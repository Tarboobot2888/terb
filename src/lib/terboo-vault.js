// ═══════════════════════════════════════════════
// 🗝️ Terboo Vault — تشفير الأسرار المحفوظة (AES-256-GCM)
// ───────────────────────────────────────────────
// يحفظ أسرار المستخدمين (مثل أسرار خوادم SSH) مشفّرة على القرص؛ لا نص صريح أبداً.
//   • المفتاح الرئيسي: config.security.masterKey ⇐ TERBOO_MASTER_KEY ⇐ ملف data/secure/master.key
//     (يُولَّد عشوائياً مرة واحدة بصلاحية 600 إن لم يوجد).
//   • مفتاح لكل سياق بـ HKDF-SHA256 (سياق لكل نوع) ⇒ تسريب سياق لا يكشف غيره.
//   • AES-256-GCM: IV عشوائي 12 بايت + وسم مصادقة 16 بايت؛ AAD يربط النص المشفّر بصاحبه
//     (نقل السر لمستخدم آخر يفشل في الفك).
//   • الصيغة: "tv1:" + base64url(iv | tag | ciphertext)
// لا تشفير مخترع: كل الأدوات من node:crypto.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import config from "../../config.js";
import { registerSecret } from "./terboo-secrets.js";

const PREFIX = "tv1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;
let cachedMaster = null;

function keyFile() {
  return process.env.TERBOO_MASTER_KEY_FILE || path.join(process.cwd(), "data", "secure", "master.key");
}

/** يفك مفتاحاً نصياً (base64/hex/نص عادي) إلى 32 بايت */
function toKeyBytes(text) {
  const value = String(text).trim();
  if (/^[0-9a-f]{64}$/i.test(value)) return Buffer.from(value, "hex");
  const b64 = Buffer.from(value, "base64");
  if (b64.length === 32 && /^[A-Za-z0-9+/_=-]+$/.test(value)) return b64;
  // عبارة مرور: تُشتق إلى 32 بايت (scrypt) — ثابتة لنفس العبارة
  return crypto.scryptSync(value, "terboo-master-key", 32);
}

/**
 * المفتاح الرئيسي (32 بايت). يُقرأ مرة ويُحفظ في الذاكرة فقط.
 * @returns {Buffer}
 */
function masterKey() {
  if (cachedMaster) return cachedMaster;
  const configured = config.security?.masterKey || process.env.TERBOO_MASTER_KEY || "";
  if (configured) {
    registerSecret(configured);
    cachedMaster = toKeyBytes(configured);
    return cachedMaster;
  }
  const file = keyFile();
  if (fs.existsSync(file)) {
    const stored = fs.readFileSync(file, "utf8").trim();
    registerSecret(stored);
    cachedMaster = toKeyBytes(stored);
    return cachedMaster;
  }
  const generated = crypto.randomBytes(32).toString("base64");
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, `${generated}\n`, { mode: 0o600 });
  registerSecret(generated);
  cachedMaster = Buffer.from(generated, "base64");
  return cachedMaster;
}

/** مفتاح سياق مشتق (HKDF-SHA256) */
function contextKey(context, override = null) {
  const base = override ? toKeyBytes(override) : masterKey();
  return Buffer.from(crypto.hkdfSync("sha256", base, Buffer.from("terboo-vault"), Buffer.from(String(context)), 32));
}

/**
 * يشفّر سراً.
 * @param {string} plaintext
 * @param {{context:string, aad?:string, key?:string}} options context مثل "ssh" · aad مثل معرّف المستخدم
 * @returns {string} "tv1:…"
 */
function encryptSecret(plaintext, { context, aad = "", key = null } = {}) {
  if (typeof plaintext !== "string" || !plaintext) throw new Error("vault-empty-secret");
  if (!context) throw new Error("vault-context-required");
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", contextKey(context, key), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(`${context}|${aad}`));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/**
 * يفك سراً مشفّراً. يرمي vault-decrypt-failed عند أي عبث أو مفتاح/صاحب مختلف.
 * @param {string} blob
 * @param {{context:string, aad?:string, key?:string}} options
 * @returns {string}
 */
function decryptSecret(blob, { context, aad = "", key = null } = {}) {
  if (typeof blob !== "string" || !blob.startsWith(PREFIX)) throw new Error("vault-bad-format");
  const raw = Buffer.from(blob.slice(PREFIX.length), "base64url");
  if (raw.length <= IV_BYTES + TAG_BYTES) throw new Error("vault-bad-format");
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", contextKey(context, key), raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(`${context}|${aad}`));
    decipher.setAuthTag(raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
    registerSecret(plain);
    return plain;
  } catch {
    throw new Error("vault-decrypt-failed");
  }
}

/** هل النص سر مشفّر بصيغة الخزنة؟ */
function isSealed(value) {
  return typeof value === "string" && value.startsWith(PREFIX);
}

/** العرض الآمن لسر: نقاط فقط، بلا أي حرف من القيمة */
function maskSecret() {
  return "••••••••••••";
}

/** للاختبارات: تفريغ المفتاح المخزّن مؤقتاً */
function _resetVault() {
  cachedMaster = null;
}

export { _resetVault, decryptSecret, encryptSecret, isSealed, maskSecret, masterKey };
export default { decryptSecret, encryptSecret, isSealed, maskSecret };
