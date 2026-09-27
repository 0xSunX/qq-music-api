/**
 * 专辑 API
 * GET /api/album?mid=xxx
 */

import { apiRequest, jsonResponse, errorResponse, handleOptions } from "../lib/request.js";
import { getCredential } from "../lib/credential.js";

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") return handleOptions();
    if (request.method !== "GET") return errorResponse("Method not allowed", 405);

    try {
        const url = new URL(request.url);
        const mid = url.searchParams.get("mid");
        const id = url.searchParams.get("id");

        if (!mid && !id) {
            return errorResponse("Missing required parameter: mid or id", 400);
        }

        const credential = await getCredential(env);
        const params = mid
            ? { albumMid: mid }
            : { albumId: parseInt(id) };

        const data = await apiRequest(
            "music.musichallAlbum.AlbumInfoServer",
            "GetAlbumDetail",
            params,
            credential
        );

        return jsonResponse({ code: 0, data });

    } catch (err) {
        console.error("获取专辑失败:", err);
        return errorResponse(err.message, 500);
    }
}
