// 设备标识公共模块（index.js/admin/page.js/cache.js/risk.js 四处共用）
// 收敛 DEVICE-SYNC 重复代码, 归于一处
(function (global) {
  var KFP = 'mtFingerprint', tDeviceId = 'mtDeviceId';

  function getFingerprint() {
    var v = localStorage.getItem(KFP);
    if (!v) {
      v = 'web-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      localStorage.setItem(KFP, v);
    }
    return v;
  }

  function getDeviceId() {
    return localStorage.getItem(tDeviceId) || getFingerprint();
  }

  function ensureDeviceId() {
    var cached = localStorage.getItem(tDeviceId);
    if (cached && cached.indexOf('.') > 0) { return Promise.resolve(cached); }
    return fetch('/api/user?action=device', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint: getFingerprint() })
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (res.ok && res.d && res.d.deviceId) { try { localStorage.setItem(tDeviceId, res.d.deviceId); } catch (e) {} return res.d.deviceId; }
        var fb = getFingerprint(); try { localStorage.setItem(tDeviceId, fb); } catch (e) {} return fb;
      })
      .catch(function () { return getFingerprint(); });
  }

  global.getFingerprint = getFingerprint;
  global.getDeviceId = getDeviceId;
  global.ensureDeviceId = ensureDeviceId;
})(window);
