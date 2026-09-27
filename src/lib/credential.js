/**
 * 凭证管理工具
 */

/**
 * 解析凭证 JSON
 * @param {string} jsonStr 
 * @returns {object|null}
 */
export function parseCredential(jsonStr) {
    if (!jsonStr) return null;

    try {
        const data = JSON.parse(jsonStr);

        // 解析 extra_fields
        let extraFields = {};
        if (typeof data.extra_fields === "string") {
            try {
                extraFields = JSON.parse(data.extra_fields.replace(/'/g, '"'));
            } catch (e) {
                console.warn("解析 extra_fields 失败:", e);
            }
        } else if (typeof data.extra_fields === "object") {
            extraFields = data.extra_fields;
        }

        return {
            openid: data.openid || "",
            refresh_token: data.refresh_token || "",
            access_token: data.access_token || "",
            expired_at: parseInt(data.expired_at) || 0,
            musicid: String(data.musicid || ""),
            musickey: data.musickey || "",
            unionid: data.unionid || "",
            str_musicid: data.str_musicid || "",
            refresh_key: data.refresh_key || "",
            encrypt_uin: data.encrypt_uin || "",
            login_type: parseInt(data.login_type) || 2,
            musickey_createtime: extraFields.musickeyCreateTime || 0,
            key_expires_in: extraFields.keyExpiresIn || 259200,
        };
    } catch (e) {
        console.error("解析凭证失败:", e);
        return null;
    }
}

/**
 * 确保凭证表存在
 * @param {D1Database} db 
 */
export async function ensureCredentialTable(db) {
    await db.prepare(`
        CREATE TABLE IF NOT EXISTS credentials (
            id INTEGER PRIMARY KEY DEFAULT 1,
            openid TEXT,
            refresh_token TEXT,
            access_token TEXT,
            expired_at INTEGER,
            musicid TEXT,
            musickey TEXT,
            unionid TEXT,
            str_musicid TEXT,
            refresh_key TEXT,
            encrypt_uin TEXT,
            login_type INTEGER DEFAULT 2,
            musickey_createtime INTEGER,
            key_expires_in INTEGER DEFAULT 259200,
            updated_at INTEGER,
            CHECK (id = 1)
        )
    `).run();
}

/**
 * 从数据库获取凭证
 * @param {D1Database} db 
 * @returns {Promise<object|null>}
 */
export async function getCredentialFromDB(db) {
    const result = await db.prepare(
        "SELECT * FROM credentials WHERE id = 1"
    ).first();

    if (!result) return null;

    return {
        openid: result.openid || "",
        refresh_token: result.refresh_token || "",
        access_token: result.access_token || "",
        expired_at: result.expired_at || 0,
        musicid: result.musicid || "",
        musickey: result.musickey || "",
        unionid: result.unionid || "",
        str_musicid: result.str_musicid || "",
        refresh_key: result.refresh_key || "",
        encrypt_uin: result.encrypt_uin || "",
        login_type: result.login_type || 2,
        musickey_createtime: result.musickey_createtime || 0,
        key_expires_in: result.key_expires_in || 259200,
    };
}

/**
 * 保存凭证到数据库
 * @param {D1Database} db 
 * @param {object} credential 
 */
export async function saveCredentialToDB(db, credential) {
    const now = Math.floor(Date.now() / 1000);

    // Check if exists
    const existing = await db.prepare("SELECT id FROM credentials WHERE id = 1").first();

    if (existing) {
        await db.prepare(`
            UPDATE credentials SET 
                openid = ?,
                refresh_token = ?,
                access_token = ?,
                expired_at = ?,
                musicid = ?,
                musickey = ?,
                unionid = ?,
                str_musicid = ?,
                refresh_key = ?,
                encrypt_uin = ?,
                login_type = ?,
                musickey_createtime = ?,
                key_expires_in = ?,
                updated_at = ?
            WHERE id = 1
        `).bind(
            credential.openid,
            credential.refresh_token,
            credential.access_token,
            credential.expired_at,
            credential.musicid,
            credential.musickey,
            credential.unionid,
            credential.str_musicid,
            credential.refresh_key,
            credential.encrypt_uin,
            credential.login_type,
            credential.musickey_createtime,
            credential.key_expires_in,
            now
        ).run();
    } else {
        await db.prepare(`
            INSERT INTO credentials (
                id, openid, refresh_token, access_token, expired_at,
                musicid, musickey, unionid, str_musicid, refresh_key,
                encrypt_uin, login_type, musickey_createtime, key_expires_in, updated_at
            ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            credential.openid,
            credential.refresh_token,
            credential.access_token,
            credential.expired_at,
            credential.musicid,
            credential.musickey,
            credential.unionid,
            credential.str_musicid,
            credential.refresh_key,
            credential.encrypt_uin,
            credential.login_type,
            credential.musickey_createtime,
            credential.key_expires_in,
            now
        ).run();
    }
}

/**
 * 从环境变量同步凭证到数据库
 * 只要 INITIAL_CREDENTIAL 与库中 musickey 不一致就覆盖，解决"改 Secret 不生效"
 * @param {D1Database} db
 * @param {string} envCredential INITIAL_CREDENTIAL 原始字符串
 * @returns {Promise<{synced: boolean, reason: string, credential: object|null}>}
 */
export async function syncCredentialFromEnv(db, envCredential) {
    // 表不存在时先建表,否则首次调用会直接抛
    await ensureCredentialTable(db);

    const current = await getCredentialFromDB(db);

    if (!envCredential) {
        return {
            synced: false,
            reason: current ? "未设置 INITIAL_CREDENTIAL,使用数据库凭证" : "未设置 INITIAL_CREDENTIAL 且数据库为空",
            credential: current
        };
    }

    let parsed = null;
    try {
        parsed = parseCredential(envCredential);
    } catch (e) {
        return { synced: false, reason: `INITIAL_CREDENTIAL 解析异常: ${e.message}`, credential: current };
    }

    if (!parsed) {
        return { synced: false, reason: "INITIAL_CREDENTIAL 解析失败(JSON 格式无效)", credential: current };
    }
    if (!parsed.musicid || !parsed.musickey) {
        return { synced: false, reason: "INITIAL_CREDENTIAL 缺少 musicid 或 musickey", credential: current };
    }
    if (current && current.musickey === parsed.musickey) {
        return { synced: false, reason: "数据库凭证已是最新", credential: current };
    }

    await saveCredentialToDB(db, parsed);
    return { synced: true, reason: "已从 INITIAL_CREDENTIAL 同步到数据库", credential: parsed };
}

/**
 * 统一凭证获取入口:各 API 直接 import 这个,不要再各自实现
 * @param {object} env Workers 环境(需含 DB,可选 INITIAL_CREDENTIAL)
 * @returns {Promise<object|null>}
 */
export async function getCredential(env) {
    if (!env || !env.DB) return null;
    const sync = await syncCredentialFromEnv(env.DB, env.INITIAL_CREDENTIAL);
    return sync.credential;
}
