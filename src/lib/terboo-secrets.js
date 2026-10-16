// ═══════════════════════════════════════════════
// 🔐 Terboo Secrets — سجل الأسرار وإخفاؤها في كل مخرج
// ───────────────────────────────────────────────
// أي قيمة سرية (مفاتيح API · كلمات مرور · توكنات لوحات · مفتاح التشفير) تُسجَّل هنا مرة،
// ثم تُستبدل بـ«••••» أينما ظهرت: السجلات والطرفية · سجل الإخفاقات · الرسائل الصادرة ·
// سياق الذكاء الاصطناعي والذاكرة · التقارير والتشخيص.
//
//   registerSecret(value)        ← قيمة سرية تُخفى حرفياً (8 أحرف فأكثر)
//   redactSecrets(text)          ← نص بعد إخفاء كل سر مسجّل + أنماط التوكنات المعروفة
//   redactDeep(value)            ← نسخة من كائن/مصفوفة بنصوص مُخفاة
//   installConsoleRedaction()    ← console.* لا يطبع سراً أبداً
//   registerConfigSecrets(cfg)   ← كل أسرار config.js (APIkey · secrets · webSessions …)
// ═══════════════════════════════════════════════

const MASK = "••••••••";
const MIN_LENGTH = 8;
const secrets = new Set();
let pattern = null;

/** توكنات Pterodactyl: تُخفى في كل مكان حتى الرسائل الصادرة (حتى لو لصقها المستخدم بنفسه) */
const PANEL_TOKEN = /\bptl[acr]_[A-Za-z0-9]{20,}\b/g;
/** أنماط عامة للسجلات وسياق الذكاء (معاملات الاستعلام · الترويسات · key: "value") — لا تُطبَّق على نص الرسائل حتى لا تُشوَّه أمثلة الكود */
const TOKEN_PATTERNS = [
  PANEL_TOKEN,
  /([?&](?:apikey|apipass|adminapikey|adminapipass|api_key|api_pass|token|access_token|key|password|pass)=)[^&\s"'<>]+/gi,
  /(\bauthorization\s*[:=]\s*(?:bearer|basic)\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
  /(\b(?:apiPassword|apiKey|apikey|apipass|encryptionKey|masterKey|password|secret|token)\b["']?\s*[:=]\s*["'])[^"'\n]{6,}(["'])/gi,
];

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rebuild() {
  const list = [...secrets].sort((a, b) => b.length - a.length).map(escapeRe);
  pattern = list.length ? new RegExp(list.join("|"), "g") : null;
}

/**
 * يسجّل قيمة سرية لتُخفى في كل المخرجات.
 * @param {unknown} value
 * @returns {boolean} هل سُجّلت
 */
function registerSecret(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < MIN_LENGTH || secrets.has(text)) return false;
  secrets.add(text);
  rebuild();
  return true;
}

/** يزيل سراً من السجل (عند حذف لوحة مستخدم مثلاً) */
function forgetSecret(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (secrets.delete(text)) rebuild();
}

/** هل يحتوي النص سراً مسجّلاً؟ (للاختبارات وحراسة الذاكرة) */
function containsSecret(text) {
  if (typeof text !== "string" || !text) return false;
  if (pattern) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return TOKEN_PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

/**
 * نص بعد إخفاء كل الأسرار المسجّلة وأنماط التوكنات المعروفة.
 * @param {unknown} text
 * @param {{generic?:boolean}} [options] generic=false للرسائل الصادرة: الأسرار المسجّلة وتوكنات اللوحات فقط
 * @returns {unknown} النص المُخفى (وغير النص كما هو)
 */
function redactSecrets(text, { generic = true } = {}) {
  if (typeof text !== "string" || !text) return text;
  let out = text;
  if (pattern) out = out.replace(pattern, MASK);
  for (const re of generic ? TOKEN_PATTERNS : [PANEL_TOKEN]) {
    re.lastIndex = 0;
    out = out.replace(re, (match, ...groups) => {
      const prefix = typeof groups[0] === "string" ? groups[0] : "";
      const suffix = typeof groups[1] === "string" && groups[1].length === 1 ? groups[1] : "";
      return prefix ? `${prefix}${MASK}${suffix}` : MASK;
    });
  }
  return out;
}

/** نسخة عميقة بنصوص مُخفاة (حد عمق لتفادي الحلقات) */
function redactDeep(value, depth = 0) {
  if (typeof value === "string") return redactSecrets(value);
  if (!value || typeof value !== "object" || depth > 6 || Buffer.isBuffer(value)) return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = redactDeep(item, depth + 1);
  return out;
}

let consoleInstalled = false;
/** console.log/info/warn/error/debug لا تطبع أي سر مسجّل */
function installConsoleRedaction() {
  if (consoleInstalled) return;
  consoleInstalled = true;
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => original(...args.map((arg) => {
      if (typeof arg === "string") return redactSecrets(arg);
      if (arg instanceof Error) {
        const copy = new Error(redactSecrets(arg.message));
        copy.stack = redactSecrets(arg.stack || "");
        return copy;
      }
      return arg;
    }));
  }
}

/** كل الأسرار المعروفة في config.js + البيئة */
function registerConfigSecrets(cfg = {}, env = process.env) {
  const values = [];
  values.push(cfg.security?.masterKey);
  for (const value of Object.values(cfg.APIkey || {})) values.push(value);
  for (const value of Object.values(cfg.webSessions || {})) values.push(value);
  values.push(cfg.geminiApiKey);
  // قسم config.secrets الموحّد: كل مفاتيح المزوّدات في مكان واحد.
  // تسجيلها هنا شرط — بدونه تظهر قيمها في السجلات ورسائل الأخطاء.
  for (const value of Object.values(cfg.secrets || {})) values.push(value);
  for (const name of ["TERBOO_MASTER_KEY", "ANTHROPIC_API_KEY", "GROQ_API_KEY", "GOOGLE_API_KEY", "OPENAI_API_KEY", "NVIDIA_API_KEY"]) values.push(env[name]);
  let count = 0;
  for (const value of values) if (registerSecret(value)) count += 1;
  return count;
}

/** عدد الأسرار المسجّلة (للتشخيص — بلا القيم) */
function secretCount() {
  return secrets.size;
}

function _resetSecrets() {
  secrets.clear();
  rebuild();
}

export { MASK, _resetSecrets, containsSecret, forgetSecret, installConsoleRedaction, redactDeep, redactSecrets, registerConfigSecrets, registerSecret, secretCount };
export default { MASK, containsSecret, forgetSecret, installConsoleRedaction, redactDeep, redactSecrets, registerConfigSecrets, registerSecret, secretCount };
