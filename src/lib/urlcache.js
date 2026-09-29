/**
 * 播放链接缓存
 * 策略: 用户请求时先查缓存; 命中则校验链接有效性, 有效直接返回;
 *       无效则重新取上游并更新缓存。不再按 TTL 定时删除。
 *       链接本身有时效性, 用"请求时校验"代替"定时清理"。
 */

/** 建表 */
export async function ensureUrlCacheTable(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS url_cache (
        cache_key TEXT PRIMARY KEY,
        mid TEXT NOT NULL,
        quality TEXT NOT NULL,
        url TEXT NOT NULL,
        actual_quality TEXT,
        created_at INTEGER
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_url_cache_created ON url_cache(created_at)`).run();
}

/** 命中/未命中统计表 (单行, id 恒为 1) */
export async function ensureCacheStatsTable(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS url_cache_stats (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        hits INTEGER DEFAULT 0,
        misses INTEGER DEFAULT 0
    )`).run();
    await db.prepare(`INSERT OR IGNORE INTO url_cache_stats (id, hits, misses) VALUES (1, 0, 0)`).run();
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
    const keys = mids.map(function(m){ return m + ":" + quality; });
    const placeholders = keys.map(function(){ return "?"; }).join(",");
    const rows = await db.prepare(
        `SELECT mid, url, actual_quality, created_at FROM url_cache WHERE cache_key IN (${placeholders})`
    ).bind(...keys).all();
    const result = {};
    const list = (rows && rows.results) || [];
    for (const row of list) {
        if (row.url) {
            result[row.mid] = { url: row.url, quality: row.actual_quality || quality, createdAt: row.created_at || 0 };
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
}

/** 分页列出缓存条目 */
export async function listCache(db, page = 1, size = 20, keyword = "") {
    await ensureUrlCacheTable(db);
    const offset = (page - 1) * size;
    const kw = String(keyword || "").trim();
    let totalRow, rows;
    if (kw) {
        const like = "%" + kw + "%";
        totalRow = await db.prepare("SELECT COUNT(*) AS c FROM url_cache WHERE mid LIKE ? OR url LIKE ?").bind(like, like).first();
        rows = await db.prepare(
            `SELECT cache_key, mid, quality, url, actual_quality, created_at FROM url_cache
             WHERE mid LIKE ? OR url LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
        ).bind(like, like, size, offset).all();
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
}

/** 清空全部缓存 */
export async function clearCache(db) {
    await db.prepare("DELETE FROM url_cache").run();
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
    return {
        hits,
        misses,
        total,
        count: (c && c.c) || 0,
        hitRate: total > 0 ? Math.round((hits / total) * 10000) / 100 : 0,
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
