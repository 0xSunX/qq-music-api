/**
 * 用户管理后台页面 GET /admin/users
 * 支持查询/搜索、查看详情、编辑信息、改等级、禁用启用、删除
 */

export function onRequest(context) {
    const { request } = context;
    if (request.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
    }
    return new Response(ADMIN_HTML, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
    });
}

const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>用户管理</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#1a1a1a;color:#e0e0e0;padding:20px}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:1.4rem;margin-bottom:16px;color:#31c27c}
.bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.bar input{flex:1;min-width:160px;background:#222;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:8px;font-family:monospace}
.bar button{cursor:pointer;background:#31c27c;color:#000;border:none;border-radius:4px;padding:8px 16px;font-weight:600}
.bar button.ghost{background:#2a2a2a;color:#e0e0e0;border:1px solid #444}
table{width:100%;border-collapse:collapse;font-size:.85rem}
th,td{padding:8px;text-align:left;border-bottom:1px solid #2a2a2a}
th{color:#888;font-weight:500}
tr:hover{background:#222}
.tag{padding:2px 8px;border-radius:4px;font-size:.72rem;font-weight:700}
.tag-vip{background:#f0a020;color:#000}
.tag-normal{background:#333;color:#aaa}
.tag-on{background:#31c27c;color:#000}
.tag-off{background:#f44;color:#fff}
.act{cursor:pointer;background:#2a2a2a;border:1px solid #444;color:#e0e0e0;border-radius:3px;padding:3px 8px;font-size:.75rem;margin-right:4px;margin-bottom:2px}
.act:hover{border-color:#31c27c}
.act.danger:hover{border-color:#f44;color:#f44}
#status{margin:12px 0;color:#888;font-size:.85rem;min-height:20px}
.pager{margin-top:16px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pager button{cursor:pointer;background:#2a2a2a;border:1px solid #444;color:#e0e0e0;border-radius:4px;padding:6px 12px}
.mask{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:50;justify-content:center;align-items:center;padding:20px}
.mask.show{display:flex}
.modal{background:#222;border:1px solid #333;border-radius:8px;width:100%;max-width:460px;padding:20px;max-height:90vh;overflow:auto}
.modal h2{font-size:1.1rem;color:#31c27c;margin-bottom:14px}
.field{margin-bottom:12px}
.field label{display:block;color:#888;font-size:.8rem;margin-bottom:4px;font-family:monospace}
.field input,.field select{width:100%;background:#181818;border:1px solid #333;color:#e0e0e0;border-radius:4px;padding:8px;font-family:monospace}
.ro{color:#aaa;font-size:.82rem;font-family:monospace;word-break:break-all}
.modal .btns{display:flex;gap:8px;margin-top:16px}
.modal .btns button{flex:1;cursor:pointer;border:none;border-radius:4px;padding:10px;font-weight:600}
.modal .btns .save{background:#31c27c;color:#000}
.modal .btns .cancel{background:#2a2a2a;color:#e0e0e0;border:1px solid #444}
</style>
</head>
<body>
<div class="wrap">
  <h1>👥 用户管理</h1>
  <div class="bar">
    <input id="token" placeholder="粘贴管理员 Token">
    <input id="search" placeholder="搜索用户名 / ID">
    <button id="load">加载</button>
    <button id="logout" class="ghost">返回首页</button>
  </div>
  <div id="status">请填入 Token 后加载</div>
  <table id="tbl" style="display:none">
    <thead><tr>
      <th>ID</th><th>用户名</th><th>等级</th>
      <th>角色</th><th>状态</th><th>日限额</th><th>操作</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div class="pager" id="pager" style="display:none">
    <button id="prev">上一页</button>
    <span id="pageinfo"></span>
    <button id="next">下一页</button>
  </div>
</div>
<div class="mask" id="mask">
  <div class="modal">
    <h2 id="mTitle">编辑用户</h2>
    <div class="field"><label>ID</label><div class="ro" id="mId"></div></div>
    <div class="field"><label>设备ID</label><div class="ro" id="mDevice"></div></div>
    <div class="field"><label>注册时间</label><div class="ro" id="mCreated"></div></div>
    <div class="field"><label>用户名</label><input id="eName"></div>
    <div class="field"><label>重置密码 (留空不改)</label><input id="ePass" placeholder="不修改请留空"></div>
    <div class="field"><label>日限额</label><input id="eLimit" type="number"></div>
    <div class="field"><label>等级</label>
      <select id="eLevel"><option value="normal">normal</option><option value="vip">vip</option></select></div>
    <div class="field"><label>状态</label>
      <select id="eStatus"><option value="1">正常</option><option value="0">禁用</option></select></div>
    <div class="btns">
      <button class="save" id="mSave">保存</button>
      <button class="cancel" id="mCancel">取消</button>
    </div>
  </div>
</div>
<script>
var PAGE = 1, SIZE = 20;
var curEditId = null;
var tokenEl = document.getElementById('token');
var searchEl = document.getElementById('search');
var statusEl = document.getElementById('status');
var rowsEl = document.getElementById('rows');
var tblEl = document.getElementById('tbl');
var pagerEl = document.getElementById('pager');
var pageinfoEl = document.getElementById('pageinfo');
var maskEl = document.getElementById('mask');

function api(action, opts){
  var url = '/api/admin/users?action=' + action;
  var t = tokenEl.value.trim();
  var init = opts || {};
  init.headers = Object.assign({ 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' }, init.headers || {});
  return fetch(url, init).then(function(r){ return r.json().then(function(d){ return { ok: r.ok, status: r.status, data: d }; }); });
}
function setStatus(msg, isErr){ statusEl.textContent = msg; statusEl.style.color = isErr ? '#f44' : '#888'; }
function td(text){ var e = document.createElement('td'); e.textContent = text; return e; }
function tag(text, cls){ var s = document.createElement('span'); s.className = 'tag ' + cls; s.textContent = text; return s; }
function mkBtn(txt, cls, fn){ var b = document.createElement('button'); b.className = 'act ' + cls; b.textContent = txt; b.onclick = fn; return b; }
function fmtTime(ts){ if(!ts) return '-'; var d = new Date(ts * 1000); return d.toLocaleString(); }

function loadUsers(){
  if(!tokenEl.value.trim()){ setStatus('请先填入 Token', true); return; }
  setStatus('加载中...');
  api('list&page=' + PAGE + '&size=' + SIZE, { method: 'GET' }).then(function(res){
    if(!res.ok){ setStatus('加载失败: ' + (res.data.error || res.status), true); return; }
    var d = res.data;
    var list = d.list || [];
    var kw = searchEl.value.trim().toLowerCase();
    if(kw){ list = list.filter(function(u){ return String(u.id) === kw || String(u.username).toLowerCase().indexOf(kw) >= 0; }); }
    if(list.length === 0){ setStatus('无匹配用户'); tblEl.style.display = 'none'; pagerEl.style.display = 'none'; return; }
    renderRows(list);
    tblEl.style.display = ''; pagerEl.style.display = '';
    var totalPages = Math.ceil(d.total / SIZE) || 1;
    pageinfoEl.textContent = '第 ' + PAGE + ' / ' + totalPages + ' 页 (共 ' + d.total + ' 人)';
    setStatus('加载完成, 本页 ' + list.length + ' 条');
  }).catch(function(e){ setStatus('请求异常: ' + e.message, true); });
}

function renderRows(list){
  rowsEl.textContent = '';
  list.forEach(function(u){
    var tr = document.createElement('tr');
    tr.appendChild(td(u.id));
    tr.appendChild(td(u.username));
    var tdl = td(''); tdl.appendChild(tag(u.level, u.level === 'vip' ? 'tag-vip' : 'tag-normal')); tr.appendChild(tdl);
    tr.appendChild(td(u.role));
    var tds = td(''); tds.appendChild(tag(u.status === 1 ? '正常' : '禁用', u.status === 1 ? 'tag-on' : 'tag-off')); tr.appendChild(tds);
    tr.appendChild(td(u.level === 'vip' ? '∞' : u.dailyLimit));
    var tdop = document.createElement('td');
    if(u.role === 'admin'){
      var sp = document.createElement('span'); sp.style.color = '#666'; sp.style.fontSize = '.75rem'; sp.textContent = '管理员不可操作'; tdop.appendChild(sp);
    } else {
      tdop.appendChild(mkBtn('编辑', 'ghost', function(){ openEdit(u.id); }));
      tdop.appendChild(mkBtn('改VIP', 'ghost', function(){ setLevel(u.id, 'vip'); }));
      tdop.appendChild(mkBtn('改普通', 'ghost', function(){ setLevel(u.id, 'normal'); }));
      tdop.appendChild(mkBtn(u.status === 1 ? '禁用' : '启用', 'ghost', function(){ setStatus2(u.id, u.status === 1 ? 0 : 1); }));
      tdop.appendChild(mkBtn('删除', 'danger', function(){ delUser(u.id, u.username); }));
    }
    tr.appendChild(tdop);
    rowsEl.appendChild(tr);
  });
}

function openEdit(id){
  setStatus('读取详情...');
  api('detail&userId=' + id, { method: 'GET' }).then(function(res){
    if(!res.ok){ setStatus('读取失败: ' + (res.data.error || res.status), true); return; }
    var u = res.data.user;
    curEditId = u.id;
    document.getElementById('mId').textContent = u.id;
    document.getElementById('mDevice').textContent = u.deviceId || '-';
    document.getElementById('mCreated').textContent = fmtTime(u.createdAt);
    document.getElementById('eName').value = u.username;
    document.getElementById('ePass').value = '';
    document.getElementById('eLimit').value = u.dailyLimit;
    document.getElementById('eLevel').value = u.level;
    document.getElementById('eStatus').value = String(u.status);
    maskEl.classList.add('show');
    setStatus('就绪');
  });
}

function closeEdit(){ maskEl.classList.remove('show'); curEditId = null; }

function saveEdit(){
  if(!curEditId) return;
  var body = { userId: curEditId };
  var name = document.getElementById('eName').value.trim();
  if(name) body.username = name;
  var pass = document.getElementById('ePass').value;
  if(pass) body.password = pass;
  var lim = document.getElementById('eLimit').value;
  if(lim !== '') body.dailyLimit = parseInt(lim, 10);
  body.level = document.getElementById('eLevel').value;
  body.status = parseInt(document.getElementById('eStatus').value, 10);
  setStatus('保存中...');
  api('update', { method: 'POST', body: JSON.stringify(body) }).then(function(res){
    if(!res.ok){ setStatus('保存失败: ' + (res.data.error || res.status), true); return; }
    closeEdit();
    setStatus('已保存');
    loadUsers();
  });
}

function setLevel(id, level){
  setStatus('修改中...');
  api('level', { method: 'POST', body: JSON.stringify({ userId: id, level: level }) })
    .then(function(res){ if(!res.ok){ setStatus('失败: ' + (res.data.error || res.status), true); return; } setStatus('已改为 ' + level); loadUsers(); });
}
function setStatus2(id, status){
  setStatus('修改中...');
  api('status', { method: 'POST', body: JSON.stringify({ userId: id, status: status }) })
    .then(function(res){ if(!res.ok){ setStatus('失败: ' + (res.data.error || res.status), true); return; } setStatus(status ? '已启用' : '已禁用'); loadUsers(); });
}
function delUser(id, name){
  if(!confirm('确定删除用户 ' + name + ' ? 不可恢复')) return;
  setStatus('删除中...');
  api('delete', { method: 'POST', body: JSON.stringify({ userId: id }) })
    .then(function(res){ if(!res.ok){ setStatus('失败: ' + (res.data.error || res.status), true); return; } setStatus('已删除 ' + name); loadUsers(); });
}

document.getElementById('load').onclick = function(){ PAGE = 1; loadUsers(); };
document.getElementById('prev').onclick = function(){ if(PAGE > 1){ PAGE--; loadUsers(); } };
document.getElementById('next').onclick = function(){ PAGE++; loadUsers(); };
document.getElementById('logout').onclick = function(){ location.href = '/'; };
document.getElementById('mSave').onclick = saveEdit;
document.getElementById('mCancel').onclick = closeEdit;
maskEl.onclick = function(e){ if(e.target === maskEl) closeEdit(); };
searchEl.addEventListener('input', function(){ if(tblEl.style.display !== 'none') loadUsers(); });

tokenEl.value = localStorage.getItem('adminToken') || '';
tokenEl.addEventListener('change', function(){ localStorage.setItem('adminToken', tokenEl.value.trim()); });
</script>
</body>
</html>`;
