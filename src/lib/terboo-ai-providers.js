// ═══════════════════════════════════════════════
// 🔌 Terboo AI Providers — طبقة المزوّدات الموحّدة
// ───────────────────────────────────────────────
// أنظمة الذكاء القديمة (Auto AI، Natural AI، NVIDIA، Agent) تبقى كما هي
// وتُستعمل من هنا كـ Adapters خلف النواة، بدل تكرار منطق الاتصال في كل ملف (§2).
//
// كل مزوّد يُنادى بنفس الحمولة:
//   { message, instruction, language, history, context }
// ويُعيد نصاً. مَن لا يدعم history يتجاهلها بلا ضرر — لكن النواة
// ترسلها دائماً، فلا يوجد مسار يبدأ بذاكرة فارغة وهناك محادثة محفوظة (§5).
// ═══════════════════════════════════════════════

import { redactSecrets } from "./terboo-secrets.js";
import { noteFailure } from "./terboo-failure-log.js";
import config from "../../config.js";
import { chooseProviderRoute, runRoutedChat } from "./terboo-ai-router.js";
import { enforceBrand } from "./terboo-brand.js";

const LOAD_TTL_MS = 300000;
const PROVIDER_TIMEOUT_MS = 12_000;
/** الافتراضي: Claude Opus 5.5 (قابل للتغيير بـ ANTHROPIC_MODEL) */
const CLAUDE_DEFAULT_MODEL = "claude-opus-5-5";
/** أقصى ضلع موصى به لصور Claude، وحد حجم الصورة في الطلب */
const CLAUDE_IMAGE_MAX_SIDE = 1568;
const CLAUDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * قدرات كل مزوّد فعلياً (§50): vision = يستلم بايتات الصورة نفسها.
 * GeminiAPI النصي لا يرسل الصورة (يكتب فقط «أرسل المستخدم صورة») ⇒ ليس مزوّد رؤية،
 * ولا يُوجَّه إليه أي طلب يحمل صورة حتى لا «يتظاهر» بالرؤية.
 */
const PROVIDER_CAPS = {
  Claude: { vision: true, longContext: true, code: true },
  GPTVision: { vision: true },
  GeminiAPI: { vision: false },
  GPT: { vision: false },
  DeepSeek: { vision: false, code: true },
  NVIDIA: { vision: false },
};

function supportsVision(name) {
  return Boolean(PROVIDER_CAPS[name]?.vision);
}

/** مفتاح Claude: config.APIkey.anthropic (مع بقية المفاتيح)، والبيئة تتجاوزه إن ضُبطت — لا يُطبع أبداً */
function claudeKey() {
  return process.env.ANTHROPIC_API_KEY || String(config.APIkey?.anthropic || "").trim();
}
function claudeConfigured() {
  return Boolean(claudeKey() || process.env.ANTHROPIC_AUTH_TOKEN);
}

let anthropicClient = null;
let anthropicClientKey = "";
async function claudeClient() {
  const key = claudeKey();
  if (anthropicClient && anthropicClientKey === key) return anthropicClient;
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // بلا مفتاح صريح يقرأ الـSDK ANTHROPIC_AUTH_TOKEN من البيئة
  anthropicClient = new Anthropic({ ...(key ? { apiKey: key } : {}), timeout: PROVIDER_TIMEOUT_MS * 2, maxRetries: 1 });
  anthropicClientKey = key;
  return anthropicClient;
}

/** صورة جاهزة لكتلة image في Claude: JPEG بأقصى ضلع 1568 وأقل من 5MB */
async function claudeImageBlock(buffer) {
  const sharp = (await import("sharp")).default;
  let quality = 85;
  let data = await sharp(buffer, { limitInputPixels: 40_000_000 }).rotate().resize({ width: CLAUDE_IMAGE_MAX_SIDE, height: CLAUDE_IMAGE_MAX_SIDE, fit: "inside", withoutEnlargement: true }).jpeg({ quality }).toBuffer();
  while (data.length > CLAUDE_IMAGE_MAX_BYTES && quality > 40) {
    quality -= 15;
    data = await sharp(data).jpeg({ quality }).toBuffer();
  }
  return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: data.toString("base64") } };
}

/**
 * Claude عبر SDK الرسمي (@anthropic-ai/sdk) — يعمل فقط إذا ضبط المالك
 * config.APIkey.anthropic (أو ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN في البيئة).
 * يدعم الصور (كتلة image base64)، ويحوّل الرفض (stop_reason=refusal) إلى خطأ
 * حتى ينتقل الموجّه لمزوّد بديل. الرفض على الخادم يُعاد تلقائياً بالنموذج البديل
 * الافتراضي (server-side fallbacks) قبل أن يصلنا.
 */
async function claudeChat({ message = "", instruction = "", history = [], imageBuffer = null, effort = "" } = {}) {
  if (!claudeConfigured()) {
    throw new Error("ANTHROPIC_API_KEY غير مضبوط؛ سيتم استخدام مزود بديل.");
  }
  const client = await claudeClient();
  const messages = (Array.isArray(history) ? history : [])
    .filter((entry) => entry?.role === "user" || entry?.role === "assistant")
    .slice(-12)
    .map((entry) => ({ role: entry.role, content: String(entry.content || "").slice(0, 4000) }));
  // الرسالة الأولى يجب أن تكون من المستخدم
  while (messages.length && messages[0].role !== "user") messages.shift();
  const content = [];
  if (Buffer.isBuffer(imageBuffer) && imageBuffer.length) content.push(await claudeImageBlock(imageBuffer));
  content.push({ type: "text", text: String(message || "").slice(0, 30_000) || "." });
  messages.push({ role: "user", content });
  const model = process.env.ANTHROPIC_MODEL || CLAUDE_DEFAULT_MODEL;
  const response = await client.beta.messages.create({
    model,
    max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 16000),
    system: String(instruction || "").slice(0, 20_000) || undefined,
    messages,
    // مسار محادثة واتساب حساس للزمن: جهد منخفض افتراضياً (قابل للتغيير بـ ANTHROPIC_EFFORT)
    output_config: { effort: effort || process.env.ANTHROPIC_EFFORT || "low" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal") {
    const error = new Error(`claude_refusal:${response.stop_details?.category || "unspecified"}`);
    error.code = "PROVIDER_REFUSAL";
    throw error;
  }
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
  if (!text) throw new Error("Claude أعاد استجابة فارغة");
  return { text, model: response.model || model };
}

if (!global.terbooProviders) {
  global.terbooProviders = { map: null, loadedAt: 0, names: [] };
}
const cache = global.terbooProviders;

/** يحوّل history الموحّدة إلى النص الذي تفهمه المزوّدات النصية البحتة */
function historyAsText(history = []) {
  if (!Array.isArray(history) || !history.length) return "";
  return history
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "User"}: ${turn.content}`)
    .join("\n");
}

/** بناء نص الطلب الكامل لمزوّد لا يدعم رسائل متعددة */
function flatten({ instruction, history, message }) {
  const past = historyAsText(history);
  return [
    instruction || "",
    past ? `Conversation so far:\n${past}` : "",
    `User: ${message}`,
  ].filter(Boolean).join("\n\n");
}

/**
 * تحميل المزوّدات المتاحة فعلاً في هذه النسخة.
 * الفشل في تحميل أي مزوّد لا يعطّل الباقي.
 */
async function loadProviders(force = false) {
  if (!force && cache.map && Date.now() - cache.loadedAt < LOAD_TTL_MS) return cache.map;

  const providers = {};

  // Claude — مسار البرمجة والوثائق والرؤية الأساسي حين يتوفّر مفتاحه في البيئة
  if (claudeConfigured()) providers.Claude = (payload) => claudeChat(payload);

  // GPTVision — رؤية حقيقية: يرفع بايتات الصورة نفسها (scraper ChatGPT الموجود)
  try {
    const { chat: gptChat } = await import("../scraper/gpt52.js");
    providers.GPTVision = async (payload) => {
      if (!Buffer.isBuffer(payload.imageBuffer)) throw new Error("gptvision_needs_image");
      const request = () => gptChat({ message: payload.message, instruction: payload.instruction, history: payload.history, imageBuffer: payload.imageBuffer });
      let result;
      try {
        result = await request();
      } catch (error) {
        // الموقع يعيد أحياناً صفحة HTML (حجب مؤقت) بدل JSON: محاولة واحدة أخرى بعد مهلة قصيرة
        if (!/not valid JSON|Unexpected token|ECONNRESET|socket hang up|\b(?:429|5\d\d)\b/i.test(String(error?.message))) throw error;
        noteFailure("ai-providers", error, { where: "src/lib/terboo-ai-providers.js:GPTVision", stage: "retry" });
        await new Promise((resolve) => setTimeout(resolve, 1500));
        result = await request();
      }
      return { text: result?.text || "" };
    };
  } catch (error) { noteFailure("ai-providers", error, { where: "src/lib/terboo-ai-providers.js:loadProviders", stage: "import:gpt52" }); }

  // Gemini (رؤية + محادثة) — يدعم history أصلاً
  try {
    const { chat } = await import("../scraper/geminiVision.js");
    providers.GeminiAPI = async (payload) => {
      const result = await chat(payload);
      // الـscraper يعيد {status:false, error} بدل الرمي ⇒ فشل صريح حتى ينتقل الموجّه للبديل
      if (result?.status === false) throw new Error(`gemini_failed:${String(result.error || "").slice(0, 80)}`);
      return result;
    };
  } catch (error) { noteFailure("ai-providers", error, {where: "src/lib/terboo-ai-providers.js:95",stage: "import:geminiVision"}); }

  // GPT — نصّي بحت، نطوي التاريخ داخل النص
  try {
    const { GPT5 } = await import("../scraper/gpt5.js");
    providers.GPT = async (payload) => {
      const result = await GPT5(flatten(payload));
      if (!result?.status) throw new Error(result?.error || "GPT provider failed");
      return { text: result.answer || "" };
    };
  } catch (error) { noteFailure("ai-providers", error, {where: "src/lib/terboo-ai-providers.js:105",stage: "import:gpt5"}); }

  // DeepSeek — نصّي بحت
  try {
    const { DeepSeekThinking } = await import("../scraper/deepseek.js");
    providers.DeepSeek = async (payload) => {
      // DeepSeekThinking يعيد كائناً {success, answer, …} لا نصاً — كان يُرسل كاملاً ⇒ «[object Object]»
      const result = await DeepSeekThinking(flatten(payload));
      if (!result?.success || !String(result.answer || "").trim()) throw new Error(`deepseek_failed:${String(result?.error || result?.raw || result?.status || "").slice(0, 80)}`);
      return { text: String(result.answer).trim() };
    };
  } catch (error) { noteFailure("ai-providers", error, {where: "src/lib/terboo-ai-providers.js:111",stage: "import:deepseek"}); }

  // NVIDIA — يعمل فقط إذا هيّأ المالك مفتاحه في بيئة السيرفر
  try {
    const { askNvidia, getNvidiaKeys } = await import("./terboo-nvidia-ai.js");
    if (getNvidiaKeys().length) {
      providers.NVIDIA = async (payload) => {
        const messages = [
          payload.instruction ? { role: "system", content: payload.instruction } : null,
          ...(Array.isArray(payload.history) ? payload.history : []),
          { role: "user", content: payload.message },
        ].filter(Boolean);
        const result = await askNvidia({ model: "meta/llama-3.1-70b-instruct", messages });
        return { text: result?.answer || "" };
      };
    }
  } catch (error) { noteFailure("ai-providers", error, {where: "src/lib/terboo-ai-providers.js:127",stage: "import:terboo-nvidia-ai"}); }

  cache.map = providers;
  cache.names = Object.keys(providers);
  cache.loadedAt = Date.now();
  return providers;
}

/** أسماء المزوّدات المتاحة (للتقارير ولوحة المالك) */
function providerNames() {
  return [...(cache.names || [])];
}

/**
 * نداء موحّد: يختار المسار المناسب ثم ينفّذ مع التبديل التلقائي عند الفشل.
 * @param {{message:string, instruction:string, language:string, history:Array, context?:string}} payload
 * @returns {Promise<{text:string, provider:string}|null>} null عند تعذّر كل المزوّدات
 */
/** نسخة من الطلب بنصوص مُخفاة الأسرار */
function redactPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const out = { ...payload };
  for (const key of ["text", "prompt", "instruction", "system", "context", "query"]) if (typeof out[key] === "string") out[key] = redactSecrets(out[key]);
  for (const key of ["history", "messages"]) if (Array.isArray(out[key])) out[key] = out[key].map((item) => (typeof item === "string" ? redactSecrets(item) : item && typeof item === "object" ? { ...item, ...(typeof item.content === "string" ? { content: redactSecrets(item.content) } : {}), ...(typeof item.text === "string" ? { text: redactSecrets(item.text) } : {}) } : item));
  return out;
}

async function ask(payload, routeHint = null, { providers: injected = null, throwOnError = false, timeoutMs = 0, budgetMs = 0 } = {}) {
  // لا يصل سر مسجّل لأي نموذج: نص الطلب والتعليمات والتاريخ تُخفى قبل الإرسال (الصور والملفات كما هي)
  payload = redactPayload(payload);
  // مزوّدات محقونة: يستعملها Auto AI (مزوّداته المهيّأة من إعداداته) والاختبارات
  const providers = injected && Object.keys(injected).length
    ? Object.fromEntries(Object.entries(injected).filter(([, fn]) => typeof fn === "function"))
    : await loadProviders();
  if (!Object.keys(providers).length) return null;

  // طلب يحمل صورة: فقط مزوّدات تستلم الصورة فعلاً (المحقونة في الاختبارات تمر كما هي)
  if (!injected && Buffer.isBuffer(payload?.imageBuffer)) {
    const capable = Object.fromEntries(Object.entries(providers).filter(([name]) => supportsVision(name)));
    if (!Object.keys(capable).length) {
      if (throwOnError) throw Object.assign(new Error("no_vision_provider"), { code: "NO_VISION_PROVIDER" });
      return null;
    }
    return ask(payload, routeHint, { providers: capable, throwOnError, timeoutMs, budgetMs });
  }

  const route = routeHint || chooseProviderRoute({
    text: payload?.message || "",
    // «رؤية» فقط حين تُرسل بايتات صورة فعلاً — علامة hasImage وحدها كانت توجّه نصاً إلى Claude/GPTVision فيفشل الكل
    hasImage: Buffer.isBuffer(payload?.imageBuffer) && payload.imageBuffer.length > 0,
    hasDocument: Boolean(payload?.hasDocument),
  });

  try {
    const routed = await runRoutedChat({ route, providers, payload, timeoutMs, budgetMs });
    // قفل الهوية (§5): أي اسم مترجم/قديم في رد أي مزوّد يُصحَّح قبل وصوله لأي مسار
    return {
      text: enforceBrand(routed.text, payload?.language),
      provider: routed.provider,
      route,
      attempts: routed.attempts,
      latencyMs: routed.latencyMs,
      fallbackUsed: routed.fallbackUsed,
      fallbackLatencyMs: routed.fallbackLatencyMs,
    };
  } catch (error) {
    if (throwOnError) throw error;
    console.error("[AI Providers] تعذّر تشغيل أي مزوّد:", error.message);
    return null;
  }
}

/** إبطال ذاكرة التحميل (بعد تغيير الإعدادات) */
function invalidateProviders() {
  cache.map = null;
  cache.loadedAt = 0;
  cache.names = [];
}

export { CLAUDE_DEFAULT_MODEL, PROVIDER_CAPS, ask, claudeChat, claudeImageBlock, flatten, historyAsText, invalidateProviders, loadProviders, providerNames, supportsVision };
export default { ask, loadProviders, providerNames, invalidateProviders };
