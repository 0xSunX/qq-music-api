/**
 * 播放链接缓存
 * 策略: 用户请求时先查缓存; 命中则校验链接有效性, 有效直接返回;
 *       无效则重新取上游并更新缓存。不再按 TTL 定时删除。
 *       链接本身有时效性, 用"请求时校验"代替"定时清理"。
 */

// ---------- isolate 内存缓存层 ----------
// 命中查询是最高频热路径: 加一层内存缓存, 命中时零 D1 查表。
// 内存条目 TTL 60 秒, 过期回源 D1 并回填; 写入/删除同步更新, 保证一致性。
// 长度上限防内存膨胀, 超限整体清空(简单且够用, 缓存本身可重建)。
const _memCache = new Map();
const MEM_TTL_MS = 60000;
const MEM_MAX = 5000;

// 内存层命中/未命中计数 (isolate 级, 重启归零)
// 用于后台直观看到内存层省了多少次 D1 查表
let _memHits = 0;
let _memMisses = 0;

function memGet(cacheKey) {
    const m = _memCache.get(cacheKey);
    if (!m) return null;
    if ((Date.now() - m.cachedAt) >= MEM_TTL_MS) { _memCache.delete(cacheKey); return null; }
    return m;
}

function memSet(cacheKey, url, quality, createdAt) {
    // 满了淘汰最旧的一批(按 Map 插入顺序), 而不是整体清空。
    // 整体清空会导致雪崩: 一次全废 → 下一波请求全部落 D1 冷查。
    if (_memCache.size >= MEM_MAX) {
        const evict = Math.floor(MEM_MAX * 0.2);
        let n = 0;
        for (const k of _memCache.keys()) {
            _memCache.delete(k);
            if (++n >= evict) break;
        }
    }
    _memCache.set(cacheKey, { url: url, quality: quality, createdAt: createdAt, cachedAt: Date.now() });
}

function memDel(cacheKey) { _memCache.delete(cacheKey); }

/** 管理端改动缓存后调用, 强制内存层失效 */
export function invalidateMemCache() { _memCache.clear(); }

/** 内存层统计 (isolate 级): 命中次数 / 未命中次数 / 当前条目数 / 命中率 */
export function getMemStats() {
    const total = _memHits + _memMisses;
    return {
        hits: _memHits,
        misses: _memMisses,
        total: total,
        size: _memCache.size,
        hitRate: total > 0 ? Math.round((_memHits / total) * 10000) / 100 : 0,
    };
}

/** 重置内存层统计 (后台可手动清零) */
export function resetMemStats() { _memHits = 0; _memMisses = 0; }

/** 建表 */
// 建表只跑一次: 同 isolate 复用后续请求不再重复执行 DDL
let _urlCacheEnsured = false;

export async function ensureUrlCacheTable(db) {
    if (_urlCacheEnsured) return;
    await db.prepare(`CREATE TABLE IF NOT EXISTS url_cache (
        cache_key TEXT PRIMARY KEY,
        mid TEXT NOT NULL,
        quality TEXT NOT NULL,
        url TEXT NOT NULL,
        actual_quality TEXT,
        created_at INTEGER
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_url_cache_created ON url_cache(created_at)`).run();
    // mid 索引: 加速按 mid 精确/前缀查询
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_url_cache_mid ON url_cache(mid)`).run();
    _urlCacheEnsured = true;
}

/** 命中/未命中统计表 (单行, id 恒为 1) */
// 统计表建表只跑一次: 缓存命中/未命中是热路径, 不能每次都跑 DDL
let _cacheStatsEnsured = false;

export async function ensureCacheStatsTable(db) {
    if (_cacheStatsEnsured) return;
    await db.prepare(`CREATE TABLE IF NOT EXISTS url_cache_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hits INTEGER DEFAULT 0,
        misses INTEGER DEFAULT 0
    )`).run();
    await db.prepare(`INSERT OR IGNORE INTO url_cache_stats (id, hits, misses) VALUES (1, 0, 0)`).run();
    _cacheStatsEnsured = true;
}

/** 记录命中 (原子递增) */
export async function recordCacheHit(db, n = 1) {
    if (!db) return;
    try {
        await ensureCacheStatsTable(db);
        await db.prepare(`UPDATE url_cache_stats SET hits = hits + ? WHERE id = 1`).bind(n).run();
    } catch (e) { console.error("[Cache] record hit 失败:", e); }
}

/** 记录未命中 (原子递增) */
export async function recordCacheMiss(db, n = 1) {
    if (!db) return;
    try {
        await ensureCacheStatsTable(db);
        await db.prepare(`UPDATE url_cache_stats SET misses = misses + ? WHERE id = 1`).bind(n).run();
    } catch (e) { console.error("[Cache] record miss 失败:", e); }
}

/**
 * 批量查缓存: 返回 { mid: { url, quality, createdAt } }
 * 不再按 TTL 过滤, 由调用方校验链接有效性。
 */
export async function getCachedUrls(db, mids, quality) {
    if (!mids || mids.length === 0) return {};
    const result = {};
    const missing = [];
    // 1) 内存优先: 命中直接取, 零 D1
    for (let i = 0; i < mids.length; i++) {
        const mid = mids[i];
        const m = memGet(mid + ":" + quality);
        if (m) {
            result[mid] = { url: m.url, quality: m.quality, createdAt: m.createdAt };
            _memHits++;
        } else {
            missing.push(mid);
            _memMisses++;
        }
    }
    // 全部内存命中: 直接返回, 一次 D1 都不用
    if (missing.length === 0) return result;

    // 2) 剩余回源 D1 批量查表, 并回填内存
    const keys = missing.map(function(m){ return m + ":" + quality; });
    const placeholders = keys.map(function(){ return "?"; }).join(",");
    const rows = await db.prepare(
        `SELECT cache_key, mid, url, actual_quality, created_at FROM url_cache WHERE cache_key IN (${placeholders})`
    ).bind(...keys).all();
    const list = (rows && rows.results) || [];
    for (const row of list) {
        if (row.url) {
            const q = row.actual_quality || quality;
            const ca = row.created_at || 0;
            result[row.mid] = { url: row.url, quality: q, createdAt: ca };
            memSet(row.cache_key || (row.mid + ":" + quality), row.url, q, ca);
        }
    }
    return result;
}

/** 写入/刷新一条缓存 (url 为空则跳过, 避免把临时失败也缓存住) */
export async function saveCachedUrl(db, mid, quality, url, actualQuality) {
    if (!url) return;
    const now = Math.floor(Date.now() / 1000);
    const key = mid + ":" + quality;
    await db.prepare(`INSERT INTO url_cache (cache_key, mid, quality, url, actual_quality, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
            url = excluded.url,
            actual_quality = excluded.actual_quality,
            created_at = excluded.created_at`)
        .bind(key, mid, quality, url, actualQuality || quality, now).run();
    // 同步写内存, 下次命中零 D1
    memSet(key, url, actualQuality || quality, now);
}

/**
 * 批量写入/刷新缓存: 单次 db.batch() 提交多条 upsert, 替代 N 次独立往返。
 * 批量取链接场景(一次请求多个 mid)时, D1 往返从 N 次压到 1 次。
 * @param {Array<{mid:string, quality:string, url:string, actualQuality?:string}>} items
 */
export async function saveCachedUrlsBatch(db, items) {
    if (!db || !items || !items.length) return;
    const now = Math.floor(Date.now() / 1000);
    const valid = items.filter(function (it) { return it && it.url && it.mid; });
    if (!valid.length) return;
    const stmt = db.prepare(`INSERT INTO url_cache (cache_key, mid, quality, url, actual_quality, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
            url = excluded.url,
            actual_quality = excluded.actual_quality,
            created_at = excluded.created_at`);
    const batch = valid.map(function (it) {
        const key = it.mid + ":" + it.quality;
        // 同步写内存, 下次命中零 D1
        memSet(key, it.url, it.actualQuality || it.quality, now);
        return stmt.bind(key, it.mid, it.quality, it.url, it.actualQuality || it.quality, now);
    });
    await db.batch(batch);
}

/** 分页列出缓存条目 */
export async function listCache(db, page = 1, size = 20, keyword = "") {
    await ensureUrlCacheTable(db);
    const offset = (page - 1) * size;
    const kw = String(keyword || "").trim();
    let totalRow, rows;
    if (kw) {
        // mid 前缀匹配走 idx_url_cache_mid 索引; url 是外链不做索引, 仅作兜底包含匹配
        const prefix = kw + "%";
        const contains = "%" + kw + "%";
        totalRow = await db.prepare("SELECT COUNT(*) AS c FROM url_cache WHERE mid LIKE ? OR url LIKE ?").bind(prefix, contains).first();
        rows = await db.prepare(
            `SELECT cache_key, mid, quality, url, actual_quality, created_at FROM url_cache
             WHERE mid LIKE ? OR url LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).bind(prefix, contains, size, offset).all();
    } else {
        totalRow = await db.prepare("SELECT COUNT(*) AS c FROM url_cache").first();
        rows = await db.prepare(
            `SELECT cache_key, mid, quality, url, actual_quality, created_at FROM url_cache
             ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).bind(size, offset).all();
    }
    return { total: (totalRow && totalRow.c) || 0, list: (rows && rows.results) || [] };
}

/** 删除一条缓存 */
export async function deleteCacheEntry(db, cacheKey) {
    await db.prepare("DELETE FROM url_cache WHERE cache_key = ?").bind(cacheKey).run();
    memDel(cacheKey);
}

/** 清空全部缓存 */
export async function clearCache(db) {
    await db.prepare("DELETE FROM url_cache").run();
    _memCache.clear();
}

/** 读取命中率统计 */
export async function getCacheStats(db) {
    await ensureUrlCacheTable(db);
    await ensureCacheStatsTable(db);
    const s = await db.prepare("SELECT hits, misses FROM url_cache_stats WHERE id = 1").first();
    const c = await db.prepare("SELECT COUNT(*) AS c FROM url_cache").first();
    const hits = (s && s.hits) || 0;
    const misses = (s && s.misses) || 0;
    const total = hits + misses;
    const mem = getMemStats();
    return {
        hits,
        misses,
        total,
        count: (c && c.c) || 0,
        hitRate: total > 0 ? Math.round((hits / total) * 10000) / 100 : 0,
        // 内存层统计 (isolate 级): 直接反映省下的 D1 查表次数
        memHits: mem.hits,
        memMisses: mem.misses,
        memTotal: mem.total,
        memSize: mem.size,
        memHitRate: mem.hitRate,
        // 估算: 内存命中即省下一次 D1 查表往返
        savedD1: mem.hits,
    };
}

/**
 * 缓存分布统计 (图形化用): 按请求音质 / 命中音质 / 新鲜度分桶
 * 全部走聚合查询, 单次请求返回, 不做全表返回。
 */
export async function getCacheDistribution(db) {
    await ensureUrlCacheTable(db);
    const now = Math.floor(Date.now() / 1000);
    const q = await db.prepare(
        "SELECT quality, COUNT(*) AS c FROM url_cache GROUP BY quality ORDER BY c DESC"
    ).all();
    const aq = await db.prepare(
        "SELECT COALESCE(actual_quality, quality) AS aq, COUNT(*) AS c FROM url_cache GROUP BY aq ORDER BY c DESC"
    ).all();
    // 新鲜度: 30 分钟内 / 30-60 分钟 / 1-24 小时 / 超过 1 天
    const fresh = await db.prepare(`SELECT
        SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS f30m,
        SUM(CASE WHEN created_at <= ? AND created_at > ? THEN 1 ELSE 0 END) AS f1h,
        SUM(CASE WHEN created_at <= ? AND created_at > ? THEN 1 ELSE 0 END) AS f24h,
        SUM(CASE WHEN created_at <= ? THEN 1 ELSE 0 END) AS fold
        FROM url_cache`)
        .bind(now - 1800, now - 1800, now - 3600, now - 3600, now - 86400, now - 86400).first();
    const top = await db.prepare(
        "SELECT mid, COUNT(*) AS c FROM url_cache GROUP BY mid ORDER BY c DESC LIMIT 10"
    ).all();
    return {
        byQuality: (q.results || []).map(r => ({ key: r.quality || 'unknown', count: r.c || 0 })),
        byActualQuality: (aq.results || []).map(r => ({ key: r.aq || 'unknown', count: r.c || 0 })),
        topMids: (top.results || []).map(r => ({ key: r.mid || 'unknown', count: r.c || 0 })),
        freshness: [
            { key: '<30分钟', count: (fresh && fresh.f30m) || 0 },
            { key: '30分钟-1小时', count: (fresh && fresh.f1h) || 0 },
            { key: '1-24小时', count: (fresh && fresh.f24h) || 0 },
            { key: '>1天', count: (fresh && fresh.fold) || 0 },
        ],
    };
}

/**
 * 校验播放链接是否有效。
 * 用 Range 请求拉 1 字节, 避免整段下载; 200/206 视为有效。
 */
export async function validateUrl(url) {
    if (!url) return false;
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(function(){ ctrl.abort(); }, 3000);
        const resp = await fetch(url, {
            method: "GET",
            headers: { "Range": "bytes=0-0" },
            signal: ctrl.signal,
        });
        clearTimeout(timer);
        return resp.status === 200 || resp.status === 206;
    } catch (e) {
        return false;
    }
}
