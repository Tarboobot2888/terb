// ═══════════════════════════════════════════════
// 🧭 Terboo Flow — مدخلات متعددة الخطوات · رموز التأكيد · بطاقة واحدة حية
// ───────────────────────────────────────────────
// ثلاث أدوات صغيرة تبني عليها الواجهات الجديدة (التسجيل · اللوحات · VPS):
//
//   1. مدخل منتظر (Input Flow): زر «تعديل الاسم» ⇒ الرسالة النصية التالية من نفس المستخدم في
//      نفس المحادثة تُسلَّم للتدفق (لا للأوامر ولا للذكاء). «إلغاء/cancel/cancelar» يلغيه. مهلة تلقائية.
//   2. رمز تأكيد (Action Token): الإجراء الخطِر يُنفَّذ فقط بزر «تأكيد» يحمل رمزاً عشوائياً مرة واحدة،
//      مربوطاً بالمستخدم وبالإجراء ومعامِلاته، وينتهي خلال دقائق. لا تأكيد بكتابة يدوية مخمّنة.
//   3. بطاقة حية (Live Card): كل تدفق يحتفظ بآخر بطاقة أرسلها؛ البطاقة الجديدة تحل محل القديمة
//      (تعديل الرسالة إن أمكن وإلا حذفها) ⇒ واجهة واحدة بلا تكدّس رسائل.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { noteFailure } from "./terboo-failure-log.js";
import { identityOf } from "./terboo-identity.js";
import { registerSecret } from "./terboo-secrets.js";

const INPUT_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 3 * 60 * 1000;
const CANCEL_WORDS = new Set(["الغاء", "إلغاء", "الغي", "إلغ", "cancel", "cancelar", "stop", "خروج"]);

const flows = new Map();
const pending = new Map();
const tokens = new Map();
const cards = new Map();
/** حدود الذاكرة: مدخلات منتهية لمستخدمين لم يعودوا · بطاقات أقدم ما يُستبدل (لا نمو بلا سقف) */
const MAX_PENDING = 2000;
const MAX_CARDS = 5000;

/** مفتاح المستخدم في المحادثة (هوية قانونية + المحادثة) */
function slot(user, chat) {
  return `${identityOf(String(user || "")).canonical}|${String(chat || "")}`;
}

/**
 * يسجّل تدفقاً.
 * @param {string} name
 * @param {{onInput:(m:Object, ctx:Object, state:Object)=>Promise<boolean|void>, onCancel?:(m:Object, ctx:Object, state:Object)=>Promise<void>}} handlers
 */
function registerFlow(name, handlers) {
  flows.set(name, handlers);
}

/**
 * ينتظر مدخلاً نصياً للخطوة التالية.
 * secret=true ⇒ المدخل سرّ (مفتاح API مثلاً): يُسجَّل في سجل الأسرار قبل أي معالجة فلا يظهر
 * في أي سجل، ويُمسح من مخزن الرسائل المؤقت ومن نسخة جهاز البوت.
 */
function startInput({ user, chat, flow, step, data = {}, ttlMs = INPUT_TTL_MS, secret = false }) {
  if (!flows.has(flow)) throw new Error(`flow-not-registered:${flow}`);
  const key = slot(user, chat);
  pending.set(key, { flow, step, data, secret: Boolean(secret), expiresAt: Date.now() + ttlMs });
  if (pending.size > MAX_PENDING) {
    for (const [k, v] of pending) if (v.expiresAt <= Date.now()) pending.delete(k);
    while (pending.size > MAX_PENDING) pending.delete(pending.keys().next().value);
  }
  return pending.get(key);
}

/** يزيل أثر رسالة سرية: مخزن الرسائل المؤقت + «حذف لدي» على جهاز البوت (أفضل جهد) */
async function scrubSecretMessage(m, sock) {
  try {
    const { forgetStoredMessage } = await import("../connection.js");
    forgetStoredMessage(m.chat, m.key?.id || m.id);
  } catch (error) {
    noteFailure("flow", error, { where: "terboo-flow:scrub-store", fallback: "store-ttl" });
  }
  if (typeof sock?.chatModify !== "function" || !m.key) return;
  try {
    const ts = Number(m.messageTimestamp || m.raw?.messageTimestamp || Math.floor(Date.now() / 1000));
    await sock.chatModify({ deleteForMe: { deleteMedia: false, key: m.key, timestamp: ts } }, m.chat);
  } catch (error) {
    noteFailure("flow", error, { where: "terboo-flow:scrub-device", fallback: "message-stays-on-user-device" });
  }
}

function pendingInput(user, chat) {
  const key = slot(user, chat);
  const entry = pending.get(key);
  if (entry && entry.expiresAt <= Date.now()) {
    pending.delete(key);
    return null;
  }
  return entry || null;
}

function endInput(user, chat) {
  pending.delete(slot(user, chat));
}

/**
 * يعالج رسالة كمدخل لتدفق منتظر. يُستدعى مبكراً في المعالج قبل الأوامر والذكاء.
 * الأوامر وضغطات الأزرار لا تُلتقط (تمر لمسارها الطبيعي)، والنص فقط يُلتقط.
 * @returns {Promise<boolean>} true إن استُهلكت الرسالة
 */
async function handleFlowInput(m, ctx = {}) {
  if (!m?.sender || m.fromMe || m.key?.fromMe) return false;
  const state = pendingInput(m.sender, m.chat);
  if (!state) return false;
  if (m.isCommand) return false;
  const body = String(m.body ?? m.text ?? "").trim();
  if (state.secret && body && !CANCEL_WORDS.has(body.toLowerCase())) {
    registerSecret(body);
    void scrubSecretMessage(m, ctx.sock);
  }
  const handlers = flows.get(state.flow);
  if (!handlers) {
    endInput(m.sender, m.chat);
    return false;
  }
  if (CANCEL_WORDS.has(body.toLowerCase())) {
    endInput(m.sender, m.chat);
    try { await handlers.onCancel?.(m, ctx, state); } catch (error) { noteFailure("flow", error, { where: "terboo-flow:onCancel", stage: state.flow }); }
    return true;
  }
  try {
    const consumed = await handlers.onInput(m, ctx, state);
    return consumed !== false;
  } catch (error) {
    noteFailure("flow", error, { where: "terboo-flow:onInput", stage: `${state.flow}:${state.step}` });
    return true;
  }
}

/**
 * رمز تأكيد لمرة واحدة.
 * @param {{user:string, action:string, payload?:Object, ttlMs?:number}} input
 * @returns {string} رمز قصير يوضع في معرّف الزر
 */
function createActionToken({ user, action, payload = {}, ttlMs = TOKEN_TTL_MS }) {
  const token = crypto.randomBytes(9).toString("base64url");
  tokens.set(token, { owner: identityOf(String(user || "")).canonical, action, payload, expiresAt: Date.now() + ttlMs });
  if (tokens.size > 5000) for (const [k, v] of tokens) if (v.expiresAt <= Date.now()) tokens.delete(k);
  return token;
}

/**
 * يستهلك رمز تأكيد: صالح فقط لنفس المستخدم وقبل انتهائه، ولمرة واحدة.
 * @returns {{action:string, payload:Object}|null}
 */
function consumeActionToken(user, token, { action = null } = {}) {
  const entry = tokens.get(String(token || ""));
  if (!entry) return null;
  tokens.delete(String(token));
  if (entry.expiresAt <= Date.now()) return null;
  if (entry.owner !== identityOf(String(user || "")).canonical) return null;
  if (action && entry.action !== action) return null;
  return { action: entry.action, payload: entry.payload };
}

/** يلغي رمزاً (زر «إلغاء») */
function dropActionToken(token) {
  tokens.delete(String(token || ""));
}

/** يتذكر آخر بطاقة لتدفق (لاستبدالها لاحقاً) */
function rememberCard(user, chat, flow, key) {
  if (!key?.id) return;
  cards.set(`${slot(user, chat)}|${flow}`, key);
  // الأقدم أولاً: بطاقة قديمة جداً لن تُستبدل إلا بحذفها من الذاكرة (تبقى على الجهاز كما هي)
  while (cards.size > MAX_CARDS) cards.delete(cards.keys().next().value);
}

/**
 * يستبدل البطاقة السابقة: يحذفها (رسالة البوت نفسه) بعد إرسال الجديدة.
 * @returns {Promise<boolean>}
 */
async function retireCard(sock, user, chat, flow) {
  const id = `${slot(user, chat)}|${flow}`;
  const key = cards.get(id);
  if (!key || typeof sock?.sendMessage !== "function") return false;
  cards.delete(id);
  try {
    await sock.sendMessage(chat, { delete: { ...key, fromMe: true, remoteJid: key.remoteJid || chat } });
    return true;
  } catch (error) {
    noteFailure("flow", error, { where: "terboo-flow:retireCard", stage: flow, fallback: "card-stays" });
    return false;
  }
}

function _resetFlows() {
  pending.clear();
  tokens.clear();
  cards.clear();
}

export { CANCEL_WORDS, INPUT_TTL_MS, TOKEN_TTL_MS, _resetFlows, scrubSecretMessage, consumeActionToken, createActionToken, dropActionToken, endInput, handleFlowInput, pendingInput, registerFlow, rememberCard, retireCard, startInput };
export default { registerFlow, startInput, pendingInput, endInput, handleFlowInput, createActionToken, consumeActionToken, dropActionToken, rememberCard, retireCard };
