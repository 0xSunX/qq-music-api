/**
 * Cloudflare Pages Function - 凭证刷新
 * POST /api/credential/refresh - 手动刷新凭证
 * Cron triggered - 自动刷新
 */

import {
    ensureCredentialTable,
    getCredentialFromDB,
    saveCredentialToDB,
    syncCredentialFromEnv
} from "../lib/credential.js";
import { buildCommonParams, buildCookies, jsonResponse, errorResponse, handleOptions } from "../lib/request.js";
import { generateSign } from "../lib/sign.js";
import { API_CONFIG } from "../lib/common.js";
import { ensureUrlCacheTable } from "../lib/urlcache.js";
import { cleanStaleRegisterRate, cleanStaleIpRate, cleanStaleLoginRate } from "../lib/user.js";
import { cleanStaleDeviceRegistry } from "../lib/device.js";
import { cleanStaleRisk } from "../lib/risk.js";
import { cleanStaleNonce } from "../lib/reqsign.js";
import { logRefresh, cleanStaleRefreshLog } from "../lib/refreshlog.js";

/**
 * 刷新凭证
 * @param {object} credential 
 * @returns {Promise<object>}
 */
async function refreshCredential(credential) {
    if (!credential.refresh_token) {
        throw new Error("缺少 refresh_token，请检查凭证是否包含 refresh_token 字段");
    }

    const params = {
        refresh_token: credential.refresh_token,
        musickey: credential.musickey,
        musicid: parseInt(credential.musicid) || 0,  // 必须是整数
    };

    // 构建 common 参数，确保 tmeLoginType 与凭证中的 login_type 一致
    const common = buildCommonParams(credential);
    // 覆盖 tmeLoginType，确保使用字符串格式
    common.tmeLoginType = String(credential.login_type || 2);

    const requestData = {
        comm: common,
        "music.login.LoginServer.Login": {
            module: "music.login.LoginServer",
            method: "Login",
            param: params,
        },
    };

    console.log(`[Refresh] 刷新请求参数: musicid=${credential.musicid}, login_type=${credential.login_type}`);

    const signature = await generateSign(requestData);
    const url = `${API_CONFIG.endpoint}?sign=${signature}`;

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Referer": "https://y.qq.com/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Origin": "https://y.qq.com",
            "Cookie": buildCookies(credential),
        },
        body: JSON.stringify(requestData),
    });

    const data = await response.json();
    const result = data["music.login.LoginServer.Login"];

    if (!result || result.code !== 0) {
        const code = result?.code;
        let errorMsg = `刷新失败: code=${code}`;

        // 常见错误码说明
        if (code === 10006) {
            errorMsg += " (refresh_token 无效或已过期，请重新登录获取新凭证)";
        } else if (code === 1000) {
            errorMsg += " (凭证已过期)";
        } else if (code === 2000) {
            errorMsg += " (签名无效)";
        }

        console.error(`[Refresh] ${errorMsg}`);
        throw new Error(errorMsg);
    }

    return result.data;
}

/**
 * 执行刷新逻辑
 * @param {D1Database} db 
 * @param {boolean} force 强制刷新
 * @returns {Promise<object>}
 */
async function doRefresh(db, force = false, envCredential = null, trigger = 'cron') {
    await ensureCredentialTable(db);

    // 环境变量仅作首次种子: 库为空时用它初始化, 库非空不覆盖
    // 刷新成功后写回数据库的新凭证不会再被环境变量顶掉
    if (envCredential) {
        try {
            const sync = await syncCredentialFromEnv(db, envCredential);
            if (sync.synced) {
                console.log(`[Refresh] ${sync.reason}`);
            }
        } catch (e) {
            console.warn("[Refresh] 环境变量种子失败:", e.message);
        }
    }

    const credential = await getCredentialFromDB(db);
    if (!credential) {
        await logRefresh(db, { trigger, success: false, reason: "未找到凭证" });
        return { success: false, message: "未找到凭证,请设置 INITIAL_CREDENTIAL 或通过 /admin 写入" };
    }

    const now = Math.floor(Date.now() / 1000);
    const createTime = credential.musickey_createtime || 0;
    const expiresIn = credential.key_expires_in || 259200;
    const expireTime = createTime + expiresIn;
    const remainingTime = expireTime - now;

    console.log(`[Refresh] 凭证剩余有效期: ${Math.floor(remainingTime / 3600)} 小时`);

    // 相对阈值:剩余不足有效期 1/3 时刷新,避免写死 48h 撞上短有效期凭证
    const refreshThreshold = Math.floor(expiresIn / 3);
    if (remainingTime < refreshThreshold || force) {
        console.log("[Refresh] 开始刷新凭证...");

        const newData = await refreshCredential(credential);

        // 更新凭证
        const updatedCredential = {
            ...credential,
            musickey: newData.musickey || credential.musickey,
            musicid: newData.musicid || credential.musicid,
            refresh_token: newData.refresh_token || credential.refresh_token,
            musickey_createtime: now,
            key_expires_in: newData.keyExpiresIn || 259200,
        };

        await saveCredentialToDB(db, updatedCredential);

        await logRefresh(db, { trigger, success: true, reason: "凭证刷新成功", expireHours: Math.floor(remainingTime / 3600) });
        console.log("[Refresh] 凭证刷新成功");
        return { success: true, message: "凭证刷新成功" };
    }

    await logRefresh(db, { trigger, success: true, reason: "凭证有效期充足, 无需刷新", expireHours: Math.floor(remainingTime / 3600) });
    return { success: true, message: "凭证有效期充足，无需刷新" };
}

/**
 * Cron 触发器入口
 */
export async function onSchedule(context) {
    const { env } = context;

    try {
        console.log("[Cron] 开始检查凭证状态...");
        const result = await doRefresh(env.DB, false, env.INITIAL_CREDENTIAL, 'cron');
        console.log(`[Cron] ${result.message}`);
    } catch (err) {
        console.error("[Cron] 刷新凭证失败:", err);
        await logRefresh(env.DB, { trigger: 'cron', success: false, reason: '刷新异常: ' + (err && err.message ? err.message : err) });
    }

    // 链接缓存改为"请求时校验有效性", 不再定时删除
    try {
        await ensureUrlCacheTable(env.DB);
        console.log("[Cron] 链接缓存已启用请求时校验策略, 跳过定时清理");
    } catch (err) {
        console.error("[Cron] 检查链接缓存表失败:", err);
    }

    // 清理陈旧的注册限速记录, 防止 register_rate 表无限膨胀
    try {
        const removed = await cleanStaleRegisterRate(env.DB, 7);
        console.log(`[Cron] 已清理 ${removed} 条陈旧注册限速记录`);
    } catch (err) {
        console.error("[Cron] 清理注册限速记录失败:", err);
    }

    // 清理陈旧的 IP 限流记录, 防止 ip_rate 表无限膨胀
    try {
        const removedIp = await cleanStaleIpRate(env.DB, 7);
        console.log(`[Cron] 已清理 ${removedIp} 条陈旧 IP 限流记录`);
    } catch (err) {
        console.error("[Cron] 清理 IP 限流记录失败:", err);
    }

    // 清理陈旧的登录限速记录, 防止 login_rate 表无限膨胀
    try {
        const removedLogin = await cleanStaleLoginRate(env.DB, 7);
        console.log(`[Cron] 已清理 ${removedLogin} 条陈旧登录限速记录`);
    } catch (err) {
        console.error("[Cron] 清理登录限速记录失败:", err);
    }

    // 清理过期的设备指纹登记记录
    try {
        const removedDev = await cleanStaleDeviceRegistry(env.DB, 7);
        console.log(`[Cron] 已清理 ${removedDev} 条过期设备登记记录`);
    } catch (err) {
        console.error("[Cron] 清理设备登记记录失败:", err);
    }

    // 清理陈旧风控事件 / MID 记录 / 限速窗口 / 过期封禁
    try {
        await cleanStaleRisk(env.DB, 7);
        console.log("[Cron] 已清理陈旧风控记录");
    } catch (err) {
        console.error("[Cron] 清理风控记录失败:", err);
    }

    // 清理过期请求签名 nonce
    try {
        await cleanStaleNonce(env.DB, 24);
        console.log("[Cron] 已清理过期请求签名 nonce");
    } catch (err) {
        console.error("[Cron] 清理请求签名 nonce 失败:", err);
    }

    // 清理过期的凭证刷新日志, 防止 refresh_log 无限膨胀 (保留最近 30 天)
    try {
        const removedLog = await cleanStaleRefreshLog(env.DB, 30);
        console.log(`[Cron] 已清理 ${removedLog} 条过期刷新日志`);
    } catch (err) {
        console.error("[Cron] 清理刷新日志失败:", err);
    }
}

/**
 * HTTP 触发器
 * POST /api/credential/refresh - 手动刷新
 */
export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") {
        return handleOptions();
    }

    if (request.method !== "POST") {
        return errorResponse("Method not allowed", 405);
    }

    try {
        const url = new URL(request.url);
        const force = url.searchParams.get("force") === "true";

        const result = await doRefresh(env.DB, force, env.INITIAL_CREDENTIAL, 'manual');
        return jsonResponse(result);
    } catch (err) {
        console.error("刷新凭证失败:", err);
        await logRefresh(env.DB, { trigger: 'manual', success: false, reason: err && err.message ? err.message : String(err) });
        return errorResponse(err.message, 500);
    }
}
