/**
 * 播放链接缓存
 * 同一 mid + 请求音质在 TTL(默认 10 分钟)内重复请求时直接复用, 避免重复打上游。
 * 资源链接本身有时效性, 故 TTL 设得较短, 过期自动失效重新获取。
 */

const URL_CACHE_TTL = 600; // 10 分钟, 单位秒

export { URL_CACHE_TTL };

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

/** 批量查缓存: 返回 { mid: { url, quality } }, 仅含未过期的非空链接 */
export async function getCachedUrls(db, mids, quality) {
    if (!mids || mids.length === 0) return {};
    const now = Math.floor(Date.now() / 1000);
    const minTime = now - URL_CACHE_TTL;
    const keys = mids.map(function(m){ return m + ":" + quality; });
    const placeholders = keys.map(function(){ return "?"; }).join(",");
    const rows = await db.prepare(
        `SELECT mid, url, actual_quality FROM url_cache
         WHERE cache_key IN (${placeholders}) AND created_at > ?`
    ).bind(...keys, minTime).all();
    const result = {};
    const list = (rows && rows.results) || [];
    for (const row of list) {
        if (row.url) {
            result[row.mid] = { url: row.url, quality: row.actual_quality || quality };
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

/** 清理过期缓存 (可选, 由 Cron 或手动调用) */
export async function cleanExpiredUrlCache(db) {
    const now = Math.floor(Date.now() / 1000);
    await db.prepare("DELETE FROM url_cache WHERE created_at <= ?").bind(now - URL_CACHE_TTL).run();
}
