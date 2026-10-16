// ═══════════════════════════════════════════════
// ♻️ Terboo Task Runners — استئناف حقيقي بعد إعادة التشغيل
// ───────────────────────────────────────────────
// المهمة الخلفية تُحفظ بملخص ومدخلات صغيرة (task-queue). عند الإقلاع تُسجَّل هنا دالة تنفيذ لكل نوع
// يمكن إعادة تشغيله من مدخلاته المحفوظة وحدها — فيعمل «كملها»/«أعدها» بعد الإيقاف فعلاً:
//   tool:<id> لأدوات الروابط والبحث والوصف (تحميل · بحث · توليد صورة من وصف) ⇒ نفس المحوّل،
//   وتُسلَّم النتيجة في نفس الدردشة (scope) لصاحبها (owner) بصلاحياته الحالية.
// ما لا يُستأنف بصدق لا يُسجَّل: فيديو/مستند/صورة مرسلة (الوسيط نفسه لا يُحفظ) ⇒ «أرسله مجدداً».
// ═══════════════════════════════════════════════

import { isOwner, isPremium } from "../../config.js";
import { noteFailure } from "./terboo-failure-log.js";
import { identityOf } from "./terboo-identity.js";
import { listScrapers, runScraper } from "./terboo-scraper-registry.js";
import { registerTaskRunner } from "./terboo-task-queue.js";

/** مدخلات أداة تكفي وحدها لإعادة التشغيل (بلا وسيط مرفق) */
const REPLAYABLE_INPUTS = new Set(["url", "query", "name", "prompt"]);

let socketOf = () => null;
let runTool = runScraper;

/** معرّف واتساب من الهوية القانونية المحفوظة في المهمة */
function jidOfOwner(owner) {
  const value = String(owner || "");
  const digits = value.replace(/^\w+:/, "").replace(/\D/g, "");
  if (value.startsWith("pn:") && digits) return `${digits}@s.whatsapp.net`;
  if (value.startsWith("lid:") && digits) return identityOf(`${digits}@lid`).pn || `${digits}@lid`;
  return value;
}

/** رسالة تسليم دنيا لصاحب المهمة في دردشتها — صلاحياته تُحسب الآن لا من وقت الطلب */
function deliveryTarget(sock, { owner, scope }) {
  const sender = jidOfOwner(owner);
  const chat = String(scope || sender);
  return {
    chat,
    sender,
    isGroup: chat.endsWith("@g.us"),
    isOwner: Boolean(sender && isOwner(sender)),
    isPremium: Boolean(sender && isPremium(sender)),
    key: null,
    reply: (content) => sock.sendMessage(chat, typeof content === "string" ? { text: content } : content),
  };
}

/** هل يمكن استئناف أداة من مدخلاتها المحفوظة؟ */
function isReplayableTool(entry) {
  // «url|query» = أيٌّ منهما؛ «image+prompt» يحتاج صورة لم تُحفظ ⇒ لا
  return Boolean(entry && entry.kind !== "chat" && entry.kind !== "agent" && String(entry.input || "").split("|").every((part) => REPLAYABLE_INPUTS.has(part)));
}

/** دالة تنفيذ أداة محفوظة: نفس المحوّل، تسليم في دردشة المهمة، فشل صريح لا نجاح شكلي */
function toolRunner(id) {
  return async (ctx) => {
    const sock = socketOf();
    if (!sock) throw Object.assign(new Error("whatsapp-offline"), { code: "NOT_CONNECTED" });
    const input = { ...(ctx.input || {}) };
    delete input.id;
    const lang = input.lang || "ar";
    delete input.lang;
    ctx.progress(10, "resume");
    const m = deliveryTarget(sock, ctx);
    const result = await runTool({ id, input, m, sock, lang, prefer: "adapter", signal: ctx.signal });
    if (!result?.ok) throw Object.assign(new Error(result?.reason || "tool-failed"), { code: "TOOL_FAILED", messageKey: result?.messageKey || "" });
    for (const item of result.deliveries || []) ctx.artifact({ type: item.type || "media", url: item.url || "" });
    return { ...result, summary: `${id}: ${result.deliveries?.length || 0} delivered` };
  };
}

/**
 * يسجّل دوال التنفيذ عند الإقلاع.
 * @param {{getSocket?:Function, run?:Function}} [options]
 *   getSocket: مصدر الاتصال الحالي (يتغير مع إعادة الاتصال) · run: منفّذ الأداة (بديل للاختبار فقط)
 * @returns {{tools:number}}
 */
function installTaskRunners({ getSocket = null, run = null } = {}) {
  if (typeof getSocket === "function") socketOf = getSocket;
  runTool = typeof run === "function" ? run : runScraper;
  let tools = 0;
  for (const entry of listScrapers()) {
    if (!isReplayableTool(entry)) continue;
    try {
      registerTaskRunner(`tool:${entry.id}`, toolRunner(entry.id));
      tools += 1;
    } catch (error) {
      noteFailure("task-runners", error, { where: "src/lib/terboo-task-runners.js:install", stage: entry.id });
    }
  }
  return { tools };
}

export { REPLAYABLE_INPUTS, deliveryTarget, installTaskRunners, isReplayableTool, jidOfOwner };
export default { installTaskRunners };
