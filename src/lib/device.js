/**
 * 设备标识签名 (HMAC-SHA256)
 * 格式: <base64url(fingerprint)>.<exp>.<sigHex>
 * 客户端用服务端签发的签名串作为 deviceId, 服务端可校验真伪与有效期,
 * 替代原先可被任意伪造的裸字符串。
 */

function b64urlEncode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s) {
    let t = String(s).replace(/-/g, "+").replace(/_/g, "/");
    while (t.length % 4) t += "=";
    const bin = atob(t);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

async function hmacHex(secret, msg) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(msg));
    return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

const DEVICE_TTL = 30 * 24 * 3600; // 30 天

/**
 * 签发设备标识。fingerprint 由客户端提供(建议为稳定的设备指纹)。
 */
export async function signDeviceId(secret, fingerprint, ttlSec = DEVICE_TTL) {
    if (!secret) throw new Error("DEVICE_SECRET 未配置");
    const fp = String(fingerprint || "").trim();
    if (fp.length < 6 || fp.length > 128) {
        throw new Error("设备指纹格式不合法(需 6-128 字符)");
    }
    const exp = Math.floor(Date.now() / 1000) + ttlSec;
    const payload = b64urlEncode(fp) + "." + exp;
    const sig = await hmacHex(secret, payload);
    return payload + "." + sig;
}

/**
 * 校验设备标识, 返回 { valid, fingerprint }。
 */
export async function verifyDeviceId(secret, token) {
    const t = String(token || "").trim();
    const parts = t.split(".");
    if (parts.length !== 3) return { valid: false, fingerprint: "" };
    const fpPart = parts[0], expPart = parts[1], sig = parts[2];
    if (!fpPart || !expPart || !sig) return { valid: false, fingerprint: "" };
    const exp = parseInt(expPart, 10) || 0;
    if (exp < Math.floor(Date.now() / 1000)) return { valid: false, fingerprint: "" };
    const expect = await hmacHex(secret, fpPart + "." + expPart);
    if (expect !== sig) return { valid: false, fingerprint: "" };
    let fp = "";
    try { fp = b64urlDecode(fpPart); } catch (e) { return { valid: false, fingerprint: "" }; }
    return { valid: true, fingerprint: fp };
}

/**
 * 设备指纹登记表: fingerprint 为主键, 保证同一指纹只保留一个有效签名。
 */
async function ensureDeviceTable(db) {
    await db.prepare(`CREATE TABLE IF NOT EXISTS device_registry (\n        fingerprint TEXT PRIMARY KEY,\n        device_id TEXT NOT NULL,\n        created_at INTEGER,\n        expires_at INTEGER\n    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_device_expires ON device_registry(expires_at)`).run();
}

/**
 * 带指纹去重的设备签名签发:
 * - 同一 fingerprint 在签名有效期内, 直接复用已签发的 deviceId, 不重复签发;
 * - 记录缺失或已过期时才重新签发并覆盖登记。
 * 这样同一台设备/指纹不会产生多个并存的有效签名。
 */
export async function signDeviceIdDedup(db, secret, fingerprint, ttlSec = DEVICE_TTL) {
    if (!secret) throw new Error("DEVICE_SECRET 未配置");
    const fp = String(fingerprint || "").trim();
    if (fp.length < 6 || fp.length > 128) {
        throw new Error("设备指纹格式不合法(需 6-128 字符)");
    }
    if (db) {
        await ensureDeviceTable(db);
        const now = Math.floor(Date.now() / 1000);
        const row = await db.prepare(
            "SELECT device_id, expires_at FROM device_registry WHERE fingerprint = ?"
        ).bind(fp).first();
        // 命中未过期记录: 直接复用, 实现去重
        if (row && row.device_id && row.expires_at > now) {
            return row.device_id;
        }
        const deviceId = await signDeviceId(secret, fp, ttlSec);
        await db.prepare(`INSERT INTO device_registry (fingerprint, device_id, created_at, expires_at)\n            VALUES (?, ?, ?, ?)\n            ON CONFLICT(fingerprint) DO UPDATE SET\n                device_id = excluded.device_id,\n                created_at = excluded.created_at,\n                expires_at = excluded.expires_at`)
            .bind(fp, deviceId, now, now + ttlSec).run();
        return deviceId;
    }
    // 无 DB 时退化为直接签发
    return await signDeviceId(secret, fp, ttlSec);
}

/** 清理过期的设备登记记录 */
export async function cleanStaleDeviceRegistry(db, days = 7) {
    try {
        await ensureDeviceTable(db);
        const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
        const r = await db.prepare("DELETE FROM device_registry WHERE expires_at < ?").bind(cutoff).run();
        return (r.meta && r.meta.changes) || 0;
    } catch (e) {
        console.error("[Device] 清理登记表失败:", e);
        return 0;
    }
}
