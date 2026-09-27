/**
 * 歌曲播放链接 API
 * GET /api/song/url?mid=xxx&quality=flac
 */

import { batchRequest, jsonResponse, errorResponse, handleOptions } from "../../lib/request.js";
import { getGuid, parseQuality, SongFileType } from "../../lib/common.js";
import { getCredential } from "../../lib/credential.js";
import { ensureUrlCacheTable, getCachedUrls, saveCachedUrl } from "../../lib/urlcache.js";

/**
 * 音质降级顺序
 */
const QUALITY_FALLBACK = ["master", "atmos_2", "atmos_51", "flac", "320", "128"];

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") {
        return handleOptions();
    }

    if (request.method !== "GET") {
        return errorResponse("Method not allowed", 405);
    }

    try {
        const url = new URL(request.url);
        const midParam = url.searchParams.get("mid");
        const requestedQuality = url.searchParams.get("quality") || "flac";

        if (!midParam) {
            return errorResponse("Missing required parameter: mid", 400);
        }

        // 支持逗号分隔的多个 MID
        const mids = midParam.split(",").map(m => m.trim()).filter(Boolean);

        if (mids.length === 0) {
            return errorResponse("Invalid mid parameter", 400);
        }

        // 1. 先查播放链接缓存(10 分钟内同 mid + 音质直接复用)
        let urls = {};
        let actualQuality = requestedQuality;
        let pendingMids = mids;
        if (env.DB) {
            try {
                await ensureUrlCacheTable(env.DB);
                const cached = await getCachedUrls(env.DB, mids, requestedQuality);
                const hitMids = [];
                for (const mid of mids) {
                    const c = cached[mid];
                    if (c && c.url) {
                        urls[mid] = c.url;
                        actualQuality = c.quality || actualQuality;
                        hitMids.push(mid);
                    }
                }
                if (hitMids.length) {
                    pendingMids = mids.filter(function(m){ return hitMids.indexOf(m) < 0; });
                }
                if (pendingMids.length === 0) {
                    // 全部命中缓存, 直接返回, 不打上游
                    return jsonResponse({ code: 0, data: urls, quality: actualQuality, cached: true });
                }
            } catch (e) {
                console.error("读取链接缓存失败, 回退直连:", e);
                pendingMids = mids;
            }
        }

        const credential = await getCredential(env);
        const domain = "https://isure.stream.qqmusic.qq.com/";

        const { generateSign } = await import("../../lib/sign.js");
        const { API_CONFIG } = await import("../../lib/common.js");
        const { buildCookies } = await import("../../lib/request.js");

        // 构建降级队列：从请求的音质开始
        const startIndex = QUALITY_FALLBACK.indexOf(requestedQuality.toLowerCase());
        const qualityQueue = startIndex >= 0
            ? QUALITY_FALLBACK.slice(startIndex)
            : QUALITY_FALLBACK; // 如果请求的音质不在列表中，从 flac 开始

        // 仅对未命中缓存的 mid 请求上游
        const reqMids = pendingMids;

        // 尝试每个音质，直到获取成功
        for (const quality of qualityQueue) {
            const fileType = parseQuality(quality);
            const fileNames = reqMids.map(mid => `${fileType.s}${mid}${mid}${fileType.e}`);

            const params = {
                filename: fileNames,
                guid: getGuid(),
                songmid: reqMids,
                songtype: reqMids.map(() => 0),
            };

            const requestData = {
                comm: {
                    ct: "19",
                    cv: 13020508,
                    v: 13020508,
                    format: "json",
                },
                "music.vkey.GetVkey.UrlGetVkey": {
                    module: "music.vkey.GetVkey",
                    method: "UrlGetVkey",
                    param: params,
                },
            };

            if (credential) {
                requestData.comm.qq = String(credential.musicid);
                requestData.comm.authst = credential.musickey;
                requestData.comm.tmeLoginType = String(credential.login_type || 2);
            }

            const signature = await generateSign(requestData);
            const apiUrl = `${API_CONFIG.endpoint}?sign=${signature}`;

            const headers = {
                "Content-Type": "application/json",
                "Referer": "https://y.qq.com/",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Origin": "https://y.qq.com",
            };

            if (credential) {
                headers["Cookie"] = buildCookies(credential);
            }

            const response = await fetch(apiUrl, {
                method: "POST",
                headers: headers,
                body: JSON.stringify(requestData),
            });

            const data = await response.json();
            const result = data["music.vkey.GetVkey.UrlGetVkey"];

            if (!result || result.code !== 0) {
                continue; // 尝试下一个音质
            }

            // 解析结果
            const midurlinfo = result.data?.midurlinfo || [];
            let hasValidUrl = false;

            for (const info of midurlinfo) {
                const purl = info.purl || info.wifiurl || "";
                if (purl) {
                    urls[info.songmid] = domain + purl;
                    hasValidUrl = true;
                } else {
                    urls[info.songmid] = "";
                }
            }

            // 如果有任何有效 URL，使用当前音质
            if (hasValidUrl) {
                actualQuality = quality;
                break;
            }
        }

        // 回写缓存(仅缓存非空链接)
        if (env.DB) {
            try {
                for (const mid of reqMids) {
                    if (urls[mid]) {
                        await saveCachedUrl(env.DB, mid, requestedQuality, urls[mid], actualQuality);
                    }
                }
            } catch (e) {
                console.error("写入链接缓存失败:", e);
            }
        }

        return jsonResponse({
            code: 0,
            data: urls,
            quality: actualQuality,
        });

    } catch (err) {
        console.error("获取歌曲链接失败:", err);
        return errorResponse(err.message, 500);
    }
}
