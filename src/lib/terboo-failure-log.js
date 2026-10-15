// ═══════════════════════════════════════════════
// 🧾 Terboo Failure Log — لا إخفاق صامت (v4 §31)
// ───────────────────────────────────────────────
// كل catch كان يبتلع الخطأ في مسارات الإرسال والذكاء والـscrapers والبلوقنات يمر من هنا:
//   الخطأ · المكان (ملف:سطر) · المرحلة · الهدف · القائمة · نوع الحمولة · البديل.
// السلوك لم يتغيّر (الخطأ ما زال لا يُسقط المسار)، لكنه صار مسجَّلاً ومرئياً للمالك
// («ابحث عن مشكلة» تعرض آخر الإخفاقات). التكرار نفسه يُطبع مرة كل 5 دقائق فقط.
// ═══════════════════════════════════════════════

import { redactSecrets } from "./terboo-secrets.js";

const RING_SIZE = 300;
const DEDUPE_MS = 5 * 60 * 1000;

if (!global.terbooFailures) global.terbooFailures = { list: [], printed: new Map(), total: 0 };
const state = global.terbooFailures;

/** نص قصير آمن من أي قيمة — حتى كائن يرمي من toString (المسجِّل لا يرمي أبداً) */
function short(value, max = 160) {
  let text;
  try {
    // لا سر في سجل الإخفاقات أبداً (مفاتيح · كلمات مرور · توكنات لوحات)
    text = redactSecrets(String(value ?? ""));
  } catch (conversionError) {
    text = `[unprintable value: ${conversionError?.message ? "toString threw" : "?"}]`;
  }
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * يسجّل إخفاقاً غير مميت. لا يرمي أبداً ويعيد undefined (بديل آمن لـcatch فارغ).
 * @param {string} scope الملف أو النظام (handler · menu-delivery · plugin:اسم…)
 * @param {unknown} error
 * @param {{where?:string, stage?:string, target?:string, menu?:string, payload?:string, fallback?:string}} [meta]
 */
function noteFailure(scope, error, meta = {}) {
  try {
    let raw;
    try {
      raw = error?.message || error || "unknown error";
    } catch (accessError) {
      raw = `[unreadable error: ${short(accessError?.message)}]`;
    }
    const message = short(raw, 200);
    const entry = {
      at: Date.now(),
      scope: short(scope, 60),
      message,
      ...(error?.code ? { code: short(error.code, 40) } : {}),
      ...Object.fromEntries(Object.entries(meta).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => [key, short(value, 120)])),
    };
    state.total += 1;
    state.list.push(entry);
    if (state.list.length > RING_SIZE) state.list.splice(0, state.list.length - RING_SIZE);
    const key = `${entry.scope}|${entry.where || ""}|${message}`;
    const last = state.printed.get(key) || 0;
    if (entry.at - last > DEDUPE_MS) {
      state.printed.set(key, entry.at);
      if (state.printed.size > 2000) state.printed.clear();
      const details = ["stage", "target", "menu", "payload", "fallback", "where"].filter((field) => entry[field]).map((field) => `${field}=${entry[field]}`).join(" · ");
      console.warn(`[${entry.scope}] ${message}${details ? ` · ${details}` : ""}`);
    }
  } catch (loggingError) {
    // التسجيل نفسه لا يجوز أن يكسر المسار — آخر ملاذ: سطر خام
    console.warn(`[failure-log] ${short(scope)}: ${short(error?.message || error)} (${short(loggingError?.message)})`);
  }
  return undefined;
}

/** آخر الإخفاقات المسجّلة (للمالك والاختبارات) */
function recentFailures(limit = 20, { scope = "" } = {}) {
  return state.list.filter((entry) => !scope || entry.scope === scope).slice(-limit).map((entry) => ({ ...entry }));
}

/** إجمالي الإخفاقات منذ التشغيل */
function failureCount() {
  return state.total;
}

function _resetFailures() {
  state.list.length = 0;
  state.printed.clear();
  state.total = 0;
}

export { _resetFailures, failureCount, noteFailure, recentFailures };
export default { noteFailure, recentFailures, failureCount };
