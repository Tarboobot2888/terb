// ═══════════════════════════════════════════════
// 🎯 Terboo Command Dispatch — تنفيذ الأمر الحقيقي نيابةً عن الذكاء
// ───────────────────────────────────────────────
// الذكاء الاصطناعي لا ينفّذ أي إجراء بنفسه (§13). حين يقرّر مثلاً «اطرد
// أحمد»، يُبنى من رسالة المستخدم الأصلية نفسها نسخةٌ نصّها `.kick @أحمد`،
// ثم تدخل مسار البوت الطبيعي كاملاً كأنّ المستخدم كتبها:
//
//   Permission · Admin · BotAdmin · Owner · Premium · Group/Private-only
//   · Registration · Cooldown · Energy · Mode · Stats
//
// فلا يتجاوز الذكاء أي صلاحية، ولا توجد نسخة ثانية من منطق أي أمر.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import config from "../../config.js";
import { getPlugin } from "./terboo-plugins.js";
import { recordCommand, recordResult, recordTarget } from "./terboo-ai-memory.js";
import { jidFromDigits, sendableJid } from "./terboo-identity.js";

/** بادئة معرّف الرسائل المُرسلة عبر الموزّع — للتعرّف عليها ومنع الحلقات */
const AI_ID_PREFIX = "TERBOOAI";

/** هل هذه الرسالة صادرة عن الموزّع؟ (تُستعمل لمنع الذكاء من الرد على نفسه) */
function isAiDispatched(m) {
  return String(m?.key?.id || m?.raw?.key?.id || "").startsWith(AI_ID_PREFIX);
}

/** سياق الرسالة الأصلية (اقتباس + إشارات) من أي نوع رسالة */
function originalContext(raw) {
  const message = raw?.message || {};
  for (const node of Object.values(message)) {
    if (node && typeof node === "object" && node.contextInfo) return node.contextInfo;
  }
  return null;
}

/** معرّف حقيقي من أي شكل — أرقام LID لا تتحوّل إلى رقم هاتف مختلق */
function jidOf(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("@")) return sendableJid(text);
  return jidFromDigits(text);
}

/**
 * يبني رسالة واتساب خام مطابقة لرسالة المستخدم، نصّها الأمر المطلوب.
 * يبقى المرسل والمحادثة كما هما، ويُنقل الاقتباس الأصلي (لأوامر مثل الحذف)،
 * وتُضاف الإشارات التي حدّدها الذكاء.
 */
function digitsOf(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
}

function buildSyntheticMessage(m, text, { mentions = [], keepQuoted = true, botJid = "" } = {}) {
  const raw = m?.raw || { key: m?.key, message: {} };
  const baseKey = raw.key || m?.key || {};
  const ctx = originalContext(raw);
  const bot = digitsOf(botJid);
  const notBot = (jid) => !bot || digitsOf(jid) !== bot;

  const contextInfo = {};
  // الاقتباس يُنقل (لأوامر مثل الحذف والطرد بالرد) إلا إن كان رسالة البوت نفسه:
  // المستخدم يرد على البوت ليخاطبه، لا ليجعله هدفاً.
  const quotedFromBot = bot && digitsOf(ctx?.participant) === bot;
  if (keepQuoted && ctx?.quotedMessage && !quotedFromBot && !mentions.length) {
    contextInfo.stanzaId = ctx.stanzaId;
    contextInfo.participant = ctx.participant;
    contextInfo.quotedMessage = ctx.quotedMessage;
    if (ctx.remoteJid) contextInfo.remoteJid = ctx.remoteJid;
  }
  // الهدف الذي حدّده الذكاء أولاً، ثم إشارات المستخدم الأصلية — بلا البوت نفسه
  const mentioned = [...new Set([...mentions.map(jidOf).filter(Boolean), ...(ctx?.mentionedJid || [])])].filter(notBot);
  if (mentioned.length) contextInfo.mentionedJid = mentioned;

  return {
    key: {
      remoteJid: baseKey.remoteJid || m?.chat,
      fromMe: Boolean(baseKey.fromMe),
      id: `${AI_ID_PREFIX}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      ...(baseKey.participant ? { participant: baseKey.participant } : {}),
    },
    message: { extendedTextMessage: { text, ...(Object.keys(contextInfo).length ? { contextInfo } : {}) } },
    pushName: raw.pushName || m?.pushName || "",
    messageTimestamp: Math.floor(Date.now() / 1000),
    ...(raw.participant ? { participant: raw.participant } : {}),
  };
}

/** نص مختصر من أي محتوى رد (نص، أو كائن رسالة فيه text/caption) */
function contentText(content) {
  if (typeof content === "string") return content;
  if (content && typeof content === "object") return String(content.text || content.caption || "");
  return "";
}

/**
 * مراقب نتيجة الأمر داخل المسار الطبيعي.
 * handler يستدعي reply() مع كل رد، و done() عند انتهاء البلوقن أو فشله.
 * إن لم يُستدعَ done() أبداً فالمسار توقّف قبل البلوقن: صلاحية، تسجيل،
 * تبريد، طاقة، وضع البوت… وهذا فشل حقيقي يُسجَّل كما هو.
 */
function createObserver() {
  const replies = [];
  let settled = null;
  return {
    replies,
    reply(content) {
      const text = contentText(content).trim();
      if (text) replies.push(text.slice(0, 600));
    },
    done(result) {
      if (!settled) settled = { ...result };
    },
    outcome() {
      if (settled) return settled;
      return { ok: false, status: "blocked", error: "" };
    },
  };
}

/**
 * ينفّذ أمراً حقيقياً عبر المسار الطبيعي وينتظر نتيجته.
 * @param {Object} m رسالة المستخدم الأصلية (مُسلسلة)
 * @param {Object} sock
 * @param {{command:string, args?:string, mentions?:string[], record?:boolean}} request
 * @param {{handler?:Function}} [deps] يُمرَّر معالج بديل في الاختبارات فقط
 * @returns {Promise<{ok:boolean, status?:string, reason?:string, command?:string, text?:string, replies?:string[], error?:string}>}
 */
async function dispatchCommand(m, sock, { command, args = "", mentions = [], record = true } = {}, deps = {}) {
  const name = String(command || "").trim();
  if (!name) return { ok: false, reason: "no-command", status: "rejected" };
  if (!getPlugin(name)) return { ok: false, reason: "unknown-command", command: name, status: "rejected" };
  if (!m?.raw?.key && !m?.key) return { ok: false, reason: "no-source-message", command: name, status: "rejected" };
  if (isAiDispatched(m)) return { ok: false, reason: "loop-guard", command: name, status: "rejected" };

  const prefix = config.command?.prefix || ".";
  const cleanArgs = String(args || "").replace(/\s+/g, " ").trim().slice(0, 500);
  const text = `${prefix}${name}${cleanArgs ? ` ${cleanArgs}` : ""}`;
  const synthetic = buildSyntheticMessage(m, text, { mentions, botJid: sock?.user?.id || "" });
  const observer = createObserver();

  const run = deps.handler || (await import("../handler.js")).messageHandler;
  try {
    await run(synthetic, sock, { aiDispatched: true, observer });
  } catch (error) {
    observer.done({ ok: false, status: "error", error: String(error?.message || error) });
  }
  const outcome = observer.outcome();
  const summary = (outcome.error || observer.replies[observer.replies.length - 1] || "").slice(0, 280);

  if (record) {
    try {
      recordCommand(m, { command: name, args: cleanArgs });
      recordResult(m, { command: name, ok: outcome.ok, summary: summary || outcome.status });
      const target = cleanArgs.match(/@?(\d{6,})/) || mentions.map((jid) => String(jid).match(/(\d{6,})/)).find(Boolean);
      if (target) recordTarget(m, { jid: target[1] });
    } catch (error) { noteFailure("command-dispatch", error, {where: "src/lib/terboo-command-dispatch.js:155",stage: "recordCommand"}); }
  }

  return {
    ok: Boolean(outcome.ok),
    status: outcome.status,
    command: name,
    text,
    replies: [...observer.replies],
    error: outcome.error || "",
    summary,
  };
}

export { AI_ID_PREFIX, buildSyntheticMessage, createObserver, dispatchCommand, isAiDispatched };
export default { dispatchCommand, isAiDispatched };
