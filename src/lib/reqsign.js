/**
 * 请求签名 / 防重放
 *
 * 目标: 让脚本与抓包重放难以直接复用请求。
 * 方案: 客户端对 (method + path + ts + nonce + bodyHash) 做 HMAC-SHA256,
 *       服务端校验签名 + 时间窗(默认 ±300s) + nonce 唯一性(防重放)。
 *
 * 密钥: env.REQUEST_SECRET; 未配置则本模块整体禁用(返回 disabled),
 *       以免在未部署客户端签名前把线上接口打死。
 *
 * 开关: risk_config.req_sign_enabled, 由后台"风控防护"页控制。
 */

const SIGN_WINDOW = 300; // 秒
let _nonceEnsured = false;

async function ensureNonceTable(db) {
    if (_nonceEnsured) return;
    await db.prepare('CREATE TABLE IF NOT EXISTS req_nonce (' +
        'nonce TEXT PRIMARY KEY,' +
        'created_at INTEGER NOT NULL)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_req_nonce_time ON req_nonce(created_at)').run();
    _nonceEnsured = true;
}

function nowSec() { return Math.floor(Date.now() / 1000); }

async function hmacHex(secret, msg) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(msg));
    return [...new Uint8Array(sig)].map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
}

async function sha256Hex(text) {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
    return [...new Uint8Array(buf)].map(function(b){ return b.toString(16).padStart(2, '0'); }).join('');
}

/**
 * 生成签名 (供客户端 / 调试用)。
 * canonical = method + "\n" + path + "\n" + ts + "\n" + nonce + "\n" + bodyHash
 */
export async function buildSignature(secret, method, path, ts, nonce, body) {
    const bodyHash = await sha256Hex(body || '');
    const canonical = String(method || 'GET').toUpperCase() + '\n' + String(path || '') + '\n' +
        String(ts) + '\n' + String(nonce) + '\n' + bodyHash;
    return await hmacHex(secret, canonical);
}

/**
 * 校验请求签名。
 * @param {Request} request
 * @param {string} secret env.REQUEST_SECRET
 * @param {D1Database} db
 * @returns {Promise<{ok:boolean, code?:string, message?:string}>}
 */
/**
 * 构造参与签名的规范路径: pathname + 排序后的查询串。
 * 将 query 纳入签名, 修复 GET 参数可被中间人篡改而不破坏签名的问题;
 * 查询参数按键名排序, 保证同一组参数顺序不同也能得到相同签名。
 */
export function canonicalPath(url) {
    const params = [];
    try { for (const [k, v] of url.searchParams) params.push([k, v]); }
    catch (e) { return url.pathname; }
    if (!params.length) return url.pathname;
    params.sort(function(a, b){ return a[0] < b[0] ? -1 : (a[0] > b[0] ? 1 : 0); });
    const qs = params.map(function(p){ return encodeURIComponent(p[0]) + '=' + encodeURIComponent(p[1]); }).join('&');
    return url.pathname + '?' + qs;
}

export async function verifyRequestSignature(request, secret, db) {
    if (!secret) return { ok: false, code: 'SIGN_DISABLED', message: '服务端未配置 REQUEST_SECRET' };
    await ensureNonceTable(db);

    const sig = (request.headers.get('X-Req-Sign') || '').trim().toLowerCase();
    const tsRaw = (request.headers.get('X-Req-Ts') || '').trim();
    const nonce = (request.headers.get('X-Req-Nonce') || '').trim();
    if (!sig || !tsRaw || !nonce) {
        return { ok: false, code: 'SIGN_MISSING', message: '缺少签名头 (X-Req-Sign / X-Req-Ts / X-Req-Nonce)' };
    }
    const ts = parseInt(tsRaw, 10);
    if (isNaN(ts)) return { ok: false, code: 'SIGN_TS', message: '时间戳非法' };

    const drift = Math.abs(nowSec() - ts);
    if (drift > SIGN_WINDOW) {
        return { ok: false, code: 'SIGN_EXPIRED', message: '签名已过期 (时间偏差 ' + drift + 's)' };
    }
    if (nonce.length < 8 || nonce.length > 128) {
        return { ok: false, code: 'SIGN_NONCE', message: 'nonce 长度非法' };
    }

    let body = '';
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        try { body = await request.clone().text(); } catch (e) { body = ''; }
    }
    const url = new URL(request.url);
    const expect = await buildSignature(secret, request.method, canonicalPath(url), ts, nonce, body);
    if (expect !== sig) {
        return { ok: false, code: 'SIGN_INVALID', message: '签名校验失败' };
    }

    // nonce 唯一性: 插入成功=首次; 冲突=重放
    const ins = await db.prepare('INSERT OR IGNORE INTO req_nonce (nonce, created_at) VALUES (?, ?)')
        .bind(nonce, nowSec()).run();
    if (!(ins.meta && ins.meta.changes > 0)) {
        return { ok: false, code: 'SIGN_REPLAY', message: '检测到重放 (nonce 已使用)' };
    }
    return { ok: true };
}

/** Cron 清理过期 nonce */
export async function cleanStaleNonce(db, hours) {
    try {
        await ensureNonceTable(db);
        const keep = hours || 24;
        const cutoff = nowSec() - keep * 3600;
        await db.prepare('DELETE FROM req_nonce WHERE created_at < ?').bind(cutoff).run();
    } catch (e) {
        console.error('[ReqSign] 清理 nonce 失败:', e);
    }
}

// ---------- 签名开关 (存于 risk_config.req_sign_enabled) ----------

let _reqSignColEnsured = false;

/**
 * 确保 risk_config 存在且带 req_sign_enabled 列。
 * risk.js 先建表时不含此列, 这里用 ALTER 补齐; 已存在则忽略报错。
 */
async function ensureReqSignColumn(db) {
    if (_reqSignColEnsured) return;
    try {
        await db.prepare('CREATE TABLE IF NOT EXISTS risk_config (' +
            'id INTEGER PRIMARY KEY CHECK (id = 1),' +
            'enabled INTEGER DEFAULT 1,' +
            'burst_per_sec INTEGER DEFAULT 20,' +
            'burst_per_min INTEGER DEFAULT 300,' +
            'mid_scan_per_min INTEGER DEFAULT 60,' +
            'block_seconds INTEGER DEFAULT 900,' +
            'auto_block INTEGER DEFAULT 1,' +
            'req_sign_enabled INTEGER DEFAULT 0,' +
            'updated_at INTEGER)').run();
        await db.prepare('INSERT OR IGNORE INTO risk_config (id) VALUES (1)').run();
    } catch (e) { /* ignore */ }
    try {
        await db.prepare('ALTER TABLE risk_config ADD COLUMN req_sign_enabled INTEGER DEFAULT 0').run();
    } catch (e) { /* 列已存在 */ }
    _reqSignColEnsured = true;
}

// 签名开关内存缓存: 热路径每请求都读, 必须零 D1
let _signCache = { v: null, ts: 0 };
const SIGN_TTL_MS = 5000;

/** 读取请求签名校验开关 (0/1), 走 isolate 内存缓存 (TTL 5s) */
export async function getReqSignEnabled(db) {
    const now = Date.now();
    if (_signCache.v !== null && (now - _signCache.ts) < SIGN_TTL_MS) return _signCache.v;
    try {
        await ensureReqSignColumn(db);
        const row = await db.prepare('SELECT req_sign_enabled FROM risk_config WHERE id = 1').first();
        const v = (row && row.req_sign_enabled) ? 1 : 0;
        _signCache = { v: v, ts: now };
        return v;
    } catch (e) {
        return 0;
    }
}

/** 写入请求签名校验开关 (立即刷新内存缓存) */
export async function setReqSignEnabled(db, v) {
    await ensureReqSignColumn(db);
    const nv = v ? 1 : 0;
    await db.prepare('UPDATE risk_config SET req_sign_enabled = ? WHERE id = 1').bind(nv).run();
    _signCache = { v: nv, ts: Date.now() };
}
