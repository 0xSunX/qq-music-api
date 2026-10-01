// 凭证管理页 —— 展示当前凭证状态 + 自动/手动刷新历史
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var token = localStorage.getItem('adminToken') || '';
  var state = { page: 1, size: 20 };

  function fmtTime(sec) {
    if (!sec) return '-';
    var d = new Date(sec * 1000);
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
      p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  function api(qs) {
    return fetch('/api/admin/credential?' + qs, {
      headers: { 'Authorization': 'Bearer ' + token.trim(), 'X-Device-Id': getDeviceId() }
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; }); });
  }

  function setStatus(t, c) { var el = $('cStatus'); if (el) { el.textContent = t; el.style.color = c || '#888'; } }

  function loadStats() {
    api('action=stats&days=30').then(function (r) {
      if (!r.ok) { setStatus(r.d.error || '加载失败', '#f44'); return; }
      var s = r.d.stats || {};
      $('sTotal').textContent = s.total || 0;
      $('sOk').textContent = s.ok || 0;
      $('sFail').textContent = s.fail || 0;
      $('sRate').textContent = (s.rate || 0) + '%';
    }).catch(function (e) { setStatus('异常: ' + e.message, '#f44'); });
  }

  function loadLast() {
    api('action=last').then(function (r) {
      if (!r.ok) return;
      var last = r.d.last;
      var el = $('cLast');
      if (!last) { el.innerHTML = '<span class="c-dim">暂无刷新记录</span>'; return; }
      var ok = last.success === 1;
      el.innerHTML =
        '<span class="c-tag ' + (ok ? 'c-ok' : 'c-fail') + '">' + (ok ? '成功' : '失败') + '</span> ' +
        '<span class="c-t">' + fmtTime(last.created_at) + '</span> ' +
        '<span class="c-dim">[' + (last.trigger || '-') + ']</span> ' +
        '<span class="c-reason">' + (last.reason || '') + '</span>' +
        (last.expire_hours != null ? ' <span class="c-dim">· 剩余 ' + last.expire_hours + 'h</span>' : '');
    });
  }

  function loadLogs() {
    api('action=logs&page=' + state.page + '&size=' + state.size).then(function (r) {
      if (!r.ok) { setStatus(r.d.error || '加载失败', '#f44'); return; }
      var list = r.d.list || [];
      var tb = $('cRows');
      if (!list.length) { tb.innerHTML = '<tr><td colspan="5" class="c-dim" style="text-align:center;padding:20px">暂无记录</td></tr>'; }
      else {
        tb.innerHTML = list.map(function (x) {
          var ok = x.success === 1;
          return '<tr>' +
            '<td>' + fmtTime(x.created_at) + '</td>' +
            '<td>' + (x.trigger === 'cron' ? '定时' : x.trigger === 'manual' ? '手动' : (x.trigger || '-')) + '</td>' +
            '<td><span class="c-tag ' + (ok ? 'c-ok' : 'c-fail') + '">' + (ok ? '成功' : '失败') + '</span></td>' +
            '<td>' + (x.expire_hours != null ? x.expire_hours + 'h' : '-') + '</td>' +
            '<td class="c-reason">' + (x.reason || '') + '</td></tr>';
        }).join('');
      }
      var total = r.d.total || 0;
      var pages = Math.max(1, Math.ceil(total / state.size));
      $('cPageInfo').textContent = '第 ' + state.page + '/' + pages + ' 页 · 共 ' + total + ' 条';
      $('cPrev').disabled = state.page <= 1;
      $('cNext').disabled = state.page >= pages;
    });
  }

  function reload() { setStatus('加载中...'); loadStats(); loadLast(); loadLogs(); }

  function init() {
    if (!token) { setStatus('未登录, 请从 /admin 登录', '#f44'); return; }
    var back = $('cBack'); if (back) back.onclick = function () { history.length > 1 ? history.back() : (location.href = '/admin'); };
    var logout = $('cLogout'); if (logout) logout.onclick = function () {
      fetch('/api/user?action=logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token.trim(), 'X-Device-Id': getDeviceId() } }).catch(function () {});
      localStorage.removeItem('adminToken'); location.href = '/admin';
    };
    var refresh = $('cReload'); if (refresh) refresh.onclick = reload;
    var prev = $('cPrev'); if (prev) prev.onclick = function () { if (state.page > 1) { state.page--; loadLogs(); } };
    var next = $('cNext'); if (next) next.onclick = function () { state.page++; loadLogs(); };
    reload();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
