/**
 * Cloudflare Pages Function - 凭证读取 API
 * GET /api/credential - 返回当前凭证
 */

import { getCredential } from "../lib/credential.js";
import { jsonResponse, errorResponse, handleOptions } from "../lib/request.js";

export async function onRequest(context) {
    const { request, env } = context;

    // CORS 预检
    if (request.method === "OPTIONS") {
        return handleOptions();
    }

    if (request.method !== "GET") {
        return errorResponse("Method not allowed", 405);
    }

    // 检查数据库绑定
    if (!env.DB) {
        return errorResponse("D1 database not bound. Please configure D1 binding in Cloudflare Dashboard.", 503);
    }

    try {
        // 统一入口:环境变量与库中不一致会同步覆盖
        const credential = await getCredential(env);

        if (!credential) {
            return jsonResponse({
                error: "No credential found. Please set INITIAL_CREDENTIAL secret.",
                credential: null
            }, 404);
        }

        // 构建返回格式
        const response = {
            credential: {
                ...credential,
                extra_fields: {
                    musickeyCreateTime: credential.musickey_createtime,
                    keyExpiresIn: credential.key_expires_in,
                },
            },
        };

        // 移除内部字段
        delete response.credential.musickey_createtime;
        delete response.credential.key_expires_in;

        return jsonResponse(response);

    } catch (err) {
        console.error("读取凭证失败:", err);
        return errorResponse(err.message, 500);
    }
}
