/**
 * APP 更新配置 API
 * GET /api/app/update?platform=android&version=1.0.0&build=80&channel=official
 */

import { jsonResponse, errorResponse, handleOptions } from "../../lib/request.js";

// 版本配置:正式环境应迁到 D1,这里先用静态配置兜底
const RELEASE_CONFIG = {
    android: {
        official: {
            latestVersion: "1.3.0",
            latestBuild: 130,
            minSupportBuild: 100,
            title: "发现新版本",
            changelog: ["修复播放偶发崩溃", "新增歌单同步", "优化启动速度"],
            downloadUrl: "https://example.com/app-release.apk",
            fileSize: 28311552,
            fileHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            publishedAt: 1730000000,
        },
    },
    ios: {
        official: {
            latestVersion: "1.3.0",
            latestBuild: 130,
            minSupportBuild: 100,
            title: "发现新版本",
            changelog: ["修复播放偶发崩溃"],
            downloadUrl: "https://apps.apple.com/app/id000000000",
            fileSize: 0,
            fileHash: "",
            publishedAt: 1730000000,
        },
    },
};

/**
 * 语义化版本比较: a > b 返回 1, a < b 返回 -1, 相等 0
 */
function compareVersion(a, b) {
    const pa = String(a).split(".").map(n => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va > vb) return 1;
        if (va < vb) return -1;
    }
    return 0;
}

async function loadRelease(env, platform, channel) {
    if (!env || !env.DB) return null;
    try {
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_releases (
            platform TEXT NOT NULL,
            channel TEXT NOT NULL,
            latest_version TEXT,
            latest_build INTEGER DEFAULT 0,
            min_support_build INTEGER DEFAULT 0,
            title TEXT DEFAULT '',
            changelog TEXT DEFAULT '',
            download_url TEXT DEFAULT '',
            file_size INTEGER DEFAULT 0,
            file_hash TEXT DEFAULT '',
            published_at INTEGER DEFAULT 0,
            updated_at INTEGER,
            PRIMARY KEY (platform, channel)
        )`).run();
        const row = await env.DB.prepare(
            "SELECT * FROM app_releases WHERE platform = ? AND channel = ?"
        ).bind(platform, channel).first();
        if (!row) return null;
        let changelog = [];
        if (row.changelog) {
            try { changelog = JSON.parse(row.changelog); }
            catch (e) { changelog = String(row.changelog).split(/\r?\n/).filter(Boolean); }
        }
        return {
            latestVersion: row.latest_version || "",
            latestBuild: row.latest_build || 0,
            minSupportBuild: row.min_support_build || 0,
            title: row.title || "",
            changelog: changelog,
            downloadUrl: row.download_url || "",
            fileSize: row.file_size || 0,
            fileHash: row.file_hash || "",
            publishedAt: row.published_at || 0,
        };
    } catch (e) {
        console.error("[Update] 读取 D1 配置失败,回退静态:", e);
        return null;
    }
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") return handleOptions();
    if (request.method !== "GET") return errorResponse("Method not allowed", 405);

    try {
        const url = new URL(request.url);
        const platform = (url.searchParams.get("platform") || "").toLowerCase();
        const version = url.searchParams.get("version") || "0.0.0";
        const channel = (url.searchParams.get("channel") || "official").toLowerCase();
        const build = parseInt(url.searchParams.get("build") || "0", 10);

        if (!platform) {
            return errorResponse("Missing required parameter: platform", 400);
        }

        const dbConf = await loadRelease(env, platform, channel);
        let conf = dbConf;
        if (!conf) {
            const platformConf = RELEASE_CONFIG[platform];
            if (!platformConf) {
                return errorResponse(`Unsupported platform: ${platform}`, 400);
            }
            conf = platformConf[channel] || platformConf.official;
        }
        if (!conf) {
            return errorResponse(`No release config for ${platform}/${channel}`, 404);
        }

        const versionCmp = compareVersion(conf.latestVersion, version);
        const hasUpdate = versionCmp > 0 || (versionCmp === 0 && conf.latestBuild > build);
        const forceUpdate = hasUpdate && build > 0 && build < conf.minSupportBuild;

        return jsonResponse({
            code: 0,
            data: {
                hasUpdate,
                forceUpdate,
                latestVersion: conf.latestVersion,
                latestBuild: conf.latestBuild,
                minSupportBuild: conf.minSupportBuild,
                title: conf.title,
                changelog: conf.changelog,
                downloadUrl: conf.downloadUrl,
                fileSize: conf.fileSize,
                fileHash: conf.fileHash,
                publishedAt: conf.publishedAt,
            },
        });
    } catch (err) {
        console.error("获取更新配置失败:", err);
        return errorResponse(err.message, 500);
    }
}
