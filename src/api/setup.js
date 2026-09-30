/**
 * 站点初始化引导页
 * GET  /api/setup  显示初始化页(已初始化则锁定)
 * POST /api/setup  清空全部数据表并创建初始管理员
 *
 * 安全: 检测到已有 admin 账号即拒绝任何初始化操作
 */

import { jsonResponse, errorResponse, handleOptions } from "../lib/request.js";
import { ensureUserTables, hashPassword, randomHex } from "../lib/user.js";

// 只缓存"已初始化=true"的结果(正向缓存): 站点一旦建了 admin 极少回退,
// 但未初始化时绝不能缓存, 否则刚建完 admin 会被短时误判为未初始化。
let _initCache = { v: false, ts: 0 };
const INIT_CACHE_TTL_MS = 10000;

async function isInitialized(db) {
    const now = Date.now();
    if (_initCache.v === true && (now - _initCache.ts) < INIT_CACHE_TTL_MS) return true;
    try {
        const row = await db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").first();
        const v = !!(row && row.c > 0);
        _initCache = { v: v, ts: now };
        return v;
    } catch (e) {
        // 表不存在视为未初始化
        return false;
    }
}

export async function onRequest(context) {
    const { request, env } = context;

    if (request.method === "OPTIONS") return handleOptions();
    if (!env.DB) return errorResponse("D1 database not bound", 503);

    // POST - 执行初始化
    if (request.method === "POST") {
        try {
            await ensureUserTables(env.DB);

            // 部署密钥校验: 必须配置 SETUP_KEY 且请求头 X-Setup-Key 一致, 否则入口直接禁用
            const setupKey = env.SETUP_KEY;
            if (!setupKey) {
                return errorResponse("未配置 SETUP_KEY, 初始化入口已禁用", 403);
            }
            if ((request.headers.get("X-Setup-Key") || "") !== setupKey) {
                return errorResponse("初始化密钥无效", 403);
            }

            // 原子占锁: 单条 UPSERT 保证同一时刻只有一个初始化请求能通过, 消除 check-then-act 竞态
            await env.DB.prepare(`CREATE TABLE IF NOT EXISTS setup_lock (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                locked_at INTEGER
            )`).run();
            const lock = await env.DB.prepare(
                "INSERT INTO setup_lock (id, locked_at) VALUES (1, ?) ON CONFLICT(id) DO NOTHING"
            ).bind(Math.floor(Date.now() / 1000)).run();
            if (!(lock.meta && lock.meta.changes > 0)) {
                return errorResponse("初始化已在进行或已完成, 入口已锁定", 403);
            }

            if (await isInitialized(env.DB)) {
                // 释放本次占用的锁, 避免锁残留堵塞后续重置路径
                try { await env.DB.prepare("DELETE FROM setup_lock WHERE id = 1").run(); } catch (_) {}
                return errorResponse("站点已初始化, 初始化入口已锁定", 403);
            }

            const body = await request.json();
            const username = String(body.username || "").trim();
            const password = String(body.password || "");

            if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
                return errorResponse("用户名需 3-20 位字母、数字或下划线", 400);
            }
            if (password.length < 6) {
                return errorResponse("密码至少 6 位", 400);
            }

            // 清空所有业务表(逐表执行, 失败记录到 warnings, 不再静默吞掉)
            // 覆盖全部业务表, 含风控/签名相关表; 新表必须同步加入, 否则初始化后残留旧数据
            const tables = ["credentials", "sessions", "usage_daily", "users", "api_stats", "app_open_daily", "url_cache", "url_cache_stats", "app_notices", "app_releases", "register_rate", "ip_rate", "login_rate", "device_registry", "risk_config", "risk_rate", "risk_mid", "risk_block", "risk_events", "req_nonce"];
            const warnings = [];
            for (const t of tables) {
                try { await env.DB.prepare("DELETE FROM " + t).run(); }
                catch (e) { warnings.push(`${t}: ${e.message}`); }
            }
            // 重置自增
            try { await env.DB.prepare("DELETE FROM sqlite_sequence").run(); } catch (e) { /* 无自增表时忽略 */ }

            // 创建初始管理员 (设备标识用随机值, 避免与 setup-init 固定串冲突)
            const salt = randomHex(16);
            const hash = await hashPassword(password, salt);
            const now = Math.floor(Date.now() / 1000);
            const adminDevice = "setup-" + randomHex(8);
            // 初始管理员: daily_limit=0 表示无限制(配额分支按无限处理), max_quality='master' 解除音质上限。
            // 旧代码写 100000 是"很大但有限", 与"管理员不限"的语义不符; 改为 0 显式表达无限制。
            const r = await env.DB.prepare(
                `INSERT INTO users (username, password_hash, salt, role, level, device_id, daily_limit, max_quality, created_at, updated_at)
                 VALUES (?, ?, ?, 'admin', 'vip', ?, 0, 'master', ?, ?)`
            ).bind(username, hash, salt, adminDevice, now, now).run();

            // 重建单行表默认数据: 上方清库清掉了行, 不重建会导致相关 UPDATE 命中 0 行而静默失效
            // 1) risk_config: 后台保存风控参数 UPDATE ... WHERE id=1
            try { await env.DB.prepare("INSERT OR IGNORE INTO risk_config (id) VALUES (1)").run(); } catch (_) {}
            // 2) url_cache_stats: 缓存命中/未命中统计 UPDATE ... WHERE id=1
            try { await env.DB.prepare("INSERT OR IGNORE INTO url_cache_stats (id, hits, misses) VALUES (1, 0, 0)").run(); } catch (_) {}

            const resp = {
                code: 0,
                message: warnings.length ? "初始化完成(部分表清理失败, 见 warnings)" : "初始化完成",
                adminId: r.meta.last_row_id,
                username,
            };
            if (warnings.length) resp.warnings = warnings;
            // 初始化完成: 释放进行中锁。持久防重复初始化由 users 表 admin 存在性承担, 锁仅用于并发互斥。
            try { await env.DB.prepare("DELETE FROM setup_lock WHERE id = 1").run(); } catch (_) {}
            return jsonResponse(resp);
        } catch (err) {
            console.error("初始化失败:", err);
            // 初始化失败: 释放锁, 允许在修复问题后重试
            try { await env.DB.prepare("DELETE FROM setup_lock WHERE id = 1").run(); } catch (_) {}
            return errorResponse(err.message, 500);
        }
    }

    // GET - 状态探测 / 显示页面
    const inited = await isInitialized(env.DB);
    // ?status=1 只返回 JSON, 供控制台登录门前置判断, 不返回 HTML
    if (new URL(request.url).searchParams.get("status") === "1") {
        // 只读体检: 报告关键 Secret 与凭证是否就绪, 便于部署后一眼看出缺什么。
        // 只回布尔, 不回密钥内容, 也不会把密钥写进页面。
        let credentialSeeded = false;
        try {
            const cRow = await env.DB.prepare("SELECT COUNT(*) AS c FROM credentials WHERE id = 1 AND musickey IS NOT NULL AND musickey != ''").first();
            credentialSeeded = !!(cRow && cRow.c > 0);
        } catch (e) { /* 表不存在视为未种子 */ }
        return jsonResponse({
            code: 0,
            initialized: inited,
            setupKeyConfigured: !!env.SETUP_KEY,
            deviceSecretConfigured: !!env.DEVICE_SECRET,
            requestSecretConfigured: !!env.REQUEST_SECRET,
            credentialSeeded: credentialSeeded,
        });
    }
    return new Response(generateHtml(inited), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}

function generateHtml(inited) {
    if (inited) {
        return `\u003c!DOCTYPE html\u003e
\u003chtml lang="zh-CN"\u003e\u003chead\u003e\u003cmeta charset="UTF-8"\u003e\u003cmeta name="viewport" content="width=device-width,initial-scale=1"\u003e\u003ctitle\u003e初始化\u003c/title\u003e
\u003cstyle\u003ebody{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}.box{background:#181818;border:1px solid #222;border-radius:12px;padding:40px;max-width:420px;text-align:center}.ico{font-size:2.5rem;margin-bottom:16px}h1{font-size:1.2rem;color:#31c27c;margin-bottom:12px}p{color:#888;font-size:.9rem;line-height:1.7}a{color:#31c27c;text-decoration:none}\u003c/style\u003e\u003c/head\u003e
\u003cbody\u003e\u003cdiv class="box"\u003e\u003cdiv class="ico"\u003e🔒\u003c/div\u003e\u003ch1\u003e站点已初始化\u003c/h1\u003e\u003cp\u003e初始化入口已锁定, 不允许重复清空数据。\u003cbr\u003e如需重置, 请手动清空 users 表。\u003c/p\u003e\u003cp style="margin-top:20px"\u003e\u003ca href="/admin"\u003e前往管理控制台 →\u003c/a\u003e\u003c/p\u003e\u003c/div\u003e\u003c/body\u003e\u003c/html\u003e`;
    }

    return `\u003c!DOCTYPE html\u003e
\u003chtml lang="zh-CN"\u003e\u003chead\u003e\u003cmeta charset="UTF-8"\u003e\u003cmeta name="viewport" content="width=device-width,initial-scale=1"\u003e\u003ctitle\u003e站点初始化\u003c/title\u003e
\u003cstyle\u003e
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:20px}
.box{background:#181818;border:1px solid #222;border-radius:12px;padding:36px;width:100%;max-width:440px}
h1{font-size:1.3rem;color:#31c27c;margin-bottom:6px}
.sub{color:#666;font-size:.85rem;margin-bottom:24px}
.warn{background:#2a1e1e;border:1px solid #4a2a2a;color:#f0a020;border-radius:8px;padding:12px;font-size:.82rem;line-height:1.6;margin-bottom:20px}
.field{margin-bottom:16px}
label{display:block;color:#888;font-size:.8rem;margin-bottom:6px;font-family:monospace}
input{width:100%;background:#101010;border:1px solid #333;color:#e0e0e0;border-radius:6px;padding:11px;font-family:monospace;font-size:.9rem}
input:focus{outline:none;border-color:#31c27c}
button{width:100%;background:#31c27c;color:#000;border:none;border-radius:6px;padding:13px;font-weight:700;font-size:.95rem;cursor:pointer;margin-top:8px}
button:hover{opacity:.9}
button:disabled{background:#333;color:#666;cursor:not-allowed}
#msg{margin-top:14px;font-size:.85rem;text-align:center;min-height:20px;line-height:1.6}
.steps{color:#555;font-size:.8rem;margin-top:20px;line-height:1.9}
.steps b{color:#888}
\u003c/style\u003e\u003c/head\u003e
\u003cbody\u003e
\u003cdiv class="box"\u003e
  \u003ch1\u003e🚀 站点初始化\u003c/h1\u003e
  \u003cdiv class="sub"\u003e首次部署引导 · 创建初始管理员\u003c/div\u003e

  \u003cdiv class="warn\u003e⚠️ 此操作将清空所有数据表(凭证/用户/会话/用量/统计), 且不可恢复。\u003cbr\u003e仅限首次部署使用, 初始化后入口自动锁定。\u003c/div\u003e

  \u003cdiv class="field"\u003e\u003clabel\u003e管理员用户名\u003c/label\u003e\u003cinput id="u" placeholder="3-20 位字母数字下划线" autocomplete="off"\u003e\u003c/div\u003e
  \u003cdiv class="field"\u003e\u003clabel\u003e管理员密码\u003c/label\u003e\u003cinput id="p" type="password" placeholder="至少 6 位" autocomplete="new-password"\u003e\u003c/div\u003e
  \u003cdiv class="field"\u003e\u003clabel\u003e确认密码\u003c/label\u003e\u003cinput id="p2" type="password" placeholder="再次输入密码" autocomplete="new-password"\u003e\u003c/div\u003e

  \u003cbutton id="go"\u003e执行初始化\u003c/button\u003e
  \u003cdiv id="msg"\u003e\u003c/div\u003e

  \u003cdiv class="steps"\u003e
    \u003cb\u003e初始化后:\u003c/b\u003e\u003cbr\u003e
    1. 用此账号登录 \u003ca href="/admin" style="color:#31c27c"\u003e/admin\u003c/a\u003e\u003cbr\u003e
    2. 在控制台配置音乐凭证\u003cbr\u003e
    3. 用户管理可在此后创建普通用户
  \u003c/div\u003e
\u003c/div\u003e
\u003cscript\u003e
(function(){
  var msg=document.getElementById('msg');
  var go=document.getElementById('go');
  function setMsg(t,c){ msg.textContent=t; msg.style.color=c||'#888'; }
  // 初始化密钥输入框 (动态插入, 避开手写 HTML 转义)
  var kField=document.createElement('div');
  kField.className='field';
  var kLabel=document.createElement('label');
  kLabel.textContent='初始化密钥 (SETUP_KEY)';
  var kInput=document.createElement('input');
  kInput.id='k';
  kInput.type='password';
  kInput.placeholder='填入服务端配置的 SETUP_KEY';
  kInput.setAttribute('autocomplete','off');
  kField.appendChild(kLabel);
  kField.appendChild(kInput);
  go.parentNode.insertBefore(kField, go);
  var chkEl=document.createElement('div');
  chkEl.id='chk';
  chkEl.className='steps';
  go.parentNode.insertBefore(chkEl, kField);
  // 探测服务端是否配置 SETUP_KEY, 未配置直接提示并禁用按钮
  function renderChecklist(d){
    var items=[
      ['SETUP_KEY', d.setupKeyConfigured, '站点初始化密钥', false],
      ['DEVICE_SECRET', d.deviceSecretConfigured, '设备签名密钥', false],
      ['REQUEST_SECRET', d.requestSecretConfigured, '请求签名密钥', true],
      ['INITIAL_CREDENTIAL', d.credentialSeeded, '音乐凭证种子', true]
    ];
    var html='<b>部署自检:</b><br>';
    for(var i=0;i<items.length;i++){
      var ok=items[i][1]===true, optional=items[i][3];
      var mark=ok?'✅':(optional?'⚪':'❌');
      var color=ok?'#31c27c':(optional?'#888':'#f44');
      html+='<span style="color:'+color+'">'+mark+' '+items[i][0]+' — '+items[i][2]+'</span>';
      if(!ok&&!optional){ html+='<br><span style="color:#f44;padding-left:1.2em">请去 Cloudflare Dashboard → Settings → Variables and Secrets 补配</span>'; }
      html+='<br>';
    }
    var el=document.getElementById('chk'); if(el){ el.innerHTML=html; }
  }
  fetch('/api/setup?status=1').then(function(r){ return r.json(); }).then(function(d){
    if(d){ renderChecklist(d); }
    if(d && d.setupKeyConfigured === false){
      kInput.disabled = true;
      go.disabled = true;
      go.textContent = '初始化入口已禁用';
      setMsg('服务端未配置 SETUP_KEY, 初始化入口已禁用; 请先在 Cloudflare 添加该 Secret','#f44');
    }
  }).catch(function(){});
  go.onclick=function(){
    var u=document.getElementById('u').value.trim();
    var p=document.getElementById('p').value;
    var p2=document.getElementById('p2').value;
    if(!u||!p){ setMsg('请填写用户名和密码','#f44'); return; }
    if(p!==p2){ setMsg('两次密码不一致','#f44'); return; }
    var k=document.getElementById('k').value.trim();
    if(!k){ setMsg('请填写初始化密钥 SETUP_KEY','#f44'); return; }
    if(!confirm('确认清空所有数据并创建管理员 '+u+' ?')) return;
    go.disabled=true; setMsg('初始化中...');
    fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json','X-Setup-Key':k},body:JSON.stringify({username:u,password:p})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      if(!res.ok){ setMsg('失败: '+(res.d.error||'未知'),'#f44'); go.disabled=false; return; }
      setMsg('✅ 初始化完成! 3 秒后跳转登录页...','#31c27c');
      setTimeout(function(){ location.href='/admin'; },3000);
    }).catch(function(e){ setMsg('异常: '+e.message,'#f44'); go.disabled=false; });
  };
})();
\u003c/script\u003e
\u003c/body\u003e\u003c/html\u003e`;
}
