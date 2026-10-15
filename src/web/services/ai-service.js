// ═══════════════════════════════════════════════
// 🧠 Terboo Web — قناة الذكاء (نفس النواة، بلا دماغ ثانٍ)
// ───────────────────────────────────────────────
// لماذا لا نستدعي runKernel() مباشرة؟
//   runKernel(m, sock, db) يسلّم الرد بنفسه عبر m.reply/m.react ويبني أزرار
//   واتساب — أي أنه مربوط بالقناة. استدعاؤه من HTTP يتطلّب تزييف رسالة مُسلسَلة
//   ومقبساً، وهذا ممنوع صراحةً. فالموقع يستعمل **نفس المكوّنات المشتركة** التي
//   تستعملها النواة:
//     • ask()                من terboo-ai-providers.js  (تعتيم الأسرار · بوابة
//       الرؤية · توجيه المزوّدات · hedge/fallback · قفل الهوية enforceBrand)
//     • chooseProviderRoute/classifyAiTask من terboo-ai-router.js
//     • classify/detectLanguage من terboo-intent-gate.js (بوابة النوايا الحتمية)
//     • brandLockPrompt       من terboo-brand.js
//   ولا يُستدعى أي مزوّد مباشرة، ولا يُتجاوز التوجيه ولا التعتيم.
//
// حدود صريحة تُعلَن للمستخدم ولا تُخفى:
//   • النموذج لا يمنح صلاحية ولا ينفّذ أمراً: نيّة COMMAND/AGENT/OWNER تُعاد
//     كإرشاد إلى واتساب، لا كتنفيذ.
//   • صورة بلا مزوّد رؤية ⇒ رفض صريح، ولا وصف مُختلق أبداً.
// ═══════════════════════════════════════════════

import { brandLockPrompt } from "../../lib/terboo-brand.js";
import { PROVIDER_CAPS, ask, loadProviders, providerNames, supportsVision } from "../../lib/terboo-ai-providers.js";
import { classifyAiTask } from "../../lib/terboo-ai-router.js";
import { classify as classifyIntent, detectLanguage } from "../../lib/terboo-intent-gate.js";
import { apiError } from "../errors.js";
import * as limits from "./rate-limit-service.js";
import { appendMessage, historyForModel, ownedConversation } from "./conversation-store.js";

/** نوايا لا تُنفَّذ من الويب: التنفيذ يحتاج قناة واتساب أو صلاحية مالك عبر Dispatcher */
const WHATSAPP_ONLY_INTENTS = new Set(["COMMAND", "AGENT", "OWNER", "PROJECT", "AUTOMATION", "TASK_CONTROL"]);

/** تعليمات النظام لقناة الويب — قفل الهوية ثم حدود القناة */
function systemPrompt(lang) {
  return [
    brandLockPrompt(lang),
    "You are answering inside the Bot Terboo web workspace, not WhatsApp.",
    "Reply in the same language the user writes in.",
    "You cannot run bot commands, change permissions, moderate groups or touch the owner console from here; if the user asks for one of those, say it is done from WhatsApp and name the command.",
    "Never claim to have seen an image, heard audio or read a file unless its content is given to you in this request.",
    "Use markdown: tables start and end with |, code goes in fenced blocks.",
  ].join("\n");
}

/** حالة مزوّدات الذكاء — أسماء وقدرات فقط، بلا أي مفتاح */
async function providerStatus() {
  const map = await loadProviders();
  const names = Object.keys(map);
  return {
    configured: names,
    count: names.length,
    vision: names.filter((name) => supportsVision(name)),
    caps: Object.fromEntries(names.map((name) => [name, PROVIDER_CAPS?.[name] || {}])),
    available: names.length > 0,
  };
}

/**
 * يرسل رسالة في محادثة ويب ويعيد الرد.
 * @param {{principal:Object, conversationId:string, text:string, image?:Buffer,
 *          lang?:string, signal?:AbortSignal}} input
 */
async function converse({ principal, conversationId, text, image = null, lang = "", signal = null }) {
  const owner = principal.canonical;
  const message = String(text || "").trim();
  if (!message && !Buffer.isBuffer(image)) {
    throw apiError("INVALID_INPUT", { message: "Write a message or attach a file." });
  }
  if (message.length > 6000) throw apiError("INVALID_INPUT", { message: "The message is too long." });

  // الملكية قبل أي عمل (IDOR)
  ownedConversation(owner, conversationId);
  await limits.aiMessages(owner);

  const status = await providerStatus();
  if (!status.available) throw apiError("PROVIDER_UNAVAILABLE", { details: { capability: "ai" } });

  // صورة بلا مزوّد رؤية ⇒ رفض صريح، لا وصف مُختلق
  if (Buffer.isBuffer(image) && image.length && !status.vision.length) {
    throw apiError("PROVIDER_UNAVAILABLE", {
      message: "No provider that can actually read images is configured, so the image cannot be described.",
      details: { capability: "vision" },
    });
  }

  // detectLanguage يعيد {language, dialect} لا سلسلة
  const detected = message ? detectLanguage(message) : null;
  const language = lang || detected?.language || "ar";
  // بوابة النوايا الحتمية نفسها التي تستعملها النواة
  const gate = classifyIntent(message) || {};
  const intent = String(gate.intent || gate.type || "CHAT").toUpperCase();

  appendMessage(owner, conversationId, { role: "user", text: message || "[attachment]" });

  // نيّة تنفيذية ⇒ إرشاد صادق بلا تنفيذ ولا ادّعاء
  if (WHATSAPP_ONLY_INTENTS.has(intent)) {
    const guidance = language === "en"
      ? "That runs on WhatsApp, not here: the web workspace cannot execute bot commands, moderate groups or use owner tools. Send it to Bot Terboo on WhatsApp and it will run with your real permissions."
      : language === "es"
        ? "Eso se ejecuta en WhatsApp, no aquí: el espacio web no puede ejecutar comandos del bot, moderar grupos ni usar herramientas del propietario. Envíalo a Bot Terboo en WhatsApp y se ejecutará con tus permisos reales."
        : "هذا ينفَّذ من واتساب لا من هنا: مساحة الويب لا تشغّل أوامر البوت ولا تدير المجموعات ولا تستعمل أدوات المالك. أرسله إلى Bot Terboo على واتساب وسينفَّذ بصلاحياتك الحقيقية.";
    appendMessage(owner, conversationId, { role: "assistant", text: guidance });
    return { text: guidance, intent, provider: "", route: "", executed: false, reason: "not-available-in-web" };
  }

  const history = historyForModel(owner, conversationId);
  // آخر دور هو رسالة المستخدم نفسها؛ لا تُكرَّر في payload.message
  const priorHistory = history.slice(0, -1);

  const payload = {
    message: message || "Describe the attached file.",
    instruction: systemPrompt(language),
    history: priorHistory,
    language,
  };
  if (Buffer.isBuffer(image) && image.length) payload.imageBuffer = image;

  // التوجيه من الموجّه الحقيقي (لا اختيار مزوّد من العميل)
  const routeHint = classifyAiTask({ text: payload.message, hasImage: Boolean(payload.imageBuffer) });

  let answer;
  try {
    answer = await ask(payload, routeHint, { throwOnError: true });
  } catch (error) {
    if (signal?.aborted) throw apiError("CANCELLED");
    if (String(error?.code) === "NO_VISION_PROVIDER") {
      throw apiError("PROVIDER_UNAVAILABLE", {
        message: "No provider that can actually read images is configured, so the image cannot be described.",
        details: { capability: "vision" },
      });
    }
    throw apiError("PROVIDER_UNAVAILABLE", { details: { capability: "ai" } });
  }
  if (signal?.aborted) throw apiError("CANCELLED");
  if (!answer?.text) throw apiError("PROVIDER_UNAVAILABLE", { details: { capability: "ai" } });

  appendMessage(owner, conversationId, { role: "assistant", text: answer.text, provider: answer.provider });

  return {
    text: answer.text,
    intent,
    provider: answer.provider || "",
    route: typeof answer.route === "string" ? answer.route : "",
    latencyMs: answer.latencyMs || 0,
    fallbackUsed: Boolean(answer.fallbackUsed),
    executed: false,
  };
}

export { WHATSAPP_ONLY_INTENTS, converse, providerNames, providerStatus, systemPrompt };
