import { requestedLanguage } from "./terboo-languages.js";
import { canUseProvider, getProviderHealth, providerScore, withProviderHealth } from "./terboo-provider-health.js";

// ── أداء المزوّدات (§11 §52): مهلة لكل نداء حسب نوع المهمة + ميزانية كلية للرسالة ──
const CALL_TIMEOUT_MS = { chat: 15_000, creative: 20_000, code: 30_000, document: 30_000, vision: 25_000, summary: 12_000 };
const TOTAL_BUDGET_MS = { chat: 32_000, creative: 38_000, code: 55_000, document: 55_000, vision: 45_000, summary: 15_000 };
const MIN_ATTEMPT_MS = 1_500;

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
}

function classifyAiTask({ text = "", hasImage = false, hasDocument = false } = {}) {
  if (hasImage) return "vision";
  if (hasDocument) return "document";
  const value = normalizeText(text);
  if (/(?:كود|برمج|javascript|node|python|خطا|debug|api|plugin|بلوقن|استيراد|syntax)/.test(value) || requestedLanguage(text)) return "code";
  if (/(?:اكتب قصه|قصيدة|شعر|اعلان|منشور|سيناريو|creative|story)/.test(value)) return "creative";
  if (/(?:لخص|تلخيص|حلل ملف|مستند|وثيقه|document)/.test(value)) return "document";
  return "chat";
}

function chooseProviderRoute(input = {}) {
  const task = classifyAiTask(input);
  const routes = {
    vision: { primary: "Claude", fallbacks: ["GPTVision"], reason: "تحليل الصور يحتاج مزوداً يستلم الصورة فعلاً (Claude ثم ChatGPT برفع الصورة)." },
    document: { primary: "Claude", fallbacks: ["GeminiAPI", "DeepSeek", "GPT"], reason: "Claude يتولى التحليل المركب والتخطيط، مع بدائل للسياق الطويل." },
    code: { primary: "Claude", fallbacks: ["DeepSeek", "GeminiAPI", "GPT"], reason: "Claude يتولى تحليل الكود والتخطيط قبل مزودي التنفيذ البدلاء." },
    creative: { primary: "GPT", fallbacks: ["GeminiAPI", "DeepSeek"], reason: "الكتابة الإبداعية تستخدم مزوداً لغوياً ثم بدائل." },
    chat: { primary: "GeminiAPI", fallbacks: ["GPT", "DeepSeek"], reason: "المحادثة اليومية تبدأ بالمزود الافتراضي للبوت." },
  };
  return { task, ...(routes[task] || routes.chat) };
}

/** نصوص تعني «لا شيء» حين تُحوَّل كائنات أو قيم فارغة إلى نص */
/** لا معنى له للمستخدم: كائن مُحوَّل نصاً · قيمة فارغة · كلمة قرار داخلية وحدها («CHAT» حرفياً) */
const JUNK_TEXT = /^(?:\[object \w+\]|undefined|null|NaN|\{\}|\[\]|["'`]?(?:CHAT|COMMAND|TOOL|AGENT|CLARIFICATION|REFUSAL|JSON)["'`.]?)$/;
const TEXT_KEYS = ["text", "answer", "reply", "content", "message", "output", "result", "response", "completion", "data"];

/**
 * عقد واحد لكل المزوّدات: أي شكل يعيده مزوّد ⇒ نص عادي، أو "" (فشل ⇒ البديل التالي).
 * يتعامل مع: نص · {text} · {answer} · {text: {answer}} (DeepSeek كان يُرسل كائنه كاملاً ⇒ [object Object])
 * · كتل content كمصفوفة · رسائل {role, content}.
 */
function normalizeProviderText(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return "";
  if (typeof value === "string") {
    const text = value.trim();
    return JUNK_TEXT.test(text) ? "" : text;
  }
  if (typeof value === "number" || typeof value === "boolean") return "";
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item : normalizeProviderText(item?.type && item.type !== "text" ? null : item?.text ?? item?.content ?? item, depth + 1))).filter(Boolean).join("\n").trim();
  }
  if (typeof value === "object") {
    for (const key of TEXT_KEYS) {
      if (key in value) {
        const text = normalizeProviderText(value[key], depth + 1);
        if (text) return text;
      }
    }
  }
  return "";
}

/** المزوّد أعلن الفشل بنفسه ({status:false} · {success:false} · {error}) ⇒ سبب واضح بدل «نص فارغ» */
function providerFailure(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const nested = value.text && typeof value.text === "object" ? value.text : null;
  for (const source of [value, nested].filter(Boolean)) {
    if (source.success === false || source.status === false || (source.error && !normalizeProviderText(source))) {
      return String(source.error || source.message || source.raw || "provider_reported_failure").slice(0, 120);
    }
  }
  return "";
}

function providerText(result) {
  const failure = providerFailure(result);
  if (failure && !normalizeProviderText(result)) throw new Error(failure);
  return normalizeProviderText(result);
}

/**
 * ترتيب المرشّحين: المسار الأساسي أولاً ما دام صحيحاً، والبدائل حسب الصحة ثم الزمن.
 * المزوّد ذو الدائرة المفتوحة يُتخطّى فوراً (إلا إن كانت كل المزوّدات مغلقة).
 */
function orderCandidates(selected, providers) {
  const names = [selected.primary, ...(selected.fallbacks || [])]
    .filter((name, index, all) => name && all.indexOf(name) === index && typeof providers[name] === "function");
  const open = names.filter((name) => canUseProvider(name).allowed);
  const usable = open.length ? open : names;
  const [first, ...rest] = usable;
  const sortedRest = [...rest].sort((a, b) => providerScore(a) - providerScore(b));
  const ordered = first === selected.primary ? [first, ...sortedRest] : [...usable].sort((a, b) => providerScore(a) - providerScore(b));
  return promoteFaster(ordered, selected.primary);
}

/** عيّنات كافية قبل أن نثق بمتوسط الزمن لترقية بديل (§50) */
const PROMOTE_MIN_SAMPLES = 3;
const PROMOTE_RATIO = 2;

/**
 * Health-aware: الأساسي الصحي يبقى أولاً ما لم يكن أبطأ باستمرار (EWMA ≥ ضعف بديل صحي
 * له عيّنات كافية). القرار من قياسات حقيقية لا من ترتيب ثابت.
 */
function promoteFaster(ordered, primary) {
  if (ordered[0] !== primary || ordered.length < 2) return ordered;
  const health = new Map(getProviderHealth().map((row) => [row.name, row]));
  const head = health.get(primary);
  if (!head || head.successes < PROMOTE_MIN_SAMPLES || !Number.isFinite(head.latencyMs)) return ordered;
  const faster = ordered.slice(1).find((name) => {
    const row = health.get(name);
    return row && !row.blocked && row.consecutiveFailures === 0 && row.successes >= PROMOTE_MIN_SAMPLES
      && Number.isFinite(row.latencyMs) && head.latencyMs >= row.latencyMs * PROMOTE_RATIO;
  });
  return faster ? [faster, ...ordered.filter((name) => name !== faster)] : ordered;
}

/**
 * مزوّد أساسي واحد لكل رسالة؛ البديل فقط عند: مهلة · فشل HTTP · نتيجة فارغة · مزوّد غير متاح.
 * لا بديل إذا نجح الأساسي. كل نداء بمهلة محدودة، والرسالة كلها بميزانية زمنية محدودة.
 * @returns {Promise<{text:string, provider:string, route:Object, raw:any, attempts:Array, latencyMs:number, fallbackUsed:boolean, fallbackLatencyMs:number}>}
 */
/** مهام تستحق Bounded Hedging (تفاعلية قصيرة) — لا للملخّص/المستند/الكود الطويل */
const HEDGE_TASKS = new Set(["chat", "vision"]);
const HEDGE_MIN_MS = 2_500;
const HEDGE_MAX_MS = 6_000;

/** متى يبدأ البديل الموازي: 1.5× الزمن المعتاد للأساسي (محصور) */
function hedgeDelay(name) {
  const row = getProviderHealth().find((item) => item.name === name);
  const typical = Number.isFinite(row?.latencyMs) ? row.latencyMs * 1.5 : 4_000;
  return Math.max(HEDGE_MIN_MS, Math.min(HEDGE_MAX_MS, typical));
}

async function runRoutedChat({ route, providers = {}, payload, timeoutMs = 0, budgetMs = 0, hedge = null } = {}) {
  const selected = route || chooseProviderRoute(payload);
  const task = payload?.purpose === "summary" ? "summary" : selected.task;
  const perCall = timeoutMs || CALL_TIMEOUT_MS[task] || CALL_TIMEOUT_MS.chat;
  const budget = budgetMs || TOTAL_BUDGET_MS[task] || TOTAL_BUDGET_MS.chat;
  const candidates = orderCandidates(selected, providers);
  const useHedge = (hedge ?? HEDGE_TASKS.has(task)) && candidates.filter((name) => canUseProvider(name).allowed).length > 1;
  if (useHedge) return runHedged({ selected, task, perCall, budget, candidates, providers, payload });
  const started = Date.now();
  const attempts = [];
  const errors = [];

  for (const name of candidates) {
    const remaining = budget - (Date.now() - started);
    // الأساسي يُجرَّب دائماً؛ البديل لا يبدأ إن لم يبقَ وقت كافٍ لرد حقيقي
    if (attempts.length && remaining < Math.min(MIN_ATTEMPT_MS, perCall / 2)) {
      errors.push("budget_exhausted");
      break;
    }
    const provider = providers[name];
    const t0 = Date.now();
    try {
      let text = "";
      const result = await withProviderHealth(name, async () => {
        const value = await provider(payload);
        text = providerText(value);
        if (!String(text || "").trim()) throw new Error("المزود لم يعد نصاً صالحاً");
        return value;
      }, { timeoutMs: Math.min(perCall, remaining) });
      attempts.push({ provider: name, ok: true, ms: Date.now() - t0 });
      const firstFailure = attempts.find((attempt) => !attempt.ok);
      return {
        text,
        provider: name,
        route: selected,
        raw: result,
        attempts,
        latencyMs: Date.now() - started,
        fallbackUsed: Boolean(firstFailure),
        fallbackLatencyMs: firstFailure ? attempts.filter((a) => !a.ok).reduce((sum, a) => sum + a.ms, 0) : 0,
      };
    } catch (error) {
      const message = String(error?.message || error).slice(0, 120);
      attempts.push({ provider: name, ok: false, ms: Date.now() - t0, error: message });
      errors.push(`${name}: ${message}`);
    }
  }
  const failure = new Error(errors.length ? `تعذر تشغيل مزودات ${selected.task}: ${errors.join(" | ")}` : "لا يوجد مزود متاح للمهمة المطلوبة");
  failure.attempts = attempts;
  throw failure;
}

/** نداء مزوّد واحد بقاطع الدائرة والمهلة؛ يُرجع النص أو يرمي */
async function callProvider(name, providers, payload, timeoutMs) {
  let text = "";
  const raw = await withProviderHealth(name, async () => {
    const value = await providers[name](payload);
    text = providerText(value);
    if (!String(text || "").trim()) throw new Error("المزود لم يعد نصاً صالحاً");
    return value;
  }, { timeoutMs });
  return { text, raw };
}

/**
 * Bounded Hedging (§52): الأساسي يبدأ وحده؛ إن تجاوز زمنه المعتاد (1.5× EWMA، 2.5–6 ث) يبدأ بديل
 * صحي واحد بالتوازي وأول نجاح يفوز. فشل الأساسي قبل ذلك ⇒ البديل فوراً (لا انتظار).
 * الحد الأقصى نداءان متوازيان — لا مضاعفة تكلفة كل رسالة: البديل لا يبدأ إن كان الأساسي سريعاً.
 */
async function runHedged({ selected, task, perCall, budget, candidates, providers, payload }) {
  const started = Date.now();
  const attempts = [];
  const errors = [];
  const queue = [...candidates];
  let inFlight = 0;
  let hedged = false;
  return new Promise((resolve, reject) => {
    let settled = false;
    let hedgeTimer = null;
    const finish = (fn) => { if (settled) return; settled = true; if (hedgeTimer) clearTimeout(hedgeTimer); fn(); };
    const launch = (reason = "") => {
      const name = queue.shift();
      if (!name) {
        if (!inFlight) finish(() => { const failure = new Error(errors.length ? `تعذر تشغيل مزودات ${selected.task}: ${errors.join(" | ")}` : "لا يوجد مزود متاح للمهمة المطلوبة"); failure.attempts = attempts; reject(failure); });
        return;
      }
      const remaining = budget - (Date.now() - started);
      if (attempts.length && remaining < Math.min(MIN_ATTEMPT_MS, perCall / 2)) {
        errors.push("budget_exhausted");
        if (!inFlight) finish(() => { const failure = new Error(`تعذر تشغيل مزودات ${selected.task}: ${errors.join(" | ")}`); failure.attempts = attempts; reject(failure); });
        return;
      }
      inFlight += 1;
      const t0 = Date.now();
      const attempt = { provider: name, ok: false, ms: 0, ...(reason ? { started: reason } : {}) };
      attempts.push(attempt);
      callProvider(name, providers, payload, Math.min(perCall, remaining)).then(({ text, raw }) => {
        attempt.ok = true;
        attempt.ms = Date.now() - t0;
        inFlight -= 1;
        finish(() => {
          const failed = attempts.filter((a) => !a.ok && a.ms);
          resolve({
            text, provider: name, route: selected, raw, attempts, latencyMs: Date.now() - started,
            fallbackUsed: attempts[0].provider !== name, fallbackLatencyMs: failed.reduce((sum, a) => sum + a.ms, 0), hedged,
          });
        });
      }, (error) => {
        attempt.ms = Date.now() - t0;
        attempt.error = String(error?.message || error).slice(0, 120);
        errors.push(`${name}: ${attempt.error}`);
        inFlight -= 1;
        if (!settled) launch("fallback");
      });
    };
    launch();
    hedgeTimer = setTimeout(() => {
      if (settled || !queue.length || inFlight > 1) return;
      hedged = true;
      launch("hedge");
    }, hedgeDelay(candidates[0]));
    hedgeTimer.unref?.();
  });
}

function formatProviderRoute(route) {
  const names = [route.primary, ...(route.fallbacks || [])].join(" ← ");
  const title = { vision: "رؤية", document: "وثائق", code: "برمجة", creative: "إبداع", chat: "محادثة" }[route.task] || "محادثة";
  return `نوع المهمة: ${title} | المسار: ${names}`;
}

export { CALL_TIMEOUT_MS, HEDGE_TASKS, TOTAL_BUDGET_MS, chooseProviderRoute, normalizeProviderText, providerFailure, classifyAiTask, formatProviderRoute, hedgeDelay, orderCandidates, promoteFaster, runRoutedChat };
