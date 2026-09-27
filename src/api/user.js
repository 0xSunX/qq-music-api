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
} from "../lib/user.js";

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
            const body = await request.json();
            const id = await registerUser(env.DB, body.username, body.password, body.deviceId);
            return jsonResponse({ code: 0, message: "注册成功", userId: id });
        }

        if (action === "login") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            const body = await request.json();
            const r = await loginUser(env.DB, body.username, body.password, body.deviceId);
            return jsonResponse({ code: 0, token: r.token, user: r.user });
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
                remaining: user.level === "vip" ? -1 : Math.max(0, user.daily_limit - used),
            });
        }

        return errorResponse("Unknown action: " + action, 400);
    } catch (err) {
        return errorResponse(err.message, 400);
    }
}