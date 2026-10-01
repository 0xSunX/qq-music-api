/**
 * 凭证刷新日志 - 记录每次刷新/检查的结果、时间与原因
 * 独立模块, 供 refresh.js 写入、admin/credential.js 读取
 */

let _ensured = false;

export async function ensureRefreshLogTable(db) {
  if (_ensured) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS refresh_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trigger TEXT NOT NULL,
    success INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    expire_hours INTEGER,
    error_code TEXT,
    created_at INTEGER NOT NULL
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_refresh_log_time ON refresh_log(created_at)').run();
  _ensured = true;
}

/**
 * 写一条刷新日志。失败不影响主流程。
 * @param {D1Database} db
 * @param {{trigger:string, success:boolean, reason?:string, expireHours?:number, errorCode?:string}} rec
 */
export async function logRefresh(db, rec) {
  if (!db) return;
  try {
    await ensureRefreshLogTable(db);
    await db.prepare(`INSERT INTO refresh_log (trigger, success, reason, expire_hours, error_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(
        String(rec.trigger || 'cron'),
        rec.success ? 1 : 0,
        String(rec.reason || ''),
        Number.isFinite(rec.expireHours) ? Math.trunc(rec.expireHours) : null,
        rec.errorCode ? String(rec.errorCode) : null,
        Math.floor(Date.now() / 1000)
      ).run();
  } catch (e) {
    console.error('[RefreshLog] 写入失败:', e);
  }
}

/** 最近一次刷新记录 */
export async function getLastRefresh(db) {
  await ensureRefreshLogTable(db);
  return await db.prepare('SELECT * FROM refresh_log ORDER BY id DESC LIMIT 1').first();
}

/** 分页查询刷新历史 */
export async function listRefreshLogs(db, page = 1, size = 20) {
  await ensureRefreshLogTable(db);
  const offset = (Math.max(1, page) - 1) * size;
  const total = await db.prepare('SELECT COUNT(*) AS c FROM refresh_log').first();
  const rows = await db.prepare('SELECT * FROM refresh_log ORDER BY id DESC LIMIT ? OFFSET ?')
    .bind(size, offset).all();
  return { total: (total && total.c) || 0, list: (rows && rows.results) || [] };
}

/** 刷新成功率统计 (近 N 天) */
export async function getRefreshStats(db, days = 30) {
  await ensureRefreshLogTable(db);
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const row = await db.prepare(`SELECT
    COUNT(*) AS total,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS ok,
    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS fail
    FROM refresh_log WHERE created_at >= ?`).bind(since).first();
  const total = (row && row.total) || 0;
  const ok = (row && row.ok) || 0;
  const fail = (row && row.fail) || 0;
  return {
    days,
    total,
    ok,
    fail,
    rate: total > 0 ? Math.round((ok / total) * 10000) / 100 : 0,
  };
}

/** Cron 清理: 仅保留最近 days 天, 防止表膨胀 */
export async function cleanStaleRefreshLog(db, days = 30) {
  try {
    await ensureRefreshLogTable(db);
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const r = await db.prepare('DELETE FROM refresh_log WHERE created_at < ?').bind(cutoff).run();
    return (r.meta && r.meta.changes) || 0;
  } catch (e) {
    console.error('[RefreshLog] 清理失败:', e);
    return 0;
  }
}
