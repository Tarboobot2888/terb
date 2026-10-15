// ═══════════════════════════════════════════════
// 📲 Terboo Web — إثبات ملكية رقم واتساب (تسجيل دخول الموقع)
// ───────────────────────────────────────────────
// هذا ليس src/lib/terboo-otp-service.js: ذاك يتكامل مع خدمة استئجار أرقام
// خارجية ولا علاقة له بالمصادقة. وهذا الملف لا يستعمل plugins/owner/internetrakyat.js
// ولا أي خدمة طرف ثالث لإرسال رموز.
//
// العقد الأمني الذي يفرضه هذا الملف:
//   • الرمز 6 أرقام من crypto.randomInt — لا Math.random.
//   • لا يُخزَّن الرمز أبداً: HMAC-SHA256 فقط، والمقارنة ثابتة الوقت.
//   • استعمال واحد · صلاحية قصيرة · عدّاد محاولات · تحدٍّ يُبطل بعد النجاح أو الانتهاء.
//   • الإرسال عبر مقبس واتساب الحقيقي (getSocket) وطبقة النقل المركزية.
//     فشل الإرسال ⇒ فشل صريح. لا نقول «أُرسل الرمز» إلا إذا أُرسل فعلاً.
//   • لا تعداد حسابات: الرد نفسه ونفس الزمن تقريباً لرقم مسجّل وغير مسجّل.
//   • الرمز لا يُسجَّل ولا يُعاد في أي رد ولا يصل أي واجهة مالك.
//   • التحديات في الذاكرة فقط: لا تُكتب على القرص بأي صورة.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { noteFailure } from "../../lib/terboo-failure-log.js";
import { send as transportSend } from "../../lib/terboo-transport.js";
import { websiteConfig } from "../config.js";
import { apiError } from "../errors.js";
import { hmac, safeEqualHex } from "./secret-store.js";
import * as limits from "./rate-limit-service.js";

/**
 * مصدر المقبس. يُحمَّل src/connection.js تحميلاً متأخراً لأن استيراده له أثر جانبي
 * (readline على stdin يُبقي العملية حيّة) فلا يصلح استيراداً ساكناً في وحدة خدمة.
 * الاختبارات تحقن مقبساً مزيّفاً عبر setSocketProvider — ولا يوجد fallback مزيّف
 * في الإنتاج: بغير مقبس حقيقي يفشل الإرسال فشلاً صريحاً.
 */
let socketProvider = null;

function setSocketProvider(provider) {
  socketProvider = typeof provider === "function" ? provider : null;
}

async function currentSocket() {
  if (socketProvider) return socketProvider();
  const mod = await import("../../connection.js");
  return mod.isConnected() ? mod.getSocket() : null;
}

/** التحديات القائمة: challengeId ⇒ سجل. ذاكرة فقط، تُنظَّف دورياً. */
const challenges = new Map();
let sweeper = null;

function startSweeper() {
  if (sweeper) return;
  sweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, record] of challenges) {
      if (record.expiresAt <= now) challenges.delete(id);
    }
  }, 30_000);
  if (sweeper.unref) sweeper.unref();
}

/** رمز 6 أرقام عشوائي آمن (000000–999999 بتوزيع منتظم) */
function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

/** مفتاح تعمية للرقم: يُستعمل في الحدود والسجلات بدل الرقم الصريح */
const phoneKey = (digits) => hmac(digits, "phone").slice(0, 32);

/** نص الرسالة بلغة الزائر — رسالة واحدة لكل تحدٍّ */
function codeMessage(code, lang = "ar") {
  if (lang === "en") {
    return [
      "*Bot Terboo Web — sign-in code*",
      "",
      `Your code: *${code}*`,
      "",
      `It expires in ${Math.round(websiteConfig().limits.otp.codeTtlSeconds / 60)} minutes and can be used once.`,
      "If you did not request it, ignore this message and do not share the code with anyone.",
    ].join("\n");
  }
  if (lang === "es") {
    return [
      "*Bot Terboo Web — código de acceso*",
      "",
      `Tu código: *${code}*`,
      "",
      `Caduca en ${Math.round(websiteConfig().limits.otp.codeTtlSeconds / 60)} minutos y se usa una sola vez.`,
      "Si no lo solicitaste, ignora este mensaje y no compartas el código con nadie.",
    ].join("\n");
  }
  return [
    "*Bot Terboo Web — رمز تسجيل الدخول*",
    "",
    `رمزك: *${code}*`,
    "",
    `صالح ${Math.round(websiteConfig().limits.otp.codeTtlSeconds / 60)} دقائق ويُستعمل مرة واحدة.`,
    "إن لم تطلبه فتجاهل هذه الرسالة، ولا تشارك الرمز مع أي شخص.",
  ].join("\n");
}

/**
 * يرسل الرمز فعلاً عبر مقبس البوت.
 * @returns {Promise<{ok:boolean, reason?:string}>}
 */
async function deliverCode(identity, code, lang) {
  const sock = await currentSocket();
  if (!sock) return { ok: false, reason: "bot-offline" };

  // الرقم موجود على واتساب فعلاً؟ تحقّق رسمي قبل الإرسال.
  // تعذُّر الفحص لا يُسقط المحاولة (قد تمنعه حالة الشبكة)، لكن غياباً مؤكداً يُوقفها.
  try {
    if (typeof sock.onWhatsApp === "function") {
      const found = await sock.onWhatsApp(identity.sendable);
      const hit = Array.isArray(found) ? found[0] : found;
      if (hit && hit.exists === false) return { ok: false, reason: "not-on-whatsapp" };
    }
  } catch (error) {
    noteFailure("web-otp", error, { where: "src/web/services/otp-service.js:deliverCode", stage: "onWhatsApp", fallback: "attempt-send" });
  }

  const outcome = await transportSend(sock, identity.sendable, { text: codeMessage(code, lang) });
  if (!outcome?.ok) return { ok: false, reason: "delivery-failed" };
  return { ok: true };
}

/**
 * ① طلب رمز.
 * الرد لا يكشف أبداً هل الرقم مسجّل في البوت أو موجود على واتساب.
 * @param {{identity:Object, ip:string, lang?:string}} input
 * @returns {Promise<{challengeId:string, expiresInSeconds:number, resendAfterSeconds:number}>}
 */
async function requestCode({ identity, ip, lang = "ar" }) {
  startSweeper();
  const site = websiteConfig();
  const otp = site.limits.otp;
  const key = phoneKey(identity.digits);

  // الحدود قبل أي عمل: عنوان · رقم · النظام كله
  await limits.otpPerIp(ip);
  await limits.otpPerPhone(key);
  await limits.otpGlobal();

  // تهدئة إعادة الإرسال: تُحسب من آخر تحدٍّ حيّ لنفس الرقم
  const now = Date.now();
  for (const record of challenges.values()) {
    if (record.phoneKey !== key || record.expiresAt <= now) continue;
    const wait = Math.ceil((record.createdAt + otp.resendCooldownSeconds * 1000 - now) / 1000);
    if (wait > 0) throw apiError("RATE_LIMITED", { details: { retryAfterSeconds: wait } });
    // تحدٍّ أقدم لنفس الرقم يُبطل: رمز واحد صالح في كل لحظة
    record.expiresAt = 0;
  }

  const challengeId = crypto.randomBytes(18).toString("base64url");
  const code = generateCode();
  const record = {
    phoneKey: key,
    canonical: identity.canonical,
    digits: identity.digits,
    // الرمز لا يُحفظ: بصمته فقط، مرتبطة بهذا التحدي وحده
    codeHash: hmac(code, `otp:${challengeId}`),
    createdAt: now,
    expiresAt: now + otp.codeTtlSeconds * 1000,
    attempts: 0,
    maxAttempts: otp.maxAttemptsPerChallenge,
    used: false,
    lang,
  };
  challenges.set(challengeId, record);

  const delivery = await deliverCode(identity, code, lang);
  if (!delivery.ok) {
    // لا نترك تحدياً حياً لرمز لم يُسلَّم
    challenges.delete(challengeId);
    if (delivery.reason === "bot-offline") throw apiError("BOT_OFFLINE");
    // رقم غير موجود على واتساب أو فشل تسليم: رد موحّد لا يميّز بينهما
    throw apiError("SERVICE_UNAVAILABLE", {
      message: "The code could not be delivered to that number on WhatsApp.",
    });
  }

  return {
    challengeId,
    expiresInSeconds: otp.codeTtlSeconds,
    resendAfterSeconds: otp.resendCooldownSeconds,
  };
}

/**
 * ② التحقق من الرمز.
 * @returns {{canonical:string, digits:string, lang:string}} هوية مُثبتة
 */
function verifyCode({ challengeId, code, ip }) {
  const id = String(challengeId || "");
  const supplied = String(code || "").replace(/[^0-9]/g, "");
  const record = challenges.get(id);
  const now = Date.now();

  // رسالة واحدة لكل الحالات غير الصالحة: لا تمييز بين تحدٍّ مجهول ومنتهٍ
  const invalid = () => apiError("INVALID_INPUT", { message: "The code is wrong or has expired. Request a new one." });

  if (!record || record.used || record.expiresAt <= now) {
    if (record) challenges.delete(id);
    throw invalid();
  }
  if (supplied.length !== 6) {
    record.attempts += 1;
    if (record.attempts >= record.maxAttempts) challenges.delete(id);
    throw invalid();
  }

  record.attempts += 1;
  if (record.attempts > record.maxAttempts) {
    challenges.delete(id);
    throw invalid();
  }

  const expected = record.codeHash;
  const actual = hmac(supplied, `otp:${id}`);
  if (!safeEqualHex(expected, actual)) {
    if (record.attempts >= record.maxAttempts) challenges.delete(id);
    throw invalid();
  }

  // نجاح ⇒ التحدي يُبطل فوراً (استعمال واحد)
  record.used = true;
  challenges.delete(id);
  return { canonical: record.canonical, digits: record.digits, lang: record.lang };
}

/** إحصاءات تشغيلية بلا أي رقم أو رمز */
function otpStats() {
  const now = Date.now();
  let live = 0;
  for (const record of challenges.values()) if (record.expiresAt > now && !record.used) live++;
  return { liveChallenges: live, tracked: challenges.size };
}

/** للاختبارات: يصفّر التحديات */
function _resetChallenges() {
  challenges.clear();
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
}

export { _resetChallenges, codeMessage, generateCode, otpStats, phoneKey, requestCode, setSocketProvider, verifyCode };
