/**
 * 用户系统 - 注册 / 登录 / 会话 / 分级 / 限流 / 管理
 */

import { verifyDeviceId } from "./device.js";

const PBKDF2_ITER = 100000;
const SESSION_TTL = 30 * 24 * 3600;   // 30 天
const DEFAULT_DAILY_LIMIT = 50;
// VIP 用户固定日限额(不随 users.daily_limit 字段变化)
export const VIP_DAILY_LIMIT = 1000;
// 普通用户默认最高音质(可被 users.max_quality 覆盖)
export const DEFAULT_MAX_QUALITY = '320';
// 音质由低到高排序, 用于比较用户音质上限与请求音质
export const QUALITY_LEVELS = ['128', '320', 'flac', 'atmos_51', 'atmos_2', 'master'];
export function qualityRank(q) {
    const i = QUALITY_LEVELS.indexOf(String(q || '').toLowerCase());
    return i < 0 ? -1 : i;
}

// ---------- 工具 ----------

export function randomHex(bytes = 16) {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return [...arr].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt: enc.encode(salt), iterations: PBKDF2_ITER, hash: 'SHA-256' },
        key, 256
    );
    return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function todayStr() {
    // 北京时间
    const now = Date.now() + 8 * 3600 * 1000;
    return new Date(now).toISOString().slice(0, 10);
}

// ---------- 建表 ----------

// 建表只跑一次: 同 isolate 复用后续请求不再重复执行 DDL
let _userTablesEnsured = false;

export async function ensureUserTables(db) {
    if (_userTablesEnsured) return;
    await db.prepare(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        level TEXT DEFAULT 'normal',
        role TEXT DEFAULT 'user',
        status INTEGER DEFAULT 1,
        device_id TEXT NOT NULL,
        daily_limit INTEGER DEFAULT 50,
        max_quality TEXT DEFAULT '320',
        created_at INTEGER,
        updated_at INTEGER
    )`).run();
    // 兼容旧库: 补充 max_quality 列(普通用户最高音质上限, VIP/管理员不受此限)
    try { await db.prepare("ALTER TABLE users ADD COLUMN max_quality TEXT DEFAULT '320'").run(); } catch (e) { /* 列已存在 */ }
    await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_device ON users(device_id)`).run();
    // username 索引: 支撑全库搜索的前缀匹配 (LIKE 'kw%'), 避免 %kw% 全表扫
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        device_id TEXT,
        expires_at INTEGER NOT NULL,
        created_at INTEGER
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS usage_daily (
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, date)
    )`).run();
    await db.prepare(`CREATE TABLE IF NOT EXISTS app_open_daily (
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, date)
    )`).run();
    // 注册限速: 按 IP 记录窗口内注册次数, 防止批量刷注册
    await db.prepare(`CREATE TABLE IF NOT EXISTS register_rate (
        ip TEXT PRIMARY KEY,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0
    )`).run();
    // 通用 IP 限流: 按 IP + 端点记录窗口内调用次数, 用于公开端点防刷
    await db.prepare(`CREATE TABLE IF NOT EXISTS ip_rate (
        ip TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (ip, endpoint)
    )`).run();
    // 登录限速: 按 IP / 用户名 双维度记录窗口内失败次数, 防爆破
    await db.prepare(`CREATE TABLE IF NOT EXISTS login_rate (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        window_start INTEGER NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (scope, key)
    )`).run();
    _userTablesEnsured = true;
}

/**
 * 注册限速: 同一 IP 在 windowSec 秒内最多 limit 次注册。
 * 单条 UPSERT 内完成"判断窗口 + 计数", 避免并发竞态。
 * @returns {Promise<boolean>} true=允许, false=超限
 */
export async function checkRegisterRate(db, ip, limit = 5, windowSec = 3600) {
    const now = Math.floor(Date.now() / 1000);
    // 窗口过期则重置计数; 未过期则条件递增, 只有 count < limit 时才 +1
    const r = await db.prepare(`INSERT INTO register_rate (ip, window_start, count) VALUES (?, ?, 1)
        ON CONFLICT(ip) DO UPDATE SET
            count = CASE WHEN register_rate.window_start <= ? THEN 1 ELSE register_rate.count + 1 END,
            window_start = CASE WHEN register_rate.window_start <= ? THEN ? ELSE register_rate.window_start END
        WHERE register_rate.window_start <= ? OR register_rate.count < ?`)
        .bind(ip, now, now - windowSec, now - windowSec, now, now - windowSec, limit).run();
    return !!(r.meta && r.meta.changes > 0);
}

/**
 * 清理陈旧的注册限速记录, 防止 register_rate 表无限膨胀。
 * 窗口早已过期的行留着无意义, 由 Cron 定期删除。
 * @param {number} days 保留最近 N 天的记录, 默认 7 天
 */
export async function cleanStaleRegisterRate(db, days = 7) {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const r = await db.prepare('DELETE FROM register_rate WHERE window_start < ?').bind(cutoff).run();
    return (r.meta && r.meta.changes) || 0;
}

/**
 * 通用 IP 限流: 同一 IP 对同一端点在 windowSec 秒内最多 limit 次。
 * 单条 UPSERT 内完成\"判断窗口 + 计数\", 避免并发竞态。
 * 用于公开端点(无登录态)防刷, 与用户维度的 reserveUsage 互补。
 * @returns {Promise<boolean>} true=允许, false=超限
 */
export async function checkIpRate(db, ip, endpoint, limit = 30, windowSec = 60) {
    const now = Math.floor(Date.now() / 1000);
    const r = await db.prepare(`INSERT INTO ip_rate (ip, endpoint, window_start, count) VALUES (?, ?, ?, 1)
        ON CONFLICT(ip, endpoint) DO UPDATE SET
            count = CASE WHEN ip_rate.window_start <= ? THEN 1 ELSE ip_rate.count + 1 END,
            window_start = CASE WHEN ip_rate.window_start <= ? THEN ? ELSE ip_rate.window_start END
        WHERE ip_rate.window_start <= ? OR ip_rate.count < ?`)
        .bind(ip, endpoint, now, now - windowSec, now - windowSec, now, now - windowSec, limit).run();
    return !!(r.meta && r.meta.changes > 0);
}

/**
 * 清理陈旧的 IP 限流记录, 防止 ip_rate 表无限膨胀。
 * @param {number} days 保留最近 N 天的记录, 默认 7 天
 */
export async function cleanStaleIpRate(db, days = 7) {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const r = await db.prepare('DELETE FROM ip_rate WHERE window_start < ?').bind(cutoff).run();
    return (r.meta && r.meta.changes) || 0;
}

/**
 * 清理陈旧的登录限速记录, 防止 login_rate 表无限膨胀。
 */
export async function cleanStaleLoginRate(db, days = 7) {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const r = await db.prepare('DELETE FROM login_rate WHERE window_start < ?').bind(cutoff).run();
    return (r.meta && r.meta.changes) || 0;
}

/**
 * 登录限速: 同一 scope('ip'/'user') + key 在 windowSec 秒内最多 limit 次。
 * 单条 UPSERT 判窗口+计数, 避免竞态。
 * @returns {Promise<boolean>} true=允许, false=超限
 */
export async function checkLoginRate(db, scope, key, limit = 10, windowSec = 900) {
    const now = Math.floor(Date.now() / 1000);
    const r = await db.prepare(`INSERT INTO login_rate (scope, key, window_start, count) VALUES (?, ?, ?, 1)
        ON CONFLICT(scope, key) DO UPDATE SET
            count = CASE WHEN login_rate.window_start <= ? THEN 1 ELSE login_rate.count + 1 END,
            window_start = CASE WHEN login_rate.window_start <= ? THEN ? ELSE login_rate.window_start END
        WHERE login_rate.window_start <= ? OR login_rate.count < ?`)
        .bind(scope, key, now, now - windowSec, now - windowSec, now, now - windowSec, limit).run();
    return !!(r.meta && r.meta.changes > 0);
}

/**
 * 校验 deviceId。配置了 deviceSecret 时必须为服务端签发的合法签名;
 * 未配置时回退旧的长度校验(仅限开发环境)。
 */
export async function checkDeviceId(deviceSecret, deviceId) {
    const raw = String(deviceId || "").trim();
    if (deviceSecret) {
        const r = await verifyDeviceId(deviceSecret, raw);
        if (!r.valid) return { ok: false, error: "设备标识无效或已过期(需服务端签发)" };
        return { ok: true, fingerprint: r.fingerprint };
    }
    if (raw.length < 6 || raw.length > 128) {
        return { ok: false, error: "设备标识格式不合法(需 6-128 字符)" };
    }
    return { ok: true, fingerprint: raw };
}

/** 登录失败计数 +1 (用户名维度) */
export async function recordLoginFail(db, username) {
    try {
        await checkLoginRate(db, "user", String(username || "").toLowerCase(), 10, 900);
    } catch (e) { console.error("记录登录失败异常:", e); }
}

/** 读取用户名维度当前失败计数(只读, 不递增) */
export async function getLoginFailCount(db, username) {
    try {
        const now = Math.floor(Date.now() / 1000);
        const row = await db.prepare(
            "SELECT count, window_start FROM login_rate WHERE scope = 'user' AND key = ?"
        ).bind(String(username || "").toLowerCase()).first();
        if (!row || !row.window_start) return 0;
        // 窗口已过期视为 0
        if (row.window_start <= now - 900) return 0;
        return row.count || 0;
    } catch (e) { return 0; }
}

/** 登录成功清除用户名维度失败计数 */
export async function clearLoginFail(db, username) {
    try {
        await db.prepare("DELETE FROM login_rate WHERE scope = 'user' AND key = ?")
            .bind(String(username || "").toLowerCase()).run();
    } catch (e) { /* ignore */ }
}

/** 记录一次 APP 打开, 原子递增当日计数 */
export async function recordAppOpen(db, userId) {
    await db.prepare(`INSERT INTO app_open_daily (user_id, date, count) VALUES (?, ?, 1)
        ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1`)
        .bind(userId, todayStr()).run();
}

/** API 调用统计: { today, total } */
export async function getUsageSummary(db, userId) {
    const row = await db.prepare(`SELECT
        (SELECT COUNT FROM usage_daily WHERE user_id = ? AND date = ?) AS today,
        (SELECT COALESCE(SUM(count),0) FROM usage_daily WHERE user_id = ?) AS total`)
        .bind(userId, todayStr(), userId).first();
    return { today: (row && row.today) || 0, total: (row && row.total) || 0 };
}

/** APP 打开统计: { today, total } */
export async function getAppOpenSummary(db, userId) {
    const row = await db.prepare(`SELECT
        (SELECT COUNT FROM app_open_daily WHERE user_id = ? AND date = ?) AS today,
        (SELECT COALESCE(SUM(count),0) FROM app_open_daily WHERE user_id = ?) AS total`)
        .bind(userId, todayStr(), userId).first();
    return { today: (row && row.today) || 0, total: (row && row.total) || 0 };
}

// ---------- 用户 CRUD ----------

export async function getUserByName(db, username) {
    return await db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first();
}

export async function getUserById(db, id) {
    return await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function registerUser(db, username, password, deviceId, deviceSecret) {
    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        throw new Error('用户名需 3-20 位字母、数字或下划线');
    }
    if (!password || password.length < 6) {
        throw new Error('密码至少 6 位');
    }
    if (password.length > 128) {
        throw new Error('密码过长');
    }
    const deviceCheck = await checkDeviceId(deviceSecret, deviceId);
    if (!deviceCheck.ok) {
        throw new Error(deviceCheck.error);
    }
    const salt = randomHex(16);
    const hash = await hashPassword(password, salt);
    const now = Math.floor(Date.now() / 1000);
    // 管理员只能通过 /api/setup 初始化创建, 注册一律为普通用户
    const role = 'user';
    try {
        const r = await db.prepare(`INSERT INTO users
            (username, password_hash, salt, role, device_id, daily_limit, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
            .bind(username, hash, salt, role, deviceId, DEFAULT_DAILY_LIMIT, now, now).run();
        return r.meta.last_row_id;
    } catch (e) {
        const msg = String(e);
        if (msg.includes('UNIQUE')) {
            const byName = await getUserByName(db, username);
            if (byName) throw new Error('用户名已存在');
            throw new Error('该设备已注册过账号');
        }
        throw e;
    }
}

export async function loginUser(db, username, password, deviceId, deviceSecret) {
    const user = await getUserByName(db, username);
    if (!user) throw new Error('用户名或密码错误');
    if (user.status === 0) throw new Error('账号已被禁用');
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.password_hash) throw new Error('用户名或密码错误');

    const deviceCheck = await checkDeviceId(deviceSecret, deviceId);
    if (!deviceCheck.ok) throw new Error(deviceCheck.error);
    const device = String(deviceId || "").trim();

    const token = randomHex(32);
    const now = Math.floor(Date.now() / 1000);
    await db.prepare(`INSERT INTO sessions (token, user_id, device_id, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?)`)
        .bind(token, user.id, device, now + SESSION_TTL, now).run();
    return { token, user: publicUser(user) };
}

export async function logoutUser(db, token) {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export async function verifySession(db, token, deviceId) {
    if (!token) return null;
    const now = Math.floor(Date.now() / 1000);
    const device = String(deviceId || "").trim();
    let row;
    if (device) {
        // 客户端带设备标识: token 必须与登录时的设备一致
        row = await db.prepare(`SELECT s.user_id AS sid, u.* FROM sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.token = ? AND s.expires_at > ? AND s.device_id = ?`).bind(token, now, device).first();
    } else {
        // 未带设备标识: 直接拒绝。设备绑定必须生效, 否则 token 可在任意设备复用
        return null;
    }
    if (!row) return null;
    if (row.status === 0) return null;
    return row;
}

/**
 * 用户等级的对外显示名: 管理员 / 会员 / 普通用户。
 * 判定优先级: role=admin > level=vip > 其余为普通用户。
 */
export function displayLevel(u) {
    if (!u) return '普通用户';
    if (u.role === 'admin') return '管理员';
    if (u.level === 'vip') return '会员';
    return '普通用户';
}

export function publicUser(u) {
    return {
        id: u.id,
        username: u.username,
        level: u.level,
        levelLabel: displayLevel(u),
        role: u.role,
        status: u.status,
        dailyLimit: u.daily_limit,
        maxQuality: u.max_quality || DEFAULT_MAX_QUALITY,
        createdAt: u.created_at,
    };
}

// ---------- 限流 ----------

export async function getUsageToday(db, userId) {
    const row = await db.prepare('SELECT count FROM usage_daily WHERE user_id = ? AND date = ?')
        .bind(userId, todayStr()).first();
    return row ? row.count : 0;
}

/**
 * 原子占用一次配额: 单条 SQL 内完成"检查+递增", 消除 check-then-act 竞态
 * @param {D1Database} db
 * @param {number} userId
 * @param {number} limit 当前用户日限额
 * @returns {Promise<boolean>} true=占用成功; false=已达限额
 */
export async function reserveUsage(db, userId, limit) {
    const r = await db.prepare(`INSERT INTO usage_daily (user_id, date, count) VALUES (?, ?, 1)
        ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1 WHERE usage_daily.count < ?`)
        .bind(userId, todayStr(), limit).run();
    // changes>0: 新插入(count=1)或条件更新命中; changes=0: WHERE 未满足, 已超限
    return !!(r.meta && r.meta.changes > 0);
}

/**
 * 纯计数(不限流): 用于 VIP / 管理员, 或任何不需要限额判断的场景。
 * 无条件递增当日调用次数, 与 reserveUsage 写入同一张 usage_daily 表。
 * 注意: 同一请求不要同时调用 reserveUsage 和 countUsage, 否则会重复计数。
 */
export async function countUsage(db, userId) {
    await db.prepare(`INSERT INTO usage_daily (user_id, date, count) VALUES (?, ?, 1)
        ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1`)
        .bind(userId, todayStr()).run();
}

/**
 * 业务失败时回滚一次已占用配额(仅当 reserveUsage 成功过)
 * count>0 兜底, 并发下最坏偏差 ±1, 不影响限流正确性
 */
export async function releaseUsage(db, userId) {
    await db.prepare(`UPDATE usage_daily SET count = count - 1
        WHERE user_id = ? AND date = ? AND count > 0`)
        .bind(userId, todayStr()).run();
}

// ---------- 管理 ----------

export async function listUsers(db, page = 1, size = 20, keyword = "") {
    const offset = (page - 1) * size;
    const today = todayStr();
    const kw = String(keyword || "").trim();
    // keyword 非空时按用户名前缀 或 用户ID精确 全库过滤, 否则全量分页
    // 前缀匹配 (LIKE 'kw%') 可走 idx_users_username 索引; %kw% 中间匹配会退化为全表扫, 如需请上 FTS5
    // 关键字: 纯数字按用户ID精确命中主键; 否则按用户名前缀(走 idx_users_username)
    // 避免 CAST(u.id AS TEXT) 导致主键索引失效
    const isNumKw = /^\d+$/.test(kw);
    let whereSql = "";
    let whereBinds = [];
    if (kw) {
        if (isNumKw) {
            whereSql = "WHERE u.username LIKE ? OR u.id = ?";
            whereBinds = [kw + "%", parseInt(kw, 10)];
        } else {
            whereSql = "WHERE u.username LIKE ?";
            whereBinds = [kw + "%"];
        }
    }
    const total = await db.prepare(`SELECT COUNT(*) AS c FROM users u ${whereSql}`).bind(...whereBinds).first();

    // 1. 先只查 users 分页 (不再对每行跑 4 个相关子查询)
    const rows = await db.prepare(
        `SELECT u.* FROM users u ${whereSql} ORDER BY u.id DESC LIMIT ? OFFSET ?`
    ).bind(...whereBinds, size, offset).all();
    const userList = rows.results || [];

    // 2. 对本页用户批量聚合用量: 一次 IN 查询替代 4×N 次子查询, 与页大小无关
    const usageMap = {};
    const openMap = {};
    const ids = userList.map(function(u){ return u.id; });
    if (ids.length > 0) {
        const ph = ids.map(function(){ return "?"; }).join(",");
        const ud = await db.prepare(
            `SELECT user_id, SUM(CASE WHEN date = ? THEN count ELSE 0 END) AS today,
                SUM(count) AS total FROM usage_daily WHERE user_id IN (${ph}) GROUP BY user_id`
        ).bind(today, ...ids).all();
        for (const r of (ud.results || [])) {
            usageMap[r.user_id] = { today: r.today || 0, total: r.total || 0 };
        }
        const ao = await db.prepare(
            `SELECT user_id, SUM(CASE WHEN date = ? THEN count ELSE 0 END) AS today,
                SUM(count) AS total FROM app_open_daily WHERE user_id IN (${ph}) GROUP BY user_id`
        ).bind(today, ...ids).all();
        for (const r of (ao.results || [])) {
            openMap[r.user_id] = { today: r.today || 0, total: r.total || 0 };
        }
    }

    return {
        total: total ? total.c : 0,
        list: userList.map(function(u){
            const ud = usageMap[u.id] || { today: 0, total: 0 };
            const ao = openMap[u.id] || { today: 0, total: 0 };
            return Object.assign(publicUser(u), {
                apiToday: ud.today,
                apiTotal: ud.total,
                appOpenToday: ao.today,
                appOpenTotal: ao.total,
            });
        }),
    };
}

export async function setUserLevel(db, userId, level) {
    if (!['normal', 'vip'].includes(level)) throw new Error('非法等级');
    await db.prepare('UPDATE users SET level = ?, updated_at = ? WHERE id = ?')
        .bind(level, Math.floor(Date.now() / 1000), userId).run();
}

export async function setUserStatus(db, userId, status) {
    await db.prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
        .bind(status ? 1 : 0, Math.floor(Date.now() / 1000), userId).run();
}

export async function deleteUser(db, userId) {
    await db.batch([
        db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM usage_daily WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM app_open_daily WHERE user_id = ?').bind(userId),
        db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    ]);
}

// 管理视角的完整用户信息(含设备/时间戳)
export function adminUser(u) {
    return {
        id: u.id,
        username: u.username,
        level: u.level,
        levelLabel: displayLevel(u),
        role: u.role,
        status: u.status,
        dailyLimit: u.daily_limit,
        maxQuality: u.max_quality || DEFAULT_MAX_QUALITY,
        deviceId: u.device_id,
        createdAt: u.created_at,
        updatedAt: u.updated_at,
    };
}

export async function getUserDetail(db, userId) {
    const u = await getUserById(db, userId);
    if (!u) return null;
    return adminUser(u);
}

/**
 * 管理员更新用户信息(可部分更新)
 * 支持: username / password / dailyLimit / level / status
 */
export async function updateUserInfo(db, userId, fields = {}) {
    const target = await getUserById(db, userId);
    if (!target) throw new Error('用户不存在');
    if (target.role === 'admin') throw new Error('不能修改管理员信息');

    const sets = [];
    const binds = [];
    let resetSessions = false;

    if (fields.username !== undefined) {
        const name = String(fields.username).trim();
        if (!/^[a-zA-Z0-9_]{3,20}$/.test(name)) throw new Error('用户名需 3-20 位字母、数字或下划线');
        const dup = await getUserByName(db, name);
        if (dup && dup.id !== userId) throw new Error('用户名已被占用');
        sets.push('username = ?');
        binds.push(name);
    }

    if (fields.password) {
        if (String(fields.password).length < 6) throw new Error('密码至少 6 位');
        const salt = randomHex(16);
        const hash = await hashPassword(String(fields.password), salt);
        sets.push('password_hash = ?', 'salt = ?');
        binds.push(hash, salt);
        resetSessions = true;
    }

    if (fields.dailyLimit !== undefined) {
        const lim = parseInt(fields.dailyLimit, 10);
        if (!Number.isInteger(lim) || lim < 1 || lim > 100000) throw new Error('日限额需为 1-100000 的整数');
        sets.push('daily_limit = ?');
        binds.push(lim);
    }

    if (fields.maxQuality !== undefined) {
        const q = String(fields.maxQuality || '').toLowerCase();
        if (QUALITY_LEVELS.indexOf(q) < 0) throw new Error('音质上限需为 ' + QUALITY_LEVELS.join('/') + ' 之一');
        sets.push('max_quality = ?');
        binds.push(q);
    }

    if (fields.level !== undefined) {
        if (!['normal', 'vip'].includes(fields.level)) throw new Error('非法等级');
        sets.push('level = ?');
        binds.push(fields.level);
    }

    if (fields.status !== undefined) {
        sets.push('status = ?');
        binds.push(fields.status ? 1 : 0);
    }

    if (sets.length === 0) throw new Error('没有可更新的字段');

    sets.push('updated_at = ?');
    binds.push(Math.floor(Date.now() / 1000), userId);

    await db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();

    // 改密后强制该用户所有会话失效
    if (resetSessions) {
        await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
    }

    const updated = await getUserById(db, userId);
    return adminUser(updated);
}