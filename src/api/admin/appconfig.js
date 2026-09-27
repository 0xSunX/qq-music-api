/**
 * 管理接口 - APP 公告 / 更新配置 在线调试
 * GET  /api/admin/appconfig?type=notice|update   读取当前配置
 * POST /api/admin/appconfig?type=notice|update   写入/更新配置
 * 需 admin 角色
 */

import { jsonResponse, errorResponse, handleOptions } from "../../lib/request.js";

async function ensureConfigTables(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS app_releases (
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
    await db.prepare(`CREATE TABLE IF NOT EXISTS app_notices (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        level TEXT DEFAULT 'info',
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        action_text TEXT DEFAULT '',
        action_url TEXT DEFAULT '',
        force_show INTEGER DEFAULT 0,
        platforms TEXT DEFAULT '',
        min_version TEXT DEFAULT '',
        max_version TEXT DEFAULT '',
        channels TEXT DEFAULT '',
        start_at INTEGER DEFAULT 0,
        end_at INTEGER DEFAULT 0,
        priority INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        updated_at INTEGER
    )`).run();
}

function splitList(v) {
    if (!v) return "";
    if (Array.isArray(v)) return v.filter(Boolean).join(",");
    return String(v).split(",").map(s => s.trim()).filter(Boolean).join(",");
}

async function readNotices(db) {
    const r = await db.prepare("SELECT * FROM app_notices ORDER BY priority DESC").all();
    return r.results || [];
}

async function readReleases(db) {
    const r = await db.prepare("SELECT * FROM app_releases ORDER BY platform, channel").all();
    return r.results || [];
}

export async function onRequest(context) {
    const { request, env, user } = context;

    if (request.method === "OPTIONS") return handleOptions();
    if (!env.DB) return errorResponse("D1 database not bound", 503);
    if (!user) return errorResponse("Unauthorized", 401);
    if (user.role !== "admin") return errorResponse("Forbidden: admin only", 403);

    await ensureConfigTables(env.DB);

    const url = new URL(request.url);
    const type = url.searchParams.get("type") || "notice";

    try {
        if (request.method === "GET") {
            if (type === "notice") {
                return jsonResponse({ code: 0, type: "notice", list: await readNotices(env.DB) });
            }
            if (type === "update") {
                return jsonResponse({ code: 0, type: "update", list: await readReleases(env.DB) });
            }
            return errorResponse("Unknown type: " + type, 400);
        }

        if (request.method === "POST") {
            const body = await request.json();
            const now = Math.floor(Date.now() / 1000);

            if (type === "notice") {
                const id = String(body.id || "").trim();
                const title = String(body.title || "").trim();
                const content = String(body.content || "").trim();
                if (!id) return errorResponse("缺少 id", 400);
                if (!title) return errorResponse("缺少 title", 400);
                if (!content) return errorResponse("缺少 content", 400);

                await env.DB.prepare(`INSERT INTO app_notices
                    (id, type, level, title, content, action_text, action_url, force_show,
                     platforms, min_version, max_version, channels, start_at, end_at, priority, enabled, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        type = excluded.type, level = excluded.level, title = excluded.title,
                        content = excluded.content, action_text = excluded.action_text,
                        action_url = excluded.action_url, force_show = excluded.force_show,
                        platforms = excluded.platforms, min_version = excluded.min_version,
                        max_version = excluded.max_version, channels = excluded.channels,
                        start_at = excluded.start_at, end_at = excluded.end_at,
                        priority = excluded.priority, enabled = excluded.enabled,
                        updated_at = excluded.updated_at`)
                    .bind(
                        id,
                        String(body.type || "popup"),
                        String(body.level || "info"),
                        title,
                        content,
                        String(body.actionText || ""),
                        String(body.actionUrl || ""),
                        body.forceShow ? 1 : 0,
                        splitList(body.platforms),
                        String(body.minVersion || ""),
                        String(body.maxVersion || ""),
                        splitList(body.channels),
                        parseInt(body.startAt, 10) || 0,
                        parseInt(body.endAt, 10) || 0,
                        parseInt(body.priority, 10) || 0,
                        body.enabled === false ? 0 : 1,
                        now
                    ).run();

                return jsonResponse({ code: 0, message: "公告已保存", id });
            }

            if (type === "update") {
                const platform = String(body.platform || "").trim().toLowerCase();
                const channel = String(body.channel || "official").trim().toLowerCase();
                if (!platform) return errorResponse("缺少 platform", 400);

                const changelog = Array.isArray(body.changelog)
                    ? JSON.stringify(body.changelog)
                    : String(body.changelog || "");

                await env.DB.prepare(`INSERT INTO app_releases
                    (platform, channel, latest_version, latest_build, min_support_build,
                     title, changelog, download_url, file_size, file_hash, published_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(platform, channel) DO UPDATE SET
                        latest_version = excluded.latest_version, latest_build = excluded.latest_build,
                        min_support_build = excluded.min_support_build, title = excluded.title,
                        changelog = excluded.changelog, download_url = excluded.download_url,
                        file_size = excluded.file_size, file_hash = excluded.file_hash,
                        published_at = excluded.published_at, updated_at = excluded.updated_at`)
                    .bind(
                        platform,
                        channel,
                        String(body.latestVersion || ""),
                        parseInt(body.latestBuild, 10) || 0,
                        parseInt(body.minSupportBuild, 10) || 0,
                        String(body.title || "发现新版本"),
                        changelog,
                        String(body.downloadUrl || ""),
                        parseInt(body.fileSize, 10) || 0,
                        String(body.fileHash || ""),
                        parseInt(body.publishedAt, 10) || now,
                        now
                    ).run();

                return jsonResponse({ code: 0, message: "更新配置已保存", platform, channel });
            }

            return errorResponse("Unknown type: " + type, 400);
        }

        return errorResponse("Method not allowed", 405);
    } catch (err) {
        return errorResponse(err.message, 400);
    }
}
