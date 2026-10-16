// ═══════════════════════════════════════════════
// 📜 Terboo Web — سجل تدقيق منقّح للأفعال الحساسة
// ───────────────────────────────────────────────
// يُسجَّل: الفاعل (هوية قانونية) · الفعل · الهدف (معرّف داخلي/رقم مُقنَّع) ·
//          الوقت · النتيجة · معرّف الطلب.
// لا يُسجَّل أبداً: رمز OTP · معرّف جلسة · رمز CSRF · مفتاح API · محتوى ملف ·
//          رقم هاتف كامل · أي قيمة من مخزن الأسرار.
// كل نص يمرّ على redactSecrets قبل الحفظ كطبقة ثانية.
// ═══════════════════════════════════════════════

import { redactSecrets } from "../../lib/terboo-secrets.js";
import { appendAudit, isReady, readAudit } from "../store/web-store.js";
import { maskPhone } from "./identity-service.js";

/** حقول يُمنع ظهورها في التدقيق بأي صورة */
const FORBIDDEN = /^(code|otp|token|csrf|session|sessionId|password|secret|apiKey|authorization|cookie|file|buffer|content)$/i;

function safeDetails(details) {
  if (!details || typeof details !== "object") return null;
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (FORBIDDEN.test(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") {
      // عمق واحد فقط، وبلا بايتات
      if (Buffer.isBuffer(value)) continue;
      out[key] = Array.isArray(value) ? value.slice(0, 10).map((v) => String(v).slice(0, 60)) : "[object]";
      continue;
    }
    out[key] = typeof value === "string" ? redactSecrets(value).slice(0, 200) : value;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * يسجّل فعلاً حساساً.
 * @param {{actor:string, action:string, target?:string, outcome:string,
 *          requestId?:string, details?:Object, targetPhone?:string}} entry
 */
function audit({ actor, action, target = "", outcome, requestId = "", details = null, targetPhone = "" }) {
  if (!isReady()) return null;
  const record = {
    at: Date.now(),
    actor: String(actor || "anonymous"),
    action: String(action || "unknown"),
    target: targetPhone ? maskPhone(targetPhone) : String(target || "").slice(0, 120),
    outcome: String(outcome || "unknown"),
    requestId: String(requestId || "").slice(0, 40),
  };
  const extra = safeDetails(details);
  if (extra) record.details = extra;
  return appendAudit(record);
}

/** يقرأ السجل (للمالك فقط — الصلاحية تُفحص في المسار) */
function auditTrail(options) {
  return isReady() ? readAudit(options) : [];
}

export { audit, auditTrail, safeDetails };
