/**
 * QQ Music API - Cloudflare Workers 入口
 * 统一路由处理
 */

// 导入各个 API 模块
import * as refresh from "./api/refresh.js";
import * as search from "./api/search.js";
import * as songUrl from "./api/song/url.js";
import * as songDetail from "./api/song/detail.js";
import * as cover from "./api/cover.js";
import * as lyric from "./api/lyric.js";
import * as album from "./api/album.js";
import * as playlist from "./api/playlist.js";
import * as singer from "./api/singer.js";
import * as top from "./api/top.js";
import * as appUpdate from "./api/app/update.js";
import * as appNotice from "./api/app/notice.js";
import * as adminCredential from "./api/admin/credential.js";
import * as adminAppConfig from "./api/admin/appconfig.js";
import * as userApi from "./api/user.js";
import * as adminUsers from "./api/admin/users.js";
import * as adminPage from "./api/admin/page.js";
import * as adminCache from "./api/admin/cache.js";
import * as adminRisk from "./api/admin/risk.js";
import * as adminCredPage from "./api/admin/credpage.js";
import * as setup from "./api/setup.js";
import { ensureStatsTable, incrementCount, getTotalCount } from "./lib/stats.js";
import { ensureUserTables, verifySession, reserveUsage, releaseUsage, countUsage, checkIpRate, VIP_DAILY_LIMIT } from "./lib/user.js";
import { ensureRiskTables, inspectRequest, logRiskEvent } from "./lib/risk.js";
import { verifyRequestSignature, getReqSignEnabled } from "./lib/reqsign.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Device-Id, X-Req-Sign, X-Req-Ts, X-Req-Nonce",
};

/**
 * 路由表
 */
const routes = {
    "/api/credential/refresh": refresh,
    "/api/search": search,
    "/api/song/url": songUrl,
    "/api/song/detail": songDetail,
    "/api/song/cover": cover,
    "/api/lyric": lyric,
    "/api/album": album,
    "/api/playlist": playlist,
    "/api/singer": singer,
    "/api/top": top,
    "/api/app/update": appUpdate,
    "/api/app/notice": appNotice,
    "/api/user": userApi,
    "/api/admin/users": adminUsers,
    "/admin/users": adminPage,
    "/api/admin/credential": adminCredential,
    "/api/admin/appconfig": adminAppConfig,
    "/api/admin/cache": adminCache,
    "/api/admin/risk": adminRisk,
    "/admin/risk": adminRisk,
    "/admin/credential": adminCredPage,
    "/api/setup": setup,
};

// 免鉴权的公开路由(register/login 额外豁免)
// /admin 是控制台页面, 前端密码登录; /admin/users 复用同一 token
const PUBLIC_ROUTES = ["/admin", "/admin/users", "/admin/cache", "/admin/risk", "/admin/credential", "/api/setup", "/api/app/update", "/api/app/notice", "/api/search", "/api/top"];
// 需 admin 角色的数据接口(登录后仍要校验角色, 统一以 [admin] 前缀标注)
const ADMIN_ROUTES = ["/api/admin/users", "/api/admin/credential", "/api/admin/appconfig", "/api/admin/cache", "/api/admin/risk"];

// 需要统计的 API 端点
const statsEndpoints = [
    "/api/search",
    "/api/song/url",
    "/api/song/detail",
    "/api/song/cover",
    "/api/lyric",
    "/api/album",
    "/api/playlist",
    "/api/singer",
    "/api/top",
    "/api/app/update",
    "/api/app/notice",
    "/api/credential/refresh",
];

/**
 * 生成首页 HTML —— 服务门户(不暴露运营数据)
 * @param {object} env Workers 环境
 */
async function generateIndexHtml(env) {
    // 服务状态: 只探测"是否就绪", 不暴露任何运营数据(总量/排行已移入 admin)。
    let dbReady = false;
    let credSeeded = false;
    if (env && env.DB) {
        try {
            const r = await env.DB.prepare("SELECT COUNT(*) AS c FROM credentials WHERE id = 1 AND musickey IS NOT NULL AND musickey != ''").first();
            credSeeded = !!(r && r.c > 0);
            dbReady = true;
        } catch (e) { dbReady = false; }
    }

    const API_LIST = [
        ['/api/search', '搜索歌曲/歌手/专辑/歌单 (公开, IP 限流)'],
        ['/api/song/url', '获取歌曲播放链接'],
        ['/api/song/detail', '获取歌曲详情'],
        ['/api/song/cover', '获取歌曲封面'],
        ['/api/lyric', '获取歌词'],
        ['/api/album', '获取专辑详情'],
        ['/api/playlist', '获取歌单详情'],
        ['/api/singer', '获取歌手信息'],
        ['/api/top', '获取排行榜 (公开, IP 限流)'],
        ['/api/app/update', 'APP 更新配置'],
        ['/api/app/notice', 'APP 公告']
    ];
    const apiRows = API_LIST.map(function(a){
        return '\u003ctr\u003e\u003ctd class="ep"\u003e' + a[0] + '\u003c/td\u003e\u003ctd class="desc"\u003e' + a[1] + '\u003c/td\u003e\u003c/tr\u003e';
    }).join('');

    return `\u003c!DOCTYPE html\u003e
\u003chtml lang="zh-CN"\u003e
\u003chead\u003e
\u003cmeta charset="UTF-8"\u003e
\u003cmeta name="viewport" content="width=device-width,initial-scale=1"\u003e
\u003cmeta name="robots" content="noindex,nofollow,noarchive"\u003e
\u003cmeta name="referrer" content="no-referrer"\u003e
\u003ctitle\u003eQQ Music API · 服务门户\u003c/title\u003e
\u003cstyle\u003e
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#0f0f0f;color:#e0e0e0;line-height:1.6}
.c{max-width:760px;margin:0 auto;padding:48px 20px}
.hero{text-align:center;padding:30px 0 40px}
.hero h1{font-size:2.2rem;color:#fff;letter-spacing:1px;margin-bottom:10px}
.hero .sub{color:#666;font-size:.95rem}
.hero .big{font-size:3rem;color:#31c27c;font-weight:700;margin:24px 0 4px;font-variant-numeric:tabular-nums}
.hero .lbl{color:#555;font-size:.8rem;letter-spacing:2px;text-transform:uppercase}
h2{font-size:1rem;color:#31c27c;margin:36px 0 14px;padding-bottom:8px;border-bottom:1px solid #222}
.card{background:#181818;border:1px solid #222;border-radius:10px;overflow:hidden}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{padding:10px 16px;text-align:left;border-bottom:1px solid #222}
th{color:#666;font-weight:500;font-size:.78rem;letter-spacing:1px;text-transform:uppercase}
tr:last-child td{border-bottom:none}
tr:hover{background:#1f1f1f}
.ep{font-family:monospace;color:#4facfe}
.ct{font-family:monospace;color:#31c27c;text-align:right;font-weight:600}
.desc{color:#888}
.empty{text-align:center;color:#555;padding:24px}
footer{margin-top:50px;text-align:center;color:#333;font-size:.82rem}
footer a{color:#31c27c;text-decoration:none}
.badges{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin:22px 0 6px}
.badge{display:inline-flex;align-items:center;gap:7px;background:#181818;border:1px solid #2a2a2a;border-radius:999px;padding:7px 16px;font-size:.85rem;color:#bbb}
.badge i{width:8px;height:8px;border-radius:50%;display:inline-block;background:#666}
.badge.on i{background:#31c27c;box-shadow:0 0 8px #31c27c}
.badge.off i{background:#f44;box-shadow:0 0 8px #f44}
.btn{display:inline-block;background:linear-gradient(135deg,#31c27c,#26a86a);color:#04150d;font-weight:700;padding:11px 24px;border-radius:8px;text-decoration:none;margin:6px 6px 0 0}
.btn.ghost{background:#2a2a2a;color:#e0e0e0;border:1px solid #444}
.note{color:#777;font-size:.82rem;line-height:1.9}
.warn{border-left:3px solid #f0a020;background:#1c1810;padding:14px 16px;border-radius:6px;color:#c9a86a;font-size:.84rem;line-height:1.9}
\u003c/style\u003e
\u003c/head\u003e
\u003cbody\u003e
\u003cdiv class="c"\u003e
  \u003cdiv class="hero"\u003e
    \u003ch1\u003eQQ Music API\u003c/h1\u003e
    \u003cdiv class="sub"\u003e基于 Cloudflare Workers + D1 的音乐 API 服务\u003c/div\u003e
    \u003cdiv class="badges"\u003e
      \u003cspan class="badge ${dbReady ? 'on' : 'off'}"\u003e\u003ci\u003e\u003c/i\u003e服务 ${dbReady ? '正常' : '离线'}\u003c/span\u003e
      \u003cspan class="badge ${credSeeded ? 'on' : 'off'}"\u003e\u003ci\u003e\u003c/i\u003e上游凭证 ${credSeeded ? '就绪' : '未配置'}\u003c/span\u003e
    \u003c/div\u003e
  \u003c/div\u003e

  \u003ch2\u003e客户端\u003c/h2\u003e
  \u003cdiv class="card" style="padding:18px 20px"\u003e
    \u003cp class="note" style="margin-bottom:12px"\u003e配套客户端通过本服务的 REST 接口工作。下载与更新配置见 \u003ca href="/api/app/update?platform=android" style="color:#31c27c"\u003e/api/app/update\u003c/a\u003e, 公告见 \u003ca href="/api/app/notice" style="color:#31c27c"\u003e/api/app/notice\u003c/a\u003e。\u003c/p\u003e
    \u003ca class="btn" href="/api/app/update?platform=android"\u003e获取 Android 客户端\u003c/a\u003e
    \u003ca class="btn ghost" href="/admin"\u003e管理控制台\u003c/a\u003e
  \u003c/div\u003e

  \u003ch2\u003e快速接入\u003c/h2\u003e
  \u003cdiv class="card" style="padding:18px 20px"\u003e
    \u003cp class="note"\u003e1. \u003cb\u003ePOST /api/user?action=device\u003c/b\u003e 用客户端指纹换取签名 deviceId;\u003cbr\u003e2. \u003cb\u003ePOST /api/user?action=register\u003c/b\u003e 注册(带 deviceId);\u003cbr\u003e3. \u003cb\u003ePOST /api/user?action=login\u003c/b\u003e 登录, 拿到 token;\u003cbr\u003e4. 后续请求头携带 \u003cb\u003eAuthorization: Bearer {token}\u003c/b\u003e 与 \u003cb\u003eX-Device-Id: {deviceId}\u003c/b\u003e;\u003cbr\u003e5. 调用音乐接口, 如 \u003cb\u003eGET /api/song/url?mid=...&quality=flac\u003c/b\u003e。\u003c/p\u003e
    \u003cp class="note" style="margin-top:10px"\u003e普通用户每日有限额度(默认 50 次, 可调)且受最高音质约束; 会员 1000 次/日不限音质; 管理员不限。\u003c/p\u003e
  \u003c/div\u003e

  \u003ch2\u003e可用接口\u003c/h2\u003e
  \u003cdiv class="card"\u003e
    \u003ctable\u003e
      \u003cthead\u003e\u003ctr\u003e\u003cth\u003e端点\u003c/th\u003e\u003cth\u003e说明\u003c/th\u003e\u003c/tr\u003e\u003c/thead\u003e
      \u003ctbody\u003e${apiRows}\u003c/tbody\u003e
    \u003c/table\u003e
  \u003c/div\u003e

  \u003ch2\u003e免责与合规声明\u003c/h2\u003e
  \u003cdiv class="warn"\u003e
    本项目为个人学习与技术研究性质的开源练习项目, 不对公众提供任何商业服务。\u003cbr\u003e
    所有音乐数据、播放链接与元信息均来自第三方上游接口, 本项目不存储、不转售、不提供任何音频内容。\u003cbr\u003e
    请勿将本项目用于任何商业用途或侵犯第三方权利的行为; 由此产生的一切后果由使用者自行承担。\u003cbr\u003e
    若权利方对本项目有任何异议, 请联系部署者及时下线相关内容。
  \u003c/div\u003e

  \u003cfooter\u003ePowered by Cloudflare Workers · © iSun · 本项目仅供学习研究\u003c/footer\u003e
\u003c/div\u003e
\u003c/body\u003e
\u003c/html\u003e`;
}

function generateConsoleHtml(totalCount) {
    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="app-build" content="cachefix-v1">
    <title>QQ Music API</title>
    <script src="/js/device.js"></script>
    <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:-apple-system,sans-serif;background:#1a1a1a;color:#e0e0e0;line-height:1.6}
        .c{max-width:800px;margin:0 auto;padding:40px 20px}
        h1{font-size:2rem;color:#fff;margin-bottom:8px}
        .s{color:#666;margin-bottom:40px}
        .s .count{color:#31c27c;font-weight:600}
        h2{font-size:1.1rem;color:#31c27c;margin:30px 0 15px;border-bottom:1px solid #333;padding-bottom:8px}
        h3{font-size:.95rem;color:#4facfe;margin:22px 0 10px}
        .e{background:#222;border-radius:8px;padding:16px;margin-bottom:16px;scroll-margin-top:24px}
        .e.flash{box-shadow:0 0 0 2px #31c27c inset}
        .h{display:flex;align-items:center;gap:10px;margin-bottom:10px}
        .m{background:#31c27c;color:#000;padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:600}
        .p{font-family:monospace;color:#4facfe}
        .d{color:#999;font-size:.9rem;margin-bottom:12px}
        table{width:100%;border-collapse:collapse;font-size:.85rem}
        th{text-align:left;color:#666;font-weight:500;padding:6px 0}
        td{padding:6px 0;border-top:1px solid #333}
        .pm{font-family:monospace;color:#f0a020}
        .r{color:#f44;font-size:.75rem}
        .ex{background:#181818;padding:10px;border-radius:4px;font-family:monospace;font-size:.85rem;color:#aaa;margin-top:10px}
        footer{margin-top:50px;text-align:center;color:#444;font-size:.85rem}
        a{color:#31c27c;text-decoration:none}
        .at-in,.at-btn,.at-resp{width:100%;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:8px;font-size:.9rem;font-family:ui-monospace,Menlo,Consolas,monospace}
        .at-in{margin-bottom:8px;color:#6A8759;font-weight:600}
        .at-in::placeholder{color:#9aa4b0;font-style:italic;font-weight:400}
        .at-in:focus{border-color:#31c27c;outline:none;box-shadow:0 0 0 2px rgba(49,194,124,.15)}
        .at-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
        .at-row label{min-width:104px;color:#E8BF6A;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1rem;font-weight:600;letter-spacing:.3px}
        .at-btn{cursor:pointer;background:linear-gradient(135deg,#31c27c,#26a86a);color:#04150d;border:none;font-weight:700;letter-spacing:.5px;padding:12px;margin-top:8px;border-radius:8px;box-shadow:0 4px 14px rgba(49,194,124,.28);transition:transform .15s ease,box-shadow .15s ease,filter .15s ease}
        .at-btn:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(49,194,124,.42);filter:brightness(1.06)}
        .at-btn:active{transform:translateY(0);box-shadow:0 3px 10px rgba(49,194,124,.3)}
        .nav-bar{margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap}
        .nav-btn{display:inline-block;background:#2a2a2a;border:1px solid #444;color:#e0e0e0;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none;transition:background .15s,border-color .15s}
        .nav-btn:hover{background:#333;border-color:#31c27c}
        .nav-logout{margin-left:auto;background:#7a2a2a;border:1px solid #a33;color:#fff;font-weight:600;padding:10px 20px;border-radius:6px;cursor:pointer;transition:background .15s,border-color .15s}
        .nav-logout:hover{background:#8f3030;border-color:#c44}
        .at-resp{white-space:pre-wrap;word-break:break-all;max-height:400px;overflow:auto;margin-top:10px;color:#aaa}
        .at-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.72rem;font-weight:700;vertical-align:middle}
        .at-get{background:#31c27c;color:#000}
        .at-post{background:#f0a020;color:#000}
        .at-desc{color:#9aa4b0;font-size:.88rem;margin:6px 0 8px}
        .at-label-hi{color:#E8BF6A;font-weight:600}
        .at-body{width:100%;min-height:96px;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:8px;font-size:.85rem;font-family:monospace;margin-bottom:8px;resize:vertical}
        .at-status{font-family:monospace;font-size:.8rem;color:#666;margin:6px 0;word-break:break-all}
        .at-status .ok{color:#31c27c;font-weight:700}
        .at-status .err{color:#f44;font-weight:700}
        .at-tools{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}
        .at-tools button{flex:1;min-width:84px;cursor:pointer;background:#20242b;border:1px solid #3a4250;color:#c8d0da;border-radius:7px;padding:9px 10px;font-size:.82rem;font-weight:600;letter-spacing:.3px;transition:background .15s ease,border-color .15s ease,color .15s ease,transform .15s ease}
        .at-tools button:hover{background:#2a3038;border-color:#31c27c;color:#e6fff2;transform:translateY(-1px)}
        .at-tools button:active{transform:translateY(0)}
        #api-tester{background:linear-gradient(180deg,#1c2026,#161a1f);border:1px solid #2b333d;border-left:3px solid #31c27c;border-radius:10px;padding:18px 16px;box-shadow:0 6px 24px rgba(0,0,0,.28)}
        #api-tester .h .p{font-size:1.05rem;letter-spacing:.5px}
        #at-status{padding:6px 10px;background:#14181d;border-radius:6px;display:inline-block}
        #at-endpoint{color:#4facfe;font-weight:600;letter-spacing:.2px}
        #at-endpoint option{color:#e0e0e0;background:#181818}
        .at-resp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace!important;font-size:.9rem!important;line-height:1.55}
        .at-body-wrap2{position:relative;margin-bottom:8px;max-height:400px;overflow:auto}
        .at-hl{position:static;display:block;margin:0;padding:8px;background:#181818;border:1px solid #333;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9rem;line-height:1.5;white-space:pre-wrap;word-break:break-word;pointer-events:none;color:#e0e0e0;tab-size:2;box-sizing:border-box}
        .at-body-ov{position:absolute;top:0;left:0;z-index:2;width:100%;background:transparent;color:transparent;caret-color:#31c27c;min-height:120px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9rem;tab-size:2;border:1px solid transparent;border-radius:4px;padding:8px;box-sizing:border-box;overflow:hidden;resize:none}
        /* 代码高亮配色 —— 参照 MT 语法(Metro/Darcula 深色主题) */
        .jk{color:#CC7832}.js{color:#6A8759}.jn{color:#6897BB}.jb{color:#9876AA}
        .jp{color:#E8BF6A;font-weight:600}.jm{color:#BBB529}
        .at-key{color:#CC7832}.at-val{color:#6A8759}.at-num{color:#6897BB}
        .at-comment{color:#808080;font-style:italic}
        .at-resp,.at-hl{background:#1e1e1e;border-color:#3c3c3c;color:#d4d4d4}
        .at-resp{color:#d4d4d4}
        .at-dim{color:#808080}
        #at-endpoint{background:#1e1e1e;border-color:#3c3c3c;color:#4ec9b0;font-weight:600}
        .at-body,.at-body-ov{background:transparent;color:transparent;caret-color:#4ec9b0;border-color:transparent}
        .at-body{border-color:transparent}
        .at-body-ov::placeholder{color:#9aa4b0;font-style:italic;font-weight:400;opacity:1}
        .at-hl{pointer-events:none}
        #backTop{position:fixed;right:16px;bottom:16px;z-index:9999;width:44px;height:44px;border-radius:50%;background:#31c27c;color:#000;border:none;font-size:20px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;transition:transform .2s ease,opacity .2s ease;opacity:.95}
        @media (max-width:600px){ #backTop{right:12px;bottom:80px;width:42px;height:42px} }
        #backTop:hover{transform:translateY(-3px);opacity:1}
    </style>
</head>
<body>
<div id="gate" style="position:fixed;inset:0;background:#1a1a1a;z-index:99;display:flex;justify-content:center;align-items:center">
<div id="gateBox" style="background:#222;border:1px solid #333;border-radius:8px;padding:30px;width:300px">
<h2 style="color:#31c27c;margin-bottom:18px;text-align:center;font-size:1.1rem">管理登录</h2>
<input id="gUser" placeholder="用户名" style="width:100%;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:9px;margin-bottom:10px">
<input id="gPass" type="password" placeholder="密码" style="width:100%;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:9px;margin-bottom:12px">
<button id="gBtn" style="width:100%;background:#2a2a2a;color:#e0e0e0;border:1px solid #31c27c;border-radius:4px;padding:10px;font-weight:600;cursor:pointer">登录</button>
<div id="gMsg" style="color:#888;font-size:.82rem;margin-top:10px;text-align:center;min-height:18px"></div>
</div>
</div>
<script src="/js/login-gate.js"></script>
<div class="c">
    <h1>QQ Music API</h1>
    <button id="backTop" title="回到顶部">⬆</button>
    <div class="nav-bar">
        <a href="/admin/users" class="nav-btn">👥 用户管理</a>
        <a href="/admin/cache" class="nav-btn">🗃 缓存列表</a>
        <a href="/admin/risk" class="nav-btn">🛡 风控防护</a>
        <a href="/admin/credential" class="nav-btn">🔑 凭证管理</a>
        <a href="/" class="nav-btn">🏠 网站首页</a>
        <button id="adminLogout" class="nav-logout">🚪 退出登录</button>
    </div>
    <div class="e" id="api-tester">
        <div class="h"><span class="m">调试</span><span class="p">API Tester</span></div>
        <p class="d">选择接口、填写参数、直接测试响应(支持 GET / POST)</p>
        <select id="at-endpoint" class="at-in"></select>
        <div class="at-desc" id="at-desc"></div>
        <div id="at-params"></div>
        <div id="at-body-wrap" style="display:none">
            <div class="at-desc">POST Body (JSON)</div>
            <div class="at-body-wrap2">
                <pre id="at-body-hl" class="at-hl"></pre>
                <textarea id="at-body" class="at-body at-body-ov"></textarea>
            </div>
        </div>
        <div class="at-tools">
            <button id="at-reset">重置参数</button>
            <button id="at-copy-url">复制 URL</button>
            <button id="at-copy-resp">复制结果</button>
            <button id="at-goto">定位说明</button>
        </div>
        <div class="at-desc at-label-hi">请求头 · 按所选接口自动提示，点框可全选直接粘贴</div>
        <div class="at-body-wrap2">
            <pre id="at-headers-hl" class="at-hl"></pre>
            <textarea id="at-headers" class="at-body at-body-ov" style="min-height:56px" placeholder="每行一条 Key: Value（粘贴后提示自动消失）&#10;X-Device-Id 已自动带上，无需手填&#10;/api/setup 需：X-Setup-Key: 你的SETUP_KEY"></textarea>
        </div>

        <button id="at-send" class="at-btn">发送请求</button>
        <div class="at-status" id="at-status">就绪</div>
        <pre id="at-resp" class="at-resp">响应结果将显示在这里</pre>
    </div>
    <p class="s">基于 Cloudflare Workers + D1 的 QQ 音乐 API 服务 · 累计调用 <span class="count">${totalCount.toLocaleString()}</span> 次</p>
    
    <h2>音乐业务接口</h2>
    <p class="d">本组除 /api/search 与 /api/top 为公开接口(按 IP 限流 30 次/分钟)外, 其余接口(播放链接、歌曲详情、封面、歌词、专辑、歌单、歌手)均需登录, 请求头需带 Authorization: Bearer 你的token 与 X-Device-Id: 登录时的设备标识, 且计入用户每日调用限额。</p>
    <h3>搜索</h3>
    <div class="e" id="doc-search"><div class="h"><span class="m">GET</span><span class="p">/api/search</span></div><p class="d">搜索歌曲、歌手、专辑或歌单</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">keyword</span><span class="r">*</span></td><td>string</td><td>搜索关键词</td></tr><tr><td><span class="pm">type</span></td><td>string</td><td>song/singer/album/playlist</td></tr><tr><td><span class="pm">num</span></td><td>int</td><td>返回数量</td></tr><tr><td><span class="pm">page</span></td><td>int</td><td>页码</td></tr></table><div class="ex">GET /api/search?keyword=周杰伦&type=song&num=20</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功, 非 0 为业务错误</td></tr><tr><td><span class="pm">data.keyword</span></td><td>本次搜索关键词(原样回显)</td></tr><tr><td><span class="pm">data.type</span></td><td>搜索类型(原样回显)</td></tr><tr><td><span class="pm">data.page</span></td><td>当前页码</td></tr><tr><td><span class="pm">data.num</span></td><td>每页返回数量</td></tr><tr><td><span class="pm">data.total</span></td><td>命中结果总数</td></tr><tr><td><span class="pm">data.list</span></td><td>结果数组, 元素结构随 type 变化</td></tr></table></div>
    <h3>歌曲</h3>
    <div class="e" id="doc-songurl"><div class="h"><span class="m">GET</span><span class="p">/api/song/url</span></div><p class="d">获取歌曲播放链接</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">mid</span><span class="r">*</span></td><td>string</td><td>歌曲MID，多个用逗号分隔</td></tr><tr><td><span class="pm">quality</span></td><td>string</td><td>master/atmos/atmos_51/flac/320/128</td></tr></table><div class="ex">GET /api/song/url?mid=0039MnYb0qxYhV&quality=320</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data</span></td><td>对象, 键为歌曲 mid, 值为可播放直链 URL; 取不到时为空字符串</td></tr><tr><td><span class="pm">quality</span></td><td>实际命中的音质(自动降级后的结果)</td></tr></table></div>
    <div class="e" id="doc-songdetail"><div class="h"><span class="m">GET</span><span class="p">/api/song/detail</span></div><p class="d">获取歌曲详情</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">mid</span></td><td>string</td><td>歌曲MID</td></tr><tr><td><span class="pm">id</span></td><td>int</td><td>歌曲ID</td></tr></table><div class="ex">GET /api/song/detail?mid=0039MnYb0qxYhV</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data</span></td><td>歌曲详情对象, 含曲名/歌手/专辑/时长等上游原始字段</td></tr></table></div>
    <div class="e" id="doc-songcover"><div class="h"><span class="m">GET</span><span class="p">/api/song/cover</span></div><p class="d">获取歌曲封面（支持 mid 自动处理、album_mid 回退）</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">mid</span></td><td>string</td><td>歌曲MID（自动获取详情）</td></tr><tr><td><span class="pm">album_mid</span></td><td>string</td><td>专辑MID</td></tr><tr><td><span class="pm">size</span></td><td>int</td><td>150/300/500/800</td></tr><tr><td><span class="pm">validate</span></td><td>bool</td><td>是否验证(默认true)</td></tr></table><div class="ex">GET /api/song/cover?mid=0039MnYb0qxYhV&size=300</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data.url</span></td><td>封面图片直链</td></tr><tr><td><span class="pm">data.source</span></td><td>封面来源: album_mid / vs / default(兜底封面)</td></tr><tr><td><span class="pm">data.size</span></td><td>实际使用的尺寸(150/300/500/800)</td></tr><tr><td><span class="pm">data.vs</span></td><td>命中 vs 值时返回, 便于排查来源</td></tr></table></div>
    <h3>歌词</h3>
    <div class="e" id="doc-lyric"><div class="h"><span class="m">GET</span><span class="p">/api/lyric</span></div><p class="d">获取歌词 (支持 LRC/QRC/罗马音/翻译 解密)</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">mid</span></td><td>string</td><td>歌曲MID</td></tr><tr><td><span class="pm">id</span></td><td>int</td><td>歌曲ID</td></tr><tr><td><span class="pm">qrc</span></td><td>bool</td><td>是否获取逐字歌词 (开启后 lyric 字段返回 QRC XML)</td></tr><tr><td><span class="pm">trans</span></td><td>bool</td><td>是否获取翻译歌词 (trans 字段)</td></tr><tr><td><span class="pm">roma</span></td><td>bool</td><td>是否获取罗马音歌词 (roma 字段, XML 格式)</td></tr></table><div class="ex">GET /api/lyric?mid=0039MnYb0qxYhV&qrc=1&trans=1&roma=1</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data.mid</span></td><td>请求的歌曲 mid(回显)</td></tr><tr><td><span class="pm">data.id</span></td><td>请求的歌曲 id(回显)</td></tr><tr><td><span class="pm">data.lyric</span></td><td>主歌词, 解密后的 LRC 文本</td></tr><tr><td><span class="pm">data.trans</span></td><td>翻译歌词, 未请求或不存在时为空串</td></tr><tr><td><span class="pm">data.roma</span></td><td>罗马音歌词(XML), 未请求或不存在时为空串</td></tr><tr><td><span class="pm">data.qrc</span></td><td>逐字歌词(QRC XML), 仅 qrc=1 且上游返回时出现</td></tr></table></div>
    <h3>专辑 / 歌单 / 歌手</h3>
    <div class="e" id="doc-album"><div class="h"><span class="m">GET</span><span class="p">/api/album</span></div><p class="d">获取专辑详情</p><div class="ex">GET /api/album?mid=002fRO0N4FftzY</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data</span></td><td>专辑详情对象, 含专辑名/封面/发行时间/曲目列表等</td></tr></table></div>
    <div class="e" id="doc-playlist"><div class="h"><span class="m">GET</span><span class="p">/api/playlist</span></div><p class="d">获取歌单详情</p><div class="ex">GET /api/playlist?id=8052190267</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data</span></td><td>歌单详情对象, 含歌单名/创建者/歌曲列表等</td></tr></table></div>
    <div class="e" id="doc-singer"><div class="h"><span class="m">GET</span><span class="p">/api/singer</span></div><p class="d">获取歌手信息</p><div class="ex">GET /api/singer?mid=0025NhlN2yWrP4</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data</span></td><td>歌手信息对象, 含艺名/头像/简介/歌曲与专辑数等</td></tr></table></div>
    <h3>排行榜</h3>
    <div class="e" id="doc-top"><div class="h"><span class="m">GET</span><span class="p">/api/top</span></div><p class="d">获取排行榜列表或详情</p><div class="ex">GET /api/top</div><div class="ex">GET /api/top?id=4&num=50</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data</span></td><td>未传 id 时返回榜单列表; 传 id 时返回该榜单详情与曲目</td></tr></table></div>
    <h2>APP 配置接口</h2>
    <div class="e" id="doc-appupdate"><div class="h"><span class="m">GET</span><span class="p">/api/app/update</span></div><p class="d">获取 APP 更新配置(版本比对与强制更新判断) · <b style="color:#31c27c">公开接口, 无需登录</b></p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">platform</span><span class="r">*</span></td><td>string</td><td>android / ios</td></tr><tr><td><span class="pm">version</span></td><td>string</td><td>客户端当前版本,如 1.2.0</td></tr><tr><td><span class="pm">build</span></td><td>int</td><td>构建号,用于强制更新判断</td></tr><tr><td><span class="pm">channel</span></td><td>string</td><td>渠道,默认 official</td></tr></table><div class="ex">GET /api/app/update?platform=android&version=1.0.0&build=80</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data.hasUpdate</span></td><td>是否有新版本</td></tr><tr><td><span class="pm">data.forceUpdate</span></td><td>是否强制更新(当前 build 低于 minSupportBuild)</td></tr><tr><td><span class="pm">data.latestVersion</span></td><td>最新版本号</td></tr><tr><td><span class="pm">data.latestBuild</span></td><td>最新构建号</td></tr><tr><td><span class="pm">data.minSupportBuild</span></td><td>最低支持构建号</td></tr><tr><td><span class="pm">data.title</span></td><td>更新弹窗标题</td></tr><tr><td><span class="pm">data.changelog</span></td><td>更新日志数组</td></tr><tr><td><span class="pm">data.downloadUrl</span></td><td>安装包下载地址</td></tr><tr><td><span class="pm">data.fileSize</span></td><td>安装包字节大小</td></tr><tr><td><span class="pm">data.fileHash</span></td><td>安装包校验值(sha256:...)</td></tr><tr><td><span class="pm">data.publishedAt</span></td><td>发布时间戳(秒)</td></tr></table></div>
    <div class="e" id="doc-appnotice"><div class="h"><span class="m">GET</span><span class="p">/api/app/notice</span></div><p class="d">获取 APP 公告(支持平台/版本/渠道过滤与定时上下线) · <b style="color:#31c27c">公开接口, 无需登录</b></p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">platform</span></td><td>string</td><td>android / ios,不传返回全平台</td></tr><tr><td><span class="pm">version</span></td><td>string</td><td>客户端版本,用于版本限定公告</td></tr><tr><td><span class="pm">channel</span></td><td>string</td><td>渠道,默认 official</td></tr></table><div class="ex">GET /api/app/notice?platform=android&version=1.2.0</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">data.notices</span></td><td>公告数组, 按 priority 降序</td></tr><tr><td><span class="pm">data.notices[].id</span></td><td>公告唯一标识</td></tr><tr><td><span class="pm">data.notices[].type</span></td><td>展示类型, 如 popup</td></tr><tr><td><span class="pm">data.notices[].level</span></td><td>级别, 如 info/warn</td></tr><tr><td><span class="pm">data.notices[].title</span></td><td>标题</td></tr><tr><td><span class="pm">data.notices[].content</span></td><td>正文内容</td></tr><tr><td><span class="pm">data.notices[].actionText</span></td><td>按钮文案</td></tr><tr><td><span class="pm">data.notices[].actionUrl</span></td><td>按钮跳转地址</td></tr><tr><td><span class="pm">data.notices[].forceShow</span></td><td>是否强制展示</td></tr><tr><td><span class="pm">data.notices[].priority</span></td><td>优先级</td></tr><tr><td><span class="pm">data.serverTime</span></td><td>服务器当前时间戳(秒), 用于校正客户端时间</td></tr></table></div>
    <h2>用户系统接口</h2>
    <p class="d">本组含: POST ?action=register(注册)、POST ?action=login(登录)、POST ?action=logout(登出)、GET ?action=me(我的信息)、POST ?action=appopen(记录APP打开)。除 register/login/device 外均需请求头 Authorization: Bearer 你的token 与 X-Device-Id: 登录时使用的设备标识(两者必须同时携带且设备一致, 缺任一个均返回 401)。</p>
    <div class="e" id="doc-register"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=register</span></div><p class="d">注册账号(同一设备仅能注册一个)</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">username</span><span class="r">*</span></td><td>string</td><td>3-20 位字母数字下划线</td></tr><tr><td><span class="pm">password</span><span class="r">*</span></td><td>string</td><td>至少 6 位</td></tr><tr><td><span class="pm">deviceId</span><span class="r">*</span></td><td>string</td><td>设备指纹</td></tr></table><div class="ex">POST /api/user?action=register{ "username":"test", "password":"123456", "deviceId":"abc123" }</div><p class="d">注册用户均为普通用户, 管理员需通过 /api/setup 初始化创建</p></div>
    <div class="e" id="doc-login"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=login</span></div><p class="d">登录, 返回 token 用于后续接口鉴权</p><div class="ex">POST /api/user?action=login{ "username":"test", "password":"123456", "deviceId":"abc123" }</div><p class="d">返回 token, 后续请求头带: Authorization: Bearer 你的token</p></div>
    <div class="e" id="doc-logout"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=logout</span></div><p class="d">登出, 注销当前 token</p><p class="d">请求头: Authorization: Bearer 你的token 与 X-Device-Id: 登录时的设备标识; 无请求体(Body 留空)</p><p class="d">注销后该 token 立即失效, 需重新登录获取; 返回 code 0 与 message</p><div class="ex">POST /api/user?action=logoutAuthorization: Bearer 你的tokenX-Device-Id: 你的设备标识</div></div>
    <div class="e" id="doc-me"><div class="h"><span class="m">GET</span><span class="p">/api/user?action=me</span></div><p class="d">查询当前用户信息与今日用量(需 token)</p><p class="d">请求头: Authorization: Bearer 你的token 与 X-Device-Id: 登录时的设备标识</p><div class="ex">GET /api/user?action=meAuthorization: Bearer 你的tokenX-Device-Id: 你的设备标识</div><p class="d">返回字段: code / user(含 level 与 levelLabel) / usageToday(今日已用) / remaining(管理员恒为 -1, 会员为 1000 减去已用, 普通用户为日限额减去已用)</p></div>
    <div class="e" id="doc-device"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=device</span></div><p class="d">签发设备标识(公开接口, 无需登录; 注册/登录前先用它换取合法 deviceId)</p><p class="d">请求头: 无需额外请求头(公开接口)</p><p class="d">需服务端配置 Secret DEVICE_SECRET, 否则返回 503; 同一 fingerprint 在有效期内复用同一 deviceId(去重); 按 IP 每分钟最多 30 次签发</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">fingerprint</span><span class="r">*</span></td><td>string</td><td>客户端稳定设备指纹, 6-128 字符</td></tr></table><div class="ex">POST /api/user?action=device{ "fingerprint":"my-device-fp-001" }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">deviceId</span></td><td>服务端签发的设备标识(HMAC 签名, 默认 30 天有效), 注册/登录时作为 deviceId 传入</td></tr></table></div>
    <div class="e" id="doc-appopen"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=appopen</span></div><p class="d">记录一次 APP 打开(用于用户管理页统计展示)</p><p class="d">请求头: Authorization: Bearer 你的token 与 X-Device-Id: 登录时的设备标识; 无请求体(Body 留空)</p><div class="ex">POST /api/user?action=appopenAuthorization: Bearer 你的tokenX-Device-Id: 你的设备标识</div><p class="d">返回字段: code / message</p></div>
    <h2>用户规则</h2>
    <div class="e"><table><tr><th>等级</th><th>调用限制</th><th>说明</th></tr><tr><td><span class="tag tag-normal" style="padding:2px 8px;border-radius:4px;background:#333;color:#aaa">普通用户 normal</span></td><td>每日 50 次(管理员可调, 设 0 表示无限制)</td><td>仅音乐业务类接口计入日限额; 受 maxQuality 音质上限约束(默认 320), 超限自动降级; 超出日限额返回 429</td></tr><tr><td><span class="tag tag-vip" style="padding:2px 8px;border-radius:4px;background:#f0a020;color:#000">会员 vip</span></td><td>每日 1000 次</td><td>不限音质(不受 maxQuality 约束); 超出日限额返回 429</td></tr><tr><td><span class="tag tag-admin" style="padding:2px 8px;border-radius:4px;background:#7a3fb0;color:#fff">管理员 admin</span></td><td>不限调用, 不限音质</td><td>可访问 /api/admin/* 管理接口</td></tr></table><p class="d">鉴权规则: 公开端点(无需 token)为 /api/user?action=register|login(注册/登录)、/api/search(搜索, 按 IP 限流 30 次/分钟)、/api/top(排行榜, 按 IP 限流 30 次/分钟)、/api/setup(站点初始化)、/api/app/update(APP更新配置) 与 /api/app/notice(APP公告); 其余 /api/ 接口均需请求头 Authorization: Bearer 你的token; /api/admin/*(用户管理、凭证管理、APP配置调试)额外要求账号 role=admin。</p><p class="d">说明: 面向普通用户的读取凭证接口(/api/credential)已下线, 凭证仅可通过管理员接口查看/写入; 客户端探活请改用 /api/user?action=me 返回的 remaining 字段。</p></div>
    <h2>管理接口</h2>
    <p class="d">以下所有 /api/admin/* 接口均需请求头 Authorization: Bearer 管理员token 与 X-Device-Id: 登录时的设备标识, 且账号 role 必须为 admin, 否则 401/403。示例中的 Authorization 行即为此要求, 不再逐条重复。</p>
    <h3>用户管理</h3>
    <div class="e" id="doc-adminusers-list"><div class="h"><span class="m">GET</span><span class="p">/api/admin/users?action=list</span></div><p class="d">[admin] 用户列表(支持 keyword 全库前缀搜索)</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 list</td></tr><tr><td><span class="pm">page</span></td><td>int</td><td>页码,默认 1</td></tr><tr><td><span class="pm">size</span></td><td>int</td><td>每页条数,默认 20,最大 100</td></tr><tr><td><span class="pm">keyword</span></td><td>string</td><td>可选, 按用户名前缀或用户ID精确全库搜索</td></tr></table><div class="ex">GET /api/admin/users?action=list&page=1&size=20&keyword=adminAuthorization: Bearer 管理员token</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">page</span></td><td>当前页码</td></tr><tr><td><span class="pm">size</span></td><td>本页条数</td></tr><tr><td><span class="pm">total</span></td><td>用户总数</td></tr><tr><td><span class="pm">list</span></td><td>用户数组(id/username/level/role/status/dailyLimit/createdAt)</td></tr></table></div>
    <div class="e" id="doc-adminusers-level"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=level</span></div><p class="d">修改用户等级</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 level</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr><tr><td><span class="pm">level</span><span class="r">*</span></td><td>string</td><td>normal / vip</td></tr></table><div class="ex">POST /api/admin/users?action=level{ "userId":2, "level":"vip" }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">userId</span></td><td>被修改的用户ID</td></tr><tr><td><span class="pm">level</span></td><td>修改后的等级</td></tr></table></div>
    <div class="e" id="doc-adminusers-status"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=status</span></div><p class="d">禁用/启用用户</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 status</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr><tr><td><span class="pm">status</span><span class="r">*</span></td><td>int</td><td>1启用 0禁用</td></tr></table><div class="ex">POST /api/admin/users?action=status{ "userId":2, "status":0 }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述(如 已启用/已禁用)</td></tr></table></div>
    <div class="e" id="doc-adminusers-delete"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=delete</span></div><p class="d">删除用户(级联清理会话与用量)</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 delete</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr></table><div class="ex">POST /api/admin/users?action=delete{ "userId":2 }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">userId</span></td><td>被删除的用户ID</td></tr></table></div>
    <div class="e" id="doc-adminusers-detail"><div class="h"><span class="m">GET</span><span class="p">/api/admin/users?action=detail</span></div><p class="d">[admin] 单个用户详情(含设备ID与时间戳)</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 detail</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr></table><div class="ex">GET /api/admin/users?action=detail&userId=2</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">user.id</span></td><td>用户ID</td></tr><tr><td><span class="pm">user.username</span></td><td>用户名</td></tr><tr><td><span class="pm">user.level</span></td><td>等级 normal/vip</td></tr><tr><td><span class="pm">user.role</span></td><td>角色 user/admin</td></tr><tr><td><span class="pm">user.status</span></td><td>1启用 0禁用</td></tr><tr><td><span class="pm">user.dailyLimit</span></td><td>日调用限额</td></tr><tr><td><span class="pm">user.deviceId</span></td><td>注册设备标识</td></tr><tr><td><span class="pm">user.createdAt</span></td><td>注册时间戳(秒)</td></tr><tr><td><span class="pm">user.updatedAt</span></td><td>最后更新时间戳(秒)</td></tr><tr><td><span class="pm">apiUsage.today</span></td><td>今日 API 调用次数</td></tr><tr><td><span class="pm">apiUsage.total</span></td><td>累计 API 调用次数</td></tr><tr><td><span class="pm">appOpen.today</span></td><td>今日 APP 打开次数</td></tr><tr><td><span class="pm">appOpen.total</span></td><td>累计 APP 打开次数</td></tr></table></div>
    <div class="e" id="doc-adminusers-update"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=update</span></div><p class="d">部分更新用户(改密强制下线)</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 update</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr><tr><td><span class="pm">username</span></td><td>string</td><td>3-20 位字母数字下划线</td></tr><tr><td><span class="pm">password</span></td><td>string</td><td>至少 6 位,改后强制下线</td></tr><tr><td><span class="pm">dailyLimit</span></td><td>int</td><td>0-1000000 (0=无限制)</td></tr><tr><td><span class="pm">maxQuality</span></td><td>string</td><td>128/320/flac/atmos_51/atmos_2/master, 普通用户音质上限(VIP/管理员不受限)</td></tr><tr><td><span class="pm">level</span></td><td>string</td><td>normal / vip</td></tr><tr><td><span class="pm">status</span></td><td>int</td><td>1启用 0禁用</td></tr></table><div class="ex">POST /api/admin/users?action=update{ "userId":2, "dailyLimit":100, "level":"vip" }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">user</span></td><td>更新后的完整用户信息</td></tr></table></div>
    <h3>凭证管理</h3>
    <div class="e" id="doc-admincred"><div class="h"><span class="m">GET</span><span class="p">/api/admin/credential</span></div><p class="d">[admin] 查看凭证完整状态(不脱敏, 已剔除 refresh_key)</p><div class="ex">GET /api/admin/credential</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">credential</span></td><td>完整凭证对象(musicid/musickey/refresh_token/openid 等字段, 已剔除 refresh_key); 无凭证时为 null</td></tr></table></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/admin/credential</span></div><p class="d">[admin] 更新 QQ 音乐凭证</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">musicid</span><span class="r">*</span></td><td>string</td><td>音乐账号ID</td></tr><tr><td><span class="pm">musickey</span><span class="r">*</span></td><td>string</td><td>音乐密钥</td></tr><tr><td><span class="pm">credential</span></td><td>object</td><td>也可整体包在 credential 字段里</td></tr></table><div class="ex">POST /api/admin/credential{ "musicid":"xxx", "musickey":"xxx" }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">success</span></td><td>true 表示写入成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">musicid</span></td><td>已保存的音乐账号ID</td></tr></table></div>
    <h3>站点初始化</h3>
    <div class="e" id="doc-setup"><div class="h"><span class="m">GET/POST</span><span class="p">/api/setup</span></div><p class="d">站点初始化: GET 查看状态, POST 清库并创建初始管理员(检测到已有 admin 即锁定, 管理员等级为「管理员」且不限调用)</p><p class=\"d\"><b style=\"color:#f0a020\">⚠ 安全前置: 服务端必须配置 Secret <span class=\"pm\">SETUP_KEY</span>, 且 POST 请求头 <span class=\"pm\">X-Setup-Key</span> 与其完全一致。</b> 未配置 SETUP_KEY 时 POST 一律 403「未配置 SETUP_KEY, 初始化入口已禁用」; 配置了但请求头不一致则 403「初始化密钥无效」——用于防止他人到已部署站上直接清库重建管理员。</p><table><tr><th>项</th><th>位置</th><th>说明</th></tr><tr><td><span class=\"pm\">X-Setup-Key</span><span class=\"r\">*</span></td><td>请求头</td><td>初始化密钥, 值 = 服务端 Secret SETUP_KEY</td></tr><tr><td><span class=\"pm\">SETUP_KEY</span></td><td>CF Secret</td><td>Cloudflare Dashboard → Worker → Settings → Variables and Secrets 添加(Type 选 Secret), 建议 openssl rand -hex 32 生成</td></tr></table><p class=\"d\">请求体字段:</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">username</span><span class="r">*</span></td><td>string</td><td>3-20 位字母数字下划线</td></tr><tr><td><span class="pm">password</span><span class="r">*</span></td><td>string</td><td>至少 6 位</td></tr></table><div class="ex">POST /api/setup{ "username":"admin", "password":"******" }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">adminId</span></td><td>新建管理员用户ID</td></tr><tr><td><span class="pm">username</span></td><td>管理员用户名</td></tr></table></div>
    <h3>风控防护</h3>
    <div class=\"e\" id=\"doc-risk\"><div class=\"h\"><span class=\"m\">GET/POST</span><span class=\"p\">/api/admin/risk</span></div><p class=\"d\">[admin] 服务端行为风控管理, 通过 ?action= 分发; 图形页 /admin/risk</p><table><tr><th>action</th><th>方法</th><th>说明</th></tr><tr><td><span class=\"pm\">stats</span></td><td>GET</td><td>总览(当前封禁数/今日事件/累计事件/规则分布/最近事件)</td></tr><tr><td><span class=\"pm\">config</span></td><td>GET/POST</td><td>读/写风控参数: enabled/burstPerSec/burstPerMin/midScanPerMin/blockSeconds/autoBlock; VIP 专属 vipBurstPerSec/vipBurstPerMin/vipMidScanPerMin(VIP 不限次数但受风控约束); 匿名专属 anonBurstPerSec/anonBurstPerMin/anonMidScanPerMin(按 IP 聚合, 阈值放宽防 NAT 误伤)</td></tr><tr><td><span class=\"pm\">blocks</span></td><td>GET</td><td>当前封禁列表(分页)</td></tr><tr><td><span class=\"pm\">events</span></td><td>GET</td><td>风控事件审计列表(分页)</td></tr><tr><td><span class=\"pm\">unblock</span></td><td>POST</td><td>解封单个主体, body {scope,key}</td></tr><tr><td><span class=\"pm\">unblockall</span></td><td>POST</td><td>全部解封</td></tr><tr><td><span class=\"pm\">clearevents</span></td><td>POST</td><td>清空全部事件</td></tr><tr><td><span class=\"pm\">signconfig</span></td><td>GET/POST</td><td>读取/切换请求签名校验开关(需同时配置 Secret REQUEST_SECRET)</td></tr></table><p class=\"d\">规则: 秒级突增 burst_1s / 分钟超限 burst_60s / MID 遍历 mid_scan。全员生效(含未登录匿名请求, 匿名按 IP 聚合); 排除认证动作(register/login/device)与管理端, 公开端点同样纳入。命中即 429, 开启 autoBlock 时按 blockSeconds 封禁主体。</p></div>
    <footer><a href="https://isunc.com">文档</a> · <a href="https://github.com/0xSunX/qq-music-api">GitHub</a> · © iSun</footer>
</div>
<script src="/js/console.js"></script>
</body>
</html>`;
}

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // OPTIONS 预检
        if (request.method === "OPTIONS") {
            return new Response(null, { headers: corsHeaders });
        }

        // 确保统计表存在
        if (env.DB) {
            try {
                await ensureStatsTable(env.DB);
            } catch (e) {
                console.error("初始化统计表失败:", e);
            }
        } else {
            console.error("env.DB is undefined!");
        }

        // 公开统计首页
        if (path === "/" || path === "/index.html") {
            return new Response(await generateIndexHtml(env), {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    ...corsHeaders,
                },
            });
        }

        // 管理控制台(前端登录门)
        if (path === "/admin") {
            let totalCount = 0;
            if (env.DB) {
                try { totalCount = await getTotalCount(env.DB); } catch (e) {}
            }
            return new Response(generateConsoleHtml(totalCount), {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-store, must-revalidate",
                    ...corsHeaders,
                },
            });
        }

        // 缓存列表页(前端自行带 token 调 /api/admin/cache)
        if (path === "/admin/cache") {
            return new Response(adminCache.renderPage(), {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-store, must-revalidate",
                    ...corsHeaders,
                },
            });
        }

        // 风控防护页(前端自行带 token 调 /api/admin/risk)
        if (path === "/admin/risk") {
            return new Response(adminRisk.renderPage(), {
                headers: {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-store, must-revalidate",
                    ...corsHeaders,
                },
            });
        }

        // API 路由
        const handler = routes[path];
        if (handler && handler.onRequest) {
            // 初始化用户表
            if (env.DB) {
                try { await ensureUserTables(env.DB); } catch (e) { console.error("初始化用户表失败:", e); }
            }

            // 认证 + 限流中间件
            let currentUser = null;
            let usageReserved = false;
            const isPublic = PUBLIC_ROUTES.includes(path);
            const urlObj = new URL(request.url);
            const action = urlObj.searchParams.get("action") || "";
            // 用户接口的 register/login 也免鉴权
            const isAuthAction = path === "/api/user" && (action === "register" || action === "login" || action === "device");

            // 公开端点 IP 限流: 无登录态, 按 IP+端点做窗口计数防刷
            // 仅覆盖公开的统计类端点(search/app update/app notice), 避免上游凭证被匿名刷爆
            if (env.DB && isPublic && !isAuthAction && statsEndpoints.includes(path)) {
                const ip = (request.headers.get("CF-Connecting-IP")
                    || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim()
                    || "unknown");
                let ipOk = true;
                try { ipOk = await checkIpRate(env.DB, ip, path, 30, 60); }
                catch (e) { console.error("IP 限流检查失败:", e); }
                if (!ipOk) {
                    return new Response(JSON.stringify({
                        error: "Too many requests",
                        limit: 30,
                        window: 60,
                    }), {
                        status: 429,
                        headers: { "Content-Type": "application/json", ...corsHeaders },
                    });
                }
            }

            // 会话预解析(仅用于风控主体识别, 不阻断; 匿名请求同样纳入风控)
            let riskUser = null;
            if (env.DB) {
                const tk0 = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
                const dv0 = request.headers.get("X-Device-Id") || "";
                if (tk0 && dv0) { try { riskUser = await verifySession(env.DB, tk0, dv0); } catch (e) {} }
            }

            // ---------- 行为风控 (全员生效: VIP / 普通用户 / 未注册匿名请求 均纳入) ----------
            // 排除认证动作(register/login/device)与管理端, 避免打挂登录入口与后台自身。
            if (env.DB && !isAuthAction && !ADMIN_ROUTES.includes(path)) {
                try {
                    await ensureRiskTables(env.DB);
                    const riskIp = (request.headers.get("CF-Connecting-IP")
                        || (request.headers.get("X-Forwarded-For") || "").split(",")[0].trim()
                        || "unknown");
                    // 主体识别: 已登录按用户维度, 未登录/匿名按 IP 维度
                    const subject = riskUser ? ("user:" + riskUser.id) : ("ip:" + riskIp);
                    const riskLevel = riskUser ? riskUser.level : "anon";
                    const riskUrl = new URL(request.url);

                    // 1) 请求签名校验(仅对已登录用户; 匿名请求无签名要求)
                    if (riskUser) {
                        const signOn = await getReqSignEnabled(env.DB);
                        if (signOn && env.REQUEST_SECRET) {
                            const vr = await verifyRequestSignature(request, env.REQUEST_SECRET, env.DB);
                            if (!vr.ok) {
                                await logRiskEvent(env.DB, subject, "bad_sign", (vr.code || "") + ": " + (vr.message || ""));
                                return new Response(JSON.stringify({
                                    error: "请求签名校验失败",
                                    code: vr.code,
                                    detail: vr.message,
                                }), {
                                    status: 403,
                                    headers: { "Content-Type": "application/json", ...corsHeaders },
                                });
                            }
                        }
                    }

                    // 2) 行为风控: 频次突增 + MID 遍历识别
                    let riskMids = [];
                    const midParam = riskUrl.searchParams.get("mid");
                    if (midParam) {
                        riskMids = midParam.split(",").map(function(s){ return s.trim(); }).filter(Boolean);
                    }
                    const verdict = await inspectRequest(env.DB, subject, path, riskMids, riskLevel);
                    if (verdict.action === "block") {
                        return new Response(JSON.stringify({
                            error: "请求已被风控拦截",
                            reason: verdict.reason,
                            retryAfter: verdict.remain || 0,
                        }), {
                            status: 429,
                            headers: {
                                "Content-Type": "application/json",
                                "Retry-After": String(verdict.remain || 0),
                                ...corsHeaders,
                            },
                        });
                    }
                } catch (e) {
                    console.error("[Risk] 风控检查异常(已放行):", e);
                }
            }

            if (env.DB && !isPublic && !isAuthAction) {
                const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
                const deviceId = request.headers.get("X-Device-Id") || "";
                currentUser = await verifySession(env.DB, token, deviceId);
                if (!currentUser) {
                    return new Response(JSON.stringify({ error: "Unauthorized" }), {
                        status: 401,
                        headers: { "Content-Type": "application/json", ...corsHeaders },
                    });
                }
                // 管理接口强制校验 admin 角色
                if (ADMIN_ROUTES.includes(path) && currentUser.role !== "admin") {
                    return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
                        status: 403,
                        headers: { "Content-Type": "application/json", ...corsHeaders },
                    });
                }
                // 统计端点: 管理员豁免限流(仅计数), 普通/VIP 用户按各自日限额限流+计数
                if (statsEndpoints.includes(path)) {
                    if (currentUser.role !== "admin") {
                        // 普通用户用其 daily_limit; VIP 用户固定 VIP_DAILY_LIMIT
                        // daily_limit<=0 视为无限制(仅计数, 不做限额判断), 与管理员语义统一
                        const limit = currentUser.level === "vip" ? VIP_DAILY_LIMIT : currentUser.daily_limit;
                        if (limit <= 0) {
                            // 无限制用户: 仅计数, 异步后台写, 不阻塞响应
                            const usageJob = countUsage(env.DB, currentUser.id).catch(function(e){ console.error("计数失败:", e); });
                            if (ctx && ctx.waitUntil) { try { ctx.waitUntil(usageJob); } catch (e) { await usageJob; } }
                            else { await usageJob; }
                        } else {
                            // 原子占用配额(检查+递增), 业务失败再回滚
                            const ok = await reserveUsage(env.DB, currentUser.id, limit);
                            if (!ok) {
                                return new Response(JSON.stringify({
                                    error: "Daily limit reached",
                                    limit: limit,
                                }), {
                                    status: 429,
                                    headers: { "Content-Type": "application/json", ...corsHeaders },
                                });
                            }
                            usageReserved = true;
                        }
                    } else {
                        // 管理员: 不限流, 但一样计入调用统计; 业务失败不回滚。
                        // 计数异步后台写, 不阻塞响应尾延迟
                        const usageJob = countUsage(env.DB, currentUser.id).catch(function(e){ console.error("计数失败:", e); });
                        if (ctx && ctx.waitUntil) { try { ctx.waitUntil(usageJob); } catch (e) { await usageJob; } }
                        else { await usageJob; }
                    }
                }
            }

            // 统计 API 调用次数
            if (env.DB && statsEndpoints.includes(path)) {
                // 统计计数非业务必需: 丢给 ctx.waitUntil 后台写, 不阻塞响应尾延迟。
                // 错误在后台任务内自行捕获, 避免 unhandled rejection; 无 ctx(本地 dev) 时兜底 await。
                const statJob = incrementCount(env.DB, path).catch(function(e){ console.error("统计计数失败:", e); });
                if (ctx && ctx.waitUntil) { try { ctx.waitUntil(statJob); } catch (e) { await statJob; } }
                else { await statJob; }
            }

            let resp;
            try {
                resp = await handler.onRequest({ request, env, ctx, user: currentUser });
            } catch (e) {
                // 业务抛异常: 回滚已占用配额再抛出
                if (usageReserved) {
                    try { await releaseUsage(env.DB, currentUser.id); } catch (_) {}
                }
                throw e;
            }
            // 配额策略: 仅服务端系统错误(>=500)才回滚; 4xx(参数错/越权/上游业务失败)一律不回滚,
            // 防止攻击者用必然失败的请求白嫖上游配额。
            if (usageReserved && resp.status >= 500) {
                try { await releaseUsage(env.DB, currentUser.id); } catch (e) { console.error("释放用量失败:", e); }
            }
            return resp;
        }

        // 404
        return new Response(JSON.stringify({ error: "Not Found" }), {
            status: 404,
            headers: {
                "Content-Type": "application/json",
                ...corsHeaders,
            },
        });
    },

    // Cron 定时任务
    async scheduled(event, env, ctx) {
        await refresh.onSchedule({ env, ctx });
    },
};
