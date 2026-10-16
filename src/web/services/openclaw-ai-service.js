// ═══════════════════════════════════════════════
// 🧠 OpenClaw — مُهيّئ الذكاء (مسار واحد مشترك للويب وواتساب)
// ───────────────────────────────────────────────
// هذا ليس «عقلاً ثانياً»: نواة Terboo (ask في terboo-ai-providers.js) تبقى
// المسار الافتراضي. هذا المُهيّئ يوجّه الطلب إلى محرّك OpenClaw الحقيقي عبر
// Gateway **حين يكون مُفعَّلاً ومتصلاً**، ويعيد نتيجة موصوفة بمصدرها.
//
// ما يفرضه هذا الملف:
//   • معطَّل افتراضياً ⇒ المتصل يستعمل نواة Terboo كما هي (لا تغيير سلوك).
//   • انقطاع OpenClaw ⇒ حالة صادقة ({ok:false, reason}) لا ردّ مُختلق،
//     والمتصل يقرّر الرجوع إلى النواة. لا «نجاح» بنصّ فارغ.
//   • الجلسة تُشتقّ على الخادم من الهوية القانونية (session-map) — لا من العميل.
//   • لا يسلّم OpenClaw رسائل واتساب: deliver=false، والردّ يعود إلى Terboo
//     ليمرّ على طبقة النقل والترجمة الموجودة.
//   • لا transcript ولا مفتاح في أي سجل أو رد.
// ═══════════════════════════════════════════════

import { openclawConfig } from "../openclaw/config.js";
import { agentRun, health } from "../openclaw/gateway-client.js";
import { sessionKeyFor, sessionLabelFor } from "../openclaw/session-map.js";

/** هل يُستعمل OpenClaw لهذا الطلب؟ (إعداد مُفعَّل فقط) */
function openclawReady() {
  return openclawConfig().enabled;
}

/** نصّ الردّ من نتيجة agent.run — حقول معروفة فقط، بلا تخمين شكل */
function extractText(result) {
  if (!result || typeof result !== "object") return "";
  for (const key of ["text", "message", "reply", "content", "output"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  // بعض الردود تحمل النصّ في آخر رسالة مساعد
  const messages = Array.isArray(result.messages) ? result.messages : [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const entry = messages[index];
    const value = typeof entry?.text === "string" ? entry.text : typeof entry?.content === "string" ? entry.content : "";
    if (value.trim()) return value.trim();
  }
  return "";
}

/**
 * سؤال محرّك OpenClaw.
 * @param {{principal:Object, text:string, channel?:string, conversationId?:string,
 *   signal?:AbortSignal, timeoutMs?:number}} input
 * @returns {Promise<{ok:boolean, text:string, provider:string, reason:string, sessionKey:string}>}
 */
async function ask({ principal, text, channel = "web", conversationId = "", signal = null, timeoutMs = 0 }) {
  const settings = openclawConfig();
  if (!settings.enabled) {
    return { ok: false, text: "", provider: "openclaw", reason: settings.reason || "disabled", sessionKey: "" };
  }
  const message = String(text || "").trim();
  if (!message) {
    return { ok: false, text: "", provider: "openclaw", reason: "empty-message", sessionKey: "" };
  }

  const sessionKey = sessionKeyFor(principal, { channel, conversationId });
  if (!sessionKey) {
    return { ok: false, text: "", provider: "openclaw", reason: "no-identity", sessionKey: "" };
  }

  const outcome = await agentRun({
    message,
    sessionKey,
    label: sessionLabelFor({ channel, conversationId }),
    ...(timeoutMs ? { timeoutMs } : {}),
    ...(signal ? { signal } : {}),
  });

  if (!outcome.ok) {
    return { ok: false, text: "", provider: "openclaw", reason: outcome.error || "gateway-failed", sessionKey };
  }

  const answer = extractText(outcome.result);
  if (!answer) {
    // نجاح بلا نصّ ليس ردّاً: يُعلَن بوضوح كي يرجع المتصل إلى النواة
    return { ok: false, text: "", provider: "openclaw", reason: "empty-answer", sessionKey };
  }
  return { ok: true, text: answer, provider: "openclaw", reason: "", sessionKey };
}

/** حالة المحرّك للعرض (لوحة المالك و/health) — بلا أسرار */
async function status(options = {}) {
  return health(options);
}

export { ask, extractText, openclawReady, status };
