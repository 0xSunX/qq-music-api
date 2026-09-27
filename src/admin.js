/**
 * Admin 页面 - 数据库初始化
 * GET /admin - 显示初始化页面
 */

import {
    parseCredential,
    ensureCredentialTable,
    getCredentialFromDB,
    saveCredentialToDB,
    syncCredentialFromEnv
} from "./lib/credential.js";
import { corsHeaders } from "./lib/request.js";

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    // POST - 更新凭证
    if (request.method === "POST") {
        if (!env.DB) {
            return new Response(JSON.stringify({ error: "D1 database not bound" }), {
                status: 503,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }

        try {
            const body = await request.json();

            // 支持两种格式: { credential: {...} } 或直接 {...}
            const credentialData = body.credential || body;

            if (!credentialData.musicid || !credentialData.musickey) {
                return new Response(JSON.stringify({ error: "缺少 musicid 或 musickey" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            await ensureCredentialTable(env.DB);

            // 解析并保存凭证
            const credential = parseCredential(JSON.stringify(credentialData));
            if (!credential) {
                return new Response(JSON.stringify({ error: "凭证格式无效" }), {
                    status: 400,
                    headers: { "Content-Type": "application/json", ...corsHeaders }
                });
            }

            await saveCredentialToDB(env.DB, credential);

            return new Response(JSON.stringify({
                success: true,
                message: "凭证已更新",
                musicid: credential.musicid
            }), {
                status: 200,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), {
                status: 500,
                headers: { "Content-Type": "application/json", ...corsHeaders }
            });
        }
    }

    // GET - 显示状态页面
    // 检查数据库绑定
    const dbStatus = env.DB ? "✅ 已绑定" : "❌ 未绑定";
    const credentialStatus = env.INITIAL_CREDENTIAL ? "✅ 已设置" : "❌ 未设置";

    let initResult = "";
    let credential = null;

    if (env.DB) {
        try {
            // 确保表存在
            await ensureCredentialTable(env.DB);

            // 以环境变量为准同步凭证:musickey 不一致就覆盖,库空则初始化
            const syncResult = await syncCredentialFromEnv(env.DB, env.INITIAL_CREDENTIAL);
            credential = syncResult.credential;

            if (syncResult.synced) {
                initResult = `✅ ${syncResult.reason}`;
            } else if (syncResult.credential) {
                initResult = `ℹ️ ${syncResult.reason}`;
            } else {
                initResult = `⚠️ ${syncResult.reason}`;
            }
        } catch (err) {
            initResult = `❌ 初始化失败: ${err.message}`;
        }
    }

    const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - QQ Music API</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, sans-serif; background: #1a1a1a; color: #e0e0e0; min-height: 100vh; display: flex; justify-content: center; align-items: center; }
        .container { max-width: 500px; padding: 40px; }
        h1 { font-size: 1.5rem; margin-bottom: 30px; color: #fff; }
        .status { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
        .status-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #333; }
        .status-row:last-child { border: none; }
        .label { color: #888; }
        .value { font-family: monospace; }
        .result { background: #222; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
        .credential { background: #181818; border-radius: 4px; padding: 12px; font-family: monospace; font-size: 0.85rem; word-break: break-all; }
        a { color: #31c27c; text-decoration: none; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔧 Admin</h1>
        
        <div class="status">
            <div class="status-row">
                <span class="label">D1 数据库</span>
                <span class="value">${dbStatus}</span>
            </div>
            <div class="status-row">
                <span class="label">INITIAL_CREDENTIAL</span>
                <span class="value">${credentialStatus}</span>
            </div>
        </div>
        
        <div class="result">
            <p>${initResult}</p>
        </div>
        

        
        <p style="margin-top: 20px; text-align: center;">
            <a href="/">← 返回首页</a>
        </p>
    </div>
</body>
</html>`;

    return new Response(html, {
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            ...corsHeaders,
        },
    });
}
