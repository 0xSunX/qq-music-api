/**
 * 风控防护管理 - 页面 + 数据接口
 * GET  /api/admin/risk?action=stats    总览
 * GET  /api/admin/risk?action=config   读配置
 * POST /api/admin/risk?action=config   改配置
 * GET  /api/admin/risk?action=blocks   封禁列表
 * POST /api/admin/risk?action=unblock  解封单个 {scope,key}
 * POST /api/admin/risk?action=unblockall 全部解封
 * GET  /api/admin/risk?action=events   事件列表
 * POST /api/admin/risk?action=clearevents 清空事件
 * GET  /api/admin/risk?action=signconfig  读签名开关
 * POST /api/admin/risk?action=signconfig  改签名开关
 * 需 admin 角色
 */

import { jsonResponse, errorResponse, handleOptions } from "../../lib/request.js";
import {
    ensureRiskTables, getRiskConfig, setRiskConfig, getRiskStats,
    listBlocks, listEvents, unblock, unblockAll, clearEvents,
} from "../../lib/risk.js";
import { getReqSignEnabled, setReqSignEnabled } from "../../lib/reqsign.js";

export async function onRequest(context) {
    const { request, env, user } = context;
    if (request.method === "OPTIONS") return handleOptions();
    if (!env.DB) return errorResponse("D1 database not bound", 503);
    if (!user) return errorResponse("Unauthorized", 401);
    if (user.role !== "admin") return errorResponse("Forbidden: admin only", 403);

    await ensureRiskTables(env.DB);
    const url = new URL(request.url);
    const action = url.searchParams.get("action") || "";

    try {
        if (action === "stats") {
            return jsonResponse({ code: 0, stats: await getRiskStats(env.DB) });
        }
        if (action === "config") {
            if (request.method === "POST") {
                const body = await request.json();
                const cfg = await setRiskConfig(env.DB, body || {});
                return jsonResponse({ code: 0, message: "配置已更新", config: cfg });
            }
            return jsonResponse({ code: 0, config: await getRiskConfig(env.DB) });
        }
        if (action === "signconfig") {
            if (request.method === "POST") {
                const body = await request.json();
                const v = body.enabled ? 1 : 0;
                await setReqSignEnabled(env.DB, v);
                return jsonResponse({ code: 0, message: v ? "请求签名校验已开启" : "请求签名校验已关闭", enabled: v });
            }
            return jsonResponse({ code: 0, enabled: await getReqSignEnabled(env.DB) });
        }
        if (action === "blocks") {
            const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
            const size = Math.min(parseInt(url.searchParams.get("size") || "20", 10) || 20, 100);
            const r = await listBlocks(env.DB, page, size);
            return jsonResponse({ code: 0, page, size, total: r.total, list: r.list });
        }
        if (action === "events") {
            const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
            const size = Math.min(parseInt(url.searchParams.get("size") || "20", 10) || 20, 100);
            const r = await listEvents(env.DB, page, size);
            return jsonResponse({ code: 0, page, size, total: r.total, list: r.list });
        }
        if (action === "unblock") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            const body = await request.json();
            if (!body.key) return errorResponse("缺少 key", 400);
            await unblock(env.DB, body.scope || "subject", body.key);
            return jsonResponse({ code: 0, message: "已解封", key: body.key });
        }
        if (action === "unblockall") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            const n = await unblockAll(env.DB);
            return jsonResponse({ code: 0, message: "已全部解封", removed: n });
        }
        if (action === "clearevents") {
            if (request.method !== "POST") return errorResponse("Method not allowed", 405);
            const n = await clearEvents(env.DB);
            return jsonResponse({ code: 0, message: "事件已清空", removed: n });
        }
        return errorResponse("Unknown action: " + action, 400);
    } catch (err) {
        return errorResponse(err.message, 400);
    }
}

export function renderPage() {
    return RISK_HTML;
}

const RISK_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>风控防护</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#1a1a1a;color:#e0e0e0;padding:20px}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:1.4rem;margin-bottom:6px;color:#f0a020}
.sub{color:#666;font-size:.82rem;margin-bottom:18px}
h2{font-size:1rem;color:#31c27c;margin:26px 0 12px;padding-bottom:6px;border-bottom:1px solid #2a2a2a}
.bar{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.bar input{flex:1;min-width:160px;background:#222;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:8px;font-family:monospace}
.bar button{cursor:pointer;background:#31c27c;color:#000;border:none;border-radius:4px;padding:8px 16px;font-weight:600}
.bar button.ghost{background:#2a2a2a;color:#e0e0e0;border:1px solid #444}
.bar button.warn{background:#7a2a2a;color:#fff}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.card{flex:1;min-width:130px;background:#222;border:1px solid #2c2c2c;border-radius:8px;padding:16px}
.card .n{font-size:1.7rem;font-weight:700;color:#f0a020;font-variant-numeric:tabular-nums}
.card .l{color:#888;font-size:.8rem;margin-top:6px}
.cfg{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:14px}
.cfg .f{background:#222;border:1px solid #2c2c2c;border-radius:6px;padding:12px}
.cfg .f label{display:block;color:#888;font-size:.78rem;margin-bottom:6px;font-family:monospace}
.cfg .f input{width:100%;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:7px;font-family:monospace}
table{width:100%;border-collapse:collapse;font-size:.82rem}
th,td{padding:8px;text-align:left;border-bottom:1px solid #2a2a2a}
th{color:#888;font-weight:500}
tr:hover{background:#222}
.mono{font-family:monospace;word-break:break-all}
.rule{padding:2px 8px;border-radius:4px;font-size:.72rem;font-weight:700;background:#7a3fb0;color:#fff}
.act{cursor:pointer;background:#2a2a2a;border:1px solid #444;color:#e0e0e0;border-radius:3px;padding:3px 8px;font-size:.75rem}
.act.danger:hover{border-color:#f44;color:#f44}
#status{margin:10px 0;color:#888;font-size:.85rem;min-height:20px}
.on{color:#31c27c;font-weight:700}
.off{color:#888}
</style>
</head>
<body>
<div class="wrap">
  <h1>🛡 风控防护</h1>
  <div class="sub">行为风控 · 频次突增检测 · MID 遍历识别 · 自动封禁 · 请求签名防重放</div>
  <div class="bar">
    <input id="token" placeholder="粘贴管理员 Token">
    <button id="load">加载</button>
    <button id="back" class="ghost">返回上一页</button>
  </div>
  <div id="status">请填入 Token 后加载</div>

  <div class="cards">
    <div class="card"><div class="n" id="cBlock">-</div><div class="l">当前封禁主体</div></div>
    <div class="card"><div class="n" id="cToday">-</div><div class="l">今日风控事件</div></div>
    <div class="card"><div class="n" id="cTotal">-</div><div class="l">累计事件</div></div>
    <div class="card"><div class="n" id="cSign">-</div><div class="l">请求签名校验</div></div>
  </div>

  <h2>风控参数</h2>
  <div class="cfg">
    <div class="f"><label>总开关 (1开/0关)</label><input id="fEnabled" type="number"></div>
    <div class="f"><label>每秒请求上限</label><input id="fSec" type="number"></div>
    <div class="f"><label>每分钟请求上限</label><input id="fMin" type="number"></div>
    <div class="f"><label>每分钟不同 MID 上限</label><input id="fMid" type="number"></div>
    <div class="f"><label>封禁时长(秒)</label><input id="fBlock" type="number"></div>
    <div class="f"><label>命中即自动封禁 (1/0)</label><input id="fAuto" type="number"></div>
  </div>
  <div class="bar">
    <button id="saveCfg">保存风控参数</button>
    <button id="toggleSign" class="ghost">切换请求签名校验</button>
  </div>

  <h2>当前封禁</h2>
  <div class="bar">
    <button id="unblockAll" class="warn">全部解封</button>
  </div>
  <table id="tblBlock" style="display:none">
    <thead><tr><th>主体</th><th>剩余</th><th>原因</th><th>命中次数</th><th>操作</th></tr></thead>
    <tbody id="rowsBlock"></tbody>
  </table>

  <h2>风控事件</h2>
  <div class="bar">
    <button id="clearEvents" class="warn">清空事件</button>
  </div>
  <table id="tblEvent" style="display:none">
    <thead><tr><th>时间</th><th>主体</th><th>规则</th><th>详情</th></tr></thead>
    <tbody id="rowsEvent"></tbody>
  </table>
</div>
<script>
(function(){
  var tokenEl=document.getElementById('token');
  var statusEl=document.getElementById('status');
  var curSign=0;
  function getDeviceId(){
    var k='mtDeviceId', v=localStorage.getItem(k);
    if(!v){ v='web-'+Math.random().toString(36).slice(2,10)+Date.now().toString(36); localStorage.setItem(k, v); }
    return v;
  }
  function api(action, opts){
    var url='/api/admin/risk?action='+action;
    var init=opts||{};
    init.headers=Object.assign({ 'Authorization':'Bearer '+tokenEl.value.trim(), 'Content-Type':'application/json', 'X-Device-Id':getDeviceId() }, init.headers||{});
    return fetch(url, init).then(function(r){ return r.json().then(function(d){ return { ok:r.ok, status:r.status, data:d }; }); });
  }
  function setStatus(m,e){ statusEl.textContent=m; statusEl.style.color=e?'#f44':'#888'; }
  function fmtTime(ts){ if(!ts) return '-'; return new Date(ts*1000).toLocaleString(); }
  function fmtRemain(sec){ if(sec<=0) return '已过期'; if(sec<60) return sec+' 秒'; return Math.floor(sec/60)+' 分 '+(sec%60)+' 秒'; }
  var ROLE={ burst_1s:'秒级突增', burst_60s:'分钟超限', mid_scan:'MID遍历' };

  function loadStats(){
    api('stats',{method:'GET'}).then(function(res){
      if(!res.ok){ setStatus('加载失败: '+(res.data.error||res.status),1); return; }
      var s=res.data.stats||{};
      document.getElementById('cBlock').textContent=s.activeBlocks||0;
      document.getElementById('cToday').textContent=s.todayEvents||0;
      document.getElementById('cTotal').textContent=s.totalEvents||0;
      var rb=document.getElementById('rowsEvent'), be=document.getElementById('tblEvent');
      var list=s.recent||[];
      if(!list.length){ be.style.display='none'; return; }
      rb.innerHTML='';
      list.forEach(function(e){
        var tr=document.createElement('tr');
        var td1=document.createElement('td'); td1.textContent=fmtTime(e.created_at);
        var td2=document.createElement('td'); td2.className='mono'; td2.textContent=e.subject;
        var td3=document.createElement('td'); var sp=document.createElement('span'); sp.className='rule'; sp.textContent=ROLE[e.rule]||e.rule; td3.appendChild(sp);
        var td4=document.createElement('td'); td4.textContent=e.detail;
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4);
        rb.appendChild(tr);
      });
      be.style.display='';
    });
  }

  function loadConfig(){
    api('config',{method:'GET'}).then(function(res){
      if(!res.ok) return;
      var c=res.data.config||{};
      document.getElementById('fEnabled').value=c.enabled;
      document.getElementById('fSec').value=c.burstPerSec;
      document.getElementById('fMin').value=c.burstPerMin;
      document.getElementById('fMid').value=c.midScanPerMin;
      document.getElementById('fBlock').value=c.blockSeconds;
      document.getElementById('fAuto').value=c.autoBlock;
    });
    api('signconfig',{method:'GET'}).then(function(res){
      if(!res.ok) return;
      curSign=res.data.enabled?1:0;
      var el=document.getElementById('cSign');
      el.textContent=curSign?'开':'关';
      el.style.color=curSign?'#31c27c':'#888';
    });
  }

  function loadBlocks(){
    api('blocks&page=1&size=50',{method:'GET'}).then(function(res){
      if(!res.ok) return;
      var list=res.data.list||[], tb=document.getElementById('tblBlock'), rb=document.getElementById('rowsBlock');
      if(!list.length){ tb.style.display='none'; return; }
      rb.innerHTML='';
      list.forEach(function(b){
        var tr=document.createElement('tr');
        var td1=document.createElement('td'); td1.className='mono'; td1.textContent=b.key;
        var td2=document.createElement('td'); td2.textContent=fmtRemain(b.blocked_until-Math.floor(Date.now()/1000));
        var td3=document.createElement('td'); td3.textContent=b.reason||'-';
        var td4=document.createElement('td'); td4.textContent=b.hits||1;
        var td5=document.createElement('td');
        var btn=document.createElement('button'); btn.className='act danger'; btn.textContent='解封';
        btn.onclick=function(){ api('unblock',{method:'POST',body:JSON.stringify({scope:b.scope,key:b.key})}).then(function(){ loadBlocks(); loadStats(); }); };
        td5.appendChild(btn);
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3); tr.appendChild(td4); tr.appendChild(td5);
        rb.appendChild(tr);
      });
      tb.style.display='';
    });
  }

  document.getElementById('load').onclick=function(){
    if(!tokenEl.value.trim()){ setStatus('请先填入 Token',1); return; }
    localStorage.setItem('adminToken',tokenEl.value.trim());
    setStatus('加载中...');
    loadStats(); loadConfig(); loadBlocks();
    setStatus('已加载');
  };
  document.getElementById('back').onclick=function(){ history.length>1?history.back():location.href='/admin'; };
  document.getElementById('saveCfg').onclick=function(){
    var body={
      enabled:parseInt(document.getElementById('fEnabled').value,10),
      burstPerSec:parseInt(document.getElementById('fSec').value,10),
      burstPerMin:parseInt(document.getElementById('fMin').value,10),
      midScanPerMin:parseInt(document.getElementById('fMid').value,10),
      blockSeconds:parseInt(document.getElementById('fBlock').value,10),
      autoBlock:parseInt(document.getElementById('fAuto').value,10)
    };
    api('config',{method:'POST',body:JSON.stringify(body)}).then(function(res){
      setStatus(res.ok?'配置已保存':'保存失败: '+(res.data.error||res.status), !res.ok);
    });
  };
  document.getElementById('toggleSign').onclick=function(){
    var next=curSign?0:1;
    if(!confirm((next?'开启':'关闭')+'请求签名校验? 开启后未带签名的请求将被拒绝。')) return;
    api('signconfig',{method:'POST',body:JSON.stringify({enabled:next})}).then(function(res){
      if(res.ok){ curSign=next; document.getElementById('cSign').textContent=next?'开':'关'; document.getElementById('cSign').style.color=next?'#31c27c':'#888'; }
      setStatus(res.ok?(next?'已开启签名校验':'已关闭签名校验'):'操作失败', !res.ok);
    });
  };
  document.getElementById('unblockAll').onclick=function(){
    if(!confirm('确认解除全部封禁?')) return;
    api('unblockall',{method:'POST',body:'{}'}).then(function(res){ setStatus(res.ok?'已全部解封':'失败', !res.ok); loadBlocks(); loadStats(); });
  };
  document.getElementById('clearEvents').onclick=function(){
    if(!confirm('确认清空全部风控事件?')) return;
    api('clearevents',{method:'POST',body:'{}'}).then(function(res){ setStatus(res.ok?'事件已清空':'失败', !res.ok); loadStats(); });
  };
})();
</script>
</body>
</html>`;
