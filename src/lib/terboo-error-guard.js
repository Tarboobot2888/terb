// ═══════════════════════════════════════════════
// 🛡️ Terboo Error Guard — أخطاء مصنّفة ومترجمة، بلا Stack Trace للمستخدم (§53)
// ───────────────────────────────────────────────
//  • classifyError(): مهلة · شبكة · حد طلبات · غير موجود · مرفوض · خطأ خادم ·
//    حجم كبير · غير متاح · مدخل غير صالح · خلل داخلي · غير معروف.
//  • userError(): رسالة قصيرة بلغة المستخدم لكل صنف (الخطأ الخام يُسجَّل فقط).
//  • sanitizeForUser(): عند حدّ الإرسال لغير المالك — تُحذف أسطر Stack Trace
//    والمسارات المطلقة، وتُستبدل عبارات الأخطاء التقنية المعروفة (axios/Node/JS)
//    برسالة الصنف المترجمة. رسائل المالك في الخاص تبقى بتفاصيلها للتشخيص.
// ═══════════════════════════════════════════════

import { t } from "./terboo-localization.js";

const KIND_KEYS = {
  timeout: "errors.timeout",
  network: "errors.network",
  rate_limit: "errors.rateLimit",
  not_found: "errors.notFound",
  forbidden: "errors.forbidden",
  server: "errors.server",
  too_large: "errors.tooLarge",
  unavailable: "errors.unavailable",
  invalid_input: "errors.invalidInput",
  internal: "errors.internal",
  unknown: "errors.unknown",
};

const TIMEOUT = /timeout of \d+ms exceeded|\bE?TIMEDOUT\b|ESOCKETTIMEDOUT|provider_timeout|aborted due to timeout|\btimed? ?out\b/i;
const NETWORK = /getaddrinfo\s+(?:ENOTFOUND|EAI_AGAIN)|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket hang up|fetch failed|Network Error/i;
const INTERNAL = /\b(?:TypeError|ReferenceError|SyntaxError|RangeError)\b|Cannot read propert(?:y|ies) of (?:undefined|null)|is not a function|is not defined|Unexpected token|Maximum call stack size exceeded/;
const TOO_LARGE = /\b(?:too large|payload too large|file size|exceeds? (?:the )?(?:maximum|limit)|ERR_FS_FILE_TOO_LARGE)\b/i;
const UNAVAILABLE = /provider_circuit_open|circuit_open|service unavailable|unavailable/i;

function statusOf(error) {
  const direct = Number(error?.response?.status || error?.status || error?.statusCode);
  if (direct >= 100 && direct < 600) return direct;
  const match = String(error?.message ?? error ?? "").match(/status code (\d{3})|\b(\d{3})\b (?:Not Found|Forbidden|Unauthorized|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)/i);
  return match ? Number(match[1] || match[2]) : 0;
}

function kindOfStatus(code) {
  if (code === 429) return "rate_limit";
  if (code === 404 || code === 410) return "not_found";
  if (code === 401 || code === 403) return "forbidden";
  if (code === 413) return "too_large";
  if (code === 400 || code === 422) return "invalid_input";
  if (code === 408 || code === 504) return "timeout";
  if (code === 503) return "unavailable";
  if (code >= 500) return "server";
  return "unknown";
}

/**
 * يصنّف خطأ (كائن أو نص).
 * @returns {{kind:string, code:number}}
 */
function classifyError(error) {
  const text = String(error?.code || "") + " " + String(error?.message ?? error ?? "");
  const code = statusOf(error);
  if (code) return { kind: kindOfStatus(code), code };
  if (TIMEOUT.test(text)) return { kind: "timeout", code: 0 };
  if (NETWORK.test(text)) return { kind: "network", code: 0 };
  if (TOO_LARGE.test(text)) return { kind: "too_large", code: 0 };
  if (UNAVAILABLE.test(text)) return { kind: "unavailable", code: 0 };
  if (INTERNAL.test(text) || error instanceof TypeError || error instanceof ReferenceError || error instanceof SyntaxError) return { kind: "internal", code: 0 };
  return { kind: "unknown", code: 0 };
}

/** رسالة خطأ للمستخدم بلغته (الخطأ الخام للسجل فقط) */
function userError(error, lang = "ar") {
  const { kind, code } = classifyError(error);
  return t(lang, KIND_KEYS[kind] || KIND_KEYS.unknown, { code: code || "" });
}

const STACK_LINE = /^[ \t]*at\s+(?:async\s+)?[^\n]*?(?:\(|\s)(?:file:\/\/|node:|\/|[A-Za-z]:\\)[^\n]*?:\d+(?::\d+)?\)?[ \t]*$\n?/gm;
const ABS_PATH = /(?:file:\/\/)?\/(?:home|root|tmp|usr|var|opt|app|srv|workspace)\/[^\s'"()<>`]+/g;
/** عبارات أخطاء تقنية شائعة كما تطبعها axios / Node / محرك JS */
const PHRASES = [
  { re: /(?:AxiosError:\s*)?Request failed with status code (\d{3})/g, kind: (m) => kindOfStatus(Number(m[1])), code: (m) => Number(m[1]) },
  { re: /(?:\b\w*Error:\s*)?(?:timeout of \d+ms exceeded|connect ETIMEDOUT[^\n]*|ESOCKETTIMEDOUT|provider_timeout(?::\S*)?|The operation was aborted due to timeout)/gi, kind: () => "timeout" },
  { re: /(?:\b\w*Error:\s*)?(?:getaddrinfo (?:ENOTFOUND|EAI_AGAIN)(?: [\w.-]+)?|connect ECONNREFUSED(?: [\d.:]+)?|read ECONNRESET|socket hang up|(?:TypeError: )?fetch failed)/gi, kind: () => "network" },
  { re: /(?:\bError:\s*)?\b(?:TypeError|ReferenceError|SyntaxError|RangeError): [^\n]*/g, kind: () => "internal" },
  { re: /(?:\bError:\s*)?(?:Cannot read propert(?:y|ies) of (?:undefined|null)(?: \(reading '[^']*'\))?|\b[\w$.]+ is not (?:a function|defined)\b|Maximum call stack size exceeded)/g, kind: () => "internal" },
];

/**
 * يجعل نصاً آمناً للمستخدم: بلا Stack Trace ولا مسارات، والأخطاء التقنية المعروفة مصنّفة ومترجمة.
 * @param {string} text
 * @param {"ar"|"en"|"es"} lang
 */
function sanitizeForUser(text, lang = "ar") {
  if (typeof text !== "string" || !text) return text;
  let out = text.replace(STACK_LINE, "");
  for (const phrase of PHRASES) {
    out = out.replace(phrase.re, (...match) => {
      const kind = phrase.kind(match);
      const code = phrase.code ? phrase.code(match) : "";
      return t(lang, KIND_KEYS[kind] || KIND_KEYS.unknown, { code });
    });
  }
  out = out.replace(ABS_PATH, (full) => full.split("/").filter(Boolean).pop() || "");
  return out === text ? text : out.replace(/\n{3,}/g, "\n\n").trimEnd();
}

/** هل في النص أثر تقني لا يجوز أن يصل للمستخدم؟ (للاختبارات) */
function leaksInternals(text) {
  const value = String(text ?? "");
  STACK_LINE.lastIndex = 0;
  return STACK_LINE.test(value) || /\/(?:home|root|tmp)\/\S+\.m?js/.test(value)
    || PHRASES.some((phrase) => { phrase.re.lastIndex = 0; return phrase.re.test(value); });
}

export { KIND_KEYS, classifyError, leaksInternals, sanitizeForUser, userError };
export default { classifyError, userError, sanitizeForUser, leaksInternals };
