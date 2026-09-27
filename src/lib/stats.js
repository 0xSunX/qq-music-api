/**
 * API 调用统计
 */

/**
 * 确保统计表存在
 * @param {D1Database} db 
 */
export async function ensureStatsTable(db) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS api_stats (
            endpoint TEXT PRIMARY KEY,
            count INTEGER DEFAULT 0
        )
    `).run();
}

/**
 * 增加 API 调用计数
 * @param {D1Database} db 
 * @param {string} endpoint 
 */
export async function incrementCount(db, endpoint) {
    try {
        await db.prepare(`
            INSERT INTO api_stats (endpoint, count) VALUES (?, 1)
            ON CONFLICT(endpoint) DO UPDATE SET count = count + 1
        `).bind(endpoint).run();
    } catch (e) {
        console.error(`[Stats] Increment failed for ${endpoint}:`, e);
    }
}

/**
 * 获取所有端点的调用统计
 * @param {D1Database} db 
 * @returns {Promise<Array<{endpoint: string, count: number}>>}
 */
export async function getAllStats(db) {
    try {
        const result = await db.prepare(
            "SELECT endpoint, count FROM api_stats ORDER BY count DESC"
        ).all();
        return result.results || [];
    } catch (e) {
        console.error("获取统计失败:", e);
        return [];
    }
}

/**
 * 获取总调用次数
 * @param {D1Database} db 
 * @returns {Promise<number>}
 */
export async function getTotalCount(db) {
    try {
        const result = await db.prepare(
            "SELECT SUM(count) as total FROM api_stats"
        ).first();
        return result?.total || 0;
    } catch (e) {
        console.error("获取总统计失败:", e);
        return 0;
    }
}
