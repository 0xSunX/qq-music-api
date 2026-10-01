// API 调试台 —— 独立静态文件，模板字符串转义问题从此消失
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var sel = $('at-endpoint'), pbox = $('at-params'), resp = $('at-resp'), btn = $('at-send');
  var descEl = $('at-desc'), statusEl = $('at-status'), bodyWrap = $('at-body-wrap');
  var bodyBox = $('at-body'), bodyHl = $('at-body-hl'), headersEl = $('at-headers');
  var NL = String.fromCharCode(10);

  var APIS = [
    { group: '音乐业务', docKey: 'doc-search', tip: '搜索', path: '/api/search', method: 'GET', desc: '搜索(公开, IP 限流)', params: [{k:'keyword',v:'周杰伦',req:1},{k:'type',v:'song'},{k:'num',v:'10'},{k:'page',v:'1'}] },
    { group: '音乐业务', docKey: 'doc-songurl', tip: '播放链接', path: '/api/song/url', method: 'GET', desc: '播放链接(多音质降级)', params: [{k:'mid',v:'0039MnYb0qxYhV',req:1},{k:'quality',v:'320'}] },
    { group: '音乐业务', docKey: 'doc-songdetail', tip: '歌曲详情', path: '/api/song/detail', method: 'GET', desc: '歌曲详情', params: [{k:'mid',v:'0039MnYb0qxYhV',req:1}] },
    { group: '音乐业务', docKey: 'doc-songcover', tip: '歌曲封面', path: '/api/song/cover', method: 'GET', desc: '歌曲封面', params: [{k:'mid',v:'0039MnYb0qxYhV'},{k:'size',v:'300'}] },
    { group: '音乐业务', docKey: 'doc-lyric', tip: '歌词', path: '/api/lyric', method: 'GET', desc: '歌词(LRC/QRC/翻译/罗马音)', params: [{k:'mid',v:'0039MnYb0qxYhV',req:1},{k:'qrc',v:'1'},{k:'trans',v:'1'},{k:'roma',v:'1'}] },
    { group: '音乐业务', docKey: 'doc-album', tip: '专辑详情', path: '/api/album', method: 'GET', desc: '专辑详情', params: [{k:'mid',v:'002fRO0N4FftzY',req:1}] },
    { group: '音乐业务', docKey: 'doc-playlist', tip: '歌单详情', path: '/api/playlist', method: 'GET', desc: '歌单详情', params: [{k:'id',v:'8052190267',req:1}] },
    { group: '音乐业务', docKey: 'doc-singer', tip: '歌手信息', path: '/api/singer', method: 'GET', desc: '歌手信息', params: [{k:'mid',v:'0025NhlN2yWrP4',req:1}] },
    { group: '音乐业务', docKey: 'doc-top', tip: '排行榜', path: '/api/top', method: 'GET', desc: '排行榜列表/详情', params: [{k:'id',v:'4'},{k:'num',v:'50'}] },
    { group: 'APP 配置', docKey: 'doc-appupdate', tip: '版本更新', path: '/api/app/update', method: 'GET', desc: 'APP 更新配置(公开)', params: [{k:'platform',v:'android',req:1},{k:'version',v:'1.0.0'},{k:'build',v:'80'}] },
    { group: 'APP 配置', docKey: 'doc-appnotice', tip: '公告', path: '/api/app/notice', method: 'GET', desc: 'APP 公告(公开)', params: [{k:'platform',v:'android'},{k:'version',v:'1.2.0'}] },
    { group: 'APP 配置', docKey: 'doc-appnotice', tip: '公告(读)', path: '/api/admin/appconfig', method: 'GET', desc: '[admin] 读取公告列表', params: [{k:'type',v:'notice'}] },
    { group: 'APP 配置', docKey: 'doc-appnotice', tip: '公告(写)', path: '/api/admin/appconfig', method: 'POST', desc: '[admin] 新增/修改公告', params: [{k:'type',v:'notice'}] },
    { group: 'APP 配置', docKey: 'doc-appupdate', tip: '更新配置(读)', path: '/api/admin/appconfig', method: 'GET', desc: '[admin] 读取版本更新列表', params: [{k:'type',v:'update'}] },
    { group: 'APP 配置', docKey: 'doc-appupdate', tip: '更新配置(写)', path: '/api/admin/appconfig', method: 'POST', desc: '[admin] 新增/修改版本更新', params: [{k:'type',v:'update'}] },
    { group: '凭证管理', docKey: 'doc-refresh', tip: '刷新凭证', path: '/api/credential/refresh', method: 'POST', desc: '手动刷新凭证(force 为 query)', params: [{k:'force',v:'true'}] },
    { group: '凭证管理', docKey: 'doc-admincred', tip: '凭证(读)', path: '/api/admin/credential', method: 'GET', desc: '[admin] 读取凭证状态', params: [] },
    { group: '凭证管理', docKey: 'doc-admincred', tip: '凭证(写)', path: '/api/admin/credential', method: 'POST', desc: '[admin] 写入/更新凭证', params: [] },
    { group: '用户系统', docKey: 'doc-register', tip: '注册', path: '/api/user', method: 'POST', desc: '注册账号(公开)', params: [{k:'action',v:'register'}] },
    { group: '用户系统', docKey: 'doc-login', tip: '登录', path: '/api/user', method: 'POST', desc: '登录(公开, 必须带 deviceId)', params: [{k:'action',v:'login'}] },
    { group: '用户系统', docKey: 'doc-logout', tip: '登出', path: '/api/user', method: 'POST', desc: '登出(需 token)', params: [{k:'action',v:'logout'}] },
    { group: '用户系统', docKey: 'doc-me', tip: '我的信息', path: '/api/user', method: 'GET', desc: '当前用户信息与今日用量(需 token)', params: [{k:'action',v:'me'}] },
    { group: '用户系统', docKey: 'doc-device', tip: '设备签发', path: '/api/user', method: 'POST', desc: '签发设备标识(公开)', params: [{k:'action',v:'device'}] },
    { group: '用户管理', docKey: 'doc-adminusers-list', tip: '用户列表', path: '/api/admin/users', method: 'GET', desc: '[admin] 用户列表', params: [{k:'action',v:'list'},{k:'page',v:'1'},{k:'size',v:'20'}] },
    { group: '用户管理', docKey: 'doc-adminusers-detail', tip: '用户详情', path: '/api/admin/users', method: 'GET', desc: '[admin] 单用户详情', params: [{k:'action',v:'detail'},{k:'userId',v:'2'}] },
    { group: '用户管理', docKey: 'doc-adminusers-level', tip: '改用户等级', path: '/api/admin/users', method: 'POST', desc: '[admin] 修改用户等级', params: [{k:'action',v:'level'}] },
    { group: '用户管理', docKey: 'doc-adminusers-status', tip: '禁用/启用', path: '/api/admin/users', method: 'POST', desc: '[admin] 禁用/启用用户', params: [{k:'action',v:'status'}] },
    { group: '用户管理', docKey: 'doc-adminusers-delete', tip: '删除用户', path: '/api/admin/users', method: 'POST', desc: '[admin] 删除用户', params: [{k:'action',v:'delete'}] },
    { group: '用户管理', docKey: 'doc-adminusers-update', tip: '更新用户', path: '/api/admin/users', method: 'POST', desc: '[admin] 部分更新用户(改密后强制会话失效)', params: [{k:'action',v:'update'}] },
    { group: '风控防护', docKey: 'doc-risk', tip: '风控总览', path: '/api/admin/risk', method: 'GET', desc: '[admin] 风控总览', params: [{k:'action',v:'stats'}] },
    { group: '风控防护', docKey: 'doc-risk', tip: '风控配置(读)', path: '/api/admin/risk', method: 'GET', desc: '[admin] 读风控参数', params: [{k:'action',v:'config'}] },
    { group: '风控防护', docKey: 'doc-risk', tip: '风控配置(写)', path: '/api/admin/risk', method: 'POST', desc: '[admin] 更新风控参数', params: [{k:'action',v:'config'}] },
    { group: '风控防护', docKey: 'doc-risk', tip: '封禁列表', path: '/api/admin/risk', method: 'GET', desc: '[admin] 当前封禁主体', params: [{k:'action',v:'blocks'},{k:'page',v:'1'},{k:'size',v:'20'}] },
    { group: '风控防护', docKey: 'doc-risk', tip: '风控事件', path: '/api/admin/risk', method: 'GET', desc: '[admin] 风控事件审计', params: [{k:'action',v:'events'},{k:'page',v:'1'},{k:'size',v:'20'}] },
    { group: '系统维护', docKey: 'doc-setup', tip: '初始化(读)', path: '/api/setup', method: 'GET', desc: '查看初始化状态(公开)', params: [{k:'status',v:'1'}] },
    { group: '系统维护', docKey: 'doc-setup', tip: '初始化(写)', path: '/api/setup', method: 'POST', desc: '站点初始化(高危, 需 X-Setup-Key)', params: [] }
  ];

  var DEFAULT_BODIES = {
    '注册': { username: '你的用户名', password: '你的密码', deviceId: '设备标识' },
    '登录': { username: '你的用户名', password: '你的密码', deviceId: '设备标识(必填)' },
    '登出': {},
    '设备签发': { fingerprint: '客户端稳定设备指纹' },
    '改用户等级': { userId: 2, level: 'vip' },
    '禁用/启用': { userId: 2, status: 1 },
    '删除用户': { userId: 2 },
    '更新用户': { userId: 2, password: '新密码', maxQuality: '320', level: 'normal' },
    '凭证(写)': { openid: '', musicid: '', musickey: '', refresh_token: '', login_type: 2 },
    '初始化(写)': { username: 'admin', password: 'admin123' },
    '公告(写)': { id: 'notice_1', type: 'popup', level: 'info', title: '标题', content: '正文', enabled: true },
    '更新配置(写)': { platform: 'android', channel: 'official', latestVersion: '1.3.0', latestBuild: 130 }
  };

  function repeatInd(n) { var r = '', k; for (k = 0; k < n; k++) { r += '  '; } return r; }
  function prettyBody(v) {
    if (v == null) return '{}';
    if (typeof v !== 'string') { try { return JSON.stringify(v, null, 2); } catch (e) { return String(v); } }
    return String(v);
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function jesc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function hlJson(txt) {
    var s = jesc(String(txt));
    var re = /("(?:[^"]*)" *:)|("(?:[^"]*)")|(true|false|null)|(-?[0-9]+(?:\.[0-9]+)?)/g;
    return s.replace(re, function (m, a, b, c) {
      if (a) return '<span class="jk">' + m + '</span>';
      if (b) return '<span class="js">' + m + '</span>';
      if (c) return '<span class="jb">' + m + '</span>';
      return '<span class="jn">' + m + '</span>';
    });
  }
  function syncBodyHl() { if (bodyHl) bodyHl.innerHTML = hlJson(bodyBox.value || '') + NL; }
  function copy(t) {
    if (navigator.clipboard) { navigator.clipboard.writeText(t); }
    else { var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
  }

  function renderParams() {
    if (!sel || !pbox) return;
    pbox.innerHTML = '';
    var api = APIS[sel.value];
    if (!api) return;
    var badge = api.method === 'POST' ? '<span class="at-badge at-post">POST</span> ' : '<span class="at-badge at-get">GET</span> ';
    if (descEl) descEl.innerHTML = badge + '<span class="jp">' + esc(api.path) + '</span> ' + esc(api.desc || '');
    (api.params || []).forEach(function (p) {
      var row = document.createElement('div'); row.className = 'at-row';
      var lab = document.createElement('label'); lab.textContent = p.k + (p.req ? ' *' : '');
      var inp = document.createElement('input'); inp.className = 'at-in'; inp.value = p.v || ''; inp.placeholder = p.k;
      inp.setAttribute('data-k', p.k);
      row.appendChild(lab); row.appendChild(inp); pbox.appendChild(row);
    });
    if (bodyWrap) bodyWrap.style.display = (api.method === 'POST') ? '' : 'none';
    if (api.method === 'POST') applyDefaultBody();
    if (statusEl) statusEl.textContent = '就绪';
  }

  function applyDefaultBody() {
    if (!sel || !bodyBox) return;
    var api = APIS[sel.value];
    if (!api) return;
    if (api.method === 'POST') {
      var v = DEFAULT_BODIES[api.tip];
      if (v != null) { bodyBox.placeholder = ''; bodyBox.value = prettyBody(v); }
      else { bodyBox.value = ''; bodyBox.placeholder = '该接口无预设 Body, 可留空或自行填写 JSON'; }
      syncBodyHl();
    }
  }

  function buildUrl() {
    var api = APIS[sel.value]; if (!api) return '';
    var qs = [];
    pbox.querySelectorAll('input').forEach(function (inp) {
      var k = inp.getAttribute('data-k'); var v = inp.value.trim();
      if (v) qs.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    });
    return api.path + (qs.length ? ('?' + qs.join('&')) : '');
  }

  function doSend() {
    var api = APIS[sel.value]; if (!api) return;
    var url = buildUrl();
    if (api.method === 'POST') {
      var risky = api.path === '/api/setup' || api.path === '/api/admin/credential' || api.path === '/api/admin/users';
      if (risky && !confirm('即将执行高危操作: ' + api.method + ' ' + api.path + '，是否继续?')) { if (statusEl) statusEl.textContent = '已取消'; return; }
    }
    var opts = { method: api.method };
    var hdrs = {};
    if (headersEl) {
      headersEl.value.split(/\r?\n/).forEach(function (line) {
        line = line.trim(); if (!line) return;
        var idx = line.indexOf(':'); if (idx <= 0) return;
        var hk = line.slice(0, idx).trim(), hv = line.slice(idx + 1).trim();
        if (hk && hv) hdrs[hk] = hv;
      });
    }
    var tk = localStorage.getItem('adminToken');
    if (tk) hdrs['Authorization'] = 'Bearer ' + tk;
    if (!hdrs['X-Device-Id']) hdrs['X-Device-Id'] = getDeviceId();
    if (api.method === 'POST') {
      if (!bodyBox) { if (statusEl) statusEl.textContent = 'Body 容器缺失'; return; }
      var raw = bodyBox.value.trim() || '{}';
      try { JSON.parse(raw); } catch (e) { if (statusEl) statusEl.innerHTML = '<span class="err">Body JSON 格式错误</span>'; return; }
      hdrs['Content-Type'] = 'application/json';
      opts.body = raw;
    }
    opts.headers = hdrs;
    if (statusEl) statusEl.textContent = '请求中...';
    if (resp) resp.innerHTML = '<span class="jm">' + esc(api.method) + '</span> ' + esc(url) + NL + '请求中...';
    var t0 = Date.now();
    fetch(url, opts).then(function (r) {
      return r.text().then(function (txt) { return { status: r.status, ok: r.ok, txt: txt }; });
    }).then(function (res) {
      var ms = Date.now() - t0;
      if (statusEl) statusEl.innerHTML = '<span class="' + (res.ok ? 'ok' : 'err') + '">HTTP ' + res.status + '</span> · ' + ms + 'ms';
      var out = res.txt; try { out = JSON.stringify(JSON.parse(res.txt), null, 2); } catch (e) {}
      if (resp) resp.innerHTML = esc(api.method) + ' ' + esc(url) + NL + 'HTTP ' + res.status + ' · ' + ms + 'ms' + NL + NL + hlJson(out);
    }).catch(function (e) {
      var ms = Date.now() - t0;
      if (statusEl) statusEl.innerHTML = '<span class="err">请求失败</span> · ' + ms + 'ms';
      if (resp) resp.innerHTML = esc(e.message);
    });
  }

  var HEADER_HINTS = {
    '/api/setup': 'X-Setup-Key: ',
    '/api/user?action=device': ''
  };
  function applyHeaderHint() {
    if (!headersEl || !sel) return;
    var api = APIS[sel.value];
    if (!api) return;
    var hit = HEADER_HINTS[api.path];
    if (hit && !headersEl.value.trim()) { headersEl.value = hit; }
  }

  function init() {
    if (!sel) { if (statusEl) statusEl.textContent = '未找到下拉容器 #at-endpoint'; return; }
    try {
      var ogMap = {};
      APIS.forEach(function (a, i) {
        var g = a.group || '其他';
        if (!ogMap[g]) { ogMap[g] = document.createElement('optgroup'); ogMap[g].label = g; sel.appendChild(ogMap[g]); }
        var o = document.createElement('option');
        o.value = i;
        o.textContent = a.method + '  ' + a.path + (a.tip ? '  · ' + a.tip : '');
        ogMap[g].appendChild(o);
      });
      sel.selectedIndex = 0;
    } catch (e) {
      if (statusEl) statusEl.textContent = '下拉初始化异常: ' + (e && e.message ? e.message : e);
      return;
    }
    if (bodyBox) {
      bodyBox.addEventListener('input', syncBodyHl);
      bodyBox.addEventListener('scroll', function () { if (bodyHl) { bodyHl.scrollTop = bodyBox.scrollTop; bodyHl.scrollLeft = bodyBox.scrollLeft; } });
    }
    sel.addEventListener('change', function () { renderParams(); applyDefaultBody(); });
    if (btn) btn.addEventListener('click', doSend);
    var resetBtn = $('at-reset'); if (resetBtn) resetBtn.addEventListener('click', function () { renderParams(); applyDefaultBody(); });
    var copyUrlBtn = $('at-copy-url'); if (copyUrlBtn) copyUrlBtn.addEventListener('click', function () { var u = location.origin + buildUrl(); copy(u); if (statusEl) statusEl.textContent = '已复制 URL: ' + u; });
    var copyRespBtn = $('at-copy-resp'); if (copyRespBtn) copyRespBtn.addEventListener('click', function () { copy(resp ? resp.textContent : ''); if (statusEl) statusEl.textContent = '已复制响应结果'; });
    var gotoBtn = $('at-goto'); if (gotoBtn) gotoBtn.addEventListener('click', function () {
      var api = APIS[sel.value]; if (!api) return;
      var el = null;
      if (api.docKey) el = document.getElementById(api.docKey);
      if (!el) {
        var all = document.querySelectorAll('[id^="doc-"]');
        for (var i = 0; i < all.length; i++) { if (all[i].textContent.indexOf(api.path) >= 0) { el = all[i]; break; } }
      }
      if (!el) { if (statusEl) statusEl.textContent = '该接口暂无独立说明条目'; return; }
      var top = el.getBoundingClientRect().top + window.pageYOffset - 16;
      window.scrollTo({ top: top, behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(function () { el.classList.remove('flash'); }, 1500);
      if (statusEl) statusEl.textContent = '已定位: ' + api.path;
    });
    sel.addEventListener('change', applyHeaderHint);
    renderParams();
    applyHeaderHint();
    applyDefaultBody();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
