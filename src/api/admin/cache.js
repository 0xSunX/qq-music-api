/**
 * 缓存管理 - 缓存列表页面 + 数据接口
 * GET /api/admin/cache?action=stats   命中率统计
 * GET /api/admin/cache?action=list&page=1&size=20&keyword=  缓存列表
 * POST /api/admin/cache?action=delete  { cacheKey }  删除一条
 * POST /api/admin/cache?action=clear   清空全部
 * 需 admin 角色
 */

import { jsonResponse, errorResponse, handleOptions } from "../../lib/request.js";
import { ensureUrlCacheTable, listCache, deleteCacheEntry, clearCache, getCacheStats, getCacheDistribution, resetMemStats } from "../../lib/urlcache.js";

export async function onRequest(context) {
    const { request, env, user } = context;
    if (request.method === "OPTIONS") return handleOptions();
    if (!env.DB) return errorResponse("D1 database not bound", 503);
    if (!user) return errorResponse("Unauthorized", 401);
    if (user.role !== "admin") return errorResponse("Forbidden: admin only", 403);

    await ensureUrlCacheTable(env.DB);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";

    try {
        if (action === "stats") {
            return jsonResponse({ code: 0, stats: await getCacheStats(env.DB) });
        }
        if (action === "dist") {
            return jsonResponse({ code: 0, dist: await getCacheDistribution(env.DB) });
        }
        if (action === "resetmem") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            resetMemStats();
            return jsonResponse({ code: 0, message: "内存层统计已重置" });
        }
        if (action === "list") {
            const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
            const size = Math.min(parseInt(url.searchParams.get("size") || "20", 10) || 20, 100);
            const keyword = url.searchParams.get("keyword") || "";
            const r = await listCache(env.DB, page, size, keyword);
            return jsonResponse({ code: 0, page, size, total: r.total, list: r.list });
        }
        if (action === "delete") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            const body = await request.json();
            if (!body.cacheKey) return errorResponse("缺少 cacheKey", 400);
            await deleteCacheEntry(env.DB, body.cacheKey);
            return jsonResponse({ code: 0, message: "已删除", cacheKey: body.cacheKey });
        }
        if (action === "clear") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            await clearCache(env.DB);
            return jsonResponse({ code: 0, message: "缓存已清空" });
        }
        return errorResponse("Unknown action: " + action, 400);
    } catch (err) {
        return errorResponse(err.message, 400);
    }
}

/** 缓存列表页面 HTML */
export function renderPage() {
    return CACHE_HTML;
}

const CACHE_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>缓存列表</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#1a1a1a;color:#e0e0e0;padding:20px}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:1.4rem;margin-bottom:16px;color:#31c27c}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.card{flex:1;min-width:140px;background:#222;border:1px solid #2c2c2c;border-radius:8px;padding:16px}
.card .n{font-size:1.8rem;font-weight:700;color:#4ec9b0;font-variant-numeric:tabular-nums}
.card .l{color:#888;font-size:.8rem;margin-top:6px}
.bar{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.bar input{flex:1;min-width:160px;background:#222;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:8px;font-family:monospace}
.bar button{cursor:pointer;background:#2a2a2a;color:#e0e0e0;border:1px solid #444;border-radius:4px;padding:8px 16px;font-weight:600;transition:background .15s,border-color .15s}
.bar button:hover{background:#333;border-color:#31c27c}
.bar button.ghost{background:#2a2a2a;color:#e0e0e0;border:1px solid #444}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th,td{padding:8px;text-align:left;border-bottom:1px solid #2a2a2a}
th{color:#888;font-weight:500}
tr:hover{background:#222}
.mono{font-family:monospace;word-break:break-all}
.url{color:#ce9178;max-width:340px;display:inline-block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;vertical-align:middle}
.act{cursor:pointer;background:#2a2a2a;border:1px solid #444;color:#e0e0e0;border-radius:3px;padding:3px 8px;font-size:.75rem}
.act.danger:hover{border-color:#f44;color:#f44}
#status{margin:10px 0;color:#888;font-size:.85rem;min-height:20px}
.pager{margin-top:14px;display:flex;gap:8px;align-items:center}
.pager button{cursor:pointer;background:#2a2a2a;border:1px solid #444;color:#e0e0e0;border-radius:4px;padding:6px 12px}
.charts{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px}
@media(max-width:760px){.charts{grid-template-columns:1fr}}
.chart{background:#222;border:1px solid #2c2c2c;border-radius:8px;padding:16px}
.chart h3{font-size:.85rem;color:#888;font-weight:500;margin-bottom:14px;letter-spacing:1px}
.crow{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:.78rem}
.crow .cl{width:110px;color:#aaa;font-family:monospace;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex-shrink:0}
.crow .cb{flex:1;background:#1a1a1a;border-radius:3px;height:16px;overflow:hidden;position:relative}
.crow .cf{height:100%;border-radius:3px;background:linear-gradient(90deg,#31c27c,#4ec9b0);transition:width .4s ease;min-width:2px}
.crow .cn{width:52px;color:#4ec9b0;font-variant-numeric:tabular-nums;text-align:right;flex-shrink:0}
.crow:nth-child(2n) .cf{background:linear-gradient(90deg,#4facfe,#00d4ff)}
.crow:nth-child(3n) .cf{background:linear-gradient(90deg,#f0a020,#ffb733)}
.crow:nth-child(5n) .cf{background:linear-gradient(90deg,#a06cf0,#c48fff)}
.chart .empty{color:#555;font-size:.8rem;text-align:center;padding:20px 0}
</style>
</head>
<body>
<div class="wrap">
  <h1>🗃 播放链接缓存</h1>
  <h2 style="font-size:.9rem;color:#888;margin:0 0 10px;font-weight:500">D1 持久层</h2>
  <div class="cards">
    <div class="card"><div class="n" id="cHitRate">-</div><div class="l">累计缓存命中率</div></div>
    <div class="card"><div class="n" id="cHits">-</div><div class="l">命中次数</div></div>
    <div class="card"><div class="n" id="cMisses">-</div><div class="l">未命中次数</div></div>
    <div class="card"><div class="n" id="cCount">-</div><div class="l">缓存条目数</div></div>
  </div>
  <h2 style="font-size:.9rem;color:#4ec9b0;margin:20px 0 10px;font-weight:500">⚡ 内存层 (isolate) · 本实例累计</h2>
  <div class="cards">
    <div class="card"><div class="n" id="mHitRate">-</div><div class="l">内存命中率</div></div>
    <div class="card"><div class="n" id="mSaved">-</div><div class="l">省下 D1 查表次数</div></div>
    <div class="card"><div class="n" id="mHits">-</div><div class="l">内存命中</div></div>
    <div class="card"><div class="n" id="mMisses">-</div><div class="l">回源 D1</div></div>
    <div class="card"><div class="n" id="mSize">-</div><div class="l">内存条目数</div></div>
  </div>
  <div class="charts">
    <div class="chart"><h3>请求音质分布</h3><div id="chartQuality"><div class="empty">暂无数据</div></div></div>
    <div class="chart"><h3>命中音质分布</h3><div id="chartActual"><div class="empty">暂无数据</div></div></div>
    <div class="chart"><h3>缓存新鲜度</h3><div id="chartFresh"><div class="empty">暂无数据</div></div></div>
    <div class="chart"><h3>缓存条目 Top MID</h3><div id="chartTop"><div class="empty">暂无数据</div></div></div>
  </div>
  <div class="bar">
    <input id="kw" placeholder="按 mid / URL 搜索">
    <button id="load">加载</button>
    <button id="clear">清空缓存</button>
    <button id="resetmem" class="ghost">重置内存统计</button>
    <button id="back" class="ghost">返回上一页</button>
  </div>
  <div id="status">就绪</div>
  <table id="tbl" style="display:none">
    <thead><tr><th>MID</th><th>请求音质</th><th>命中音质</th><th>链接</th><th>写入时间</th><th>操作</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="pager" id="pager" style="display:none">
    <button id="prev">上一页</button><span id="pageinfo"></span><button id="next">下一页</button>
  </div>
</div>
<script>
(function(){
  var PAGE=1, SIZE=20;
  var token=localStorage.getItem('adminToken')||'', kwEl=document.getElementById('kw');
  var statusEl=document.getElementById('status'), rowsEl=document.getElementById('rows');
  var tblEl=document.getElementById('tbl'), pagerEl=document.getElementById('pager'), pageinfoEl=document.getElementById('pageinfo');
  function getDeviceId(){ var k='mtDeviceId', v=localStorage.getItem(k); if(!v){ v='web-'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); localStorage.setItem(k,v);} return v; }
  function api(qs, opts){ var url='/api/admin/cache?'+qs; var t=token.trim(); var init=opts||{}; init.headers=Object.assign({'Authorization':'Bearer '+t,'Content-Type':'application/json','X-Device-Id':getDeviceId()}, init.headers||{}); return fetch(url,init).then(function(r){ return r.json().then(function(d){ return {ok:r.ok,status:r.status,data:d}; }); }); }
  function setStatus(m,e){ statusEl.textContent=m; statusEl.style.color=e?'#f44':'#888'; }
  function fmtTime(ts){ if(!ts) return '-'; return new Date(ts*1000).toLocaleString(); }
  function loadStats(){ api('action=stats',{method:'GET'}).then(function(res){ if(!res.ok) return; var s=res.data.stats||{}; document.getElementById('cHitRate').textContent=(s.hitRate||0)+'%'; document.getElementById('cHits').textContent=s.hits||0; document.getElementById('cMisses').textContent=s.misses||0; document.getElementById('cCount').textContent=s.count||0; document.getElementById('mHitRate').textContent=(s.memHitRate||0)+'%'; document.getElementById('mSaved').textContent=s.savedD1||0; document.getElementById('mHits').textContent=s.memHits||0; document.getElementById('mMisses').textContent=s.memMisses||0; document.getElementById('mSize').textContent=s.memSize||0; }); }
  function drawBars(elId, rows){
    var el=document.getElementById(elId);
    if(!rows || rows.length===0){ el.innerHTML='<div class=\"empty\">暂无数据</div>'; return; }
    var max=Math.max.apply(null, rows.map(function(r){return r.count;}));
    if(max<=0) max=1;
    el.innerHTML='';
    rows.forEach(function(r){
      var pct=Math.max(2, Math.round(r.count/max*100));
      var row=document.createElement('div'); row.className='crow';
      var l=document.createElement('div'); l.className='cl'; l.textContent=r.key; l.title=r.key;
      var b=document.createElement('div'); b.className='cb';
      var f=document.createElement('div'); f.className='cf'; f.style.width=pct+'%';
      b.appendChild(f);
      var n=document.createElement('div'); n.className='cn'; n.textContent=r.count;
      row.appendChild(l); row.appendChild(b); row.appendChild(n); el.appendChild(row);
    });
  }
  function loadDist(){
    api('action=dist',{method:'GET'}).then(function(res){
      if(!res.ok) return;
      var d=res.data.dist||{};
      drawBars('chartQuality', d.byQuality||[]);
      drawBars('chartActual', d.byActualQuality||[]);
      drawBars('chartFresh', d.freshness||[]);
      drawBars('chartTop', d.topMids||[]);
    });
  }
  function loadList(){ setStatus('加载中...'); api('action=list&page='+PAGE+'&size='+SIZE+'&keyword='+encodeURIComponent(kwEl.value.trim()),{method:'GET'}).then(function(res){ if(!res.ok){ setStatus('加载失败: '+(res.data.error||res.status),true); return; } var d=res.data, list=d.list||[]; if(list.length===0){ setStatus('暂无缓存'); tblEl.style.display='none'; pagerEl.style.display='none'; return; } renderRows(list); tblEl.style.display=''; pagerEl.style.display=''; var tp=Math.ceil(d.total/SIZE)||1; pageinfoEl.textContent='第 '+PAGE+' / '+tp+' 页 · 共 '+d.total+' 条'; setStatus('就绪'); }); }
  function renderRows(list){ rowsEl.innerHTML=''; list.forEach(function(r){ var tr=document.createElement('tr'); function td(t,c){ var e=document.createElement('td'); if(c)e.className=c; e.textContent=t; return e; } tr.appendChild(td(r.mid,'mono')); tr.appendChild(td(r.quality||'')); tr.appendChild(td(r.actual_quality||'')); var tdu=document.createElement('td'); var u=document.createElement('span'); u.className='url'; u.title=r.url; u.textContent=r.url; tdu.appendChild(u); tr.appendChild(tdu); tr.appendChild(td(fmtTime(r.created_at))); var tdo=document.createElement('td'); var b=document.createElement('button'); b.className='act danger'; b.textContent='删除'; b.onclick=function(){ if(!confirm('删除这条缓存?')) return; api('action=delete',{method:'POST',body:JSON.stringify({cacheKey:r.cache_key})}).then(function(res){ if(!res.ok){ setStatus('删除失败: '+(res.data.error||res.status),true); return; } setStatus('已删除'); loadList(); loadStats(); }); }; tdo.appendChild(b); tr.appendChild(tdo); rowsEl.appendChild(tr); }); }
  document.getElementById('load').onclick=function(){ PAGE=1; loadStats(); loadDist(); loadList(); };
  document.getElementById('prev').onclick=function(){ if(PAGE>1){ PAGE--; loadList(); } };
  document.getElementById('next').onclick=function(){ PAGE++; loadList(); };
  // 搜索防抖: 输入 300ms 后再查, 避免每敲一键都打一次接口
  var searchTimer=null;
  kwEl.addEventListener('input', function(){
    if(searchTimer) clearTimeout(searchTimer);
    searchTimer=setTimeout(function(){ PAGE=1; loadList(); }, 300);
  });
  document.getElementById('back').onclick=function(){ location.href='/admin'; };
  document.getElementById('clear').onclick=function(){ if(!confirm('确定清空全部缓存? 不可恢复')) return; api('action=clear',{method:'POST',body:'{}'}).then(function(res){ if(!res.ok){ setStatus('清空失败: '+(res.data.error||res.status),true); return; } setStatus('缓存已清空'); PAGE=1; loadList(); loadStats(); }); };
  document.getElementById('resetmem').onclick=function(){ if(!confirm('重置本实例内存层统计计数? (不影响缓存内容)')) return; api('action=resetmem',{method:'POST',body:'{}'}).then(function(res){ if(!res.ok){ setStatus('重置失败: '+(res.data.error||res.status),true); return; } setStatus('内存统计已重置'); loadStats(); }); };
  if(token){ loadStats(); loadDist(); loadList(); } else { setStatus('未登录, 请先到 /admin 登录',true); }
})();
</script>
</body>
</html>`;
