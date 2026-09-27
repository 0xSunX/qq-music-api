/**
 * QQ Music API - Cloudflare Workers 入口
 * 统一路由处理
 */

// 导入各个 API 模块
import * as credential from "./api/credential.js";
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
import * as admin from "./admin.js";
import * as userApi from "./api/user.js";
import * as adminUsers from "./api/admin/users.js";
import * as adminPage from "./api/admin/page.js";
import { ensureStatsTable, incrementCount, getTotalCount } from "./lib/stats.js";
import { ensureUserTables, verifySession, getUsageToday, incrUsage } from "./lib/user.js";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

/**
 * 路由表
 */
const routes = {
    "/api/credential": credential,
    "/api/refresh": refresh,
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
    "/admin": admin,
};

// 免鉴权的公开路由(register/login 额外豁免)
// 注: /admin/users 页面本身免鉴权, 靠前端填 token 调 API; /api/admin/users 走鉴权
const PUBLIC_ROUTES = ["/admin", "/admin/users"];

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
];

/**
 * 生成首页 HTML
 * @param {number} totalCount 
 */
function generateIndexHtml(totalCount) {
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
        .e{background:#222;border-radius:8px;padding:16px;margin-bottom:16px}
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
    </style>
</head>
<body>
<div class="c">
    <h1>QQ Music API</h1>
    <div style="margin-bottom:20px">
        <a href="/admin/users" style="display:inline-block;background:#31c27c;color:#000;font-weight:600;padding:10px 20px;border-radius:6px;text-decoration:none">👥 用户管理</a>
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
        </div>
        <button id="at-send" class="at-btn">发送请求</button>
        <div class="at-status" id="at-status">就绪</div>
        <pre id="at-resp" class="at-resp">响应结果将显示在这里</pre>
    </div>
    <p class="s">基于 Cloudflare Workers + D1 的 QQ 音乐 API 服务 · 累计调用 <span class="count">${totalCount.toLocaleString()}</span> 次</p>
    
    <h2>搜索</h2>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/search</span></div><p class="d">搜索歌曲、歌手、专辑或歌单</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">keyword</span><span class="r">*</span></td><td>string</td><td>搜索关键词</td></tr><tr><td><span class="pm">type</span></td><td>string</td><td>song/singer/album/playlist</td></tr><tr><td><span class="pm">num</span></td><td>int</td><td>返回数量</td></tr><tr><td><span class="pm">page</span></td><td>int</td><td>页码</td></tr></table><div class="ex">GET /api/search?keyword=周杰伦&type=song&num=20</div></div>
    <h2>歌曲</h2>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/song/url</span></div><p class="d">获取歌曲播放链接</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">mid</span><span class="r">*</span></td><td>string</td><td>歌曲MID，多个用逗号分隔</td></tr><tr><td><span class="pm">quality</span></td><td>string</td><td>master/atmos/atmos_51/flac/320/128</td></tr></table><div class="ex">GET /api/song/url?mid=0039MnYb0qxYhV&quality=320</div></div>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/song/detail</span></div><p class="d">获取歌曲详情</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">mid</span></td><td>string</td><td>歌曲MID</td></tr><tr><td><span class="pm">id</span></td><td>int</td><td>歌曲ID</td></tr></table><div class="ex">GET /api/song/detail?mid=0039MnYb0qxYhV</div></div>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/song/cover</span></div><p class="d">获取歌曲封面（支持 mid 自动处理、album_mid 回退）</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">mid</span></td><td>string</td><td>歌曲MID（自动获取详情）</td></tr><tr><td><span class="pm">album_mid</span></td><td>string</td><td>专辑MID</td></tr><tr><td><span class="pm">size</span></td><td>int</td><td>150/300/500/800</td></tr><tr><td><span class="pm">validate</span></td><td>bool</td><td>是否验证(默认true)</td></tr></table><div class="ex">GET /api/song/cover?mid=0039MnYb0qxYhV&size=300</div></div>
    <h2>歌词</h2>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/lyric</span></div><p class="d">获取歌词 (支持 LRC/QRC/罗马音/翻译 解密)</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">mid</span></td><td>string</td><td>歌曲MID</td></tr><tr><td><span class="pm">id</span></td><td>int</td><td>歌曲ID</td></tr><tr><td><span class="pm">qrc</span></td><td>bool</td><td>是否获取逐字歌词 (开启后 lyric 字段返回 QRC XML)</td></tr><tr><td><span class="pm">trans</span></td><td>bool</td><td>是否获取翻译歌词 (trans 字段)</td></tr><tr><td><span class="pm">roma</span></td><td>bool</td><td>是否获取罗马音歌词 (roma 字段, XML 格式)</td></tr></table><div class="ex">GET /api/lyric?mid=0039MnYb0qxYhV&qrc=1&trans=1&roma=1</div></div>
    <h2>专辑/歌单/歌手</h2>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/album</span></div><p class="d">获取专辑详情</p><div class="ex">GET /api/album?mid=002fRO0N4FftzY</div></div>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/playlist</span></div><p class="d">获取歌单详情</p><div class="ex">GET /api/playlist?id=8052190267</div></div>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/singer</span></div><p class="d">获取歌手信息</p><div class="ex">GET /api/singer?mid=0025NhlN2yWrP4</div></div>
    <h2>排行榜</h2>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/top</span></div><p class="d">获取排行榜列表或详情</p><div class="ex">GET /api/top</div><div class="ex">GET /api/top?id=4&num=50</div></div>
    <h2>APP 配置</h2>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/app/update</span></div><p class="d">获取 APP 更新配置(版本比对与强制更新判断)</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">platform</span><span class="r">*</span></td><td>string</td><td>android / ios</td></tr><tr><td><span class="pm">version</span></td><td>string</td><td>客户端当前版本,如 1.2.0</td></tr><tr><td><span class="pm">build</span></td><td>int</td><td>构建号,用于强制更新判断</td></tr><tr><td><span class="pm">channel</span></td><td>string</td><td>渠道,默认 official</td></tr></table><div class="ex">GET /api/app/update?platform=android&version=1.0.0&build=80</div><p class="d">返回 hasUpdate / forceUpdate / latestVersion / changelog / downloadUrl / fileHash 等字段</p></div>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/app/notice</span></div><p class="d">获取 APP 公告(支持平台/版本/渠道过滤与定时上下线)</p><table><tr><th>参数</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">platform</span></td><td>string</td><td>android / ios,不传返回全平台</td></tr><tr><td><span class="pm">version</span></td><td>string</td><td>客户端版本,用于版本限定公告</td></tr><tr><td><span class="pm">channel</span></td><td>string</td><td>渠道,默认 official</td></tr></table><div class="ex">GET /api/app/notice?platform=android&version=1.2.0</div><p class="d">返回 notices 数组(type/level/title/content/actionUrl/forceShow)及 serverTime</p></div>
    <h2>用户系统</h2>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=register</span></div><p class="d">注册账号(同一设备仅能注册一个)</p><table><tr><th>字段</th><th>类型</th><th>说明</th></tr><tr><td><span class="pm">username</span><span class="r">*</span></td><td>string</td><td>3-20 位字母数字下划线</td></tr><tr><td><span class="pm">password</span><span class="r">*</span></td><td>string</td><td>至少 6 位</td></tr><tr><td><span class="pm">deviceId</span><span class="r">*</span></td><td>string</td><td>设备指纹</td></tr></table><div class="ex">POST /api/user?action=register{ "username":"test", "password":"123456", "deviceId":"abc123" }</div><p class="d">首个注册用户自动成为管理员</p></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=login</span></div><p class="d">登录, 返回 token 用于后续接口鉴权</p><div class="ex">POST /api/user?action=login{ "username":"test", "password":"123456" }</div><p class="d">返回 token, 后续请求头带: Authorization: Bearer 你的token</p></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/user?action=logout</span></div><p class="d">登出, 注销当前 token</p></div>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/user?action=me</span></div><p class="d">查询当前用户信息与今日用量(需 token)</p><div class="ex">GET /api/user?action=meAuthorization: Bearer 你的token</div></div>
    <h2>用户规则</h2>
    <div class="e"><table><tr><th>等级</th><th>调用限制</th><th>说明</th></tr><tr><td><span class="tag tag-normal" style="padding:2px 8px;border-radius:4px;background:#333;color:#aaa">普通用户</span></td><td>每日 50 次</td><td>超出返回 429</td></tr><tr><td><span class="tag tag-vip" style="padding:2px 8px;border-radius:4px;background:#f0a020;color:#000">VIP 用户</span></td><td>无限制</td><td>不限调用次数</td></tr></table><p class="d">所有 /api/ 接口(除注册登录外)均需携带 Bearer token。普通用户仅统计类接口计数。</p></div>
    <h2>管理接口</h2>
    <div class="e"><div class="h"><span class="m">GET</span><span class="p">/api/admin/users?action=list</span></div><p class="d">用户列表(需 admin), 支持 page/size 分页</p><div class="ex">GET /api/admin/users?action=list&page=1&size=20Authorization: Bearer 管理员token</div></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=level</span></div><p class="d">修改用户等级(normal/vip)</p><div class="ex">POST /api/admin/users?action=level{ "userId":2, "level":"vip" }</div></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=status</span></div><p class="d">禁用/启用用户(status: 1启用 0禁用)</p><div class="ex">POST /api/admin/users?action=status{ "userId":2, "status":0 }</div></div>
    <div class="e"><div class="h"><span class="m">POST</span><span class="p">/api/admin/users?action=delete</span></div><p class="d">删除用户(级联清理会话与用量)</p><div class="ex">POST /api/admin/users?action=delete{ "userId":2 }</div></div>
    <div class="e"><div class="h"><span class="m">PAGE</span><span class="p">/admin/users</span></div><p class="d">图形化管理后台, 填入管理员 token 后可增删改查用户</p><div class="ex"><a href="/admin/users" style="color:#31c27c">打开用户管理后台 →</a></div></div>
    <footer><a href="https://doc.ygking.top">文档</a> · <a href="https://github.com/tooplick/qq-music-api">GitHub</a></footer>
</div>
<script>
(function(){
  var APIS = [
    {path:'/api/search',method:'GET',desc:'搜索歌曲/歌手/专辑/歌单',params:[{k:'keyword',v:'周杰伦',req:1},{k:'type',v:'song'},{k:'num',v:'10'},{k:'page',v:'1'}]},
    {path:'/api/song/url',method:'GET',desc:'获取歌曲播放链接(多音质自动降级)',params:[{k:'mid',v:'0039MnYb0qxYhV',req:1},{k:'quality',v:'320'}]},
    {path:'/api/song/detail',method:'GET',desc:'获取歌曲详情',params:[{k:'mid',v:'0039MnYb0qxYhV',req:1}]},
    {path:'/api/song/cover',method:'GET',desc:'获取歌曲封面(支持 mid / album_mid / vs)',params:[{k:'mid',v:'0039MnYb0qxYhV'},{k:'size',v:'300'}]},
    {path:'/api/lyric',method:'GET',desc:'获取歌词(LRC/QRC/翻译/罗马音)',params:[{k:'mid',v:'0039MnYb0qxYhV',req:1},{k:'qrc',v:'1'},{k:'trans',v:'1'},{k:'roma',v:'1'}]},
    {path:'/api/album',method:'GET',desc:'获取专辑详情',params:[{k:'mid',v:'002fRO0N4FftzY',req:1}]},
    {path:'/api/playlist',method:'GET',desc:'获取歌单详情',params:[{k:'id',v:'8052190267',req:1}]},
    {path:'/api/singer',method:'GET',desc:'获取歌手信息',params:[{k:'mid',v:'0025NhlN2yWrP4',req:1}]},
    {path:'/api/top',method:'GET',desc:'获取排行榜列表或详情',params:[{k:'id',v:'4'},{k:'num',v:'50'}]},
    {path:'/api/app/update',method:'GET',desc:'APP 更新配置(版本比对/强制更新)',params:[{k:'platform',v:'android',req:1},{k:'version',v:'1.0.0'},{k:'build',v:'80'}]},
    {path:'/api/app/notice',method:'GET',desc:'APP 公告(平台/版本/渠道过滤)',params:[{k:'platform',v:'android'},{k:'version',v:'1.2.0'}]},
    {path:'/api/credential',method:'GET',desc:'读取当前凭证',params:[]},
    {path:'/api/refresh',method:'POST',desc:'手动刷新凭证(force=true 强制刷新)',params:[{k:'force',v:'true'}],body:'{}'}
  ];
  var NL = String.fromCharCode(10);
  var sel = document.getElementById('at-endpoint');
  var pbox = document.getElementById('at-params');
  var resp = document.getElementById('at-resp');
  var btn = document.getElementById('at-send');
  var descEl = document.getElementById('at-desc');
  var statusEl = document.getElementById('at-status');
  var bodyWrap = document.getElementById('at-body-wrap');
  var bodyBox = document.getElementById('at-body');
  APIS.forEach(function(a,i){
    var o = document.createElement('option');
    o.value = i;
    o.textContent = a.method + '  ' + a.path;
    sel.appendChild(o);
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
    descEl.innerHTML = badge + esc(api.desc || '');
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
      bodyBox.value = api.body || '{}';
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
    if(api.method === 'POST'){
      var raw = bodyBox.value.trim() || '{}';
      try { JSON.parse(raw); } catch(e){ statusEl.innerHTML = '\u003cspan class="err"\u003eBody JSON 格式错误\u003c/span\u003e'; return; }
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = raw;
    }
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
  sel.addEventListener('change', renderParams);
  renderParams();
  btn.addEventListener('click', doSend);
  document.getElementById('at-reset').addEventListener('click', renderParams);
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

        // 静态首页 - 动态生成包含统计数据
        if (path === "/" || path === "/index.html") {
            let totalCount = 0;

            if (env.DB) {
                try {
                    totalCount = await getTotalCount(env.DB);
                } catch (e) {
                    console.error("获取统计数据失败:", e);
                }
            }

            return new Response(generateIndexHtml(totalCount), {
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
                // 普通用户限流(仅统计端点)
                if (currentUser.level !== "vip" && statsEndpoints.includes(path)) {
                    const used = await getUsageToday(env.DB, currentUser.id);
                    if (used >= currentUser.daily_limit) {
                        return new Response(JSON.stringify({
                            error: "Daily limit reached",
                            limit: currentUser.daily_limit,
                            used,
                        }), {
                            status: 429,
                            headers: { "Content-Type": "application/json", ...corsHeaders },
                        });
                    }
                    await incrUsage(env.DB, currentUser.id);
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

            return handler.onRequest({ request, env, ctx, user: currentUser });
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
