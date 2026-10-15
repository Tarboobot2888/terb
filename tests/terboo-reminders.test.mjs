// ═══════════════════════════════════════════════
// 🧪 Terboo Reminders (§21 §48)
// ───────────────────────────────────────────────
//   1. فهم الوقت بلا نموذج: نسبي · مطلق · غداً · يومي · ص/م · أرقام عربية · عربي/إنجليزي/إسباني.
//   2. عبر النواة: ضبط تذكير حقيقي في المجدول · إشارة في المجموعة · بلا نداء نموذج.
//   3. لا وعود كاذبة: بلا وقت ⇒ سؤال · فعل تلقائي متكرر ⇒ رد صريح · لا جدولة.
//   4. الخصوصية: «تذكيراتي» و«الغي التذكير» لصاحبها فقط · الحد الأقصى لكل مستخدم.
//   5. المجدول الحقيقي: تذكير بعد 3 أيام يُجدول ليومه بالضبط (لا «أقرب hour:minute») ويُحفظ ويُلغى.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-reminders-"));
process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid.json");
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
memory.resetAll();
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const core = await import("../src/lib/terboo-ai-core.js");
const { parseReminder, REMINDER_LIMITS } = await import("../src/lib/terboo-reminders.js");
const realScheduler = await import("../src/lib/terboo-scheduler.js");

const NOW = Date.parse("2026-10-02T12:00:00Z"); // 15:00 بتوقيت القاهرة
const cairo = (date) => new Date(date).toLocaleString("en-GB", { timeZone: "Africa/Cairo", hour12: false });
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("parse-matrix", () => {
  const cases = [
    ["فكرني بعد ساعة أشرب مية", "02/10/2026, 16:00:00", "أشرب مية", false],
    ["ذكرني بكرة الساعة 9 بالاجتماع", "03/10/2026, 09:00:00", "الاجتماع", false],
    ["فكرني الساعة 5 اكلم ماما", "02/10/2026, 17:00:00", "اكلم ماما", false],
    ["فكرني الساعة ٨ الصبح بالدوا", "03/10/2026, 08:00:00", "الدوا", false],
    ["فكرني كل يوم الساعة 8 بالدوا", "03/10/2026, 08:00:00", "الدوا", true],
    ["فكرني كل يوم الساعة 9 بالليل اقفل الباب", "02/10/2026, 21:00:00", "اقفل الباب", true],
    ["فكرني بعد نص ساعة", "02/10/2026, 15:30:00", "", false],
    ["ذكّرني بعد ٣ ساعات", "02/10/2026, 18:00:00", "", false],
    ["فكرني بعد ساعتين اقفل الفرن", "02/10/2026, 17:00:00", "اقفل الفرن", false],
    ["remind me in 10 minutes to call mom", "02/10/2026, 15:10:00", "call mom", false],
    ["remind me tomorrow at 9am about the meeting", "03/10/2026, 09:00:00", "the meeting", false],
    ["recuérdame mañana a las 9 la reunión", "03/10/2026, 09:00:00", "la reunión", false],
  ];
  for (const [text, at, what, repeat] of cases) {
    const parsed = parseReminder(text, { now: NOW });
    assert.equal(parsed.ok, true, `«${text}»: ${parsed.error}`);
    assert.equal(cairo(parsed.at), at, `«${text}» ⇒ ${cairo(parsed.at)}`);
    assert.equal(parsed.what, what, `«${text}» ⇒ «${parsed.what}»`);
    assert.equal(parsed.repeat, repeat);
  }
  assert.equal(parseReminder("فكرني اشرب مية", { now: NOW }).error, "need-time");
  assert.equal(parseReminder("فكرني بعد 40 يوم", { now: NOW }).error, "too-far");
  assert.equal(parseReminder("فكرني كل يوم بالدوا", { now: NOW }).error, "daily-needs-time");
  assert.equal(parseReminder("فكرني كل يوم الساعة 9 لخص الاخبار", { now: NOW }).recurringAction, true);
});

// مجدول مُبرمج بنفس واجهة terboo-scheduler (التخزين في الذاكرة)
function fakeScheduler() {
  const tasks = new Map();
  return {
    tasks, saves: 0, SCHEDULER_TZ: "Africa/Cairo",
    async scheduleMessage(options) { tasks.set(options.id, { ...options, nextRun: options.at }); return tasks.get(options.id); },
    cancelScheduledMessage(id) { return tasks.delete(id); },
    getScheduledMessages() { return [...tasks.values()]; },
    saveScheduledMessages() { this.saves += 1; },
  };
}

const sock = { user: { id: "2348093093240:12@s.whatsapp.net" } };
let seq = 0;
function message({ body, sender = "201000000501@s.whatsapp.net", group = false }) {
  const replies = [];
  return {
    key: { remoteJid: group ? "120363000000000501@g.us" : sender, fromMe: false, id: `RM${++seq}` }, id: `RM${seq}`,
    sender, chat: group ? "120363000000000501@g.us" : sender, isGroup: group, body, pushName: "مختبر", type: "conversation",
    isCommand: false, prefix: ".", isOwner: false, isPremium: false, isAdmin: false, isBotAdmin: false, isBot: false, fromMe: false,
    isNewsletter: false, mentionedJid: [], quoted: group ? { key: { fromMe: true, id: "Q" }, text: "x" } : null, replies,
    async reply(text) { replies.push(String(text)); return { key: { id: `r${seq}` } }; },
    async react() {},
  };
}
let modelCalls = 0;
const ask = async () => { modelCalls += 1; return { text: JSON.stringify({ decision: "CHAT", reply: "سأذكرك بالتأكيد!", confidence: 0.9 }), provider: "mock" }; };

await check("kernel-flow", async () => {
  const sched = fakeScheduler();
  const deps = { ask, rateLimit: false, reminders: { scheduler: sched, now: NOW } };
  const m = message({ body: "فكرني بعد ساعة أشرب مية" });
  assert.equal(await core.runKernel(m, sock, db, deps), "answered");
  assert.equal(modelCalls, 0, "التذكير نادى النموذج");
  const [task] = sched.getScheduledMessages();
  assert.ok(task, "لم يُجدول شيء");
  assert.equal(task.kind, "reminder");
  assert.equal(task.hour, 16);
  assert.equal(task.minute, 0);
  assert.equal(task.date, "2026-10-02");
  assert.equal(task.repeat, false);
  assert.equal(task.jid, m.chat);
  assert.match(task.message.text, /أشرب مية/);
  assert.ok(sched.saves >= 1, "التذكير لم يُحفظ");
  assert.match(m.replies.join("\n"), /سأذكّرك اليوم الساعة 16:00/);
  // في المجموعة: إشارة لصاحب التذكير
  const g = message({ body: "تيربو فكرني بكرة الساعة 9 بالاجتماع", group: true });
  await core.runKernel(g, sock, db, deps);
  const groupTask = sched.getScheduledMessages().find((x) => x.jid === g.chat);
  assert.deepEqual(groupTask.message.mentions, [g.sender]);
  assert.match(groupTask.message.text, /^@201000000501 /);
  assert.equal(groupTask.date, "2026-10-03");
});

await check("honest-no-promise", async () => {
  const sched = fakeScheduler();
  const deps = { ask, rateLimit: false, reminders: { scheduler: sched, now: NOW } };
  const vague = message({ body: "فكرني اشرب مية" });
  await core.runKernel(vague, sock, db, deps);
  assert.match(vague.replies.join("\n"), /متى أذكّرك/);
  const action = message({ body: "فكرني كل يوم الساعة 9 لخص الاخبار" });
  await core.runKernel(action, sock, db, deps);
  assert.match(action.replies.join("\n"), /غير متاح بعد/);
  assert.equal(sched.getScheduledMessages().length, 0, "جُدول تذكير رغم عدم الفهم");
  assert.equal(modelCalls, 0, "نُودي النموذج (خطر وعد كاذب)");
});

await check("privacy-and-limits", async () => {
  const sched = fakeScheduler();
  const deps = { ask, rateLimit: false, reminders: { scheduler: sched, now: NOW } };
  const A = "201000000511@s.whatsapp.net";
  const B = "201000000512@s.whatsapp.net";
  await core.runKernel(message({ body: "فكرني بعد ساعة بالمكالمة", sender: A }), sock, db, deps);
  await core.runKernel(message({ body: "فكرني بعد ساعتين بالتمرين", sender: A }), sock, db, deps);
  await core.runKernel(message({ body: "فكرني بعد ساعة بالدرس", sender: B }), sock, db, deps);
  const list = message({ body: "تذكيراتي", sender: A });
  await core.runKernel(list, sock, db, deps);
  const shown = list.replies.join("\n");
  assert.match(shown, /المكالمة/);
  assert.match(shown, /التمرين/);
  assert.doesNotMatch(shown, /الدرس/, "تذكيرات مستخدم آخر ظهرت");
  // B يلغي ⇒ تذكيره فقط
  await core.runKernel(message({ body: "الغي التذكير", sender: B }), sock, db, deps);
  assert.equal(sched.getScheduledMessages().length, 2, "إلغاء B لمس تذكيرات A");
  await core.runKernel(message({ body: "الغي كل التذكيرات", sender: A }), sock, db, deps);
  assert.equal(sched.getScheduledMessages().length, 0);
  // الحد الأقصى لكل مستخدم
  for (let i = 0; i < REMINDER_LIMITS.perUser; i++) await core.runKernel(message({ body: `فكرني بعد ${i + 1} ساعة`, sender: A }), sock, db, deps);
  const over = message({ body: "فكرني بعد 20 ساعة", sender: A });
  await core.runKernel(over, sock, db, deps);
  assert.equal(sched.getScheduledMessages().length, REMINDER_LIMITS.perUser);
  assert.match(over.replies.join("\n"), /الحد الأقصى/);
});

await check("real-scheduler-exact-date", async () => {
  const m = message({ body: "فكرني بعد 3 أيام بتجديد الاشتراك" });
  await core.runKernel(m, sock, db, { ask, rateLimit: false });
  const task = realScheduler.getScheduledMessages().find((x) => x.kind === "reminder" && x.jid === m.chat);
  assert.ok(task, "المجدول الحقيقي لم يستلم التذكير");
  const expected = new Date(Date.now() + 3 * 86_400_000);
  const next = new Date(task.nextRun);
  assert.ok(Math.abs(next - expected) < 120_000, `nextRun ${task.nextRun} ≠ بعد 3 أيام (${expected.toISOString()})`);
  const saved = db.setting("scheduledMessages") || [];
  assert.ok(saved.some((x) => x.id === task.id), "التذكير لم يُحفظ ليُستعاد بعد إعادة التشغيل");
  await core.runKernel(message({ body: "الغي التذكير" }), sock, db, { ask, rateLimit: false });
  assert.equal(realScheduler.getScheduledMessage(task.id), null, "الإلغاء لم يوقف المهمة");
});

realScheduler.stopAllSchedulers();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-reminders: ${results.join(" · ")}`);
process.exit(0);
