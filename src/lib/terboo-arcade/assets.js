// ═══════════════════════════════════════════════
// 🖼️ TERBOO ARCADE — وكيل الأصول البصرية (داخل Mini App فقط)
// ───────────────────────────────────────────────
// سياسة الصور (§6 من خطة الترحيل):
//   • لا تُرسل أي صورة كرسالة واتساب من أي مسار لعبة — إطلاقاً.
//   • الألعاب التي تقوم قواعدها على معرفة صورة (خمن الصورة/العلم/الدراما…) تعرض
//     الأصل **داخل صفحة Mini App على نفس أصل الموقع (same-origin)**.
//   • الصفحة لا ترى عنوان المصدر الأصلي: تستقبل رمزاً موقّعاً قصير العمر فقط،
//     والخادم هو من يجلب البايتات ويعيدها. هذا يحفظ CSP بلا موارد خارجية،
//     ويمنع تسريب مصادر البيانات، ويمنع استخدام البوت كوكيل مفتوح.
// لا يوجد في هذا الملف أي مسار يبني صورة لوحة أو يرسلها في رسالة.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { getDatabase } from "../terboo-database.js";
import { noteFailure } from "../terboo-failure-log.js";

const TTL_MS = 2 * 60 * 60 * 1000;
const SECRET_KEY = "arcade:assetSecret";
const MAX_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
/** أنواع يسمح بها الوكيل — صور ثابتة فقط، لا HTML ولا SVG (SVG ينفّذ سكربت) */
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
/** مضيفات بيانات الأسئلة المسموح جلبها. قائمة مغلقة: الوكيل ليس مفتوحاً. */
const ALLOWED_HOSTS = new Set([
  "flagpedia.net", "www.flagpedia.net",
  "www.cademedia.com", "cademedia.com",
  "i.ibb.co", "telegra.ph", "upload.wikimedia.org", "commons.wikimedia.org",
]);

let memorySecret = null;

function secret() {
  try {
    const store = getDatabase();
    let value = store.setting(SECRET_KEY);
    if (typeof value !== "string" || value.length < 32) {
      value = crypto.randomBytes(32).toString("hex");
      store.setting(SECRET_KEY, value);
    }
    return value;
  } catch (error) {
    noteFailure("arcade-assets", error, { where: "terboo-arcade/assets:secret", stage: "db", fallback: "process-secret" });
    memorySecret ||= crypto.randomBytes(32).toString("hex");
    return memorySecret;
  }
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (body) => crypto.createHmac("sha256", secret()).update(body).digest("base64url").slice(0, 32);

/** هل العنوان أصل أسئلة مقبول؟ (HTTPS + مضيف من القائمة المغلقة) */
function allowedSource(rawUrl) {
  // URL.canParse بدل try/catch: رفض عنوان غير صالح حالة متوقعة لا إخفاق يُسجَّل
  const text = String(rawUrl || "");
  if (!URL.canParse(text)) return null;
  const url = new URL(text);
  if (url.protocol !== "https:") return null;
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null;
  return url;
}

/**
 * رمز أصل موقّع لصورة سؤال، مربوط بجلسة اللعبة.
 * @returns {string} رمز، أو "" إن كان المصدر غير مقبول
 */
function issueAssetToken(sourceUrl, { sessionId = "", ttlMs = TTL_MS } = {}) {
  const url = allowedSource(sourceUrl);
  if (!url) return "";
  const body = b64(JSON.stringify({ u: url.href, s: String(sessionId || ""), e: Date.now() + ttlMs }));
  return `${body}.${sign(body)}`;
}

/** يتحقق من الرمز ⇒ {url, sessionId} أو null */
function verifyAssetToken(token) {
  const text = String(token || "");
  if (text.length > 800) return null;
  const [body, mac] = text.split(".");
  if (!body || !mac) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!data?.u || !(data.e > Date.now())) return null;
    if (!allowedSource(data.u)) return null;
    return { url: String(data.u), sessionId: String(data.s || "") };
  } catch (error) {
    noteFailure("arcade-assets", error, { where: "terboo-arcade/assets:verify", stage: "parse", fallback: "rejected" });
    return null;
  }
}

/**
 * يجلب بايتات الأصل للعرض داخل الصفحة.
 * لا يُستخدم مخرجه في أي رسالة واتساب — المستهلك الوحيد هو مسار HTTP للصفحة.
 * @returns {Promise<{ok:boolean, code?:string, body?:Buffer, type?:string}>}
 */
async function fetchAsset(token) {
  const claims = verifyAssetToken(token);
  if (!claims) return { ok: false, code: "bad-asset-token" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(claims.url, { signal: controller.signal, redirect: "follow", headers: { Accept: "image/*" } });
    if (!res.ok) return { ok: false, code: `upstream-${res.status}` };
    const type = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_TYPES.has(type)) return { ok: false, code: "bad-asset-type" };
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return { ok: false, code: "asset-too-large" };
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > MAX_BYTES) return { ok: false, code: "asset-too-large" };
    return { ok: true, body, type };
  } catch (error) {
    noteFailure("arcade-assets", error, { where: "terboo-arcade/assets:fetchAsset", stage: "fetch", fallback: "no-asset" });
    return { ok: false, code: "asset-fetch-failed" };
  } finally {
    clearTimeout(timer);
  }
}

export { ALLOWED_HOSTS, ALLOWED_TYPES, MAX_BYTES, allowedSource, fetchAsset, issueAssetToken, verifyAssetToken };
