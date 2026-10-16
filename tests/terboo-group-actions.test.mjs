// ═══════════════════════════════════════════════
// 🧪 Terboo Group Actions — تكامل كامل بالكلام الطبيعي
// ───────────────────────────────────────────────
// messageHandler الحقيقي ← النواة ← محرّك الإجراءات ← وكيل المجموعة ← محرّك الصلاحيات ← واتساب وهمي
// تتغير حالته فعلاً (أعضاء · قفل · اسم · رابط · قائمة حظر) ← تحقق بقراءة حديثة.
// السيناريوهات (V6): طرد الكل إلا أحمد (دفعات + rate-limit + حماية + تقرير) · طرد الكل (حدود تقنية)
// · مشرف يطلب الطرد الجماعي ⇒ مالك فقط · طرد/ترقية عدة محددين · قفل/فتح فوري وبمدة وبعد مدة + إلغاء
// · حالة الجروب · عضو بلا صلاحية · حظر/فك حظر (مالك فقط، تأكيد) · الرابط وتغييره · الاسم
// · «وقف التنصيب» يوقف التنصيب فقط · استئناف صادق لجدولة قاطعها الإيقاف · أدوات النموذج بلا JID.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111111";
const BOT_JID = `${BOT}@s.whatsapp.net`;
const GROUP = "120363000000000888@g.us";
const OWNER = "201000000999@s.whatsapp.net";
const CREATOR = "201200000001@s.whatsapp.net";
const ADMIN = "201200000002@s.whatsapp.net";
const MEMBER = "201200000003@s.whatsapp.net";
const AHMED = "201555555555@s.whatsapp.net";
const SARA = "201688888888@s.whatsapp.net";
const KAREEM = "201699999999@s.whatsapp.net";

global.terbooProviders = {
  map: { GeminiAPI: async () => ({ text: JSON.stringify({ decision: "CHAT", reply: "تمام", confidence: 0.9 }) }) },
  loadedAt: Date.now() + 3_600_000,
  names: ["GeminiAPI"],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-group-actions-"));
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
process.env.TERBOO_VPS_STORE = path.join(tmp, "vps.json");
process.env.TERBOO_BULK_GAP_MS = "0";
process.env.TERBOO_BULK_BACKOFF_MS = "5";
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
config.owner.number = [OWNER.split("@")[0]];
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");
const tasks = await import("../src/lib/terboo-task-queue.js");
const G = await import("../src/lib/terboo-group-actions.js");
const agent = await import("../src/lib/terboo-group-agent.js");
const { taskOwner } = await import("../src/lib/terboo-task-control.js");
db.setting("registrationRequired", false);

// ── واتساب وهمي بحالة حقيقية ──
const extras = Array.from({ length: 9 }, (_, i) => ({ id: `2017000000${String(i).padStart(2, "0")}@s.whatsapp.net`, admin: null, notify: `عضو ${i + 1}` }));
let participants = [
  { id: BOT_JID, admin: "admin" },
  { id: CREATOR, admin: "superadmin", notify: "المنشئ" },
  { id: OWNER, admin: null, notify: "المالك" },
  { id: ADMIN, admin: "admin", notify: "مشرف" },
  { id: MEMBER, admin: null, notify: "عضو عادي" },
  { id: AHMED, admin: null, notify: "أحمد" },
  { id: SARA, admin: null, notify: "Sara" },
  { id: KAREEM, admin: null, notify: "كريم" },
  ...extras,
];
const state = { subject: "جروب الاختبار", desc: "", announce: false, restrict: false, code: "CODE1", codes: 1, blocked: new Set(), rateLimitOnce: false };
const ops = [];
const sent = [];
const relays = [];
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net` },
  groupMetadata: async () => ({ id: GROUP, subject: state.subject, desc: state.desc, announce: state.announce, restrict: state.restrict, owner: CREATOR, size: participants.length, participants: participants.map((p) => ({ ...p })) }),
  groupSettingUpdate: async (jid, setting) => {
    ops.push({ action: "setting", setting });
    if (setting === "announcement") state.announce = true;
    if (setting === "not_announcement") state.announce = false;
    if (setting === "locked") state.restrict = true;
    if (setting === "unlocked") state.restrict = false;
  },
  groupParticipantsUpdate: async (chat, jids, action) => {
    if (state.rateLimitOnce) {
      state.rateLimitOnce = false;
      ops.push({ action: `${action}:rate-limited`, jids: [...jids] });
      throw Object.assign(new Error("rate-overlimit"), { data: 429 });
    }
    ops.push({ action, jids: [...jids] });
    return jids.map((jid) => {
      const p = participants.find((x) => x.id === jid);
      if (!p) return { jid, status: "404" };
      if (action === "remove" && p.admin === "superadmin") return { jid, status: "403" };
      if (action === "remove") participants = participants.filter((x) => x.id !== jid);
      if (action === "promote") p.admin = "admin";
      if (action === "demote") p.admin = null;
      return { jid, status: "200" };
    });
  },
  groupUpdateSubject: async (jid, subject) => { ops.push({ action: "subject" }); state.subject = subject; },
  groupUpdateDescription: async (jid, desc) => { ops.push({ action: "description" }); state.desc = desc || ""; },
  groupInviteCode: async () => state.code,
  groupRevokeInvite: async () => { ops.push({ action: "revoke" }); state.codes += 1; state.code = `CODE${state.codes}`; return state.code; },
  updateBlockStatus: async (jid, action) => { ops.push({ action, jids: [jid] }); if (action === "block") state.blocked.add(jid); else state.blocked.delete(jid); },
  fetchBlocklist: async () => [...state.blocked],
  sendMessage: async (chat, content) => { sent.push({ chat, text: content?.text || content?.caption || "" }); return { key: { id: `S${sent.length}`, remoteJid: chat, fromMe: true } }; },
  relayMessage: async (chat, message, opts) => {
    const node = message?.viewOnceMessage?.message?.interactiveMessage || message?.interactiveMessage;
    const buttons = (node?.nativeFlowMessage?.buttons || []).map((b) => { try { return JSON.parse(b.buttonParamsJson || "{}").id; } catch { return null; } });
    relays.push({ chat, text: node?.body?.text || "", buttons });
    return opts?.messageId || `R${relays.length}`;
  },
  sendPresenceUpdate: async () => { },
  readMessages: async () => { },
};
G.installGroupActions({ getSocket: () => sock });

let seq = 0;
function groupMessage(sender, text, { mentions = [], button = null, raw = false } = {}) {
  const id = `GA${++seq}X${Date.now().toString(36).toUpperCase()}`;
  if (button) {
    return {
      key: { remoteJid: GROUP, participant: sender, fromMe: false, id },
      message: { interactiveResponseMessage: { body: { text: "" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id: button }), version: 3 }, contextInfo: { stanzaId: "BOTMSG", participant: BOT_JID, quotedMessage: { conversation: "تأكيد" } } } },
      pushName: "مختبر",
      messageTimestamp: Math.floor(Date.now() / 1000),
    };
  }
  return {
    key: { remoteJid: GROUP, participant: sender, fromMe: false, id },
    message: { extendedTextMessage: { text: raw ? text : `@${BOT} ${text}`, contextInfo: { mentionedJid: raw ? mentions : [BOT_JID, ...mentions] } } },
    pushName: "مختبر",
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function say(sender, text, options = {}) {
  const before = { sent: sent.length, relays: relays.length, ops: ops.length };
  await messageHandler(groupMessage(sender, text, options), sock);
  await tick();
  return {
    replies: [...sent.slice(before.sent).map((x) => x.text), ...relays.slice(before.relays).map((x) => x.text)].join("\n"),
    ops: ops.slice(before.ops),
    buttons: relays.slice(before.relays).flatMap((r) => r.buttons).filter(Boolean),
  };
}
const confirmButton = (r) => r.buttons.find((b) => /^terboo_grp_(?!no$)/.test(b));
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await tick(20); }
  return false;
}
const isMember = (jid) => participants.some((p) => p.id === jid);
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("lock-now-verified", async () => {
  const r = await say(ADMIN, "اقفل الجروب");
  assert.deepEqual(r.ops.map((o) => o.setting), ["announcement"], "قفل حقيقي واحد");
  assert.equal(state.announce, true);
  assert.match(r.replies, /اتقفل الجروب/);
  assert.doesNotMatch(r.replies, /مقدرتش أتأكد/, "متحقق منه");
  // نص مختلف: حارس الحلقات يتجاهل نفس النص من نفس الشخص خلال نافذة قصيرة (سلوك مقصود)
  const again = await say(ADMIN, "قفل المجموعة");
  assert.equal(again.ops.length, 0, "مقفول بالفعل ⇒ لا كتابة مكررة");
  assert.match(again.replies, /مقفول بالفعل/);
});

await check("settings-get", async () => {
  const r = await say(MEMBER, "الجروب مقفول؟");
  assert.match(r.replies, /الرسائل: المشرفين بس/);
  assert.match(r.replies, /الأعضاء: 17/);
});

await check("member-denied", async () => {
  const r = await say(MEMBER, "افتح الجروب");
  assert.equal(r.ops.length, 0);
  assert.match(r.replies, /لمشرفي المجموعة فقط/);
  assert.equal(state.announce, true);
});

await check("unlock-later-scheduled-and-cancel", async () => {
  const r = await say(ADMIN, "افتح الجروب بعد 30 دقيقة");
  assert.equal(r.ops.length, 0, "لا شيء الآن");
  assert.match(r.replies, /هفتح الجروب بعد 30 دقيقة/);
  const pending = G.pendingSchedules(GROUP);
  assert.equal(pending.length, 1);
  assert.ok(pending[0].notBefore > Date.now() + 29 * 60_000, "موعد حقيقي بعد 30 دقيقة");
  assert.equal(tasks.getQueueSummary().active, 0, "المؤجّلة لا تحجز خانة تنفيذ");
  const status = await say(ADMIN, "حالة الجروب");
  assert.match(status.replies, /مجدول: فتح الجروب/);
  const cancel = await say(ADMIN, "الغي المؤقت");
  assert.match(cancel.replies, /تم إيقاف المهمة/);
  assert.equal(G.pendingSchedules(GROUP).length, 0);
});

await check("lock-for-duration", async () => {
  await say(ADMIN, "افتح الجروب");
  assert.equal(state.announce, false);
  const r = await say(ADMIN, "اقفل الجروب ساعة");
  assert.equal(state.announce, true, "قُفل الآن");
  assert.match(r.replies, /هفتح الجروب بعد 1 ساعة/);
  const pending = G.pendingSchedules(GROUP);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].input.op, "unlock", "مهمة عكسية");
  // الزر القديم .الغاء_مؤقت مربوط بالجدولة الجديدة
  const old = await say(ADMIN, ".الغاء_مؤقت", { raw: true });
  assert.match(old.replies, /تم إلغاء المؤقت/);
  assert.equal(G.pendingSchedules(GROUP).length, 0);
});

await check("kick-all-admin-needs-owner", async () => {
  const r = await say(ADMIN, "اطرد الكل");
  assert.equal(r.ops.length, 0);
  assert.match(r.replies, /لمالك البوت فقط/);
});

await check("kick-all-except-ahmed-batches", async () => {
  const before = participants.length;
  const r = await say(OWNER, "اطرد كل الأعضاء إلا أحمد");
  assert.equal(r.ops.length, 0, "لا تنفيذ قبل التأكيد");
  assert.match(r.replies, /طرد 12 عضو/, `الخطة: كل الأعضاء العاديين عدا أحمد والمالك — ${r.replies}`);
  assert.match(r.replies, /منشئ المجموعة/);
  const button = confirmButton(r);
  assert.ok(button, "زر تأكيد");
  state.rateLimitOnce = true;
  const go = await say(OWNER, "", { button });
  assert.match(go.replies, /بدأ طرد 12 عضو/);
  assert.ok(await waitFor(() => sent.some((x) => /خلص الطرد الجماعي/.test(x.text))), "تقرير نهائي");
  const report = sent.filter((x) => /خلص الطرد الجماعي/.test(x.text)).pop().text;
  assert.match(report, /اتطرد 12 من 12/);
  assert.match(report, /قراءة جديدة من واتساب/);
  assert.match(report, /نبطّأ/, "rate-limit مذكور بصدق");
  assert.ok(isMember(AHMED), "أحمد باقٍ");
  for (const jid of [BOT_JID, CREATOR, OWNER, ADMIN]) assert.ok(isMember(jid), `${jid} محمي`);
  assert.equal(participants.length, before - 12);
  const removes = ops.filter((o) => o.action === "remove");
  assert.ok(removes.length >= 3, "دفعات (5 · 5 · 2) لا طلب واحد ضخم");
  assert.ok(removes.every((o) => o.jids.length <= 5));
  const retried = ops.find((o) => o.action === "remove:rate-limited");
  assert.ok(retried, "rate-limit حدث");
});

await check("kick-all-technical-limits", async () => {
  const r = await say(OWNER, "اطرد الكل");
  assert.equal(r.ops.length, 0);
  assert.match(r.replies, /طرد 1 عضو/, "من بقي فقط (أحمد)");
  assert.match(r.replies, /منشئ المجموعة لا يمكن إزالته/, "حدود واتساب التقنية مذكورة");
  assert.match(r.replies, /هذا البوت نفسه/);
  assert.match(r.replies, /المشرفون مستثنون/, "سبب لكل مستثنى");
  const no = await say(OWNER, "", { button: "terboo_grp_no" });
  assert.match(no.replies, /اتلغى/);
  assert.ok(isMember(AHMED));
});

await check("selected-promote-and-demote", async () => {
  participants.push({ id: SARA, admin: null, notify: "سارة" }, { id: KAREEM, admin: null, notify: "كريم" });
  // حدث الانضمام كما يصل من الاتصال الحقيقي (يحدّث الدليل بلا قراءة كاملة)
  const directory = await import("../src/lib/terboo-group-directory.js");
  directory.applyParticipantsUpdate({ id: GROUP, participants: [{ id: SARA, notify: "سارة" }, { id: KAREEM, notify: "كريم" }], action: "add" });
  const r = await say(ADMIN, "رقي سارة وكريم");
  assert.equal(r.ops.length, 0);
  const button = confirmButton(r);
  assert.ok(button, `تأكيد للترقية الجماعية: ${r.replies}`);
  await say(ADMIN, "", { button });
  assert.ok(await waitFor(() => participants.filter((p) => [SARA, KAREEM].includes(p.id)).every((p) => p.admin)), "ترقية متحققة");
  assert.ok(await waitFor(() => sent.some((x) => /اترقى 2 من 2/.test(x.text))));
  const mentions = await say(ADMIN, `شيل الادمن من @${SARA.split("@")[0]} @${KAREEM.split("@")[0]}`, { mentions: [SARA, KAREEM] });
  const demote = confirmButton(mentions);
  assert.ok(demote, `منشن متعدد ⇒ تنفيذ جماعي: ${mentions.replies}`);
  await say(ADMIN, "", { button: demote });
  assert.ok(await waitFor(() => participants.filter((p) => [SARA, KAREEM].includes(p.id)).every((p) => !p.admin)));
});

await check("selected-kick-cancel", async () => {
  const r = await say(ADMIN, "اطرد سارة وكريم");
  assert.ok(confirmButton(r));
  const no = await say(ADMIN, "", { button: "terboo_grp_no" });
  assert.match(no.replies, /اتلغى/);
  assert.ok(isMember(SARA) && isMember(KAREEM), "إلغاء = لا تنفيذ");
});

await check("block-owner-only-with-confirm", async () => {
  const denied = await say(ADMIN, "احظر سارة");
  assert.match(denied.replies, /لمالك البوت فقط/);
  assert.equal(denied.ops.length, 0);
  const r = await say(OWNER, "احظر سارة");
  assert.equal(r.ops.length, 0, "تأكيد أولاً");
  await say(OWNER, "", { button: confirmButton(r) });
  assert.ok(state.blocked.has(SARA), "حظر حقيقي");
  assert.ok(sent.some((x) => /اتحظر سارة/.test(x.text)));
  const unblock = await say(OWNER, "فك الحظر عن سارة");
  assert.equal(state.blocked.has(SARA), false, "فك الحظر بلا تأكيد (غير مدمّر)");
  assert.match(unblock.replies, /اتفك الحظر/);
  const self = await say(OWNER, `احظر @${BOT}`, { mentions: [BOT_JID] });
  assert.equal(self.ops.length, 0, "البوت لا يحظر نفسه");
});

await check("invite-and-revoke", async () => {
  const r = await say(ADMIN, "هات لينك الجروب");
  assert.match(r.replies, /chat\.whatsapp\.com\/CODE1/);
  const ask = await say(ADMIN, "غير اللينك");
  assert.equal(ask.ops.length, 0, "تغيير الرابط يحتاج تأكيداً");
  const done = await say(ADMIN, "", { button: confirmButton(ask) });
  assert.match(done.replies, /CODE2/);
  assert.equal(state.code, "CODE2");
});

await check("subject-verified", async () => {
  const r = await say(ADMIN, "غير اسم الجروب لـ «أصحاب الكلية»");
  assert.equal(state.subject, "أصحاب الكلية");
  assert.match(r.replies, /اتغير اسم الجروب/);
});

await check("stop-install-only", async () => {
  const who = taskOwner({ sender: OWNER, chat: GROUP });
  const longRun = (ctx) => new Promise((resolve, reject) => ctx.signal.addEventListener("abort", () => reject(Object.assign(new Error("task_cancelled"), { code: "TASK_CANCELLED" }))));
  const download = tasks.enqueueTask({ type: "tool:aio", title: "تحميل فيديو", owner: who.owner, scope: who.scope, run: longRun });
  const install = tasks.enqueueTask({ type: "vps.reinstall", title: "تنصيب Ubuntu", owner: who.owner, scope: who.scope, run: longRun });
  await tick();
  const r = await say(OWNER, "وقف التنصيب");
  assert.match(r.replies, /تنصيب Ubuntu/);
  await tick();
  assert.equal(tasks.getTask(install.id).status, "cancelled", "التنصيب أُلغي");
  assert.equal(tasks.getTask(download.id).status, "running", "التحميل لم يُمس");
  const none = await say(OWNER, "وقف البرودكاست");
  assert.match(none.replies, /لا توجد مهمة من هذا النوع/, "لا يوقف شيئاً آخر بدلاً منه");
  tasks.cancelTask(download.id, null);
});

await check("truthful-resume-after-restart", async () => {
  // جدولة كانت قائمة ثم توقف البوت وفات موعدها ⇒ تُنفَّذ عند الإقلاع مع إشعار تأخير صادق
  await say(ADMIN, "قفل الشات");
  assert.equal(state.announce, true);
  const file = process.env.TERBOO_TASKS_PATH;
  const at = Date.now() - 10 * 60_000;
  const rows = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
  rows.push({ id: "TASK-OLD-SCHED", type: "group.schedule", title: "فتح الجروب", owner: "pn:201200000002", scope: GROUP, priority: 1, status: "queued", progress: 0, note: "", createdAt: at - 60_000, startedAt: null, finishedAt: null, error: null, retryCount: 0, maxRetries: 0, parentTask: null, childTasks: [], provider: null, tool: null, cancellation: null, resumable: true, checkpoint: null, summary: null, artifacts: [], input: { groupId: GROUP, op: "unlock", at, lang: "ar", chat: GROUP }, notBefore: at });
  fs.writeFileSync(file, JSON.stringify(rows));
  tasks._resetTasks();
  assert.ok(tasks.restoreInterrupted() >= 1, "ما كان معلّقاً ⇒ waiting");
  const { resumed } = G.installGroupActions({ getSocket: () => sock });
  assert.equal(resumed, 1, "الجدولة تُستأنف تلقائياً");
  assert.ok(await waitFor(() => state.announce === false), "نُفّذ الفتح");
  assert.ok(await waitFor(() => sent.some((x) => /اتنفذ متأخر 10 دقيقة/.test(x.text))), "إشعار التأخير الحقيقي");
  assert.equal(tasks.getTask("TASK-OLD-SCHED").status, "cancelled", "السجل القديم لا يُستأنف مرتين");
  assert.match(tasks.getTask("TASK-OLD-SCHED").note, /^resumed-as:/);
});

await check("model-tools-names-only", async () => {
  const mAdmin = { sender: ADMIN, chat: GROUP, isGroup: true, mentionedJid: [], reply: async (text) => sent.push({ chat: GROUP, text }) };
  const adminTools = await agent.groupToolsForModel(mAdmin, sock, "اقفل الجروب");
  assert.match(adminTools, /group\.settings\.lock/);
  assert.doesNotMatch(adminTools, /kickAll/, "الطرد الكلي لا يظهر لغير المالك");
  assert.doesNotMatch(adminTools, /contact\.block/);
  const mMember = { ...mAdmin, sender: MEMBER };
  const memberTools = await agent.groupToolsForModel(mMember, sock, "اقفل الجروب");
  assert.doesNotMatch(memberTools, /settings\.lock/, "العضو لا يرى أدوات المشرفين");
  assert.match(memberTools, /settings\.get/);
  // النموذج يمرر JID/رقماً لم يكتبه المستخدم ⇒ يُتجاهل (لا هدف مختلق)
  const before = ops.length;
  const handled = await agent.runGroupTool({ id: "group.members.kickSelected", input: { names: ["201699999999@s.whatsapp.net", "201699999999"] }, m: mAdmin, sock, lang: "ar", text: "اطردهم" });
  assert.equal(handled, "answered");
  assert.equal(ops.length, before, "لا تنفيذ على JID من النموذج");
  assert.ok(isMember(KAREEM));
});

console.log(`✅ terboo-group-actions: ${results.join(" · ")}`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* مجلد مؤقت */ }
process.exit(0);
