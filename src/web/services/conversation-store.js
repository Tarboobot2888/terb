// ═══════════════════════════════════════════════
// 💬 Terboo Web — محادثات قناة الويب (مخزن مستقل ومملوك)
// ───────────────────────────────────────────────
// لماذا مخزن خاص ولا نكتب في ذاكرة الذكاء؟
//   ذاكرة البوت مُشجَّرة بـ private:<digits> و group:<gid>:<digits>؛ الكتابة فيها
//   من الموقع تخلط محادثة الويب بمحادثة واتساب الخاصة لنفس الشخص. فالسجل هنا
//   مستقل وله schemaVersion وملكية صريحة، وذاكرة الذكاء تبقى للقراءة/النسيان فقط.
// الملكية: كل محادثة لها owner = الهوية القانونية، ولا تُقرأ ولا تُحذف إلا به.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { redact } from "../../lib/terboo-ai-memory.js";
import { apiError } from "../errors.js";
import { conversationsOf, dropConversation, getConversation, putConversation } from "../store/web-store.js";

const LIMITS = Object.freeze({
  perUser: 60,          // أقصى عدد محادثات محفوظة لكل مستخدم
  messages: 200,        // أقصى عدد رسائل محفوظة لكل محادثة
  messageChars: 8000,   // أقصى طول رسالة محفوظة
  titleChars: 80,
  historyForModel: 14,  // عدد الأدوار المرسلة للنموذج (نفس حدّ الذاكرة القصيرة)
});

const newId = () => `c_${crypto.randomBytes(12).toString("base64url")}`;

/** عنوان مشتق من أول رسالة حتى يسمّي المستخدم المحادثة بنفسه */
function deriveTitle(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.slice(0, LIMITS.titleChars) || "محادثة جديدة";
}

function createConversation(owner, { title = "", lang = "ar" } = {}) {
  const mine = conversationsOf(owner);
  // حد المحادثات: الأقدم يُحذف (الحذف صريح لا صامت — يُعاد في الرد)
  const pruned = [];
  for (const extra of mine.slice(LIMITS.perUser - 1)) {
    dropConversation(extra.id);
    pruned.push(extra.id);
  }
  const id = newId();
  const now = Date.now();
  putConversation(id, {
    owner,
    schema: 1,
    title: String(title || "").slice(0, LIMITS.titleChars),
    lang,
    archived: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  });
  return { id, pruned };
}

/** يقرأ محادثة بعد التحقق من الملكية (IDOR) */
function ownedConversation(owner, id) {
  const record = getConversation(String(id || ""));
  // غير موجودة أو ليست له ⇒ نفس الرد: لا يكشف وجود محادثة لغيره
  if (!record || record.owner !== owner) throw apiError("NOT_FOUND");
  return record;
}

/**
 * يضيف دوراً إلى المحادثة.
 * النص يمرّ على redact من محرّك الذاكرة نفسه: ما يشبه سراً لا يُحفظ.
 */
function appendMessage(owner, id, { role, text, provider = "", toolId = "", artifacts = [] }) {
  const record = ownedConversation(owner, id);
  const clean = redact(String(text || "")).slice(0, LIMITS.messageChars);
  if (!clean) return null;
  const message = {
    id: crypto.randomBytes(8).toString("base64url"),
    role: role === "assistant" ? "assistant" : "user",
    text: clean,
    at: Date.now(),
  };
  if (provider) message.provider = String(provider).slice(0, 40);
  if (toolId) message.toolId = String(toolId).slice(0, 60);
  if (Array.isArray(artifacts) && artifacts.length) message.artifacts = artifacts.slice(0, 8).map((a) => String(a).slice(0, 80));

  record.messages.push(message);
  if (record.messages.length > LIMITS.messages) record.messages.splice(0, record.messages.length - LIMITS.messages);
  if (!record.title && message.role === "user") record.title = deriveTitle(clean);
  record.updatedAt = message.at;
  putConversation(id, record);
  return message;
}

/** تاريخ بصيغة المزوّدات: [{role, content}] — آخر الأدوار فقط */
function historyForModel(owner, id, limit = LIMITS.historyForModel) {
  const record = ownedConversation(owner, id);
  return record.messages.slice(-limit).map((m) => ({ role: m.role, content: m.text }));
}

function listConversations(owner, { includeArchived = false } = {}) {
  return conversationsOf(owner)
    .filter((c) => includeArchived || !c.archived)
    .map((c) => ({
      id: c.id,
      title: c.title || deriveTitle(c.messages?.[0]?.text || ""),
      lang: c.lang,
      archived: Boolean(c.archived),
      messageCount: Array.isArray(c.messages) ? c.messages.length : 0,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    }));
}

function readConversation(owner, id) {
  const record = ownedConversation(owner, id);
  return {
    id,
    title: record.title,
    lang: record.lang,
    archived: Boolean(record.archived),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messages: record.messages,
  };
}

function renameConversation(owner, id, title) {
  const record = ownedConversation(owner, id);
  record.title = String(title || "").slice(0, LIMITS.titleChars);
  record.updatedAt = Date.now();
  putConversation(id, record);
  return { id, title: record.title };
}

function archiveConversation(owner, id, archived = true) {
  const record = ownedConversation(owner, id);
  record.archived = Boolean(archived);
  record.updatedAt = Date.now();
  putConversation(id, record);
  return { id, archived: record.archived };
}

function deleteConversation(owner, id) {
  ownedConversation(owner, id);
  return dropConversation(String(id));
}

/** حذف كل محادثات الهوية (طلب خصوصية) */
function deleteAllConversations(owner) {
  let removed = 0;
  for (const c of conversationsOf(owner)) if (dropConversation(c.id)) removed++;
  return removed;
}

export {
  LIMITS as CONVERSATION_LIMITS,
  appendMessage,
  archiveConversation,
  createConversation,
  deleteAllConversations,
  deleteConversation,
  historyForModel,
  listConversations,
  ownedConversation,
  readConversation,
  renameConversation,
};
