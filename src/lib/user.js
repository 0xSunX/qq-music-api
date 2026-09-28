/**
 * 用户系统 - 注册 / 登录 / 会话 / 分级 / 限流 / 管理
 */

const PBKDF2_ITER = 100000;
const SESSION_TTL = 30 * 24 * 3600;   // 30 天
const DEFAULT_DAILY_LIMIT = 50;

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

export async function ensureUserTables(db) {
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
        created_at INTEGER,
        updated_at INTEGER
    )`).run();
    await db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_device ON users(device_id)`).run();
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

export async function registerUser(db, username, password, deviceId) {
    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        throw new Error('用户名需 3-20 位字母、数字或下划线');
    }
    if (!password || password.length < 6) {
        throw new Error('密码至少 6 位');
    }
    if (!deviceId) {
        throw new Error('缺少设备标识');
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

export async function loginUser(db, username, password, deviceId) {
    const user = await getUserByName(db, username);
    if (!user) throw new Error('用户名或密码错误');
    if (user.status === 0) throw new Error('账号已被禁用');
    const hash = await hashPassword(password, user.salt);
    if (hash !== user.password_hash) throw new Error('用户名或密码错误');

    const device = String(deviceId || "").trim();
    if (!device) throw new Error('缺少设备标识');

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

export function publicUser(u) {
    return {
        id: u.id,
        username: u.username,
        level: u.level,
        role: u.role,
        status: u.status,
        dailyLimit: u.daily_limit,
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

export async function listUsers(db, page = 1, size = 20) {
    const offset = (page - 1) * size;
    const total = await db.prepare('SELECT COUNT(*) AS c FROM users').first();
    const today = todayStr();
    const rows = await db.prepare(`SELECT u.*,
        (SELECT COUNT FROM usage_daily WHERE user_id = u.id AND date = ?) AS api_today,
        (SELECT COALESCE(SUM(count),0) FROM usage_daily WHERE user_id = u.id) AS api_total,
        (SELECT COUNT FROM app_open_daily WHERE user_id = u.id AND date = ?) AS open_today,
        (SELECT COALESCE(SUM(count),0) FROM app_open_daily WHERE user_id = u.id) AS open_total
        FROM users u ORDER BY u.id DESC LIMIT ? OFFSET ?`)
        .bind(today, today, size, offset).all();
    return {
        total: total ? total.c : 0,
        list: (rows.results || []).map(function(u){
            return Object.assign(publicUser(u), {
                apiToday: u.api_today || 0,
                apiTotal: u.api_total || 0,
                appOpenToday: u.open_today || 0,
                appOpenTotal: u.open_total || 0,
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
        db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
    ]);
}

// 管理视角的完整用户信息(含设备/时间戳)
export function adminUser(u) {
    return {
        id: u.id,
        username: u.username,
        level: u.level,
        role: u.role,
        status: u.status,
        dailyLimit: u.daily_limit,
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