// ═══════════════════════════════════════════════
// 🧪 Terboo Messaging + Broadcast Orchestrator — تكامل كامل
// ───────────────────────────────────────────────
// messageHandler الحقيقي (خاص المالك) ← محرّك الإجراءات ← وكيل المراسلة ← الصلاحيات ← بوت رئيسي + بوتان فرعيان
// مسجّلان في سجل البوتات الفرعية الحقيقي (jadibotSessions).
// السيناريوهات: رقم محلي ⇒ تطبيع + فحص واتساب + إرسال + سجل تدقيق بلا نص · تكرار ⇒ لا إرسال ثانٍ
// · رقم ليس على واتساب · غير المالك مرفوض · بالاسم ⇒ تأكيد ثم إرسال · تجربة الإذاعة (خطة بلا إرسال)
// · إذاعة لكل جروبات كل البوتات: بوت واحد لكل جروب · قائمة سوداء · مقفول بلا إشراف · تقرير
// · إيقاف ثم «كمل الإذاعة» بلا تكرار ما أُرسل · مخزن المجموعات لكل حساب (لا يعيد مجموعات بوت لآخر)
// · النموذج لا يختار رقماً لم يكتبه المستخدم.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111111";
const OWNER = "201000000999@s.whatsapp.net";
const STRANGER = "201200000077@s.whatsapp.net";
const AHMED = "201555555555@s.whatsapp.net";

global.terbooProviders = {
  map: { GeminiAPI: async () => ({ text: JSON.stringify({ decision: "CHAT", reply: "تمام", confidence: 0.9 }) }) },
  loadedAt: Date.now() + 3_600_000,
  names: ["GeminiAPI"],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-messaging-"));
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
process.env.TERBOO_VPS_STORE = path.join(tmp, "vps.json");
process.env.TERBOO_AGENT_STATE_DIR = path.join(tmp, "agent");
process.env.TERBOO_BROADCAST_GAP_MS = "0";
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
const { installBroadcast } = await import("../src/lib/terboo-broadcast.js");
const { jadibotSessions } = await import("../src/lib/terboo-jadibot-manager.js");
const { listAuditEvents } = await import("../src/lib/terboo-agent-audit.js");
const { runMessagingTool, parseMessagingRequest } = await import("../src/lib/terboo-messaging-agent.js");
db.setting("registrationRequired", false);
for (const jid of [OWNER, STRANGER]) db.setUser(jid, { isRegistered: true, regName: "مختبر", language: "ar" });
db.setting("contacts", { [AHMED]: { jid: AHMED, name: "أحمد" } });
db.setting("jpmBlacklist", ["120363000000000006@g.us"]);

const outbox = [];
const group = (id, subject, { announce = false, botAdmin = false, bot = BOT } = {}) => ({ id, subject, announce, participants: [{ id: `${bot}@s.whatsapp.net`, admin: botAdmin ? "admin" : null }] });
function makeSock(number, groups, { notOnWhatsApp = [] } = {}) {
  return {
    user: { id: `${number}:1@s.whatsapp.net` },
    ws: { readyState: 1 },
    groupFetchAllParticipating: async () => Object.fromEntries(groups.map((g) => [g.id, g])),
    onWhatsApp: async (number) => [{ exists: !notOnWhatsApp.includes(String(number)), jid: `${String(number).replace(/\D/g, "")}@s.whatsapp.net` }],
    sendMessage: async (chat, content) => {
      outbox.push({ from: number, chat, text: content?.text || content?.caption || "" });
      return { key: { id: `M${outbox.length}`, remoteJid: chat, fromMe: true } };
    },
    relayMessage: async (chat, message, opts) => {
      const node = message?.viewOnceMessage?.message?.interactiveMessage || message?.interactiveMessage;
      const buttons = (node?.nativeFlowMessage?.buttons || []).map((b) => { try { return JSON.parse(b.buttonParamsJson || "{}").id; } catch { return null; } });
      outbox.push({ from: number, chat, text: node?.body?.text || "", buttons });
      return opts?.messageId || `R${outbox.length}`;
    },
    sendPresenceUpdate: async () => { },
    readMessages: async () => { },
  };
}
const sock = makeSock(BOT, [
  group("120363000000000001@g.us", "عائلة"),
  group("120363000000000002@g.us", "شغل"),
  group("120363000000000003@g.us", "إعلانات", { announce: true }),
], { notOnWhatsApp: ["201099999999"] });
const CHILD1 = "201333000001";
const CHILD2 = "201333000002";
const child1 = makeSock(CHILD1, [group("120363000000000002@g.us", "شغل", { bot: CHILD1 }), group("120363000000000004@g.us", "أصحاب", { bot: CHILD1 })]);
const child2 = makeSock(CHILD2, [group("120363000000000005@g.us", "نادي", { bot: CHILD2 }), group("120363000000000006@g.us", "محظور", { bot: CHILD2 })]);
jadibotSessions.set(CHILD1, { sock: child1, jid: `${CHILD1}@s.whatsapp.net`, connectionReady: true, startedAt: Date.now() });
jadibotSessions.set(CHILD2, { sock: child2, jid: `${CHILD2}@s.whatsapp.net`, connectionReady: true, startedAt: Date.now() });
installBroadcast({ getSocket: () => sock });

let seq = 0;
function privateMessage(sender, text, { button = null } = {}) {
  const id = `PM${++seq}X${Date.now().toString(36).toUpperCase()}`;
  if (button) {
    return {
      key: { remoteJid: sender, fromMe: false, id },
      message: { interactiveResponseMessage: { body: { text: "" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id: button }), version: 3 }, contextInfo: { stanzaId: "BOTMSG", participant: `${BOT}@s.whatsapp.net`, quotedMessage: { conversation: "تأكيد" } } } },
      pushName: "المالك",
      messageTimestamp: Math.floor(Date.now() / 1000),
    };
  }
  return { key: { remoteJid: sender, fromMe: false, id }, message: { conversation: text }, pushName: "المالك", messageTimestamp: Math.floor(Date.now() / 1000) };
}
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
async function say(sender, text, options = {}) {
  const before = outbox.length;
  await messageHandler(privateMessage(sender, text, options), sock);
  await tick();
  const fresh = outbox.slice(before);
  return { replies: fresh.filter((x) => x.chat === sender).map((x) => x.text).join("\n"), sent: fresh.filter((x) => x.chat !== sender), buttons: fresh.flatMap((x) => x.buttons || []) };
}
const confirmButton = (r) => r.buttons.find((b) => /^terboo_grp_(?!no$)/.test(b));
async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (fn()) return true; await tick(20); }
  return false;
}
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("send-local-number", async () => {
  const r = await say(OWNER, "ابعت لـ 01012345678: ازيك يا صاحبي");
  assert.equal(r.sent.length, 1, `إرسال واحد: ${r.replies}`);
  assert.equal(r.sent[0].chat, "201012345678@s.whatsapp.net", "الصيغة المحلية ⇒ E.164 بدولة البوت");
  assert.equal(r.sent[0].text, "ازيك يا صاحبي", "النص كما كتبه المالك");
  assert.match(r.replies, /اتبعتت الرسالة/);
  const events = listAuditEvents({ limit: 5 }).filter((e) => e.type === "message.send_to_contact");
  assert.equal(events.at(-1).status, "sent");
  assert.doesNotMatch(JSON.stringify(events), /ازيك/, "سجل التدقيق بلا نص الرسالة");
  assert.doesNotMatch(JSON.stringify(events), /201012345678/, "ولا الرقم كاملاً");
});

await check("duplicate-not-resent", async () => {
  const r = await say(OWNER, "ابعت للرقم 201012345678: ازيك يا صاحبي");
  assert.equal(r.sent.length, 0, "نفس النص لنفس الشخص ⇒ لا إرسال ثانٍ");
  assert.match(r.replies, /مش هكررها/);
});

await check("not-on-whatsapp", async () => {
  const r = await say(OWNER, "ابعت لـ +20 109 999 9999: تجربة");
  assert.equal(r.sent.length, 0);
  assert.match(r.replies, /مش على واتساب/);
});

await check("stranger-denied", async () => {
  const r = await say(STRANGER, "ابعت لـ 01012345678: سلام");
  assert.equal(r.sent.length, 0);
  assert.match(r.replies, /لمالك البوت فقط/);
});

await check("send-by-name-confirmed", async () => {
  const r = await say(OWNER, "ابعت رسالة لأحمد وقوله هتأخر ربع ساعة");
  assert.equal(r.sent.length, 0, "بالاسم ⇒ تأكيد أولاً");
  const go = await say(OWNER, "", { button: confirmButton(r) });
  assert.equal(go.sent.length, 1);
  assert.equal(go.sent[0].chat, AHMED);
  assert.equal(go.sent[0].text, "هتأخر ربع ساعة");
});

await check("broadcast-dry-run", async () => {
  const r = await say(OWNER, "جرب الاذاعة");
  assert.equal(r.sent.length, 0, "لا إرسال في التجربة");
  assert.match(r.replies, /هتوصل لـ 4 جروب عبر 3 بوت/);
  assert.match(r.replies, /1 جروب فيه أكتر من بوت/);
  assert.match(r.replies, /1 جروب في القائمة السودا/);
  assert.match(r.replies, /1 جروب مقفول/);
});

await check("broadcast-all-bots", async () => {
  const r = await say(OWNER, "ابعت لكل الجروبات: عرض جديد اليوم");
  assert.equal(r.sent.length, 0, "تأكيد إلزامي");
  assert.match(r.replies, /إذاعة لـ 4 جروب عبر 3 بوت/);
  const before = outbox.length;
  await say(OWNER, "", { button: confirmButton(r) });
  assert.ok(await waitFor(() => outbox.some((x) => /خلصت الإذاعة/.test(x.text))), "تقرير نهائي");
  const sent = outbox.slice(before).filter((x) => x.chat.endsWith("@g.us"));
  const byGroup = new Map(sent.map((x) => [x.chat, x.from]));
  assert.equal(sent.length, 4, "كل جروب مرة واحدة");
  assert.equal(byGroup.get("120363000000000002@g.us"), BOT, "المشترك يُرسل من الرئيسي فقط");
  assert.equal(byGroup.get("120363000000000004@g.us"), CHILD1);
  assert.equal(byGroup.get("120363000000000005@g.us"), CHILD2);
  assert.ok(!byGroup.has("120363000000000006@g.us"), "القائمة السوداء محترمة");
  assert.ok(!byGroup.has("120363000000000003@g.us"), "المقفول بلا إشراف متخطى");
  assert.ok(sent.every((x) => x.text === "عرض جديد اليوم"));
  assert.ok(outbox.some((x) => /اتبعتت لـ 4 من 4/.test(x.text)));
});

await check("broadcast-stop-and-resume", async () => {
  const { startBroadcast } = await import("../src/lib/terboo-broadcast.js");
  const { taskOwner } = await import("../src/lib/terboo-task-control.js");
  const who = taskOwner({ sender: OWNER, chat: OWNER });
  process.env.TERBOO_BROADCAST_GAP_MS = "150";
  const items = ["1", "2", "4"].map((n) => ({ groupId: `12036300000000000${n}@g.us`, sender: n === "4" ? `child:${CHILD1}` : "main" }));
  const before = outbox.length;
  const started = startBroadcast({ text: "نسخة ثانية", items, owner: who.owner, scope: who.scope, title: "إذاعة اختبار" });
  assert.ok(await waitFor(() => outbox.slice(before).length >= 2), "بدأ الإرسال");
  const stop = await say(OWNER, "وقف الاذاعة");
  assert.match(stop.replies, /إذاعة اختبار/);
  await started.done.catch(() => null);
  const firstRun = outbox.slice(before).filter((x) => x.text === "نسخة ثانية").length;
  assert.ok(firstRun < 3, "توقف قبل الإكمال");
  process.env.TERBOO_BROADCAST_GAP_MS = "0";
  const resume = await say(OWNER, "كمل الاذاعة");
  assert.match(resume.replies, /استأنفت/);
  assert.ok(await waitFor(() => outbox.slice(before).filter((x) => x.text === "نسخة ثانية").length === 3), "أُكملت");
  const all = outbox.slice(before).filter((x) => x.text === "نسخة ثانية").map((x) => x.chat);
  assert.equal(new Set(all).size, 3, "لا جروب استلم مرتين");
});

await check("per-account-group-cache", async () => {
  const { fetchGroupsSafe } = await import("../src/lib/terboo-jpm-helper.js");
  const a = await fetchGroupsSafe(sock);
  const b = await fetchGroupsSafe(child2);
  assert.notDeepEqual(Object.keys(a), Object.keys(b), "مجموعات كل بوت له لا لغيره");
});

await check("model-cannot-pick-number", async () => {
  const m = { sender: OWNER, chat: OWNER, isGroup: false, mentionedJid: [], reply: async (text) => outbox.push({ chat: OWNER, text }) };
  const before = outbox.length;
  await runMessagingTool({ id: "message.send_to_contact", input: { names: ["201077777777"], text: "hi" }, m, sock, lang: "ar", text: "ابعت رسالة لصاحبي" });
  assert.equal(outbox.slice(before).filter((x) => x.chat !== OWNER).length, 0, "رقم لم يكتبه المستخدم ⇒ لا إرسال");
  assert.equal(parseMessagingRequest("ابعت لي: الكود"), null, "«ابعت لي» ليست إرسالاً لطرف ثالث");
  assert.equal(parseMessagingRequest("ابعت الصورة لأحمد"), null, "بلا نص رسالة ⇒ ليست مراسلة");
});

console.log(`✅ terboo-messaging: ${results.join(" · ")}`);
jadibotSessions.delete(CHILD1);
jadibotSessions.delete(CHILD2);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* مجلد مؤقت */ }
process.exit(0);
