// 管理控制台登录门 —— 依赖 device.js 提供的 getDeviceId/ensureDeviceId
(function () {
  'use strict';
  var gate = document.getElementById('gate');
  if (!gate) return;
  function setMsg(t, c) { var m = document.getElementById('gMsg'); if (!m) return; m.textContent = t; m.style.color = c || '#888'; }
  function showConsole() { gate.style.display = 'none'; var c = document.querySelector('.c'); if (c) c.style.display = ''; }
  function doLogout() {
    var tk = localStorage.getItem('adminToken');
    if (tk) { fetch('/api/user?action=logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + tk, 'X-Device-Id': getDeviceId() } }).catch(function () {}); }
    localStorage.removeItem('adminToken');
    var c = document.querySelector('.c'); if (c) c.style.display = 'none';
    gate.style.display = 'flex';
    setMsg('已退出登录', '#888');
    var gu = document.getElementById('gUser'); if (gu) gu.value = '';
    var gp = document.getElementById('gPass'); if (gp) gp.value = '';
  }
  function showInitGuide() {
    var box = document.getElementById('gateBox');
    if (!box) return;
    box.innerHTML = '<h2 style="color:#31c27c;margin-bottom:14px;text-align:center;font-size:1.1rem">站点未初始化</h2>'
      + '<p style="color:#888;font-size:.85rem;line-height:1.7;text-align:center;margin-bottom:18px">尚未创建管理员账号, 请先完成站点初始化。</p>'
      + '<a href="/api/setup" style="display:block;text-align:center;background:#31c27c;color:#000;border-radius:4px;padding:10px;font-weight:600;text-decoration:none">前往初始化 →</a>';
  }
  function initConsole() {
    if (localStorage.getItem('adminToken')) { showConsole(); return; }
    if (localStorage.getItem('siteInitialized') === '1') { return; }
    fetch('/api/setup?status=1').then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.initialized === false) { showInitGuide(); }
    }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initConsole);
  else initConsole();

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'backTop') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      if (document.documentElement) document.documentElement.scrollTop = 0;
      if (document.body) document.body.scrollTop = 0;
    } else if (t.id === 'adminLogout') {
      doLogout();
    }
  }, false);

  var gBtn = document.getElementById('gBtn');
  if (gBtn) gBtn.onclick = function () {
    var u = document.getElementById('gUser').value.trim();
    var p = document.getElementById('gPass').value;
    if (!u || !p) { setMsg('请输入用户名和密码', '#f44'); return; }
    setMsg('登录中...');
    ensureDeviceId().then(function (devId) {
      return fetch('/api/user?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u, password: p, deviceId: devId }) })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          if (!res.ok) { setMsg(res.d.error || '登录失败', '#f44'); return; }
          if (!res.d.user || res.d.user.role !== 'admin') { setMsg('该账号不是管理员', '#f44'); return; }
          localStorage.setItem('adminToken', res.d.token);
          try { localStorage.setItem('siteInitialized', '1'); } catch (e) {}
          showConsole();
        }).catch(function (e) { setMsg('异常: ' + e.message, '#f44'); });
    }).catch(function (e) { setMsg('异常: ' + e.message, '#f44'); });
  };
})();
