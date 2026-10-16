// ═══════════════════════════════════════════════
// 🧪 Smart Button Engine (§33–§42)
// ───────────────────────────────────────────────
// 1. وصف الواجهة لكل أمر من بيانات البلوقن الحقيقية: المدمّر · يحتاج هدفاً/نصاً/رداً · خيارات · مالك.
// 2. سياسة الأزرار: لا زر لما لا يملك المستخدم صلاحيته · لا زر لأمر يحتاج نصاً حراً · المدمّر تأكيد فقط.
// 3. النواة الحقيقية: النموذج يقترح responseMode ⇒ السياسة تقرر ⇒ أزرار حقيقية (relay) ⇒ الضغط
//    (terboo_pick_N / yes / no) يمر بالمعلّق والصلاحيات الحقيقية ويصل للموزّع.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-buttons-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
memory.resetAll();
const core = await import("../src/lib/terboo-ai-core.js");
const ui = await import("../src/lib/terboo-command-ui.js");
const { dispatchCommand } = await import("../src/lib/terboo-command-dispatch.js");

const results = [];
async function check(name, fn) {
  await fn();
  results.push(name);
}

const BOT = "2348093093240";
const USER = "201000000001@s.whatsapp.net";
const GROUP = "120363000000000999@g.us";

// ── واتساب وهمي يسجّل الرسائل التفاعلية الحقيقية (relay) والنصوص ──
const sent = [];
const sock = {
  user: { id: `${BOT}:12@s.whatsapp.net` },
  async relayMessage(jid, message) {
    const interactive = message?.viewOnceMessage?.message?.interactiveMessage || message?.interactiveMessage;
    sent.push({ kind: "relay", jid, interactive });
    return { key: { id: `relay-${sent.length}` } };
  },
  async sendMessage(jid, content) {
    sent.push({ kind: "send", jid, text: content?.text || content?.caption || "" });
    return { key: { id: `send-${sent.length}` } };
  },
};
function lastButtons() {
  const relay = [...sent].reverse().find((s) => s.kind === "relay");
  return (relay?.interactive?.nativeFlowMessage?.buttons || []).map((b) => { try { return JSON.parse(b.buttonParamsJson || "{}").id; } catch { return null; } }).filter(Boolean);
}

// ── نموذج مُبرمج + موزّع حقيقي بمعالج نهائي مسجِّل ──
const calls = [];
let script = () => ({ decision: "CHAT", reply: "…", confidence: 0.9 });
async function ask(payload) {
  calls.push(payload);
  return { text: JSON.stringify(script(payload)), provider: "Scripted" };
}
const executed = [];
async function recordingHandler(synthetic, _sock, options) {
  executed.push(synthetic.message.extendedTextMessage.text);
  options.observer.done({ ok: true, status: "done" });
}
const dispatch = (m, s, request) => dispatchCommand(m, s, request, { handler: recordingHandler });
const deps = { ask, dispatch, rateLimit: false };

let seq = 0;
function message({ sender = USER, body, group = false, isOwner = false, isAdmin = false }) {
  const replies = [];
  return {
    key: { remoteJid: group ? GROUP : sender, fromMe: false, id: `SB${++seq}`, ...(group ? { participant: sender } : {}) },
    sender, chat: group ? GROUP : sender, isGroup: group, body: group ? `@${BOT} ${body}` : body,
    pushName: "مختبر", type: "conversation", isCommand: false, prefix: ".",
    isOwner, isPremium: false, isPartner: false, isAdmin, isBotAdmin: true, isBot: false, fromMe: false, isNewsletter: false,
    mentionedJid: group ? [`${BOT}@s.whatsapp.net`] : [], quoted: null, replies,
    async reply(text) { replies.push(String(text)); return { key: { id: "r" } }; },
    async react() { },
  };
}
async function say(opts) {
  const m = message(opts);
  const result = await core.runKernel(m, sock, db, deps);
  return { m, result, text: m.replies.join("\n") };
}

// ═══ 1. وصف الواجهة من بيانات البلوقن ═══
await check("ui-descriptor", async () => {
  const kick = ui.uiOf("طرد");
  assert.equal(kick.destructive, true, "الطرد مدمّر");
  assert.equal(kick.requiresTarget, true);
  assert.equal(kick.eligible, false, "لا زر عام للطرد");
  assert.equal(kick.mode, "confirm-after-target", "الطرد: تأكيد بعد تحديد الهدف");
  const menu = ui.uiOf("menu");
  assert.equal(menu.eligible, true);
  assert.equal(menu.mode, "select", "القائمة: خيارات محدودة من الاستعمال نفسه");
  assert.ok(menu.options.length >= 2);
  const restart = ui.uiOf("رستارت");
  assert.equal(restart.ownerOnly, true);
  assert.equal(restart.eligible, true, "رستارت ⇒ زر (للمالك)");
  assert.equal(ui.uiOf("شغل").requiresText, true, "«شغل <بحث>» يحتاج نصاً حراً ⇒ لا زر");
  assert.equal(ui.uiOf("شغل").eligible, false);
  assert.equal(ui.uiOf("حذف").requiresReply, true, "«حذف (رد على رسالة)» يحتاج رداً ⇒ لا زر");
  const welcome = ui.uiOf("ترحيب");
  assert.ok(welcome.options.includes("تشغيل") && welcome.options.includes("إيقاف"), "خيارات الترحيب من الاستعمال");
  assert.equal(welcome.adminOnly, true);
});

// ═══ 2. سياسة الأزرار ═══
await check("button-policy", async () => {
  const user = message({});
  assert.equal(ui.buttonFor({ command: "رستارت", m: user }).reason, "permission", "لا زر مالك لغير المالك");
  assert.equal(ui.buttonFor({ command: "رستارت", m: message({ isOwner: true }) }).allowed, true);
  assert.equal(ui.buttonFor({ command: "شغل", m: user }).reason, "needs-text");
  assert.equal(ui.buttonFor({ command: "شغل", args: "عمرو دياب", m: user }).allowed, true, "النص معروف ⇒ زر");
  const admin = message({ group: true, isAdmin: true });
  assert.equal(ui.buttonFor({ command: "طرد", m: admin }).reason, "needs-target");
  assert.equal(ui.buttonFor({ command: "طرد", args: "@201000000077", m: admin }).mode, "confirm", "الهدف معروف ⇒ تأكيد لا زر مباشر");
  assert.equal(ui.resolveResponseMode({ proposed: "buttons", options: [{ command: "menu" }, { command: "بروفايل" }], m: user }).mode, "buttons");
  assert.equal(ui.resolveResponseMode({ proposed: "text", options: [{ command: "menu" }, { command: "بروفايل" }], m: user }).mode, "text", "النموذج طلب نصاً");
  const mixed = ui.resolveResponseMode({ proposed: "buttons", options: [{ command: "menu" }, { command: "طرد", args: "@201000000077" }], m: admin });
  assert.equal(mixed.mode, "text", "خيار مدمّر بين الخيارات ⇒ لا أزرار مباشرة");
  assert.equal(ui.resolveResponseMode({ proposed: "confirm", options: [{ command: "طرد", args: "@201000000077" }], m: admin }).mode, "confirm");
  assert.equal(ui.resolveResponseMode({ proposed: "buttons", options: [{ command: "شغل" }, { command: "menu" }], m: user }).mode, "text", "خيار يحتاج نصاً ⇒ لا أزرار جزئية");
});

// ═══ 3. النواة: اقتراح ⇒ سياسة ⇒ أزرار حقيقية ⇒ ضغط ⇒ تنفيذ عبر الصلاحيات ═══
await check("kernel-clarification-buttons", async () => {
  script = () => ({ decision: "CLARIFICATION", reply: "تقصد أيهما؟", options: [{ command: "menu", args: "" }, { command: "بروفايل", args: "" }], responseMode: "buttons", confidence: 0.5 });
  sent.length = 0;
  await say({ body: "وريني حاجة" });
  assert.deepEqual(lastButtons(), ["terboo_pick_1", "terboo_pick_2"], "أزرار اختيار حقيقية");
  const before = executed.length;
  await say({ body: "terboo_pick_2" });
  assert.equal(executed.length, before + 1, "الضغط نفّذ أمراً واحداً");
  assert.match(executed.at(-1), /^\.(?:بروفايل|profile)/u, "الخيار الثاني عبر الموزّع الحقيقي");
  assert.equal(memory.peekPending(message({})), null, "المعلّق استُهلك");
});

await check("kernel-no-buttons-when-unsafe", async () => {
  script = () => ({ decision: "CLARIFICATION", reply: "أي واحد؟", options: [{ command: "شغل", args: "" }, { command: "menu", args: "" }], responseMode: "buttons", confidence: 0.5 });
  sent.length = 0;
  const r = await say({ body: "اعمل حاجة" });
  assert.equal(lastButtons().length, 0, "خيار يحتاج نصاً ⇒ لا أزرار");
  assert.match(r.text, /2\./, "الخيارات نصاً مرقّمة");
  memory.takePending(r.m);
});

await check("kernel-confirm-buttons", async () => {
  script = () => ({ decision: "COMMAND", command: "menu", args: "", reply: "تقصد القائمة؟", responseMode: "confirm", confidence: 0.3 });
  sent.length = 0;
  await say({ body: "الحاجات" });
  assert.deepEqual(lastButtons(), ["terboo_pick_yes", "terboo_pick_no"], "تأكيد بنعم/لا");
  const before = executed.length;
  const no = await say({ body: "terboo_pick_no" });
  assert.equal(executed.length, before, "لا ⇒ لا تنفيذ");
  assert.match(no.text, /إلغاء|ألغ/u);
  await say({ body: "الحاجات" });
  await say({ body: "terboo_pick_yes" });
  assert.equal(executed.length, before + 1, "نعم ⇒ تنفيذ واحد");
});

await check("kernel-owner-button-hidden", async () => {
  script = () => ({ decision: "COMMAND", command: "رستارت", args: "", reply: "تقصد إعادة التشغيل؟", responseMode: "confirm", confidence: 0.3 });
  sent.length = 0;
  const r = await say({ body: "ريستارت للبوت" });
  assert.equal(lastButtons().length, 0, "غير المالك لا يرى زر أمر مالك");
  memory.takePending(r.m);
});

// ═══ 4. docs/terboo-command-ui-matrix.json مطابق للمحرك الحيّ ═══
await check("matrix-fresh", async () => {
  const doc = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs", "terboo-command-ui-matrix.json"), "utf8"));
  const live = ui.uiMatrix();
  assert.equal(doc.commands.length, live.length, "كل أمر حيّ في المصفوفة — شغّل node tools/terboo-command-ui-matrix.mjs");
  const byName = new Map(live.map((row) => [row.command, row]));
  for (const row of doc.commands) assert.deepEqual(row, JSON.parse(JSON.stringify(byName.get(row.command))), `صف قديم: ${row.command}`);
});

console.log(`✅ terboo-smart-buttons: ${results.length} — ${results.join(" · ")}`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* مجلد مؤقت */ }
process.exit(0);
