/**
 * APP 公告 API
 * GET /api/app/notice?platform=android&version=1.2.0&channel=official
 */

import { jsonResponse, errorResponse, handleOptions } from "../../lib/request.js";

// 静态兜底配置。正式环境应迁到 D1 的 app_notices 表
const STATIC_NOTICES = [
    {
        id: "notice_welcome",
        type: "popup",
        level: "info",
        title: "欢迎使用",
        content: "当前为测试版本,遇到问题请反馈。",
        actionText: "知道了",
        actionUrl: "",
        forceShow: false,
        platforms: ["android", "ios"],
        minVersion: "",
        maxVersion: "",
        channels: [],
        startAt: 0,
        endAt: 0,
        priority: 1,
        enabled: true,
    },
];

function compareVersion(a, b) {
    const pa = String(a).split(".").map(n => parseInt(n, 10) || 0);
    const pb = String(b).split(".").map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const va = pa[i] || 0, vb = pb[i] || 0;
        if (va > vb) return 1;
        if (va < vb) return -1;
    }
    return 0;
}

function matchVersion(version, minVersion, maxVersion) {
    if (!version) return true;
    if (minVersion && compareVersion(version, minVersion) < 0) return false;
    if (maxVersion && compareVersion(version, maxVersion) > 0) return false;
    return true;
}

function matchChannel(channel, channels) {
    if (!channels || channels.length === 0) return true;
    return channels.includes(channel);
}

function matchPlatform(platform, platforms) {
    if (!platforms || platforms.length === 0) return true;
    return platforms.includes(platform);
}

async function loadNotices(env) {
    if (!env.DB) return STATIC_NOTICES;

    try {
        await env.DB.prepare(`
            CREATE TABLE IF NOT EXISTS app_notices (
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
            )
        `).run();

        const result = await env.DB.prepare(
            "SELECT * FROM app_notices WHERE enabled = 1"
        ).all();

        if (!result.results || result.results.length === 0) return STATIC_NOTICES;

        return result.results.map(row => ({
            id: row.id,
            type: row.type,
            level: row.level || "info",
            title: row.title,
            content: row.content,
            actionText: row.action_text || "",
            actionUrl: row.action_url || "",
            forceShow: !!row.force_show,
            platforms: row.platforms ? row.platforms.split(",").filter(Boolean) : [],
            minVersion: row.min_version || "",
            maxVersion: row.max_version || "",
            channels: row.channels ? row.channels.split(",").filter(Boolean) : [],
            startAt: row.start_at || 0,
            endAt: row.end_at || 0,
            priority: row.priority || 0,
            enabled: !!row.enabled,
        }));
    } catch (err) {
        console.error("[Notice] 读取公告失败,回退静态配置:", err);
        return STATIC_NOTICES;
    }
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") return handleOptions();
    if (request.method !== "GET") return errorResponse("Method not allowed", 405);

    try {
        const url = new URL(request.url);
        const platform = (url.searchParams.get("platform") || "").toLowerCase();
        const version = url.searchParams.get("version") || "";
        const channel = (url.searchParams.get("channel") || "official").toLowerCase();

        const now = Math.floor(Date.now() / 1000);
        const all = await loadNotices(env);

        const notices = all
            .filter(n => n.enabled)
            .filter(n => matchPlatform(platform, n.platforms))
            .filter(n => matchChannel(channel, n.channels))
            .filter(n => matchVersion(version, n.minVersion, n.maxVersion))
            .filter(n => !n.startAt || now >= n.startAt)
            .filter(n => !n.endAt || now < n.endAt)
            .sort((a, b) => b.priority - a.priority)
            .map(n => ({
                id: n.id,
                type: n.type,
                level: n.level,
                title: n.title,
                content: n.content,
                actionText: n.actionText,
                actionUrl: n.actionUrl,
                forceShow: n.forceShow,
                startAt: n.startAt,
                endAt: n.endAt,
                priority: n.priority,
            }));

        return jsonResponse({
            code: 0,
            data: {
                notices,
                serverTime: now,
            },
        });
    } catch (err) {
        console.error("获取公告失败:", err);
        return errorResponse(err.message, 500);
    }
}
