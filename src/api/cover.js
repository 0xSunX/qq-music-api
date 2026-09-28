/**
 * QQ Music Cover API
 * 获取歌曲封面URL，支持 mid 自动处理、album_mid 和 vs 值回退
 */

import { apiRequest, jsonResponse, errorResponse, handleOptions } from "../lib/request.js";
import { getCredential } from "../lib/credential.js";

const DEFAULT_COVER = "https://y.gtimg.cn/music/photo_new/T002R800x800M000003y8dsH2wBHlo_1.jpg";

/**
 * 通过 album_mid 生成封面 URL
 */
function getCoverUrlByAlbumMid(mid, size = 300) {
    if (!mid) return null;
    return `https://y.gtimg.cn/music/photo_new/T002R${size}x${size}M000${mid}.jpg`;
}

/**
 * 通过 vs 值生成封面 URL
 */
function getCoverUrlByVs(vs, size = 300) {
    if (!vs) return null;
    return `https://y.qq.com/music/photo_new/T062R${size}x${size}M000${vs}.jpg`;
}

/**
 * 验证封面 URL 是否有效
 */
async function checkCoverValid(url) {
    if (!url) return false;
    try {
        const resp = await fetch(url, { method: "HEAD" });
        if (resp.ok) {
            const contentLength = resp.headers.get("content-length");
            return contentLength && parseInt(contentLength) > 1024;
        }
    } catch (e) {
        // 忽略错误
    }
    return false;
}

/**
 * 获取第一个非空的 vs 值
 */
function getFirstValidVs(vsArray) {
    if (!Array.isArray(vsArray)) return null;
    for (const vs of vsArray) {
        if (vs && typeof vs === "string" && vs.length >= 3 && !vs.includes(",")) {
            return vs;
        }
    }
    return null;
}

/**
 * 获取有效封面 URL（带验证）
 */
async function getValidCoverUrl(albumMid, vsArray, size) {
    // 1. 尝试 album_mid
    if (albumMid) {
        const url = getCoverUrlByAlbumMid(albumMid, size);
        if (await checkCoverValid(url)) {
            return { url, source: "album_mid" };
        }
    }

    // 2. 尝试 vs 值
    if (Array.isArray(vsArray) && vsArray.length > 0) {
        const candidates = [];
        for (const vs of vsArray) {
            if (vs && typeof vs === "string" && vs.length >= 3) {
                if (vs.includes(",")) {
                    const parts = vs.split(",").map(p => p.trim()).filter(p => p.length >= 3);
                    candidates.push(...parts);
                } else {
                    candidates.push(vs);
                }
            }
        }

        for (const candidate of candidates) {
            const url = getCoverUrlByVs(candidate, size);
            if (await checkCoverValid(url)) {
                return { url, source: "vs", vs: candidate };
            }
        }
    }

    // 3. 返回默认封面
    return { url: DEFAULT_COVER.replace("R800x800", `R${size}x${size}`), source: "default" };
}

/**
 * 同步获取封面（不验证）
 */
function getCoverUrlSync(albumMid, vsArray, size) {
    if (albumMid) {
        return { url: getCoverUrlByAlbumMid(albumMid, size), source: "album_mid" };
    }

    const firstVs = getFirstValidVs(vsArray);
    if (firstVs) {
        return { url: getCoverUrlByVs(firstVs, size), source: "vs", vs: firstVs };
    }

    return { url: DEFAULT_COVER.replace("R800x800", `R${size}x${size}`), source: "default" };
}

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") {
        return handleOptions();
    }

    if (request.method !== "GET") {
        return errorResponse("Method not allowed", 405);
    }

    const url = new URL(request.url);
    const params = url.searchParams;

    // 获取参数
    const mid = params.get("mid") || "";
    const albumMid = params.get("album_mid") || params.get("albumMid") || "";
    const vsParam = params.get("vs") || "";
    const size = parseInt(params.get("size") || "300");
    const validate = params.get("validate") !== "false";

    // 验证 size
    const validSizes = [150, 300, 500, 800];
    const finalSize = validSizes.includes(size) ? size : 300;

    // 解析 vs 数组
    let vsArray = [];
    if (vsParam) {
        try {
            vsArray = JSON.parse(vsParam);
        } catch {
            vsArray = vsParam.split(",").map(v => v.trim()).filter(v => v);
        }
    }

    try {
        let finalAlbumMid = albumMid;
        let finalVsArray = vsArray;

        // 如果传入了歌曲 mid，自动获取详情
        if (mid && !albumMid && vsArray.length === 0) {
            const credential = await getCredential(env);

            const data = await apiRequest(
                "music.pf_song_detail_svr",
                "get_song_detail_yqq",
                { song_mid: mid },
                credential
            );

            // 从详情中提取 album_mid 和 vs
            const trackInfo = data?.track_info || {};
            finalAlbumMid = trackInfo?.album?.mid || "";
            finalVsArray = trackInfo?.vs || [];
        }

        // 如果仍然没有参数
        if (!finalAlbumMid && finalVsArray.length === 0) {
            return errorResponse("请提供 mid、album_mid 或 vs 参数", 400);
        }

        // 获取封面
        let result;
        if (validate) {
            result = await getValidCoverUrl(finalAlbumMid, finalVsArray, finalSize);
        } else {
            result = getCoverUrlSync(finalAlbumMid, finalVsArray, finalSize);
        }

        return jsonResponse({
            code: 0,
            data: {
                url: result.url,
                source: result.source,
                size: finalSize,
                ...(result.vs ? { vs: result.vs } : {})
            }
        });

    } catch (error) {
        console.error("获取封面失败:", error);
        return errorResponse(error.message, 500);
    }
}
