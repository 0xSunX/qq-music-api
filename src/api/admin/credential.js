/**
 * 管理接口 - 凭证写入 (原 /admin/credential)
 * POST /api/admin/credential  更新 QQ 音乐凭证
 * GET  /api/admin/credential  查看凭证状态(脱敏)
 * 需 admin 角色
 */

import {
    parseCredential,
    ensureCredentialTable,
    getCredentialFromDB,
    saveCredentialToDB,
} from "../../lib/credential.js";
import { listRefreshLogs, getLastRefresh, getRefreshStats } from "../../lib/refreshlog.js";
import { jsonResponse, errorResponse, handleOptions } from "../../lib/request.js";

export async function onRequest(context) {
    const { request, env, user } = context;

    if (request.method === "OPTIONS") return handleOptions();
    if (!env.DB) return errorResponse("D1 database not bound", 503);

    // 强制 admin
    if (!user) return errorResponse("Unauthorized", 401);
    if (user.role !== "admin") return errorResponse("Forbidden: admin only", 403);

    if (request.method === "POST") {
        try {
            const body = await request.json();
            const credentialData = body.credential || body;

            if (!credentialData.musicid || !credentialData.musickey) {
                return errorResponse("缺少 musicid 或 musickey", 400);
            }

            await ensureCredentialTable(env.DB);
            const credential = parseCredential(JSON.stringify(credentialData));
            if (!credential) return errorResponse("凭证格式无效", 400);

            await saveCredentialToDB(env.DB, credential);
            return jsonResponse({ success: true, message: "凭证已更新", musicid: credential.musicid });
        } catch (err) {
            return errorResponse(err.message, 500);
        }
    }

    if (request.method === "GET") {
        // 刷新日志子资源: ?action=last|logs|stats (admin 专属)
        const url = new URL(request.url);
        const action = url.searchParams.get("action") || "";
        if (action === "last") {
            const last = await getLastRefresh(env.DB);
            return jsonResponse({ last: last || null });
        }
        if (action === "stats") {
            const days = parseInt(url.searchParams.get("days") || "30", 10) || 30;
            return jsonResponse({ stats: await getRefreshStats(env.DB, days) });
        }
        if (action === "logs") {
            const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
            const size = Math.min(parseInt(url.searchParams.get("size") || "20", 10) || 20, 100);
            const r = await listRefreshLogs(env.DB, page, size);
            return jsonResponse({ page, size, total: r.total, list: r.list });
        }
        // 管理侧回传完整凭证(admin 专属, 不脱敏)
        const credential = await getCredentialFromDB(env.DB);
        if (!credential) return jsonResponse({ credential: null });
        // 剔除 refresh_key, 不再对外暴露该字段
        const safe = Object.assign({}, credential);
        delete safe.refresh_key;
        return jsonResponse({ credential: safe });
    }

    return errorResponse("Method not allowed", 405);
}
