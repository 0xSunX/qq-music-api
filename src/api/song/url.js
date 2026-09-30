/**
 * 歌曲播放链接 API
 * GET /api/song/url?mid=xxx&quality=flac
 */

import { batchRequest, jsonResponse, errorResponse, handleOptions, buildCookies } from "../../lib/request.js";
import { getGuid, parseQuality, SongFileType, API_CONFIG } from "../../lib/common.js";
import { getCredential } from "../../lib/credential.js";
import { generateSign } from "../../lib/sign.js";
import { ensureUrlCacheTable, getCachedUrls, saveCachedUrl, validateUrl, recordCacheHit, recordCacheMiss } from "../../lib/urlcache.js";
import { qualityRank, DEFAULT_MAX_QUALITY } from "../../lib/user.js";

/**
 * 音质降级顺序
 */
const QUALITY_FALLBACK = ["master", "atmos_2", "atmos_51", "flac", "320", "128"];

export async function onRequest(context) {
    const { request, env, ctx, user } = context;

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

        // 1. 先查播放链接缓存。分级校验:
        //    - 写入 30 分钟内的: 直接信, 免校验(QQ 直链 vkey 通常数小时有效)
        //    - 写入超过 30 分钟的: 并行校验链接有效性, 有效即返回, 无效丢弃重取
        //    不再定时删除, 用"请求时校验"兜底。
        let urls = {};
        let actualQuality = requestedQuality;
        let pendingMids = mids;
        const FRESH_SECONDS = 1800; // 30 分钟
        if (env.DB) {
            try {
                await ensureUrlCacheTable(env.DB);
                const cached = await getCachedUrls(env.DB, mids, requestedQuality);
                const now = Math.floor(Date.now() / 1000);
                const hitMids = [];
                let hits = 0, misses = 0;
                // 并行处理每个 mid: 新鲜的直接信, 老的才校验
                // 先分流: 新鲜(30分钟内)的直接信, 只有老年限的才需要外网探活
                const freshHits = [];
                const staleCheck = [];
                for (const mid of mids) {
                    const c = cached[mid];
                    if (!c || !c.url) { staleCheck.push({ mid: mid, c: null }); continue; }
                    const age = now - (c.createdAt || 0);
                    if (age < FRESH_SECONDS) { freshHits.push({ mid: mid, c: c }); }
                    else { staleCheck.push({ mid: mid, c: c }); }
                }
                // 仅对老年限链接并行探活, 新鲜链接零外网开销
                const probed = await Promise.all(staleCheck.map(async function(item){
                    if (!item.c) return { mid: item.mid, ok: false };
                    const ok = await validateUrl(item.c.url);
                    return { mid: item.mid, ok: ok, url: item.c.url, quality: item.c.quality };
                }));
                const decisions = freshHits.map(function(item){
                    return { mid: item.mid, ok: true, url: item.c.url, quality: item.c.quality };
                }).concat(probed);
                for (const d of decisions) {
                    if (d.ok) {
                        urls[d.mid] = d.url;
                        if (d.quality) actualQuality = d.quality;
                        hitMids.push(d.mid);
                        hits++;
                    } else {
                        misses++;
                    }
                }
                if (hits || misses) {
                    // 命中率统计非业务必需: 有 ctx 则丢给 waitUntil 异步写, 不阻塞响应; 无 ctx 才兜底 await
                    const statsJob = (async () => {
                        if (hits) { try { await recordCacheHit(env.DB, hits); } catch (e) {} }
                        if (misses) { try { await recordCacheMiss(env.DB, misses); } catch (e) {} }
                    })();
                    if (ctx && ctx.waitUntil) { try { ctx.waitUntil(statsJob); } catch (e) { await statsJob; } }
                    else { await statsJob; }
                }
                if (hitMids.length) {
                    const hitSet = new Set(hitMids);
                    pendingMids = mids.filter(function(m){ return !hitSet.has(m); });
                }
                if (pendingMids.length === 0) {
                    // 全部命中且校验通过, 直接返回, 不打上游
                    return jsonResponse({ code: 0, data: urls, quality: actualQuality, cached: true });
                }
            } catch (e) {
                console.error("读取链接缓存失败, 回退直连:", e);
                pendingMids = mids;
            }
        }

        const credential = await getCredential(env);
        const domain = "https://isure.stream.qqmusic.qq.com/";

        // 音质权限: 普通用户受 max_quality 上限约束(超出则按上限取值); VIP/管理员不限制
        let userMaxQuality = null;
        if (user && user.role !== 'admin' && user.level !== 'vip') {
            userMaxQuality = String(user.max_quality || DEFAULT_MAX_QUALITY).toLowerCase();
        }
        let startQuality = requestedQuality.toLowerCase();
        if (userMaxQuality) {
            const rReq = qualityRank(startQuality);
            const rMax = qualityRank(userMaxQuality);
            // 请求音质高于上限, 或请求了未知音质: 统一从上限音质开始降级
            if (rMax >= 0 && (rReq < 0 || rReq > rMax)) startQuality = userMaxQuality;
        }

        // 构建降级队列：从实际允许的最高音质开始
        const startIndex = QUALITY_FALLBACK.indexOf(startQuality);
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

        // 回写缓存(仅缓存非空链接), 并行写入减少串行等待
        if (env.DB) {
            try {
                await Promise.all(reqMids
                    .filter(function(mid){ return !!urls[mid]; })
                    .map(function(mid){ return saveCachedUrl(env.DB, mid, requestedQuality, urls[mid], actualQuality); }));
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
