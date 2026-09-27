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
        // 管理侧回传完整凭证(admin 专属, 不脱敏)
        const credential = await getCredentialFromDB(env.DB);
        if (!credential) return jsonResponse({ credential: null });
        return jsonResponse({ credential });
    }

    return errorResponse("Method not allowed", 405);
}
