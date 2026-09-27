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
import * as setup from "./api/setup.js";
import { ensureStatsTable, incrementCount, getTotalCount, getAllStats } from "./lib/stats.js";
import { ensureUserTables, verifySession, reserveUsage, releaseUsage } from "./lib/user.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
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
    "/api/setup": setup,
};

// 免鉴权的公开路由(register/login 额外豁免)
// /admin 是控制台页面, 前端密码登录; /admin/users 复用同一 token
const PUBLIC_ROUTES = ["/admin", "/admin/users", "/api/setup", "/api/app/update", "/api/app/notice"];
// 需 admin 角色的数据接口(登录后仍要校验角色)
const ADMIN_ROUTES = ["/api/admin/users", "/api/admin/credential", "/api/admin/appconfig"];

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
 * 生成首页 HTML
 * @param {number} totalCount 
 */
async function generateIndexHtml(env) {
    let totalCount = 0;
    let stats = [];
    if (env && env.DB) {
        try { totalCount = await getTotalCount(env.DB); } catch (e) { console.error("统计失败:", e); }
        try { stats = await getAllStats(env.DB); } catch (e) { console.error("明细失败:", e); }
    }
    const rows = stats.length
        ? stats.map(function(s){
            return '\u003ctr\u003e\u003ctd class="ep"\u003e' + s.endpoint + '\u003c/td\u003e\u003ctd class="ct"\u003e' + Number(s.count).toLocaleString() + '\u003c/td\u003e\u003c/tr\u003e';
          }).join('')
        : '\u003ctr\u003e\u003ctd colspan="2" class="empty"\u003e暂无调用数据\u003c/td\u003e\u003c/tr\u003e';

    const API_LIST = [
        ['/api/search', '搜索歌曲/歌手/专辑/歌单'],
        ['/api/song/url', '获取歌曲播放链接'],
        ['/api/song/detail', '获取歌曲详情'],
        ['/api/song/cover', '获取歌曲封面'],
        ['/api/lyric', '获取歌词'],
        ['/api/album', '获取专辑详情'],
        ['/api/playlist', '获取歌单详情'],
        ['/api/singer', '获取歌手信息'],
        ['/api/top', '获取排行榜'],
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
\u003ctitle\u003eQQ Music API\u003c/title\u003e
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
\u003c/style\u003e
\u003c/head\u003e
\u003cbody\u003e
\u003cdiv class="c"\u003e
  \u003cdiv class="hero"\u003e
    \u003ch1\u003eQQ Music API\u003c/h1\u003e
    \u003cdiv class="sub"\u003e基于 Cloudflare Workers + D1 的音乐 API 服务\u003c/div\u003e
    \u003cdiv class="big"\u003e${Number(totalCount).toLocaleString()}\u003c/div\u003e
    \u003cdiv class="lbl"\u003e累计调用次数\u003c/div\u003e
  \u003c/div\u003e

  \u003ch2\u003e接口调用排行\u003c/h2\u003e
  \u003cdiv class="card"\u003e
    \u003ctable\u003e
      \u003cthead\u003e\u003ctr\u003e\u003cth\u003e接口\u003c/th\u003e\u003cth style="text-align:right"\u003e调用次数\u003c/th\u003e\u003c/tr\u003e\u003c/thead\u003e
      \u003ctbody\u003e${rows}\u003c/tbody\u003e
    \u003c/table\u003e
  \u003c/div\u003e

  \u003ch2\u003e可用接口\u003c/h2\u003e
  \u003cdiv class="card"\u003e
    \u003ctable\u003e
      \u003cthead\u003e\u003ctr\u003e\u003cth\u003e端点\u003c/th\u003e\u003cth\u003e说明\u003c/th\u003e\u003c/tr\u003e\u003c/thead\u003e
      \u003ctbody\u003e${apiRows}\u003c/tbody\u003e
    \u003c/table\u003e
  \u003c/div\u003e

  \u003cfooter\u003ePowered by Cloudflare Workers · © iSun\u003c/footer\u003e
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
    <title>QQ Music API</title>
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
        .at-in,.at-btn,.at-resp{width:100%;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:8px;font-size:.9rem;font-family:monospace}
        .at-in{margin-bottom:8px}
        .at-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
        .at-row label{min-width:90px;color:#f0a020;font-family:monospace;font-size:.85rem}
        .at-btn{cursor:pointer;background:#31c27c;color:#000;font-weight:600;border:none;padding:10px;margin-top:4px}
        .at-btn:hover{opacity:.9}
        .at-resp{white-space:pre-wrap;word-break:break-all;max-height:400px;overflow:auto;margin-top:10px;color:#aaa}
        .at-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.72rem;font-weight:700;vertical-align:middle}
        .at-get{background:#31c27c;color:#000}
        .at-post{background:#f0a020;color:#000}
        .at-desc{color:#888;font-size:.82rem;margin:4px 0 8px}
        .at-body{width:100%;min-height:96px;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:8px;font-size:.85rem;font-family:monospace;margin-bottom:8px;resize:vertical}
        .at-status{font-family:monospace;font-size:.8rem;color:#666;margin:6px 0;word-break:break-all}
        .at-status .ok{color:#31c27c;font-weight:700}
        .at-status .err{color:#f44;font-weight:700}
        .at-tools{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px}
        .at-tools button{flex:1;min-width:80px;cursor:pointer;background:#2a2a2a;border:1px solid #444;color:#e0e0e0;border-radius:4px;padding:6px;font-size:.8rem}
        .at-tools button:hover{background:#333;border-color:#31c27c}
        #backTop{position:fixed;right:16px;bottom:16px;z-index:9999;width:44px;height:44px;border-radius:50%;background:#31c27c;color:#000;border:none;font-size:20px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;transition:transform .2s ease,opacity .2s ease;opacity:.95}
        @media (max-width:600px){ #backTop{right:12px;bottom:80px;width:42px;height:42px} }
        #backTop:hover{transform:translateY(-3px);opacity:1}
    </style>
</head>
<body>
<div id="gate" style="position:fixed;inset:0;background:#1a1a1a;z-index:99;display:flex;justify-content:center;align-items:center">
<div style="background:#222;border:1px solid #333;border-radius:8px;padding:30px;width:300px">
<h2 style="color:#31c27c;margin-bottom:18px;text-align:center;font-size:1.1rem">管理登录</h2>
<input id="gUser" placeholder="用户名" style="width:100%;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:9px;margin-bottom:10px">
<input id="gPass" type="password" placeholder="密码" style="width:100%;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:9px;margin-bottom:12px">
<button id="gBtn" style="width:100%;background:#31c27c;color:#000;border:none;border-radius:4px;padding:10px;font-weight:600;cursor:pointer">登录</button>
<div id="gMsg" style="color:#888;font-size:.82rem;margin-top:10px;text-align:center;min-height:18px"></div>
</div>
</div>
<script>
(function(){
  var gate=document.getElementById('gate');
  function setMsg(t,c){ var m=document.getElementById('gMsg'); m.textContent=t; m.style.color=c||'#888'; }
  function showConsole(){ gate.style.display='none'; var c=document.querySelector('.c'); if(c) c.style.display=''; }
  function doLogout(){
    var tk=localStorage.getItem('adminToken');
    if(tk){ fetch('/api/user?action=logout',{method:'POST',headers:{'Authorization':'Bearer '+tk}}).catch(function(){}); }
    localStorage.removeItem('adminToken');
    location.reload();
  }
  function initConsole(){
    if(localStorage.getItem('adminToken')){ showConsole(); }
  }
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initConsole);
  } else { initConsole(); }
  // 事件委托: 绑在 document 上, 不依赖按钮是否已解析
  document.addEventListener('click', function(e){
    var t = e.target;
    if(!t || !t.id){ return; }
    if(t.id === 'backTop'){
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if(document.documentElement){ document.documentElement.scrollTop = 0; }
      if(document.body){ document.body.scrollTop = 0; }
    } else if(t.id === 'adminLogout'){
      doLogout();
    }
  }, false);
  document.getElementById('gBtn').onclick=function(){
    var u=document.getElementById('gUser').value.trim();
    var p=document.getElementById('gPass').value;
    if(!u||!p){ setMsg('请输入用户名和密码','#f44'); return; }
    setMsg('登录中...');
    fetch('/api/user?action=login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})})
    .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
    .then(function(res){
      if(!res.ok){ setMsg(res.d.error||'登录失败','#f44'); return; }
      if(!res.d.user||res.d.user.role!=='admin'){ setMsg('该账号不是管理员','#f44'); return; }
      localStorage.setItem('adminToken',res.d.token);
      showConsole();
    }).catch(function(e){ setMsg('异常: '+e.message,'#f44'); });
  };
})();
</script>
<div class="c">
    <h1>QQ Music API</h1>
    <button id="backTop" title="回到顶部">⬆</button>
    <div style="margin-bottom:20px;display:flex;gap:10px;flex-wrap:wrap">
        <a href="/admin/users" style="display:inline-block;background:#31c27c;color:#000;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none">👥 用户管理</a>
        <a href="/" style="display:inline-block;background:#2a2a2a;border:1px solid #444;color:#e0e0e0;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none">🏠 网站首页</a>
        <button id="adminLogout" style="background:#2a2a2a;border:1px solid #444;color:#e0e0e0;font-weight:600;padding:10px 20px;border-radius:6px;cursor:pointer">🚪 退出登录</button>
    </div>
    <div class="e" id="api-tester">
        <div class="h"><span class="m">调试</span><span class="p">API Tester</span></div>
        <p class="d">选择接口、填写参数、直接测试响应(支持 GET / POST)</p>
        <select id="at-endpoint" class="at-in"></select>
        <div class="at-desc" id="at-desc"></div>
        <div id="at-params"></div>
        <div id="at-body-wrap" style="display:none">
            <div class="at-desc">POST Body (JSON)</div>
            <textarea id="at-body" class="at-body"></textarea>
        </div>
        <div class="at-tools">
            <button id="at-reset">重置参数</button>
            <button id="at-copy-url">复制 URL</button>
            <button id="at-copy-resp">复制结果</button>
            <button id="at-goto">定位说明</button>
        </div>
        <button id="at-send" class="at-btn">发送请求</button>
        <div class="at-status" id="at-status">就绪</div>
        <pre id="at-resp" class="at-resp">响应结果将显示在这里</pre>
    </div>
    <p class="s">基于 Cloudflare Workers + D1 的 QQ 音乐 API 服务 · 累计调用 <span class="count">${totalCount.toLocaleString()}</span> 次</p>
    
    <h2>音乐业务接口</h2>
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
    <div class="e" id="doc-register"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=register</span></div><p class="d">注册账号(同一设备仅能注册一个)</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">username</span><span class="r">*</span></td><td>string</td><td>3-20 位字母数字下划线</td></tr><tr><td><span class="pm">password</span><span class="r">*</span></td><td>string</td><td>至少 6 位</td></tr><tr><td><span class="pm">deviceId</span><span class="r">*</span></td><td>string</td><td>设备指纹</td></tr></table><div class="ex">POST /api/user?action=register{ "username":"test", "password":"123456", "deviceId":"abc123" }</div><p class="d">注册用户均为普通用户, 管理员需通过 /api/setup 初始化创建</p></div>
    <div class="e" id="doc-login"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=login</span></div><p class="d">登录, 返回 token 用于后续接口鉴权</p><div class="ex">POST /api/user?action=login{ "username":"test", "password":"123456" }</div><p class="d">返回 token, 后续请求头带: Authorization: Bearer 你的token</p></div>
    <div class="e" id="doc-logout"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=logout</span></div><p class="d">登出, 注销当前 token</p></div>
    <div class="e" id="doc-me"><div class="h"><span class="m">GET</span><span class="p">/api/user?action=me</span></div><p class="d">查询当前用户信息与今日用量(需 token)</p><div class="ex">GET /api/user?action=meAuthorization: Bearer 你的token</div></div>
    <h2>用户规则</h2>
    <div class="e"><table><tr><th>等级</th><th>调用限制</th><th>说明</th></tr><tr><td><span class="tag tag-normal" style="padding:2px 8px;border-radius:4px;background:#333;color:#aaa">普通用户 normal</span></td><td>每日 50 次(可被管理员调整)</td><td>仅音乐业务类接口计入日限额, 超出返回 429</td></tr><tr><td><span class="tag tag-vip" style="padding:2px 8px;border-radius:4px;background:#f0a020;color:#000">VIP 用户 vip</span></td><td>无限制</td><td>不限调用次数</td></tr><tr><td><span class="tag" style="padding:2px 8px;border-radius:4px;background:#31c27c;color:#000">管理员 admin</span></td><td>无限制(日限额 100000)</td><td>可访问 /api/admin/* 管理接口</td></tr></table><p class="d">鉴权规则: 公开端点(无需 token)为 /api/user?action=register|login(注册/登录)、/api/setup(站点初始化)、/api/app/update(APP更新配置) 与 /api/app/notice(APP公告); 其余 /api/ 接口均需请求头 Authorization: Bearer 你的token; /api/admin/*(用户管理、凭证管理、APP配置调试)额外要求账号 role=admin。</p><p class="d">说明: 面向普通用户的读取凭证接口(/api/credential)已下线, 凭证仅可通过管理员接口查看/写入; 客户端探活请改用 /api/user?action=me 返回的 remaining 字段。</p></div>
    <h2>管理接口</h2>
    <h3>用户管理</h3>
    <div class="e" id="doc-adminusers"><div class="h"><span class="m">GET</span><span class="p">/api/admin/users?action=list</span></div><p class="d">用户列表(需 admin)</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 list</td></tr><tr><td><span class="pm">page</span></td><td>int</td><td>页码,默认 1</td></tr><tr><td><span class="pm">size</span></td><td>int</td><td>每页条数,默认 20,最大 100</td></tr></table><div class="ex">GET /api/admin/users?action=list&page=1&size=20Authorization: Bearer 管理员token</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">page</span></td><td>当前页码</td></tr><tr><td><span class="pm">size</span></td><td>本页条数</td></tr><tr><td><span class="pm">total</span></td><td>用户总数</td></tr><tr><td><span class="pm">list</span></td><td>用户数组(id/username/level/role/status/dailyLimit/createdAt)</td></tr></table></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=level</span></div><p class="d">修改用户等级</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 level</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr><tr><td><span class="pm">level</span><span class="r">*</span></td><td>string</td><td>normal / vip</td></tr></table><div class="ex">POST /api/admin/users?action=level{ "userId":2, "level":"vip" }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">userId</span></td><td>被修改的用户ID</td></tr><tr><td><span class="pm">level</span></td><td>修改后的等级</td></tr></table></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=status</span></div><p class="d">禁用/启用用户</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 status</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr><tr><td><span class="pm">status</span><span class="r">*</span></td><td>int</td><td>1启用 0禁用</td></tr></table><div class="ex">POST /api/admin/users?action=status{ "userId":2, "status":0 }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述(如 已启用/已禁用)</td></tr></table></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=delete</span></div><p class="d">删除用户(级联清理会话与用量)</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 delete</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr></table><div class="ex">POST /api/admin/users?action=delete{ "userId":2 }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">userId</span></td><td>被删除的用户ID</td></tr></table></div>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/admin/users?action=detail</span></div><p class="d">单个用户详情(含设备ID与时间戳, 需 admin)</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 detail</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr></table><div class="ex">GET /api/admin/users?action=detail&userId=2</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">user.id</span></td><td>用户ID</td></tr><tr><td><span class="pm">user.username</span></td><td>用户名</td></tr><tr><td><span class="pm">user.level</span></td><td>等级 normal/vip</td></tr><tr><td><span class="pm">user.role</span></td><td>角色 user/admin</td></tr><tr><td><span class="pm">user.status</span></td><td>1启用 0禁用</td></tr><tr><td><span class="pm">user.dailyLimit</span></td><td>日调用限额</td></tr><tr><td><span class="pm">user.deviceId</span></td><td>注册设备标识</td></tr><tr><td><span class="pm">user.createdAt</span></td><td>注册时间戳(秒)</td></tr><tr><td><span class="pm">user.updatedAt</span></td><td>最后更新时间戳(秒)</td></tr></table></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=update</span></div><p class="d">部分更新用户(改密强制下线)</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">action</span><span class="r">*</span></td><td>string</td><td>固定 update</td></tr><tr><td><span class="pm">userId</span><span class="r">*</span></td><td>int</td><td>目标用户ID</td></tr><tr><td><span class="pm">username</span></td><td>string</td><td>3-20 位字母数字下划线</td></tr><tr><td><span class="pm">password</span></td><td>string</td><td>至少 6 位,改后强制下线</td></tr><tr><td><span class="pm">dailyLimit</span></td><td>int</td><td>1-100000</td></tr><tr><td><span class="pm">level</span></td><td>string</td><td>normal / vip</td></tr><tr><td><span class="pm">status</span></td><td>int</td><td>1启用 0禁用</td></tr></table><div class="ex">POST /api/admin/users?action=update{ "userId":2, "dailyLimit":100, "level":"vip" }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">user</span></td><td>更新后的完整用户信息</td></tr></table></div>
    <h3>凭证管理</h3>
    <div class="e" id="doc-admincred"><div class="h"><span class="m">GET</span><span class="p">/api/admin/credential</span></div><p class="d">查看凭证完整状态(需 admin, 不脱敏)</p><div class="ex">GET /api/admin/credential</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">credential</span></td><td>完整凭证对象(musicid/musickey/refresh_token/openid 等字段, 已剔除 refresh_key); 无凭证时为 null</td></tr></table></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/admin/credential</span></div><p class="d">更新 QQ 音乐凭证(需 admin)</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">musicid</span><span class="r">*</span></td><td>string</td><td>音乐账号ID</td></tr><tr><td><span class="pm">musickey</span><span class="r">*</span></td><td>string</td><td>音乐密钥</td></tr><tr><td><span class="pm">credential</span></td><td>object</td><td>也可整体包在 credential 字段里</td></tr></table><div class="ex">POST /api/admin/credential{ "musicid":"xxx", "musickey":"xxx" }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">success</span></td><td>true 表示写入成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">musicid</span></td><td>已保存的音乐账号ID</td></tr></table></div>
    <h3>站点初始化</h3>
    <div class="e" id="doc-setup"><div class="h"><span class="m">GET/POST</span><span class="p">/api/setup</span></div><p class="d">站点初始化: GET 查看状态, POST 清库并创建初始管理员(检测到已有 admin 即锁定, 管理员默认 vip 且日限额 100000)</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">username</span><span class="r">*</span></td><td>string</td><td>3-20 位字母数字下划线</td></tr><tr><td><span class="pm">password</span><span class="r">*</span></td><td>string</td><td>至少 6 位</td></tr></table><div class="ex">POST /api/setup{ "username":"admin", "password":"******" }</div><p class="d">返回字段:</p><table><tr><th>字段</th><th>说明</th></tr><tr><td><span class="pm">code</span></td><td>0 表示成功</td></tr><tr><td><span class="pm">message</span></td><td>结果描述</td></tr><tr><td><span class="pm">adminId</span></td><td>新建管理员用户ID</td></tr><tr><td><span class="pm">username</span></td><td>管理员用户名</td></tr></table></div>
    <h3>管理页面</h3>
    <div class="e"><div class="h"><span class="m">PAGE</span><span class="p">/admin/users</span></div><p class="d">图形化管理后台, 填入管理员 token 后可增删改查用户</p><div class="ex"><a href="/admin/users" style="color:#31c27c">打开用户管理后台 →</a></div></div>
    <footer><a href="https://isunc.com">文档</a> · <a href="https://github.com/0xSunX/qq-music-api">GitHub</a> · © iSun</footer>
</div>
<script>
(function(){
  var APIS = [
    {group:'音乐业务',docKey:'doc-search',tip:'搜索',path:'/api/search',method:'GET',desc:'搜索歌曲/歌手/专辑/歌单',params:[{k:'keyword',v:'周杰伦',req:1},{k:'type',v:'song'},{k:'num',v:'10'},{k:'page',v:'1'}]},
    {group:'音乐业务',docKey:'doc-songurl',tip:'播放链接',path:'/api/song/url',method:'GET',desc:'获取歌曲播放链接(多音质自动降级)',params:[{k:'mid',v:'0039MnYb0qxYhV',req:1},{k:'quality',v:'320'}]},
    {group:'音乐业务',docKey:'doc-songdetail',tip:'歌曲详情',path:'/api/song/detail',method:'GET',desc:'获取歌曲详情',params:[{k:'mid',v:'0039MnYb0qxYhV',req:1}]},
    {group:'音乐业务',docKey:'doc-songcover',tip:'歌曲封面',path:'/api/song/cover',method:'GET',desc:'获取歌曲封面(支持 mid / album_mid / vs)',params:[{k:'mid',v:'0039MnYb0qxYhV'},{k:'size',v:'300'}]},
    {group:'音乐业务',docKey:'doc-lyric',tip:'歌词',path:'/api/lyric',method:'GET',desc:'获取歌词(LRC/QRC/翻译/罗马音)',params:[{k:'mid',v:'0039MnYb0qxYhV',req:1},{k:'qrc',v:'1'},{k:'trans',v:'1'},{k:'roma',v:'1'}]},
    {group:'音乐业务',docKey:'doc-album',tip:'专辑详情',path:'/api/album',method:'GET',desc:'获取专辑详情',params:[{k:'mid',v:'002fRO0N4FftzY',req:1}]},
    {group:'音乐业务',docKey:'doc-playlist',tip:'歌单详情',path:'/api/playlist',method:'GET',desc:'获取歌单详情',params:[{k:'id',v:'8052190267',req:1}]},
    {group:'音乐业务',docKey:'doc-singer',tip:'歌手信息',path:'/api/singer',method:'GET',desc:'获取歌手信息',params:[{k:'mid',v:'0025NhlN2yWrP4',req:1}]},
    {group:'音乐业务',docKey:'doc-top',tip:'排行榜',path:'/api/top',method:'GET',desc:'获取排行榜列表或详情',params:[{k:'id',v:'4'},{k:'num',v:'50'}]},
    {group:'APP 配置',docKey:'doc-appupdate',tip:'版本更新',path:'/api/app/update',method:'GET',desc:'APP 更新配置(版本比对/强制更新, 公开接口)',params:[{k:'platform',v:'android',req:1},{k:'version',v:'1.0.0'},{k:'build',v:'80'}]},
    {group:'APP 配置',docKey:'doc-appnotice',tip:'公告',path:'/api/app/notice',method:'GET',desc:'APP 公告(平台/版本/渠道过滤, 公开接口)',params:[{k:'platform',v:'android'},{k:'version',v:'1.2.0'}]},
    {group:'APP 配置',docKey:'doc-appnotice',tip:'公告-读取(调试)',path:'/api/admin/appconfig',method:'GET',desc:'读取已配置公告列表(需 admin)',params:[{k:'type',v:'notice'}]},
    {group:'APP 配置',docKey:'doc-appnotice',tip:'公告-写入/更新(调试)',path:'/api/admin/appconfig',method:'POST',desc:'新增或修改公告,同 id 覆盖(需 admin)',params:[{k:'type',v:'notice'}],body:'{ \"id\": \"notice_welcome\", \"type\": \"popup\", \"level\": \"info\", \"title\": \"公告标题\", \"content\": \"公告正文,一眼看清要补什么\", \"actionText\": \"知道了\", \"actionUrl\": \"\", \"forceShow\": false, \"platforms\": \"android,ios\", \"minVersion\": \"\", \"maxVersion\": \"\", \"channels\": \"\", \"startAt\": 0, \"endAt\": 0, \"priority\": 10, \"enabled\": true }'},
    {group:'APP 配置',docKey:'doc-appupdate',tip:'更新-读取(调试)',path:'/api/admin/appconfig',method:'GET',desc:'读取已配置的版本更新(需 admin)',params:[{k:'type',v:'update'}]},
    {group:'APP 配置',docKey:'doc-appupdate',tip:'更新-写入/更新(调试)',path:'/api/admin/appconfig',method:'POST',desc:'新增或修改版本更新,platform+channel 覆盖(需 admin)',params:[{k:'type',v:'update'}],body:'{ \"platform\": \"android\", \"channel\": \"official\", \"latestVersion\": \"1.3.0\", \"latestBuild\": 130, \"minSupportBuild\": 100, \"title\": \"发现新版本\", \"changelog\": [\"修复播放偶发崩溃\", \"新增歌单同步\"], \"downloadUrl\": \"https://example.com/app-release.apk\", \"fileSize\": 28311552, \"fileHash\": \"sha256:xxxx\", \"publishedAt\": 1730000000 }'},
    {group:'凭证管理',docKey:'doc-refresh',tip:'刷新凭证',path:'/api/credential/refresh',method:'POST',desc:'手动刷新凭证(force=true 强制刷新)',params:[{k:'force',v:'true'}],body:'{ "force": false }'},
    {group:'用户管理',docKey:'doc-adminusers',tip:'用户列表/详情',path:'/api/admin/users',method:'GET',desc:'用户列表/详情(需 admin, action=list|detail)',params:[{k:'action',v:'list'},{k:'page',v:'1'},{k:'size',v:'20'}]},
    {group:'凭证管理',docKey:'doc-admincred',tip:'凭证状态(admin)',path:'/api/admin/credential',method:'GET',desc:'查看凭证完整状态(需 admin)',params:[]},
    {group:'系统维护',docKey:'doc-setup',tip:'站点初始化',path:'/api/setup',method:'GET',desc:'站点初始化状态(公开)',params:[]},
    {group:'用户系统',docKey:'doc-register',tip:'注册',path:'/api/user',method:'POST',desc:'注册账号(公开)',params:[{k:'action',v:'register'}],body:'{ "username":"test", "password":"123456", "deviceId":"abc123" }'},
    {group:'用户系统',docKey:'doc-login',tip:'登录',path:'/api/user',method:'POST',desc:'登录(公开, 返回 token)',params:[{k:'action',v:'login'}],body:'{ "username":"test", "password":"123456" }'},
    {group:'用户系统',docKey:'doc-logout',tip:'登出',path:'/api/user',method:'POST',desc:'登出(需 token)',params:[{k:'action',v:'logout'}],body:'{}'},
    {group:'用户系统',docKey:'doc-me',tip:'我的信息',path:'/api/user',method:'GET',desc:'当前用户信息与今日用量(需 token)',params:[{k:'action',v:'me'}]},
    {group:'用户管理',docKey:'doc-adminusers',tip:'改用户等级',path:'/api/admin/users',method:'POST',desc:'修改用户等级(需 admin)',params:[{k:'action',v:'level'}],body:'{ "userId":2, "level":"vip" }'},
    {group:'用户管理',docKey:'doc-adminusers',tip:'禁用/启用用户',path:'/api/admin/users',method:'POST',desc:'禁用/启用用户(需 admin)',params:[{k:'action',v:'status'}],body:'{ "userId":2, "status":0 }'},
    {group:'用户管理',docKey:'doc-adminusers',tip:'删除用户',path:'/api/admin/users',method:'POST',desc:'删除用户(需 admin)',params:[{k:'action',v:'delete'}],body:'{ "userId":2 }'},
    {group:'用户管理',docKey:'doc-adminusers',tip:'更新用户',path:'/api/admin/users',method:'POST',desc:'部分更新用户(需 admin)',params:[{k:'action',v:'update'}],body:'{ "userId":2, "dailyLimit":100, "level":"vip" }'},
    {group:'用户管理',docKey:'doc-adminusers',tip:'用户详情',path:'/api/admin/users',method:'GET',desc:'单用户详情(需 admin)',params:[{k:'action',v:'detail'},{k:'userId',v:'2'}]},
    {group:'凭证管理',docKey:'doc-admincred',tip:'凭证更新(admin)',path:'/api/admin/credential',method:'POST',desc:'更新音乐凭证(需 admin)',params:[],body:'{ "musicid":"xxx", "musickey":"xxx" }'},
    {group:'系统维护',docKey:'doc-setup',tip:'初始化站点',path:'/api/setup',method:'POST',desc:'站点初始化(公开, 仅未初始化时可用)',params:[],body:'{ "username":"admin", "password":"******" }'}
  ];
  var DEFAULT_BODIES = {
    '刷新凭证': { force: false },
    '注册': { username: "你的用户名(3-20位字母数字下划线)", password: "你的密码(至少6位)", deviceId: "设备唯一标识, 如 abc123" },
    '登录': { username: "你的用户名", password: "你的密码" },
    '登出': {},
    '改用户等级': { userId: "目标用户ID(数字)", level: "normal 或 vip" },
    '禁用/启用用户': { userId: "目标用户ID(数字)", status: "1 启用 / 0 禁用" },
    '删除用户': { userId: "目标用户ID(数字)" },
    '更新用户': { userId: "目标用户ID(数字)", username: "新用户名(可省)", password: "新密码(可省)", dailyLimit: "日限额(1-100000)", level: "normal 或 vip", status: "1 启用 / 0 禁用" },
    '凭证更新(admin)': { openid: "你的OpenID", musicid: "你的QQ号", musickey: "你的MusicKey", refresh_token: "你的RefreshToken", login_type: 2, extra_fields: { musickeyCreateTime: 0, keyExpiresIn: 259200 } },
    '初始化站点': { username: "管理员用户名", password: "管理员密码(至少6位)" },
    '公告-写入/更新(调试)': { id: "notice_welcome", type: "popup", level: "info", title: "公告标题", content: "公告正文, 一眼看清要补什么", actionText: "知道了", actionUrl: "", forceShow: false, platforms: "android,ios", minVersion: "", maxVersion: "", channels: "", startAt: 0, endAt: 0, priority: 10, enabled: true },
    '更新-写入/更新(调试)': { platform: "android", channel: "official", latestVersion: "1.3.0", latestBuild: 130, minSupportBuild: 100, title: "发现新版本", changelog: ["修复播放偶发崩溃", "新增歌单同步"], downloadUrl: "https://example.com/app-release.apk", fileSize: 28311552, fileHash: "sha256:xxxx", publishedAt: 1730000000 }
  };
  function repeatInd(n){ var r = '', k; for(k = 0; k < n; k++){ r += '  '; } return r; }
  function prettyBody(v){
    if(v == null){ return '{}'; }
    if(typeof v !== 'string'){
      try { return JSON.stringify(v, null, 2); } catch(e){ return String(v); }
    }
    var s = String(v).trim(), out = '', ind = 0, i, c;
    for(i = 0; i < s.length; i++){
      c = s.charAt(i);
      if(c === '{' || c === '['){ out += c + NL; ind++; out += repeatInd(ind); }
      else if(c === '}' || c === ']'){ out += NL; if(ind > 0){ ind--; } out += repeatInd(ind) + c; }
      else if(c === ','){ out += c + NL + repeatInd(ind); }
      else { out += c; }
    }
    return out;
  }
  function applyDefaultBody(){
    var api = APIS[sel.value];
    if(!api){ return; }
    if(api.method === 'POST'){
      var v = (DEFAULT_BODIES[api.tip] != null) ? DEFAULT_BODIES[api.tip] : api.body;
      bodyBox.value = prettyBody(v);
    }
  }
  var NL = String.fromCharCode(10);
  var sel = document.getElementById('at-endpoint');
  var pbox = document.getElementById('at-params');
  var resp = document.getElementById('at-resp');
  var btn = document.getElementById('at-send');
  var descEl = document.getElementById('at-desc');
  var statusEl = document.getElementById('at-status');
  var bodyWrap = document.getElementById('at-body-wrap');
  var bodyBox = document.getElementById('at-body');
  var docMap = {};
  APIS.forEach(function(a){ if(a.group && a.docKey && !docMap[a.docKey]) docMap[a.docKey] = a.docKey; });
  var ogMap = {};
  APIS.forEach(function(a,i){
    var g = a.group || '其他';
    if(!ogMap[g]){
      ogMap[g] = document.createElement('optgroup');
      ogMap[g].label = g;
      sel.appendChild(ogMap[g]);
    }
    var o = document.createElement('option');
    o.value = i;
    o.textContent = a.method + '  ' + a.path + (a.tip ? '  · ' + a.tip : '');
    ogMap[g].appendChild(o);
  });
  function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/\u003c/g,'&lt;').replace(/>/g,'&gt;'); }
  function copy(t){
    if(navigator.clipboard){ navigator.clipboard.writeText(t); }
    else { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  }
  function renderParams(){
    pbox.innerHTML = '';
    var api = APIS[sel.value];
    if(!api) return;
    var badge = api.method === 'POST' ? '\u003cspan class="at-badge at-post"\u003ePOST\u003c/span\u003e ' : '\u003cspan class="at-badge at-get"\u003eGET\u003c/span\u003e ';
        descEl.innerHTML = badge + esc(api.desc || '') + esc(api.tip ? '  [' + api.tip + ']' : '');
    (api.params || []).forEach(function(p){
      var row = document.createElement('div');
      row.className = 'at-row';
      var lab = document.createElement('label');
      lab.textContent = p.k + (p.req ? ' *' : '');
      var inp = document.createElement('input');
      inp.className = 'at-in';
      inp.value = p.v || '';
      inp.placeholder = p.k;
      inp.setAttribute('data-k', p.k);
      row.appendChild(lab);
      row.appendChild(inp);
      pbox.appendChild(row);
    });
    if(api.method === 'POST'){
      bodyWrap.style.display = '';
      applyDefaultBody();
    } else {
      bodyWrap.style.display = 'none';
    }
    statusEl.textContent = '就绪';
  }
  function buildUrl(){
    var api = APIS[sel.value];
    var qs = [];
    pbox.querySelectorAll('input').forEach(function(inp){
      var k = inp.getAttribute('data-k');
      var v = inp.value.trim();
      if(v) qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return api.path + (qs.length ? ('?' + qs.join('&')) : '');
  }
  function doSend(){
    var api = APIS[sel.value];
    if(!api) return;
    var url = buildUrl();
    var opts = { method: api.method };
    var hdrs = {};
    var tk = localStorage.getItem('adminToken');
    if(tk) hdrs['Authorization'] = 'Bearer ' + tk;
    if(api.method === 'POST'){
      var raw = bodyBox.value.trim() || '{}';
      try { JSON.parse(raw); } catch(e){ statusEl.innerHTML = '\u003cspan class="err"\u003eBody JSON 格式错误\u003c/span\u003e'; return; }
      hdrs['Content-Type'] = 'application/json';
      opts.body = raw;
    }
    opts.headers = hdrs;
    statusEl.textContent = '请求中...';
    resp.textContent = api.method + ' ' + url + NL + '请求中...';
    var t0 = Date.now();
    fetch(url, opts).then(function(r){
      return r.text().then(function(txt){ return { status: r.status, ok: r.ok, txt: txt }; });
    }).then(function(res){
      var ms = Date.now() - t0;
      statusEl.innerHTML = '\u003cspan class="' + (res.ok ? 'ok' : 'err') + '"\u003eHTTP ' + res.status + '\u003c/span\u003e · ' + ms + 'ms · ' + api.method + ' ' + esc(url);
      var out = res.txt;
      try { out = JSON.stringify(JSON.parse(res.txt), null, 2); } catch(e){}
      resp.textContent = api.method + ' ' + url + NL + 'HTTP ' + res.status + ' · ' + ms + 'ms' + NL + NL + out;
    }).catch(function(e){
      var ms = Date.now() - t0;
      statusEl.innerHTML = '\u003cspan class="err"\u003e请求失败\u003c/span\u003e · ' + ms + 'ms';
      resp.textContent = api.method + ' ' + url + NL + NL + '请求失败: ' + e.message;
    });
  }
  sel.addEventListener('change', function(){ renderParams(); applyDefaultBody(); });
  renderParams();
  applyDefaultBody();
  btn.addEventListener('click', doSend);
  document.getElementById('at-reset').addEventListener('click', renderParams);
  document.getElementById('at-goto').addEventListener('click', function(){
    var api = APIS[sel.value];
    if(!api) return;
    var el = null;
    // 1. 先按 docKey 精确匹配
    if(api.docKey){ el = document.getElementById(api.docKey); }
    // 2. 精确 id 未命中, 扫描所有 doc- 块, 用接口路径匹配其标题文本
    if(!el){
      var all = document.querySelectorAll('[id^="doc-"]');
      for(var i = 0; i < all.length; i++){
        if(all[i].textContent.indexOf(api.path) >= 0){ el = all[i]; break; }
      }
    }
    if(!el){ statusEl.textContent = '该接口暂无独立说明条目'; return; }
    var top = el.getBoundingClientRect().top + window.pageYOffset - 16;
    window.scrollTo({ top: top, behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(function(){ el.classList.remove('flash'); }, 1500);
    statusEl.textContent = '已定位: ' + api.path;
  });
  document.getElementById('at-copy-url').addEventListener('click', function(){
    var u = location.origin + buildUrl();
    copy(u);
    statusEl.textContent = '已复制 URL: ' + u;
  });
  document.getElementById('at-copy-resp').addEventListener('click', function(){
    copy(resp.textContent);
    statusEl.textContent = '已复制响应结果';
  });
})();
</script>
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
            const isAuthAction = path === "/api/user" && (action === "register" || action === "login");

            if (env.DB && !isPublic && !isAuthAction) {
                const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
                currentUser = await verifySession(env.DB, token);
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
                // 普通用户限流(仅统计端点): 原子占用配额, 业务失败再回滚
                if (currentUser.level !== "vip" && statsEndpoints.includes(path)) {
                    const ok = await reserveUsage(env.DB, currentUser.id, currentUser.daily_limit);
                    if (!ok) {
                        return new Response(JSON.stringify({
                            error: "Daily limit reached",
                            limit: currentUser.daily_limit,
                        }), {
                            status: 429,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    usageReserved = true;
                }
            }

            // 统计 API 调用次数
            if (env.DB && statsEndpoints.includes(path)) {
                // 在本地开发或无 waitUntil 支持的环境下，直接 await
                // 为了确保计数准确，这里改为 await，虽然会微弱增加响应时间
                try {
                    await incrementCount(env.DB, path);
                } catch (e) {
                    console.error("统计计数失败:", e);
                }
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
            // 业务返回 >=400 视为失败, 回滚配额(参数错/鉴权错/上游错都不计入)
            if (usageReserved && resp.status >= 400) {
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
