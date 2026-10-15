// ═══════════════════════════════════════════════
// 🪪 Terboo Web — خدمة الهوية القانونية لقناة الويب
// ───────────────────────────────────────────────
// تستعمل terboo-identity.js الحقيقي ولا تعيد تنفيذ أي تطبيع:
//   • رقم يكتبه الزائر ⇒ normalizePhone (E.164 بلا +) بدولة رقم البوت كمرجع للصيغ المحلية.
//   • الرقم ⇒ معرّف قابل للإرسال عبر jidFromDigits + sendableJid (لا PN مختلق أبداً).
//   • الهوية القانونية canonical = "pn:<digits>" هي مفتاح كل ما يملكه الموقع.
//   • مفتاح قاعدة بيانات البوت هو الأرقام وحدها (Database.getUser يقصّ @…) ⇒ نشتقّه
//     من الهوية لا من مدخل المتصفح.
// لا تُستنتج هوية من جسم الطلب أبداً: المصدر الوحيد هو جلسة موقَّعة أو تحدٍّ ناجح.
// ═══════════════════════════════════════════════

import config from "../../../config.js";
import { identityOf, jidFromDigits, normalizePhone, sendableJid } from "../../lib/terboo-identity.js";

/** مرجع الدولة للصيغ المحلية: رقم البوت ثم أول رقم مالك */
function phoneOptions() {
  return {
    referenceNumber:
      config.bot?.number || config.bot?.primaryNumber || config.owner?.number?.[0] || "",
  };
}

/**
 * رقم يكتبه الزائر ⇒ أرقام E.164 بلا «+»، أو "" إن لم يُطبَّع بثقة.
 * الرفض آمن: لا تخمين ولا مطابقة جزئية.
 */
function normalizeInputPhone(raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.length > 32) return "";
  // تُسمح الأرقام والفواصل الشكلية و«+» فقط
  if (!/^[+0-9\s().-]+$/.test(value)) return "";
  return normalizePhone(value, phoneOptions());
}

/**
 * هوية كاملة من أرقام E.164.
 * @returns {{digits:string, pn:string, canonical:string, sendable:string, dbKey:string}|null}
 */
function identityFromDigits(digits) {
  const clean = String(digits || "").replace(/[^0-9]/g, "");
  if (!/^\d{6,15}$/.test(clean)) return null;
  // jidFromDigits يحترم ربط LID⇄PN المتعلَّم: رقم معروف كـLID يُعاد بصورته الحقيقية
  const jid = jidFromDigits(clean);
  const id = identityOf(jid);
  const pn = id.pn || `${clean}@s.whatsapp.net`;
  const canonical = id.canonical || `pn:${clean}`;
  return {
    digits: id.number || clean,
    pn,
    canonical,
    sendable: sendableJid(pn),
    // مفتاح Database.getUser/setUser: الأرقام وحدها
    dbKey: id.number || clean,
  };
}

/** هوية من رقم يكتبه الزائر (تطبيع ثم اشتقاق) */
function identityFromInput(raw) {
  const digits = normalizeInputPhone(raw);
  return digits ? identityFromDigits(digits) : null;
}

/** هوية من canonical محفوظ في جلسة ("pn:2010…") */
function identityFromCanonical(canonical) {
  const value = String(canonical || "");
  const match = value.match(/^pn:(\d{6,15})$/);
  if (!match) return null;
  return identityFromDigits(match[1]);
}

/** رقم مُقنَّع للعرض: آخر أربعة أرقام فقط (سجلّات المالك والواجهة) */
function maskPhone(digits) {
  const clean = String(digits || "").replace(/[^0-9]/g, "");
  if (clean.length <= 4) return "•".repeat(clean.length);
  return `${"•".repeat(Math.max(2, clean.length - 4))}${clean.slice(-4)}`;
}

export {
  identityFromCanonical,
  identityFromDigits,
  identityFromInput,
  maskPhone,
  normalizeInputPhone,
  phoneOptions,
};
