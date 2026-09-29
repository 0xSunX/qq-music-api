/**
 * 服务端行为风控 (性能优先版)
 *
 * 设计取向: 不看"谁在调", 看"怎么调"。
 * - 频次突增: 秒级用 isolate 内存滑动计数, 零 D1 往返
 * - 行为模式: MID 遍历在内存 60 秒窗口去重计数, 零 D1 往返
 * - 分钟级: 唯一落 D1 的热路径计数, 单条 UPSERT
 * - 自动封禁: 命中规则才落 D1(冷路径), 封禁态走内存缓存
 * - 事件审计: 每次命中落一条事件
 *
 * 性能约定 (相对初版 ~7 次 D1 往返):
 *   正常请求热路径 = 1 次 D1 (分钟窗口 UPSERT)
 *   配置读取 = isolate 内存, TTL 5s
 *   封禁查询 = isolate 内存, 命中即拦
 *   秒级突增 = isolate 内存, 零往返
 *   MID 遍历 = isolate 内存, 零往返
 *
 * 精度取舍: 秒级/MID 计数为单 isolate 近似。攻击者被路由到少数
 * isolate, 对"明显是脚本"的突增足够灵敏; 分钟级计数仍落 D1 保证跨
 * isolate 准确。宁可漏一点噪声, 也不让每个正常请求都吃 7 次 D1。
 */

const DEFAULTS = {
    enabled: 1,
    burstPerSec: 20,
    burstPerMin: 300,
    midScanPerMin: 60,
    blockSeconds: 900,
    autoBlock: 1,
};

let _riskTablesEnsured = false;

function nowSec() { return Math.floor(Date.now() / 1000); }

function num(v, d) {
    const x = parseInt(v, 10);
    return (isNaN(x) || x <= 0) ? d : x;
}

// ---------- isolate 内存态 ----------

// 配置缓存: 极少变, TTL 5 秒
let _cfgCache = { cfg: null, ts: 0 };
const CFG_TTL_MS = 5000;

// 秒级窗口: subject -> { ws(秒), count }
const _secMap = new Map();

// MID 窗口: subject -> { ws(60秒对齐), set }
const _midMap = new Map();

// 封禁缓存: subject -> { until, reason, hits }
const _blockMap = new Map();

function cleanMemSec(now) {
    for (const [k, v] of _secMap) {
        if (v.ws < now - 2) _secMap.delete(k);
    }
}

function cleanMemMid(ws) {
    for (const [k, v] of _midMap) {
        if (v.ws < ws) _midMap.delete(k);
    }
}

/** 秒级窗口计数 (内存, 零 D1) */
function memSecBump(subject) {
    const now = nowSec();
    let e = _secMap.get(subject);
    if (!e || e.ws !== now) { e = { ws: now, count: 0 }; _secMap.set(subject, e); }
    e.count++;
    if (_secMap.size > 10000) cleanMemSec(now);
    return e.count;
}

/** MID 60 秒窗口去重计数 (内存, 零 D1), 返回窗口内不同 mid 数 */
function memMidCheck(subject, mids) {
    const now = nowSec();
    const ws = now - (now % 60);
    let e = _midMap.get(subject);
    if (!e || e.ws !== ws) { e = { ws: ws, set: new Set() }; _midMap.set(subject, e); }
    for (let i = 0; i < mids.length; i++) { if (mids[i]) e.set.add(mids[i]); }
    if (_midMap.size > 5000) cleanMemMid(ws);
    return e.set.size;
}

/** 内存封禁命中 (零 D1); 返回 null 表示缓存未命中需查库 */
function memGetBlock(subject) {
    const e = _blockMap.get(subject);
    if (!e) return null;
    const now = nowSec();
    if (e.until <= now) { _blockMap.delete(subject); return null; }
    return { action: 'block', reason: e.reason, remain: e.until - now, until: e.until, hits: e.hits };
}

function memSetBlock(subject, until, reason, hits) {
    _blockMap.set(subject, { until: until, reason: reason, hits: hits || 1 });
}

// ---------- 建表 ----------

export async function ensureRiskTables(db) {
    if (_riskTablesEnsured) return;
    await db.prepare('CREATE TABLE IF NOT EXISTS risk_config (' +
        'id INTEGER PRIMARY KEY CHECK (id = 1),' +
        'enabled INTEGER DEFAULT 1,' +
        'burst_per_sec INTEGER DEFAULT 20,' +
        'burst_per_min INTEGER DEFAULT 300,' +
        'mid_scan_per_min INTEGER DEFAULT 60,' +
        'block_seconds INTEGER DEFAULT 900,' +
        'auto_block INTEGER DEFAULT 1,' +
        'updated_at INTEGER)').run();
    await db.prepare('INSERT OR IGNORE INTO risk_config (id) VALUES (1)').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS risk_rate (' +
        'scope TEXT NOT NULL,' +
        'key TEXT NOT NULL,' +
        'bucket TEXT NOT NULL,' +
        'window_start INTEGER NOT NULL,' +
        'count INTEGER NOT NULL DEFAULT 0,' +
        'PRIMARY KEY (scope, key, bucket))').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS risk_mid (' +
        'subject TEXT NOT NULL,' +
        'window_start INTEGER NOT NULL,' +
        'mid TEXT NOT NULL,' +
        'PRIMARY KEY (subject, window_start, mid))').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS risk_block (' +
        'scope TEXT NOT NULL,' +
        'key TEXT NOT NULL,' +
        'blocked_until INTEGER NOT NULL,' +
        'reason TEXT,' +
        'hits INTEGER DEFAULT 1,' +
        'created_at INTEGER,' +
        'PRIMARY KEY (scope, key))').run();
    await db.prepare('CREATE TABLE IF NOT EXISTS risk_events (' +
        'id INTEGER PRIMARY KEY AUTOINCREMENT,' +
        'subject TEXT NOT NULL,' +
        'rule TEXT NOT NULL,' +
        'detail TEXT,' +
        'created_at INTEGER)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_risk_events_time ON risk_events(created_at)').run();
    await db.prepare('CREATE INDEX IF NOT EXISTS idx_risk_block_until ON risk_block(blocked_until)').run();
    _riskTablesEnsured = true;
}

// ---------- 配置 ----------

async function rawGetRiskConfig(db) {
    const row = await db.prepare('SELECT * FROM risk_config WHERE id = 1').first();
    if (!row) return Object.assign({}, DEFAULTS);
    return {
        enabled: row.enabled === 0 ? 0 : 1,
        burstPerSec: num(row.burst_per_sec, DEFAULTS.burstPerSec),
        burstPerMin: num(row.burst_per_min, DEFAULTS.burstPerMin),
        midScanPerMin: num(row.mid_scan_per_min, DEFAULTS.midScanPerMin),
        blockSeconds: num(row.block_seconds, DEFAULTS.blockSeconds),
        autoBlock: row.auto_block === 0 ? 0 : 1,
    };
}

/** 读配置: 走 isolate 内存缓存 (TTL 5s) */
export async function getRiskConfig(db) {
    const now = Date.now();
    if (_cfgCache.cfg && (now - _cfgCache.ts) < CFG_TTL_MS) return _cfgCache.cfg;
    await ensureRiskTables(db);
    const cfg = await rawGetRiskConfig(db);
    _cfgCache = { cfg: cfg, ts: now };
    return cfg;
}

/** 写配置: 落库并立即刷新内存缓存 */
export async function setRiskConfig(db, cfg) {
    await ensureRiskTables(db);
    const cur = await rawGetRiskConfig(db);
    const n = {
        enabled: cfg.enabled === undefined ? cur.enabled : (cfg.enabled ? 1 : 0),
        burstPerSec: num(cfg.burstPerSec, cur.burstPerSec),
        burstPerMin: num(cfg.burstPerMin, cur.burstPerMin),
        midScanPerMin: num(cfg.midScanPerMin, cur.midScanPerMin),
        blockSeconds: num(cfg.blockSeconds, cur.blockSeconds),
        autoBlock: cfg.autoBlock === undefined ? cur.autoBlock : (cfg.autoBlock ? 1 : 0),
    };
    await db.prepare('UPDATE risk_config SET enabled=?, burst_per_sec=?, burst_per_min=?, ' +
        'mid_scan_per_min=?, block_seconds=?, auto_block=?, updated_at=? WHERE id=1')
        .bind(n.enabled, n.burstPerSec, n.burstPerMin, n.midScanPerMin, n.blockSeconds, n.autoBlock, nowSec()).run();
    _cfgCache = { cfg: n, ts: Date.now() };
    return n;
}

// ---------- 分钟级计数 (唯一热路径 D1) ----------

/**
 * 单条 UPSERT 完成"判窗口+递增+回读", 一次 D1 往返。
 * 用 RETURNING 拿到新 count; 若运行时不支持, 回退为写后单独读一次。
 * @returns {Promise<number>} 当前窗口计数
 */
async function bumpMinute(db, subject) {
    const now = nowSec();
    const ws = now - (now % 60);
    try {
        const row = await db.prepare('INSERT INTO risk_rate (scope, key, bucket, window_start, count) ' +
            'VALUES (?, ?, ?, ?, 1) ' +
            'ON CONFLICT(scope, key, bucket) DO UPDATE SET ' +
            'count = CASE WHEN risk_rate.window_start = ? THEN risk_rate.count + 1 ELSE 1 END, ' +
            'window_start = ? ' +
            'RETURNING count')
            .bind('subject', subject, '60s', ws, ws, ws).first();
        if (row && row.count) return row.count;
    } catch (e) {
        // RETURNING 不被支持: 回退为写 + 读
        try {
            await db.prepare('INSERT INTO risk_rate (scope, key, bucket, window_start, count) ' +
                'VALUES (?, ?, ?, ?, 1) ' +
                'ON CONFLICT(scope, key, bucket) DO UPDATE SET ' +
                'count = CASE WHEN risk_rate.window_start = ? THEN risk_rate.count + 1 ELSE 1 END, ' +
                'window_start = ?')
                .bind('subject', subject, '60s', ws, ws, ws).run();
            const row = await db.prepare('SELECT count FROM risk_rate WHERE scope=? AND key=? AND bucket=?')
                .bind('subject', subject, '60s').first();
            return (row && row.count) || 1;
        } catch (e2) {
            return 1;
        }
    }
    return 1;
}

// ---------- 封禁 ----------

/** 查库确认封禁 (内存 miss 时调用), 顺带回填内存 */
export async function isBlocked(db, scope, key) {
    const row = await db.prepare('SELECT blocked_until, reason, hits FROM risk_block WHERE scope=? AND key=?')
        .bind(scope, key).first();
    if (!row) return null;
    const now = nowSec();
    if (row.blocked_until <= now) {
        await db.prepare('DELETE FROM risk_block WHERE scope=? AND key=?').bind(scope, key).run();
        return null;
    }
    if (scope === 'subject') memSetBlock(key, row.blocked_until, row.reason, row.hits);
    return { until: row.blocked_until, reason: row.reason, hits: row.hits, remain: row.blocked_until - now };
}

/** 封禁主体 (冷路径, 取更长到期时间), 同步回填内存 */
export async function blockSubject(db, scope, key, seconds, reason) {
    await ensureRiskTables(db);
    const now = nowSec();
    const until = now + seconds;
    await db.prepare('INSERT INTO risk_block (scope, key, blocked_until, reason, hits, created_at) VALUES (?, ?, ?, ?, 1, ?) ' +
        'ON CONFLICT(scope, key) DO UPDATE SET ' +
        'blocked_until = MAX(risk_block.blocked_until, excluded.blocked_until), ' +
        'reason = excluded.reason, ' +
        'hits = risk_block.hits + 1')
        .bind(scope, key, until, String(reason || ''), now).run();
    if (scope === 'subject') memSetBlock(key, until, reason, 1);
    return { until: until, remain: seconds };
}

/** 落一条风控事件 (失败不影响主流程) */
export async function logRiskEvent(db, subject, rule, detail) {
    try {
        await db.prepare('INSERT INTO risk_events (subject, rule, detail, created_at) VALUES (?, ?, ?, ?)')
            .bind(subject, rule, String(detail || ''), nowSec()).run();
    } catch (e) {
        console.error('[Risk] 事件落库失败:', e);
    }
}

/** 记录一次 mid 访问 (管理/兼容用; 热路径已走内存, 此函数保留导出) */
export async function recordMidAccess(db, subject, mid) {
    await ensureRiskTables(db);
    const now = nowSec();
    const ws = now - (now % 60);
    await db.prepare('INSERT OR IGNORE INTO risk_mid (subject, window_start, mid) VALUES (?, ?, ?)')
        .bind(subject, ws, String(mid)).run();
    const row = await db.prepare('SELECT COUNT(*) AS c FROM risk_mid WHERE subject=? AND window_start=?')
        .bind(subject, ws).first();
    return (row && row.c) || 0;
}

/**
 * 单次请求风控检查 —— 接入中间件的主入口。
 *
 * 热路径 D1 往返:
 *   被内存封禁缓存命中 -> 0 次
 *   秒级/MID 超阈值    -> 0 次(仅冷路径落 D1 封禁)
 *   正常请求           -> 1 次(分钟窗口 UPSERT)
 *
 * @param {D1Database} db
 * @param {string} subject 主体标识 (user:<id>)
 * @param {string} endpoint 端点路径
 * @param {string[]} midList 本次请求涉及的歌曲 mid
 * @returns {Promise<{action:'allow'|'block', reason?:string, remain?:number, count?:number}>}
 */
export async function inspectRequest(db, subject, endpoint, midList) {
    // 1) 配置: isolate 内存 (TTL 5s), 零 D1
    const cfg = await getRiskConfig(db);
    if (!cfg.enabled) return { action: 'allow' };

    // 2) 封禁: 内存缓存命中即拦, 零 D1
    const memBlock = memGetBlock(subject);
    if (memBlock) return memBlock;

    // 3) 秒级突增: 内存滑动计数, 零 D1
    const secCount = memSecBump(subject);
    if (secCount > cfg.burstPerSec) {
        await logRiskEvent(db, subject, 'burst_1s', endpoint + ' 1秒内 ' + secCount + ' 次 (阈值 ' + cfg.burstPerSec + ')');
        if (cfg.autoBlock) await blockSubject(db, 'subject', subject, cfg.blockSeconds, '频次突增: 1秒 ' + secCount + ' 次');
        return { action: 'block', reason: '请求频率异常(秒级突增)', remain: cfg.blockSeconds, count: secCount };
    }

    // 4) MID 遍历: 内存 60 秒去重计数, 零 D1
    if (midList && midList.length && cfg.midScanPerMin > 0) {
        const uniq = [];
        for (let i = 0; i < midList.length; i++) {
            const m = midList[i];
            if (m && uniq.indexOf(m) < 0) uniq.push(m);
        }
        if (uniq.length) {
            const seen = memMidCheck(subject, uniq);
            if (seen > cfg.midScanPerMin) {
                await logRiskEvent(db, subject, 'mid_scan', '1分钟内遍历 ' + seen + ' 个不同 mid (阈值 ' + cfg.midScanPerMin + ')');
                if (cfg.autoBlock) await blockSubject(db, 'subject', subject, cfg.blockSeconds, '疑似全量遍历 mid: ' + seen + ' 个/分钟');
                return { action: 'block', reason: '行为异常(疑似批量遍历歌曲)', remain: cfg.blockSeconds, count: seen };
            }
        }
    }

    // 5) 分钟级: 唯一热路径 D1, 单条 UPSERT (RETURNING 回读)
    const minCount = await bumpMinute(db, subject);
    if (minCount > cfg.burstPerMin) {
        await logRiskEvent(db, subject, 'burst_60s', endpoint + ' 1分钟内 ' + minCount + ' 次 (阈值 ' + cfg.burstPerMin + ')');
        if (cfg.autoBlock) await blockSubject(db, 'subject', subject, cfg.blockSeconds, '频次超限: 1分钟 ' + minCount + ' 次');
        return { action: 'block', reason: '请求频率异常(分钟级超限)', remain: cfg.blockSeconds, count: minCount };
    }

    return { action: 'allow', perSec: secCount, perMin: minCount };
}

// ---------- 管理端查询 (非热路径) ----------

export async function listBlocks(db, page, size) {
    await ensureRiskTables(db);
    page = page || 1; size = size || 20;
    const offset = (page - 1) * size;
    const now = nowSec();
    const total = await db.prepare('SELECT COUNT(*) AS c FROM risk_block WHERE blocked_until > ?').bind(now).first();
    const rows = await db.prepare('SELECT scope, key, blocked_until, reason, hits, created_at FROM risk_block ' +
        'WHERE blocked_until > ? ORDER BY blocked_until DESC LIMIT ? OFFSET ?')
        .bind(now, size, offset).all();
    return { total: (total && total.c) || 0, list: (rows && rows.results) || [] };
}

export async function listEvents(db, page, size) {
    await ensureRiskTables(db);
    page = page || 1; size = size || 20;
    const offset = (page - 1) * size;
    const total = await db.prepare('SELECT COUNT(*) AS c FROM risk_events').first();
    const rows = await db.prepare('SELECT id, subject, rule, detail, created_at FROM risk_events ' +
        'ORDER BY id DESC LIMIT ? OFFSET ?').bind(size, offset).all();
    return { total: (total && total.c) || 0, list: (rows && rows.results) || [] };
}

export async function getRiskStats(db) {
    await ensureRiskTables(db);
    const now = nowSec();
    const dayStart = now - (now % 86400);
    const active = await db.prepare('SELECT COUNT(*) AS c FROM risk_block WHERE blocked_until > ?').bind(now).first();
    const todayEvents = await db.prepare('SELECT COUNT(*) AS c FROM risk_events WHERE created_at >= ?').bind(dayStart).first();
    const totalEvents = await db.prepare('SELECT COUNT(*) AS c FROM risk_events').first();
    const byRule = await db.prepare('SELECT rule, COUNT(*) AS c FROM risk_events GROUP BY rule ORDER BY c DESC').all();
    const recent = await db.prepare('SELECT id, subject, rule, detail, created_at FROM risk_events ORDER BY id DESC LIMIT 10').all();
    return {
        activeBlocks: (active && active.c) || 0,
        todayEvents: (todayEvents && todayEvents.c) || 0,
        totalEvents: (totalEvents && totalEvents.c) || 0,
        byRule: (byRule && byRule.results) || [],
        recent: (recent && recent.results) || [],
    };
}

export async function unblock(db, scope, key) {
    await ensureRiskTables(db);
    await db.prepare('DELETE FROM risk_block WHERE scope=? AND key=?').bind(scope, key).run();
    if (scope === 'subject') _blockMap.delete(key);
}

export async function unblockAll(db) {
    await ensureRiskTables(db);
    const r = await db.prepare('DELETE FROM risk_block').run();
    _blockMap.clear();
    return (r.meta && r.meta.changes) || 0;
}

export async function clearEvents(db) {
    await ensureRiskTables(db);
    const r = await db.prepare('DELETE FROM risk_events').run();
    return (r.meta && r.meta.changes) || 0;
}

/** Cron 清理: 陈旧事件 / 过期 mid 记录 / 已过期封禁 */
export async function cleanStaleRisk(db, days) {
    try {
        await ensureRiskTables(db);
        const keep = days || 7;
        const cutoff = nowSec() - keep * 86400;
        await db.prepare('DELETE FROM risk_events WHERE created_at < ?').bind(cutoff).run();
        await db.prepare('DELETE FROM risk_mid WHERE window_start < ?').bind(cutoff).run();
        await db.prepare('DELETE FROM risk_block WHERE blocked_until < ?').bind(cutoff).run();
        await db.prepare('DELETE FROM risk_rate WHERE window_start < ?').bind(cutoff).run();
    } catch (e) {
        console.error('[Risk] 清理失败:', e);
    }
}
