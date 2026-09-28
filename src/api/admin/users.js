/**
 * 管理接口 - 用户列表 / 改等级 / 禁用启用 / 删除
 * 通过 ?action=list|level|status|delete 分发
 * 需 admin 角色
 */

import { jsonResponse, errorResponse, handleOptions } from "../../lib/request.js";
import {
    ensureUserTables,
    listUsers,
    setUserLevel,
    setUserStatus,
    deleteUser,
    getUserById,
    getUserDetail,
    updateUserInfo,
    getUsageSummary,
    getAppOpenSummary,
} from "../../lib/user.js";

export async function onRequest(context) {
    const { request, env, user } = context;

    if (request.method === "OPTIONS") return handleOptions();
    if (!env.DB) return errorResponse("D1 database not bound", 503);
    if (!user) return errorResponse("Unauthorized", 401);
    if (user.role !== "admin") return errorResponse("Forbidden: admin only", 403);

    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";

    await ensureUserTables(env.DB);

    try {
        if (action === "list") {
            const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
            const size = Math.min(parseInt(url.searchParams.get("size") || "20", 10) || 20, 100);
            const r = await listUsers(env.DB, page, size);
            return jsonResponse({ code: 0, page, size, total: r.total, list: r.list });
        }

        if (action === "detail") {
            const id = parseInt(url.searchParams.get("userId") || "0", 10);
            if (!id) return errorResponse("缺少 userId", 400);
            const d = await getUserDetail(env.DB, id);
            if (!d) return errorResponse("用户不存在", 404);
            const apiUsage = await getUsageSummary(env.DB, id);
            const appOpen = await getAppOpenSummary(env.DB, id);
            return jsonResponse({ code: 0, user: d, apiUsage: apiUsage, appOpen: appOpen });
        }

        if (action === "update") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            const body = await request.json();
            if (!body.userId) return errorResponse("缺少 userId", 400);
            const updated = await updateUserInfo(env.DB, body.userId, {
                username: body.username,
                password: body.password,
                dailyLimit: body.dailyLimit,
                level: body.level,
                status: body.status,
            });
            return jsonResponse({ code: 0, message: "已更新", user: updated });
        }

        if (action === "level") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            const body = await request.json();
            const target = await getUserById(env.DB, body.userId);
            if (!target) return errorResponse("用户不存在", 404);
            if (target.role === "admin") return errorResponse("不能修改管理员等级", 403);
            await setUserLevel(env.DB, body.userId, body.level);
            return jsonResponse({ code: 0, message: "等级已更新", userId: body.userId, level: body.level });
        }

        if (action === "status") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            const body = await request.json();
            const target = await getUserById(env.DB, body.userId);
            if (!target) return errorResponse("用户不存在", 404);
            if (target.role === "admin") return errorResponse("不能禁用管理员", 403);
            await setUserStatus(env.DB, body.userId, body.status ? 1 : 0);
            return jsonResponse({ code: 0, message: body.status ? "已启用" : "已禁用" });
        }

        if (action === "delete") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            const body = await request.json();
            const target = await getUserById(env.DB, body.userId);
            if (!target) return errorResponse("用户不存在", 404);
            if (target.role === "admin") return errorResponse("不能删除管理员", 403);
            await deleteUser(env.DB, body.userId);
            return jsonResponse({ code: 0, message: "已删除", userId: body.userId });
        }

        return errorResponse("Unknown action: " + action, 400);
    } catch (err) {
        return errorResponse(err.message, 400);
    }
}