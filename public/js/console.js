// API 调试台 —— 独立静态文件，模板字符串转义问题从此消失
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var sel = $('at-endpoint'), pbox = $('at-params'), resp = $('at-resp'), btn = $('at-send');
  var descEl = $('at-desc'), statusEl = $('at-status'), bodyWrap = $('at-body-wrap');
  var bodyBox = $('at-body'), bodyHl = $('at-body-hl'), headersEl = $('at-headers'), headersHl = $('at-headers-hl');
  var NL = String.fromCharCode(10);

  // 收集 Body 预设对象里所有非空字符串值(占位提示), 用于聚焦时定位
  var _bodyPh = [];
  function collectPlaceholders(obj) {
    var out = [];
    (function walk(v) {
      if (v == null) return;
      if (typeof v === 'string') { if (v) out.push(v); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === 'object') { Object.keys(v).forEach(function (k) { walk(v[k]); }); }
    })(obj);
    return out;
  }
  // 点击占位提示时, 直接删除该占位值, 光标停在原位, 用户可直接输入
  // (类似 IDE 参数提示: 点提示即消失, 而不是整体选中)
  function clearPlaceholderAt(el, phList) {
    if (!el || !phList || !phList.length) return false;
    var val = el.value, pos = el.selectionStart, hit = null;
    // 优先: 光标正好落在某个占位串内 -> 只删该占位, 光标停在原位
    phList.forEach(function (ph) {
      if (hit || !ph) return;
      var idx = val.indexOf(ph);
      while (idx >= 0) {
        if (pos >= idx && pos <= idx + ph.length) { hit = { s: idx, e: idx + ph.length }; break; }
        idx = val.indexOf(ph, idx + 1);
      }
    });
    if (hit) {
      el.value = val.slice(0, hit.s) + val.slice(hit.e);
      try { el.setSelectionRange(hit.s, hit.s); } catch (e) {}
      return true;
    }
    // 未命中任何占位串: 一律不改 value、不动光标, 避免点非占位处光标漂移
    return false;
  }

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
    { group: '用户系统', docKey: 'doc-logout', tip: '登出', path: '/api/user', method: 'POST', desc: '登出(需 Authorization: Bearer token + X-Device-Id, 无 Body)', params: [{k:'action',v:'logout'}] },
    { group: '用户系统', docKey: 'doc-me', tip: '我的信息', path: '/api/user', method: 'GET', desc: '当前用户信息与今日用量(需 token)', params: [{k:'action',v:'me'}] },
    { group: '用户系统', docKey: 'doc-device', tip: '设备签发', path: '/api/user', method: 'POST', desc: '签发设备标识(公开)', params: [{k:'action',v:'device'}] },
    { group: '用户管理', docKey: 'doc-adminusers-list', tip: '用户列表', path: '/api/admin/users', method: 'GET', desc: '[admin] 用户列表', params: [{k:'action',v:'list'},{k:'page',v:'1'},{k:'size',v:'20'}] },
    { group: '用户管理', docKey: 'doc-adminusers-detail', tip: '用户详情', path: '/api/admin/users', method: 'GET', desc: '[admin] 单用户详情', params: [{k:'action',v:'detail'},{k:'userId',v:'2'}] },
    { group: '用户管理', docKey: 'doc-adminusers-level', tip: '改用户等级', path: '/api/admin/users', method: 'POST', desc: '[admin] 修改用户等级', params: [{k:'action',v:'level'}] },
    { group: '用户管理', docKey: 'doc-adminusers-status', tip: '禁用/启用', path: '/api/admin/users', method: 'POST', desc: '[admin] 禁用/启用用户', params: [{k:'action',v:'status'}] },
    { group: '用户管理', docKey: 'doc-adminusers-delete', tip: '删除用户', path: '/api/admin/users', method: 'POST', desc: '[admin] 删除用户', params: [{k:'action',v:'delete'}] },
    { group: '用户管理', docKey: 'doc-adminusers-update', tip: '更新用户', path: '/api/admin/users', method: 'POST', desc: '[admin] 部分更新用户(改密后强制会话失效)', params: [{k:'action',v:'update'}] },
    { group: '系统维护', docKey: 'doc-setup', tip: '初始化(读)', path: '/api/setup', method: 'GET', desc: '查看初始化状态(公开)', params: [{k:'status',v:'1'}] },
    { group: '系统维护', docKey: 'doc-setup', tip: '初始化(写)', path: '/api/setup', method: 'POST', desc: '站点初始化(高危, 需 X-Setup-Key)', params: [] }
  ];

  // 参数字段说明字典: 按参数名给出"该填什么", 与所选接口的参数联动显示
  var FIELD_HINTS = {
    keyword: '搜索关键词, 如 周杰伦', type: '类型: song/singer/album/playlist/mv/lyric/user',
    num: '返回数量, 如 10', page: '页码, 从 1 开始',
    mid: '歌曲MID, 如 0039MnYb0qxYhV', quality: '音质: 128/320/flac/atmos_2/atmos_51/master',
    id: '数字ID(歌曲/歌单/榜单)', size: '每页条数或图片尺寸(150/300/500/800)',
    qrc: '1=返回逐字歌词', trans: '1=返回翻译歌词', roma: '1=返回罗马音歌词',
    platform: '平台: android / ios', version: '版本号, 如 1.0.0', build: '构建号, 如 80',
    force: 'true=强制刷新凭证', action: '动作标识, 如 list/level/status/delete/update/detail',
    userId: '目标用户ID(数字)', level: '等级: vip 或 normal', status: '1 启用 / 0 禁用',
    maxQuality: '最高音质(普通用户生效)', dailyLimit: '日限额, 0=无限制',
    setupKey: '初始化密钥, 需与服务端 SETUP_KEY 一致',
    openid: 'QQ音乐 OpenID', musicid: 'QQ号(数字)', musickey: 'MusicKey', refresh_token: '刷新令牌',
    fingerprint: '设备指纹(6-128位稳定字符串)', username: '用户名(3-20位字母数字下划线)', password: '密码(至少6位)'
  };

  var DEFAULT_BODIES = {
    '注册': { username: '你的用户名', password: '你的密码', deviceId: '设备标识' },
    '登录': { username: '你的用户名', password: '你的密码', deviceId: '设备标识(必填)' },
    '改用户等级': { userId: 2, level: 'vip' },
    '禁用/启用': { userId: 2, status: 1 },
    '删除用户': { userId: 2 },
    '更新用户': { userId: 2, username: '新用户名', password: '新密码', dailyLimit: 50, maxQuality: '320', level: 'normal', status: 1 },
    '凭证(写)': { openid: 'QQ音乐OpenID', musicid: 'QQ号(数字)', musickey: 'MusicKey', refresh_token: '刷新令牌', login_type: 2 },
    '设备签发': { fingerprint: '设备指纹(6-128位稳定字符串)' },
    '登出': {},
    '我的信息': {},
    '初始化(写)': { username: 'admin', password: 'admin123' },
    '公告(写)': { id: 'notice_1', type: 'popup', level: 'info', title: '标题', content: '正文', actionText: '查看详情', actionUrl: 'https://example.com', forceShow: false, platforms: 'android', minVersion: '', maxVersion: '', channels: 'official', startAt: 0, endAt: 0, priority: 0, enabled: true },
    '更新配置(写)': { platform: 'android', channel: 'official', latestVersion: '1.3.0', latestBuild: 130, minSupportBuild: 1, title: '发现新版本', changelog: '[]', downloadUrl: 'https://example.com/app.apk', fileSize: 0, fileHash: '', publishedAt: 0 }
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
  // 请求头高亮: 每行 "Key: Value", 键/值分别着色, 其余行灰显
  function hlHeaders(txt) {
    return String(txt || '').split(/\r?\n/).map(function (line) {
      var m = line.match(/^(\s*)([^:\s][^:]*)(:)([\s\S]*)$/);
      if (!m) return '<span class="at-dim">' + esc(line) + '</span>';
      return m[1] + '<span class="jk">' + esc(m[2]) + '</span><span class="at-dim">:</span><span class="js">' + esc(m[4]) + '</span>';
    }).join(NL);
  }
  function syncHeadersHl() { if (headersHl) headersHl.innerHTML = hlHeaders(headersEl ? headersEl.value : '') + NL; }
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
      var lab = document.createElement('label'); lab.className = 'at-lab';
      lab.textContent = p.k + (p.req ? ' *' : '');
      lab.title = p.kh || p.k;
      var inp = document.createElement('input'); inp.className = 'at-in';
      // 预填可直接使用的真实值: 不改也能直接发; 点进去自动全选, 直接粘贴即替换
      inp.value = p.v || '';
      var kh = p.kh || FIELD_HINTS[p.k] || p.k;
      inp.placeholder = (p.req ? '必填' : '可选') + ' · ' + kh;
      inp.setAttribute('data-k', p.k);
      inp.setAttribute('title', p.k + (p.kh ? '：' + p.kh : '') + (p.v ? '（默认 ' + p.v + '，点入可直接粘贴替换）' : ''));
      inp.addEventListener('focus', function () { try { this.select(); } catch (e) {} });
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
      if (v != null) {
        bodyBox.placeholder = '';
        bodyBox.value = prettyBody(v);
        _bodyPh = collectPlaceholders(v);
      } else {
        bodyBox.value = '';
        bodyBox.placeholder = '该接口无预设 Body, 可留空或自行填写 JSON';
        _bodyPh = [];
      }
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

  // 请求头按所选接口联动: value 预填可直接用的行, placeholder 说明该接口需要什么
  // 只有确实需要额外请求头的接口才预设; 其余一律不预设, 避免误发无用头
  var HEADER_PRESET = {
    '/api/setup': 'X-Setup-Key: '
  };
  // 按接口给出"需要什么请求头"的提示
  var HEADER_TIP = {
    '/api/setup': '本接口需要请求头 → X-Setup-Key: 你的SETUP_KEY（只填冒号后的密钥，可直接粘贴）',
    '/api/user?action=device': '公开接口, 无需额外请求头',
    '/api/user?action=register': '公开接口, 无需额外请求头',
    '/api/user?action=login': '公开接口, 无需额外请求头(deviceId 在 Body 里)',
    '/api/admin/credential': '[admin] 无需额外请求头, Authorization 已自动附带',
    '/api/admin/users': '[admin] 无需额外请求头, Authorization 已自动附带'
  };
  var HEADER_DEFAULT_TIP = '该接口无需手填请求头; Authorization 与 X-Device-Id 已自动附加';
  // 记录上一次"自动预设"的值, 切换接口时据此清除, 不误删用户手填内容
  var _lastAutoHeader = '';
  function applyHeaderHint() {
    if (!headersEl || !sel) return;
    var api = APIS[sel.value];
    if (!api) return;
    headersEl.placeholder = HEADER_TIP[api.path] || HEADER_DEFAULT_TIP;
    // 当前框里的值若正是上次自动填的, 先清掉, 避免带到不需要请求头的接口
    if (_lastAutoHeader && headersEl.value.trim() === _lastAutoHeader.trim()) {
      headersEl.value = '';
    }
    var preset = HEADER_PRESET[api.path];
    if (preset) {
      // 已存在同名头则不再重复预填, 避免覆盖用户已填的 SETUP_KEY
      if (headersEl.value.indexOf('X-Setup-Key') < 0) headersEl.value = preset;
      _lastAutoHeader = preset;
    } else {
      _lastAutoHeader = '';
    }
    syncHeadersHl();
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
      bodyBox.addEventListener('click', function () { if (clearPlaceholderAt(bodyBox, _bodyPh)) syncBodyHl(); });
      // focus 后补一次(等光标落位), 修复首次点按占位不消失
      bodyBox.addEventListener('focus', function () {
        // 推迟到浏览器定位好光标后再判断, 避免边改 value 边设光标造成光标偏移漂移
        setTimeout(function () { if (clearPlaceholderAt(bodyBox, _bodyPh)) syncBodyHl(); }, 0);
      });
      bodyBox.addEventListener('input', syncBodyHl);
      bodyBox.addEventListener('scroll', function () { if (bodyHl) { bodyHl.scrollTop = bodyBox.scrollTop; bodyHl.scrollLeft = bodyBox.scrollLeft; } });
    }
    sel.addEventListener('change', function () { renderParams(); applyDefaultBody(); });
    if (btn) btn.addEventListener('click', doSend);
    var resetBtn = $('at-reset'); if (resetBtn) resetBtn.addEventListener('click', function () { renderParams(); applyDefaultBody(); });
    var copyUrlBtn = $('at-copy-url'); if (copyUrlBtn) copyUrlBtn.addEventListener('click', function () { var u = location.origin + buildUrl(); copy(u); if (statusEl) statusEl.textContent = '已复制 URL: ' + u; });
    var copyRespBtn = $('at-copy-resp'); if (copyRespBtn) copyRespBtn.addEventListener('click', function () { copy(resp ? resp.textContent : ''); if (statusEl) statusEl.textContent = '已复制响应结果'; });
    if (headersEl) {
      headersEl.addEventListener('input', syncHeadersHl);
      headersEl.addEventListener('scroll', function () { if (headersHl) { headersHl.scrollTop = headersEl.scrollTop; headersHl.scrollLeft = headersEl.scrollLeft; } });
      headersEl.addEventListener('focus', function () {
        // 有 X-Setup-Key 行时, 光标直接落到冒号后, 方便粘贴密钥; 否则落到末尾
        var v = this.value || '';
        var idx = v.indexOf('X-Setup-Key:');
        if (idx >= 0) {
          var c = idx + 'X-Setup-Key:'.length;
          if (v.charAt(c) === ' ') c++;
          try { this.setSelectionRange(c, c); } catch (e) {}
        } else {
          try { this.setSelectionRange(v.length, v.length); } catch (e) {}
        }
      });
    }
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
    syncHeadersHl();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
