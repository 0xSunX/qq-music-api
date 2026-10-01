/**
 * 凭证管理页 GET /admin/credential
 * 展示当前凭证 + 自动/手动刷新历史与统计
 */

export function onRequest(context) {
  const { request } = context;
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  return new Response(CRED_HTML, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, must-revalidate',
    },
  });
}

const CRED_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>凭证管理</title>
<script src="/js/device.js"></script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,sans-serif;background:#1a1a1a;color:#e0e0e0;padding:20px}
.wrap{max-width:1100px;margin:0 auto}
h1{font-size:1.4rem;margin-bottom:6px;color:#31c27c}
.sub{color:#666;font-size:.82rem;margin-bottom:18px}
h2{font-size:1rem;color:#31c27c;margin:24px 0 12px;padding-bottom:6px;border-bottom:1px solid #2a2a2a}
.bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.bar button{cursor:pointer;background:#20242b;border:1px solid #3a4250;color:#c8d0da;border-radius:7px;padding:9px 16px;font-weight:600;transition:background .15s,border-color .15s}
.bar button:hover{background:#2a3038;border-color:#31c27c;color:#e6fff2}
.bar button:disabled{opacity:.4;cursor:not-allowed}
.bar button.danger{background:#7a2a2a;border-color:#a33;color:#fff}
.cards{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
.card{flex:1;min-width:130px;background:#222;border:1px solid #2c2c2c;border-radius:8px;padding:16px}
.card .n{font-size:1.7rem;font-weight:700;color:#31c27c;font-variant-numeric:tabular-nums}
.card .l{color:#888;font-size:.8rem;margin-top:6px}
#cLast{background:#1e2228;border:1px solid #2c2c2c;border-radius:8px;padding:14px;font-size:.9rem;line-height:1.7}
table{width:100%;border-collapse:collapse;font-size:.85rem;margin-top:8px}
th,td{padding:9px;text-align:left;border-bottom:1px solid #2a2a2a}
th{color:#888;font-weight:500}
tr:hover{background:#222}
.c-tag{padding:2px 8px;border-radius:4px;font-size:.72rem;font-weight:700}
.c-ok{background:#31c27c;color:#000}
.c-fail{background:#f44;color:#fff}
.c-dim{color:#666}
.c-t{color:#6897BB;font-family:monospace}
.c-reason{color:#aaa}
.pager{margin-top:16px;display:flex;gap:10px;align-items:center}
.pager button{cursor:pointer;background:#20242b;border:1px solid #3a4250;color:#c8d0da;border-radius:6px;padding:6px 14px}
.pager button:disabled{opacity:.4;cursor:not-allowed}
</style>
</head>
<body>
<div class="wrap">
  <h1>🔑 凭证管理</h1>
  <div class="sub">QQ 音乐上游凭证状态 · 自动/手动刷新历史 · 成功率统计</div>
  <div class="bar">
    <button id="cReload">刷新数据</button>
    <button id="cBack">返回上一页</button>
    <button id="cLogout" class="danger">退出登录</button>
  </div>
  <div id="cStatus" style="margin-bottom:12px;color:#888;font-size:.85rem">加载中...</div>

  <h2>最近一次刷新</h2>
  <div id="cLast">-</div>

  <h2>近 30 天统计</h2>
  <div class="cards">
    <div class="card"><div class="n" id="sTotal">-</div><div class="l">总检查次数</div></div>
    <div class="card"><div class="n" id="sOk">-</div><div class="l">成功</div></div>
    <div class="card"><div class="n" id="sFail">-</div><div class="l">失败</div></div>
    <div class="card"><div class="n" id="sRate">-</div><div class="l">成功率</div></div>
  </div>

  <h2>刷新历史</h2>
  <table>
    <thead><tr><th>时间</th><th>触发</th><th>结果</th><th>剩余有效期</th><th>说明</th></tr></thead>
    <tbody id="cRows"></tbody>
  </table>
  <div class="pager">
    <button id="cPrev">上一页</button>
    <span id="cPageInfo" class="c-dim"></span>
    <button id="cNext">下一页</button>
  </div>
</div>
<script src="/js/credential.js"></script>
</body>
</html>`;
