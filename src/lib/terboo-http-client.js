// ═══════════════════════════════════════════════
// 🌐 Terboo HTTP Client — طبقة HTTP موحّدة للواجهات الخارجية
// ───────────────────────────────────────────────
//   httpRequest({ url, method, headers, body, timeoutMs, signal, retries, responseType, maxBytes, expect })
//     ⇒ { ok, status, data, headers, error?: { code, message, retryable, host, status } }
// · مهلة إجبارية + AbortSignal خارجي (إلغاء المستخدم/المهمة)
// · إعادة محاولة للقراءات فقط (GET/HEAD) بتراجع أسّي — الكتابة لا تُعاد أبداً (لا عملية مكررة)
// · قاطع دائرة لكل مضيف: فشل متتالٍ ⇒ رفض فوري مؤقت بدل انتظار مهلة كل مرة
// · حد حجم الاستجابة · تحقق نوع المحتوى · تحليل JSON آمن · أخطاء موحّدة بلا أسرار
// ولا يمس fetch العام (تستعمله Baileys نفسها)؛ لمكتبة axios التي تستعملها البلوقنات: installAxiosDefaults.
// ═══════════════════════════════════════════════

import { Agent, interceptors, request } from "undici";
import { noteFailure } from "./terboo-failure-log.js";
import { redactSecrets } from "./terboo-secrets.js";

const DEFAULTS = Object.freeze({ timeoutMs: 30_000, maxBytes: 25 * 1024 * 1024, retries: 2, backoffMs: 400 });
const CIRCUIT = { threshold: 5, openMs: 60_000 };
const READ_METHODS = new Set(["GET", "HEAD"]);
/** حالات عابرة تستحق إعادة محاولة القراءة */
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const circuits = new Map();
/**
 * undici 7: التحويلات عبر interceptor (خيار maxRedirections أُزيل من request). موزّع خاص من نفس نسخة undici
 * (الموزّع العام قد يكون نسخة Node الداخلية بواجهة معالج مختلفة ⇒ «invalid onError method»).
 */
let redirectDispatcher = null;
function dispatcher() {
  redirectDispatcher ||= new Agent({ connections: 64 }).compose(interceptors.redirect({ maxRedirections: 5 }));
  return redirectDispatcher;
}

/** يزيل قيم query الحساسة من رابط قبل أي رسالة/سجل */
function safeUrlText(url) {
  if (!URL.canParse(String(url))) return "invalid-url";
  const u = new URL(String(url));
  for (const key of [...u.searchParams.keys()]) {
    if (/key|token|pass|secret|auth|sig|session|apikey/i.test(key)) u.searchParams.set(key, "***");
  }
  return redactSecrets(`${u.origin}${u.pathname}${u.search}`);
}

function hostOf(url) {
  return URL.canParse(String(url)) ? new URL(String(url)).host.toLowerCase() : "";
}

/** حالة قاطع مضيف (للتشخيص) */
function circuitState(host) {
  const c = circuits.get(host);
  if (!c) return { host, state: "closed", failures: 0 };
  return { host, state: c.openUntil > Date.now() ? "open" : "closed", failures: c.failures, openUntil: c.openUntil || 0 };
}

function recordHost(host, ok) {
  if (!host) return;
  const c = circuits.get(host) || { failures: 0, openUntil: 0 };
  if (ok) {
    c.failures = 0;
    c.openUntil = 0;
  } else {
    c.failures += 1;
    if (c.failures >= CIRCUIT.threshold) c.openUntil = Date.now() + CIRCUIT.openMs;
  }
  circuits.set(host, c);
  while (circuits.size > 2000) circuits.delete(circuits.keys().next().value);
}

function isOpen(host) {
  const c = circuits.get(host);
  return Boolean(c && c.openUntil > Date.now());
}

const httpError = (code, message, extra = {}) => ({ code, message: redactSecrets(String(message || code)).slice(0, 300), ...extra });
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  timer.unref?.();
  signal?.addEventListener?.("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("aborted"), { code: "ABORTED" })); }, { once: true });
});

/** يقرأ الجسم مع حد حجم صارم (يقطع عند التجاوز بدل تحميل كل شيء في الذاكرة) */
async function readLimited(body, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.length;
    if (size > maxBytes) {
      body.destroy?.();
      throw Object.assign(new Error(["too-large", maxBytes].join(":")), { code: "TOO_LARGE" });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * طلب HTTP موحّد.
 * @param {{url:string, method?:string, headers?:Object, body?:any, timeoutMs?:number, signal?:AbortSignal,
 *          retries?:number, responseType?:"json"|"text"|"buffer", maxBytes?:number, expect?:"json"|"text"|"any",
 *          okStatus?:(status:number)=>boolean}} options
 * @returns {Promise<{ok:boolean, status:number, data:any, headers:Object, error?:Object, attempts:number}>}
 */
async function httpRequest(options) {
  const method = String(options.method || "GET").toUpperCase();
  const url = String(options.url || "");
  const host = hostOf(url);
  if (!/^https?:\/\//i.test(url) || !host) return { ok: false, status: 0, data: null, headers: {}, attempts: 0, error: httpError("INVALID_URL", "invalid-url") };
  if (isOpen(host)) return { ok: false, status: 0, data: null, headers: {}, attempts: 0, error: httpError("CIRCUIT_OPEN", ["circuit-open", host].join(":"), { host, retryable: true }) };
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || DEFAULTS.timeoutMs);
  const maxBytes = Math.max(1024, Number(options.maxBytes) || DEFAULTS.maxBytes);
  // الكتابة لا تُعاد أبداً: إعادة POST قد تنفّذ العملية مرتين
  const retries = READ_METHODS.has(method) ? Math.max(0, Math.min(5, options.retries ?? DEFAULTS.retries)) : 0;
  const responseType = options.responseType || (options.expect === "json" ? "json" : "text");
  const okStatus = options.okStatus || ((status) => status >= 200 && status < 300);
  let body = options.body ?? null;
  const headers = { "user-agent": "Mozilla/5.0 (compatible; TerbooBot/5.0)", ...(options.headers || {}) };
  if (body && typeof body === "object" && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    body = JSON.stringify(body);
    headers["content-type"] ||= "application/json";
  }

  let last = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) return { ok: false, status: 0, data: null, headers: {}, attempts: attempt, error: httpError("ABORTED", "aborted", { host }) };
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    try {
      const response = await request(url, { method, headers, body, signal, dispatcher: dispatcher() });
      const raw = await readLimited(response.body, maxBytes);
      const contentType = String(response.headers["content-type"] || "");
      let data = raw;
      if (responseType === "json") {
        if (options.expect === "json" && raw.length && !/json/i.test(contentType) && !/^\s*[[{]/.test(raw.toString("utf8", 0, 64))) {
          throw Object.assign(new Error(["bad-content-type", contentType.split(";")[0] || "unknown"].join(":")), { code: "BAD_CONTENT_TYPE", status: response.statusCode });
        }
        try {
          data = raw.length ? JSON.parse(raw.toString("utf8")) : null;
        } catch {
          throw Object.assign(new Error("bad-json"), { code: "BAD_JSON", status: response.statusCode });
        }
      } else if (responseType === "text") {
        data = raw.toString("utf8");
      }
      if (!okStatus(response.statusCode)) {
        const retryable = RETRY_STATUS.has(response.statusCode);
        last = { ok: false, status: response.statusCode, data, headers: response.headers, attempts: attempt + 1, error: httpError(`HTTP_${response.statusCode}`, `${safeUrlText(url)} → ${response.statusCode}`, { host, status: response.statusCode, retryable }) };
        recordHost(host, response.statusCode < 500);
        if (retryable && attempt < retries) { await sleep(DEFAULTS.backoffMs * 2 ** attempt, options.signal); continue; }
        return last;
      }
      recordHost(host, true);
      return { ok: true, status: response.statusCode, data, headers: response.headers, attempts: attempt + 1 };
    } catch (error) {
      if (options.signal?.aborted) return { ok: false, status: 0, data: null, headers: {}, attempts: attempt + 1, error: httpError("ABORTED", "aborted", { host }) };
      const code = error?.code === "UND_ERR_ABORTED" || error?.name === "TimeoutError" || error?.name === "AbortError" ? "TIMEOUT" : error?.code || "NETWORK";
      const retryable = ["TIMEOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"].includes(code);
      last = { ok: false, status: error?.status || 0, data: null, headers: {}, attempts: attempt + 1, error: httpError(code, `${safeUrlText(url)}: ${error?.message || code}`, { host, retryable }) };
      if (!["BAD_JSON", "BAD_CONTENT_TYPE", "TOO_LARGE"].includes(code)) recordHost(host, false);
      if (retryable && attempt < retries) {
        try {
          await sleep(DEFAULTS.backoffMs * 2 ** attempt, options.signal);
        } catch {
          return { ...last, error: httpError("ABORTED", "aborted", { host }) };
        }
        continue;
      }
      return last;
    }
  }
  return last;
}

let axiosInstalled = false;
/**
 * طبقة موحّدة فوق axios (تستعمله البلوقنات مباشرة في مئات الملفات) بلا تعديل كل ملف:
 * مهلة خمول افتراضية (axios بلا مهلة افتراضياً ⇒ أمر معلّق للأبد) · حد حجم · حد تحويلات
 * · قاطع دائرة لكل مضيف · أخطاء بلا مفاتيح (رابط الطلب يحمل apikey= أحياناً).
 * القيم الصريحة في أي طلب تبقى كما هي.
 */
function installAxiosDefaults(axios, { timeoutMs = 120_000, maxBytes = 200 * 1024 * 1024 } = {}) {
  if (axiosInstalled || !axios?.interceptors) return false;
  axiosInstalled = true;
  axios.defaults.timeout ||= timeoutMs;
  if (!Number.isFinite(axios.defaults.maxContentLength) || axios.defaults.maxContentLength < 0) axios.defaults.maxContentLength = maxBytes;
  axios.defaults.maxRedirects ??= 5;
  axios.interceptors.request.use((config) => {
    const host = hostOf(config.baseURL ? new URL(config.url || "", config.baseURL).href : config.url);
    if (host && isOpen(host)) {
      const error = new Error(["circuit-open", host].join(":"));
      error.code = "CIRCUIT_OPEN";
      throw error;
    }
    return config;
  });
  axios.interceptors.response.use((response) => {
    recordHost(hostOf(response.config?.url), true);
    return response;
  }, (error) => {
    const status = error?.response?.status || 0;
    if (error?.code !== "CIRCUIT_OPEN" && error?.code !== "ERR_CANCELED") recordHost(hostOf(error?.config?.url), status > 0 && status < 500);
    // لا مفاتيح في رسالة الخطأ ولا في الرابط المحفوظ داخله
    if (error?.message) error.message = redactSecrets(error.message);
    if (error?.config?.url) error.config.url = safeUrlText(error.config.url);
    return Promise.reject(error);
  });
  return true;
}

/** للاختبارات */
function _resetHttpClient() {
  circuits.clear();
}

export { CIRCUIT, DEFAULTS, _resetHttpClient, circuitState, httpRequest, installAxiosDefaults, safeUrlText };
export default { httpRequest, installAxiosDefaults, circuitState, safeUrlText };
