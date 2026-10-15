// ═══════════════════════════════════════════════
// 🩺 صحة مزوّدات الذكاء (§11): مهلة · حالة · عدّاد فشل · تبريد · زمن استجابة
// ───────────────────────────────────────────────
// • قاطع دائرة: 3 إخفاقات متتالية ⇒ المزوّد يُتخطّى فوراً لمدة التبريد (لا انتظار مزوّد ميت).
// • المهلة محدودة لكل نداء؛ انتهاؤها يُحسب فشلاً.
// • زمن الاستجابة يُتابَع بمتوسط متحرك (EWMA) لترتيب البدائل الأسرع أولاً.
// ═══════════════════════════════════════════════

const providers = new Map();
const FAILURE_LIMIT = 3;
const COOLDOWN_MS = 60 * 1000;
const EWMA_WEIGHT = 0.3;

function state(name) {
  if (!providers.has(name)) {
    providers.set(name, {
      name, calls: 0, successes: 0, failures: 0, consecutiveFailures: 0, lastError: "",
      blockedUntil: 0, latencyMs: null, lastLatencyMs: null, lastSuccessAt: null, lastFailureAt: null,
      inFlight: 0, updatedAt: Date.now(),
    });
  }
  return providers.get(name);
}

function canUseProvider(name) {
  const item = state(name);
  return { allowed: item.blockedUntil <= Date.now(), retryAt: item.blockedUntil || null };
}

function reportProviderSuccess(name, latencyMs = null) {
  const item = state(name);
  item.calls += 1;
  item.successes += 1;
  item.failures = 0;
  item.consecutiveFailures = 0;
  item.lastError = "";
  item.blockedUntil = 0;
  item.lastSuccessAt = Date.now();
  if (Number.isFinite(latencyMs)) {
    item.lastLatencyMs = latencyMs;
    item.latencyMs = item.latencyMs === null ? latencyMs : Math.round(item.latencyMs * (1 - EWMA_WEIGHT) + latencyMs * EWMA_WEIGHT);
  }
  item.updatedAt = Date.now();
  return { ...item };
}

function reportProviderFailure(name, error, latencyMs = null) {
  const item = state(name);
  item.calls += 1;
  item.failures += 1;
  item.consecutiveFailures += 1;
  item.lastError = String(error?.message || error || "unknown_failure").slice(0, 180);
  item.lastFailureAt = Date.now();
  if (Number.isFinite(latencyMs)) item.lastLatencyMs = latencyMs;
  if (item.consecutiveFailures >= FAILURE_LIMIT) item.blockedUntil = Date.now() + COOLDOWN_MS;
  item.updatedAt = Date.now();
  return { ...item };
}

function timeoutError(name, ms) {
  const error = new Error("provider_timeout");
  error.code = "PROVIDER_TIMEOUT";
  error.provider = name;
  error.timeoutMs = ms;
  return error;
}

/**
 * يشغّل نداء مزوّد بقاطع دائرة ومهلة محدودة ويسجّل الزمن.
 * @param {string} name
 * @param {()=>Promise<any>} operation
 * @param {{timeoutMs?:number}} [options]
 */
async function withProviderHealth(name, operation, { timeoutMs = 0 } = {}) {
  const permission = canUseProvider(name);
  if (!permission.allowed) {
    const error = new Error(`provider_circuit_open:${name}`);
    error.code = "PROVIDER_CIRCUIT_OPEN";
    throw error;
  }
  const item = state(name);
  const started = Date.now();
  item.inFlight += 1;
  let timer = null;
  try {
    const call = Promise.resolve().then(operation);
    const result = timeoutMs > 0
      ? await Promise.race([call, new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(name, timeoutMs)), timeoutMs); })])
      : await call;
    reportProviderSuccess(name, Date.now() - started);
    return result;
  } catch (error) {
    reportProviderFailure(name, error, Date.now() - started);
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    item.inFlight = Math.max(0, item.inFlight - 1);
  }
}

/** درجة ترتيب البدائل: الصحيح قبل المتعثّر، ثم الأقل حِملاً والأسرع */
function providerScore(name) {
  const item = state(name);
  const blocked = item.blockedUntil > Date.now() ? 1e9 : 0;
  const shaky = item.consecutiveFailures * 5000;
  const load = item.inFlight * 2000;
  const latency = item.latencyMs ?? 4000; // مزوّد لم يُجرَّب: متوسط محايد
  return blocked + shaky + load + latency;
}

function getProviderHealth() {
  return [...providers.values()].map((item) => ({ ...item, blocked: item.blockedUntil > Date.now() }));
}

/** للاختبارات فقط */
function resetProviderHealth() {
  providers.clear();
}

export {
  COOLDOWN_MS,
  FAILURE_LIMIT,
  canUseProvider,
  getProviderHealth,
  providerScore,
  reportProviderFailure,
  reportProviderSuccess,
  resetProviderHealth,
  withProviderHealth,
};
