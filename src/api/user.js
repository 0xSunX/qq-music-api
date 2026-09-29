/**
 * 用户接口 - 注册 / 登录 / 登出 / 当前信息
 * 通过 ?action=register|login|logout|me 分发
 */

import { jsonResponse, errorResponse, handleOptions } from "../lib/request.js";
import {
    ensureUserTables,
    registerUser,
    loginUser,
    logoutUser,
    publicUser,
    getUsageToday,
    recordAppOpen,
    checkRegisterRate,
    checkLoginRate,
    checkIpRate,
    recordLoginFail,
    clearLoginFail,
    getLoginFailCount,
    VIP_DAILY_LIMIT,
} from "../lib/user.js";
import { signDeviceIdDedup } from "../lib/device.js";

export async function onRequest(context) {
    const { request, env, user } = context;

    if (request.method === "OPTIONS") return handleOptions();
    if (!env.DB) return errorResponse("D1 database not bound", 503);

    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";

    await ensureUserTables(env.DB);

    try {
        if (action === "register") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            // 注册限速: 同一 IP 每小时最多 5 次, 防止批量刷注册
            const ip = (request.headers.get("CF-Connecting-IP")
                || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim()
                || "unknown");
            const allowed = await checkRegisterRate(env.DB, ip, 5, 3600);
            if (!allowed) return errorResponse("注册过于频繁, 请稍后再试", 429);
            let body;
            try {
                body = await request.json();
            } catch (e) {
                return errorResponse("请求体需为合法 JSON", 400);
            }
            const id = await registerUser(env.DB, body.username, body.password, body.deviceId, env.DEVICE_SECRET);
            return jsonResponse({ code: 0, message: "注册成功", userId: id });
        }

        if (action === "login") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            let body;
            try { body = await request.json(); }
            catch (e) { return errorResponse("请求体需为合法 JSON", 400); }
            // IP 维度登录限速(防爆破): 同一 IP 15 分钟内最多 20 次尝试
            const ip = (request.headers.get("CF-Connecting-IP")
                || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim()
                || "unknown");
            const ipOk = await checkLoginRate(env.DB, "ip", ip, 20, 900);
            if (!ipOk) return errorResponse("登录尝试过于频繁, 请稍后再试", 429);
            // 用户名维度锁定: 15 分钟内失败达 10 次直接拒绝, 防定向爆破
            const failCount = await getLoginFailCount(env.DB, body.username);
            if (failCount >= 10) return errorResponse("该账号失败次数过多, 请稍后再试", 429);
            try {
                const r = await loginUser(env.DB, body.username, body.password, body.deviceId, env.DEVICE_SECRET);
                await clearLoginFail(env.DB, body.username);
                return jsonResponse({ code: 0, token: r.token, user: r.user });
            } catch (e) {
                // 用户名维度失败计数(15 分钟内最多 10 次失败)
                await recordLoginFail(env.DB, body.username);
                return errorResponse(e.message, 400);
            }
        }

        if (action === "device") {
            // 签发设备标识签名(公开): 客户端用稳定 fingerprint 换取带签名的 deviceId
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            if (!env.DEVICE_SECRET) return errorResponse("服务端未配置 DEVICE_SECRET", 503);
            // IP 限流: 同一 IP 每分钟最多 30 次签发, 防海量随机指纹灌登记表
            const devIp = (request.headers.get("CF-Connecting-IP")
                || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim()
                || "unknown");
            const devIpOk = await checkIpRate(env.DB, devIp, "/api/user?action=device", 30, 60);
            if (!devIpOk) return errorResponse("设备签发过于频繁, 请稍后再试", 429);
            let body;
            try { body = await request.json(); }
            catch (e) { return errorResponse("请求体需为合法 JSON", 400); }
            try {
                const deviceId = await signDeviceIdDedup(env.DB, env.DEVICE_SECRET, body.fingerprint);
                return jsonResponse({ code: 0, deviceId });
            } catch (e) {
                return errorResponse(e.message, 400);
            }
        }

        if (action === "appopen") {
            // 记录一次 APP 打开, 需登录
            if (!user) return errorResponse("Unauthorized", 401);
            await recordAppOpen(env.DB, user.id);
            return jsonResponse({ code: 0, message: "已记录" });
        }

        if (action === "logout") {
            const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
            await logoutUser(env.DB, token);
            return jsonResponse({ code: 0, message: "已登出" });
        }

        if (action === "me") {
            if (!user) return errorResponse("Unauthorized", 401);
            const used = await getUsageToday(env.DB, user.id);
            return jsonResponse({
                code: 0,
                user: publicUser(user),
                usageToday: used,
                remaining: user.role === "admin" ? -1 : Math.max(0, (user.level === "vip" ? VIP_DAILY_LIMIT : user.daily_limit) - used),
            });
        }

        return errorResponse("Unknown action: " + action, 400);
    } catch (err) {
        return errorResponse(err.message, 400);
    }
}