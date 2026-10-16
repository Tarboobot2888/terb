// ═══════════════════════════════════════════════
// 🧭 Terboo Context Engine — ذاكرة العمل للجلسة
// ───────────────────────────────────────────────
// ما «يتكلم عنه» المستخدم الآن في هذه المحادثة (لكل شخص في كل محادثة على حدة):
//   آخر عضو تعامل معه · آخر من أُضيف · آخر من طُرد · آخر من رُقّي/خُفّض · آخر رسالة رد عليها
//   · آخر ملف/صورة/فيديو/صوت/رابط · آخر أمر · آخر أداة · آخر نتيجة · آخر VPS · آخر لوحة/سيرفر
//   · آخر مهمة · آخر اختيار في الواجهة · سجل آخر الإجراءات (لـ«اعمل نفس اللي عملناه»).
// قصيرة العمر (30 دقيقة) وفي الذاكرة فقط — مكمّلة لذاكرة المحادثة الدائمة (terboo-ai-memory)
// لا بديلاً عنها: الذاكرة الدائمة للحقائق والتفضيلات، وهذه لحل «اطرده · رجعه · عيد تشغيله».
// لا أسرار ولا نصوص كاملة: معرّفات وأسماء ومراجع قصيرة فقط.
// ═══════════════════════════════════════════════

import { identityOf } from "./terboo-identity.js";

const TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 5000;
const MAX_ACTIONS = 12;
const SLOTS = Object.freeze([
  "member", "added", "removed", "promoted", "demoted", "replied", "file", "image", "video", "audio", "link",
  "command", "tool", "result", "vps", "panel", "server", "task", "choice",
  // آخر قائمة سيرفرات معروضة للمستخدم (لـ«السيرفر التاني») — {kind:"vps"|"panel-servers", panelId?, ids:[…]}
  "list",
]);

if (!global.terbooContextEngine) global.terbooContextEngine = new Map();
const sessions = global.terbooContextEngine;

function keyOf(m) {
  return `${m?.chat || ""}|${identityOf(String(m?.sender || "")).canonical}`;
}

function session(m, { create = true } = {}) {
  const key = keyOf(m);
  let s = sessions.get(key);
  if (s && Date.now() - s.touchedAt > TTL_MS) {
    sessions.delete(key);
    s = null;
  }
  if (!s && create) {
    s = { slots: {}, actions: [], touchedAt: Date.now() };
    sessions.set(key, s);
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
  }
  return s;
}

/** يحفظ كياناً في خانة (عضو/وسيط/VPS…) */
function remember(m, slot, value) {
  if (!SLOTS.includes(slot) || value === undefined || value === null) return null;
  const s = session(m);
  s.slots[slot] = { ...value, at: Date.now() };
  s.touchedAt = Date.now();
  return s.slots[slot];
}

/** آخر كيان في خانة (أو null إن انتهت صلاحيته) */
function recall(m, slot) {
  const s = session(m, { create: false });
  const value = s?.slots?.[slot];
  return value && Date.now() - value.at < TTL_MS ? value : null;
}

/** يسجل إجراءً نُفّذ فعلاً (للتكرار والمتابعة) */
function recordAction(m, action) {
  const s = session(m);
  s.actions.push({ ...action, at: Date.now() });
  if (s.actions.length > MAX_ACTIONS) s.actions.splice(0, s.actions.length - MAX_ACTIONS);
  s.touchedAt = Date.now();
}

function lastAction(m, filter = () => true) {
  const s = session(m, { create: false });
  return [...(s?.actions || [])].reverse().find((a) => Date.now() - a.at < TTL_MS && filter(a)) || null;
}

const LINK = /https?:\/\/[^\s<>"']+/i;

/** يلتقط من الرسالة الواردة: وسائطها · رابطها · الرسالة التي رد عليها */
function observeMessage(m) {
  if (!m?.sender || m.fromMe) return;
  const type = String(m.type || "");
  const ref = { id: m.key?.id || m.id || "", type };
  if (m.isImage || type === "imageMessage") remember(m, "image", ref);
  else if (m.isVideo || type === "videoMessage") remember(m, "video", ref);
  else if (m.isAudio || type === "audioMessage") remember(m, "audio", ref);
  else if (m.isDocument || type === "documentMessage" || type === "documentWithCaptionMessage") remember(m, "file", { ...ref, name: String(m.message?.documentMessage?.fileName || m.message?.documentWithCaptionMessage?.message?.documentMessage?.fileName || "").slice(0, 120) });
  const link = String(m.body || m.text || "").match(LINK);
  if (link) remember(m, "link", { url: link[0].slice(0, 400) });
  if (m.quoted) remember(m, "replied", { id: m.quoted.id || m.quoted.key?.id || "", sender: m.quoted.sender || "", fromBot: Boolean(m.quoted.key?.fromMe) });
}

/** ملخص قصير لسياق النموذج («آخر عضو: أحمد · آخر VPS: 101 …») */
function brief(m) {
  const s = session(m, { create: false });
  if (!s) return {};
  const out = {};
  for (const slot of SLOTS) {
    const v = recall(m, slot);
    if (!v) continue;
    out[slot] = v.name || v.label || v.vpsId || v.id || v.url || v.command || v.summary || slot;
  }
  const action = lastAction(m);
  if (action) out.lastAction = `${action.kind}${action.targetName ? `:${action.targetName}` : ""}`;
  return out;
}

function _resetContext() {
  sessions.clear();
}

export { SLOTS, TTL_MS, _resetContext, brief, lastAction, observeMessage, recall, recordAction, remember };
export default { remember, recall, recordAction, lastAction, observeMessage, brief, SLOTS };
