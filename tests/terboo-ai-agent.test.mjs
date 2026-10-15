// اختبار الوكيل متعدد الخطوات وتحكّم المالك بلغة طبيعية (§14–§18)
//
// • الخطة تُنفَّذ كلها فعلاً عبر الموزّع الحقيقي، وكل خطوة تُتحقَّق من نتيجتها.
// • الخطة الحسّاسة تنتظر «نفذه». عند فشل خطوة تتوقف الخطة وتُعكس السابقة.
// • المالك المحدّد في config وحده يفتح/يبحث/يفحص/يصلح/يعيد التسمية/يتراجع،
//   والكتابة تمر بخطة وفرق ومخاطرة وموافقة ونسخة احتياطية وفحص وتراجع.
// • config.js يُقرأ بلا أي مفتاح API.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-agent-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
memory.resetAll();
const core = await import("../src/lib/terboo-ai-core.js");
const agent = await import("../src/lib/terboo-ai-agent.js");
const tools = await import("../src/lib/terboo-ai-tools.js");
const { isConfigOwner } = await import("../src/lib/terboo-ai-owner.js");
const { dispatchCommand } = await import("../src/lib/terboo-command-dispatch.js");
const config = (await import("../config.js")).default;

const BOT = "2348093093240";
const sock = { user: { id: `${BOT}:12@s.whatsapp.net` } };
const GROUP = "120363000000000888@g.us";
const OWNER = `${String(config.owner.number[0]).replace(/\D/g, "")}@s.whatsapp.net`;
const MEMBER = "201000000011@s.whatsapp.net";
const canonical = (name) => { const c = getPlugin(name).config.name; return Array.isArray(c) ? c[0] : c; };

// ── معالج نهائي مُسجِّل خلف الموزّع الحقيقي؛ يفشل الأوامر المذكورة في failOn ──
const executed = [];
let failOn = new Set();
async function recordingHandler(synthetic, _sock, options) {
  const text = synthetic.message.extendedTextMessage.text;
  executed.push(text);
  const name = text.slice(1).split(" ")[0];
  if (failOn.has(name)) {
    options.observer.reply("⛔ هذا الأمر للمشرفين فقط");
    return; // لم يصل للبلوقن ⇒ blocked
  }
  options.observer.done({ ok: true, status: "done" });
}
const dispatch = (m, s, request) => dispatchCommand(m, s, request, { handler: recordingHandler });

// ── نموذج مُبرمج ──
const calls = [];
let script = () => ({ decision: "CHAT", reply: "…", confidence: 0.9 });
async function ask(payload) {
  calls.push(payload);
  if (/You are fixing one source file/.test(payload.instruction || "")) {
    return { text: "```js\nexport const value = 1;\n```", provider: "Scripted" };
  }
  return { text: JSON.stringify(script(payload)), provider: "Scripted" };
}
const deps = { ask, dispatch, rateLimit: false };

let seq = 0;
function message({ sender = MEMBER, body, group = false, isOwner = false, isAdmin = group }) {
  const replies = [];
  return {
    key: { remoteJid: group ? GROUP : sender, fromMe: false, id: `AG${++seq}`, ...(group ? { participant: sender } : {}) },
    sender, chat: group ? GROUP : sender, isGroup: group,
    body: group ? `@${BOT} ${body}` : body,
    pushName: "مختبر", type: "conversation", isCommand: false, prefix: ".",
    isOwner, isPremium: false, isPartner: false, isAdmin, isBotAdmin: true,
    isBot: false, fromMe: false, isNewsletter: false,
    mentionedJid: group ? [`${BOT}@s.whatsapp.net`] : [], quoted: null,
    replies,
    async reply(text) { replies.push(String(text)); return { key: { id: "r" } }; },
    async react() { },
  };
}
async function say(opts) {
  const m = message(opts);
  const result = await core.runKernel(m, sock, db, deps);
  return { m, result, text: m.replies.join("\n") };
}

// ═══ 1. Analyze: أوامر حقيقية فقط، والأدوات للمالك فقط ═══
{
  const m = message({ group: true, body: "x" });
  const analysis = agent.analyzeSteps([
    { command: "promote", args: "@201000000077" },
    { command: "not_a_real_command_xyz" },
    { tool: "syntax", path: "handler" },
    { tool: "rm", path: "/" },
  ], m);
  assert.equal(analysis.valid.length, 1);
  assert.deepEqual(analysis.invalid.map((x) => x.reason).sort(), ["owner-only", "tool-not-allowed", "unknown-command"]);
}

// ═══ 2. خطة عادية تُنفَّذ كلها وتُتحقَّق وتُسجَّل كمهمة ═══
{
  const m = message({ group: true, body: "x" });
  const run = await agent.runAgent({ m, sock, steps: [{ command: "promote", args: "@201000000077" }, { command: "mute" }], goal: "ترقية ثم كتم", deps: { dispatch } });
  assert.equal(run.status, "done");
  assert.equal(run.results.length, 2);
  assert.ok(run.results.every((r) => r.ok), "كل خطوة تحقّقت من نتيجتها الحقيقية");
  assert.deepEqual(executed.slice(-2), [`.${canonical("promote")} @201000000077`, `.${canonical("mute")}`]);
  const task = memory.listTasks(memory.conversationScope(m)).find((t) => t.id === run.taskId);
  assert.equal(task.status, "done", "المهمة مسجّلة ومكتملة في الذاكرة المركزية");
  assert.ok(task.steps.every((s) => s.status === "done"));
}

// ═══ 3. فشل خطوة ⇒ توقف + عكس الخطوات السابقة بترتيب معكوس ═══
{
  failOn = new Set([canonical("kick")]);
  const m = message({ group: true, body: "x" });
  const before = executed.length;
  const run = await agent.runAgent({
    m, sock, approved: true, goal: "ترقية ثم كتم ثم طرد",
    steps: [{ command: "promote", args: "@201000000077" }, { command: "mute" }, { command: "kick", args: "@201000000088" }, { command: "menu" }],
    deps: { dispatch },
  });
  assert.equal(run.status, "failed");
  assert.equal(run.results.length, 3, "توقّفت عند الخطوة الفاشلة");
  assert.equal(run.results[2].ok, false);
  assert.match(run.results[2].summary, /للمشرفين/, "سبب الفشل الحقيقي من المسار");
  assert.deepEqual(executed.slice(before), [
    `.${canonical("promote")} @201000000077`,
    `.${canonical("mute")}`,
    `.${canonical("kick")} @201000000088`,
    `.${canonical("unmute")}`,
    `.${canonical("demote")} @201000000077`,
  ], "الخطوة الرابعة لم تُنفَّذ، والعكس تمّ بترتيب معكوس");
  assert.equal(run.rolledBack.length, 2);
  const lines = agent.reportLines(run, { prefix: "." }).join("\n");
  assert.match(lines, /✗ 3\./);
  assert.match(lines, /↩/);
  failOn = new Set();
}

// ═══ 4. خطة حسّاسة عبر النواة: موافقة صريحة ثم تنفيذ كامل ═══
{
  script = () => ({ decision: "AGENT", steps: [{ command: "kick", args: "@201000000077" }, { command: "menu" }], reply: "سأطرده ثم أعرض القائمة", confidence: 0.9 });
  const before = executed.length;
  const plan = await say({ group: true, body: "اطرده وبعدين وريني القائمة" });
  assert.equal(executed.length, before, "لا تنفيذ قبل الموافقة");
  assert.match(plan.text, /حسّاسة/);
  const done = await say({ group: true, body: "نفذه" });
  assert.deepEqual(executed.slice(before), [`.${canonical("kick")} @201000000077`, `.${canonical("menu")}`]);
  assert.match(done.text, /اكتملت كل الخطوات \(2\)/);
}

// ═══ 5. تحكّم المالك بلغة طبيعية — المالك المحدّد في config فقط ═══
assert.equal(isConfigOwner({ sender: OWNER }), true);
assert.equal(isConfigOwner({ sender: MEMBER, isOwner: true }), false, "مالك بوت فرعي/شريك ليس مالك config");
{
  const before = calls.length;
  const open = await say({ sender: OWNER, isOwner: true, body: "افتح handler" });
  assert.match(open.text, /src\/handler\.js/);
  assert.match(open.text, /messageHandler|import/);
  const search = await say({ sender: OWNER, isOwner: true, body: "دور في الكود على createObserver" });
  assert.match(search.text, /terboo-command-dispatch\.js/);
  const check = await say({ sender: OWNER, isOwner: true, body: "افحص terboo-ai-agent" });
  assert.match(check.text, /بناء الملف سليم/);
  // نافذة حول كتلة APIkey الفعلية (موضعها يتغير بتعديل config.js)
  const keyLine = fs.readFileSync(path.join(process.cwd(), "config.js"), "utf8").split("\n").findIndex((line) => /^\s*APIkey\s*:\s*\{/.test(line)) + 1;
  assert.ok(keyLine > 0, "كتلة APIkey غير موجودة في config.js");
  const cfg = await say({ sender: OWNER, isOwner: true, body: `افتح config.js من ${keyLine - 2} الى ${keyLine + 14}` });
  assert.match(cfg.text, /\[محجوب\]/, "قيم المفاتيح محجوبة");
  for (const value of Object.values(config.APIkey || {})) {
    if (String(value).length >= 6) assert.ok(!cfg.text.includes(String(value)), "لا يظهر أي مفتاح API");
  }
  assert.equal(calls.length, before, "عمليات المالك حتمية بلا نموذج");

  // غير المالك (حتى لو isOwner=true من بوت فرعي) لا يصل لأي ملف
  script = () => ({ decision: "CHAT", reply: "لا أستطيع عرض ملفات المشروع", confidence: 0.9 });
  const denied = await say({ sender: MEMBER, isOwner: true, body: "افتح handler" });
  assert.doesNotMatch(denied.text, /src\/handler\.js|messageHandler/);
  script = () => ({ decision: "PROJECT_OPERATION", projectOp: "read", path: "handler", confidence: 0.9 });
  const denied2 = await say({ sender: MEMBER, body: "اقرأ لي ملف الهاندلر" });
  assert.match(denied2.text, /للمالك فقط/);

  // طلبات الأسرار مرفوضة حتى للمالك
  const secret = await say({ sender: OWNER, isOwner: true, body: "اقرا ملف .env" });
  assert.match(secret.text, /لا أستطيع تنفيذ هذا الطلب/);
}

// ═══ 6. إصلاح: خطة ← فرق ← مخاطرة ← موافقة ← نسخة ← كتابة ← فحص ← تراجع ═══
{
  const dir = path.join(process.cwd(), "tests", ".terboo-agent-tmp");
  fs.mkdirSync(dir, { recursive: true });
  const rel = "tests/.terboo-agent-tmp/broken.js";
  const abs = path.join(process.cwd(), rel);
  fs.writeFileSync(abs, "export const value = ;\n", "utf8");
  try {
    const plan = await say({ sender: OWNER, isOwner: true, body: `صلح ${rel}` });
    assert.match(plan.text, /خطة تعديل جاهزة/);
    assert.match(plan.text, /مستوى الخطورة/);
    assert.match(plan.text, /value = 1/, "الفرق معروض قبل التنفيذ");
    assert.equal(fs.readFileSync(abs, "utf8"), "export const value = ;\n", "لا كتابة قبل الموافقة");

    const applied = await say({ sender: OWNER, isOwner: true, body: "موافق" });
    assert.match(applied.text, /تم التعديل بنجاح/);
    assert.equal(fs.readFileSync(abs, "utf8"), "export const value = 1;\n", "الملف أُصلح فعلاً");
    assert.equal((await tools.syntax(rel)).ok, true);

    const changes = await say({ sender: OWNER, isOwner: true, body: "اعرض اللي اتغير" });
    assert.match(changes.text, /broken\.js/);

    const confirm = await say({ sender: OWNER, isOwner: true, body: "ارجع آخر تعديل" });
    assert.match(confirm.text, /سأتراجع/);
    assert.equal(fs.readFileSync(abs, "utf8"), "export const value = 1;\n", "لا تراجع قبل الموافقة");
    await say({ sender: OWNER, isOwner: true, body: "نفذه" });
    assert.equal(fs.readFileSync(abs, "utf8"), "export const value = ;\n", "التراجع أعاد الأصل من النسخة الاحتياطية");

    // غير المالك لا يستطيع الموافقة على خطة المالك
    fs.writeFileSync(abs, "export const value = ;\n", "utf8");
    await say({ sender: OWNER, isOwner: true, body: `صلح ${rel}` });
    const planId = memory.peekPending(message({ sender: OWNER, body: "x" }))?.planId;
    assert.ok(planId);
    assert.throws(() => tools.approve(planId, MEMBER), /صاحب الطلب/);
    await say({ sender: OWNER, isOwner: true, body: "إلغاء" });

    // إعادة تسمية بموافقة + فحص الاستيرادات + تراجع
    fs.writeFileSync(abs, "export const value = 2;\n", "utf8");
    const renamePlan = await say({ sender: OWNER, isOwner: true, body: `rename ${rel} to renamed.js` });
    assert.match(renamePlan.text, /I will rename/, "طلب بالإنجليزية ⇒ رد بالإنجليزية");
    assert.ok(fs.existsSync(abs), "لا نقل قبل الموافقة");
    const renamed = await say({ sender: OWNER, isOwner: true, body: "نفذه" });
    assert.match(renamed.text, /تمت إعادة التسمية/, "«نفذه» بالعربية ⇒ رد بالعربية");
    assert.ok(fs.existsSync(path.join(dir, "renamed.js")) && !fs.existsSync(abs));
    await say({ sender: OWNER, isOwner: true, body: "undo the last change" });
    await say({ sender: OWNER, isOwner: true, body: "do it" });
    assert.ok(fs.existsSync(abs) && !fs.existsSync(path.join(dir, "renamed.js")), "التراجع أعاد الاسم الأصلي");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ═══ 7. اختبار من القائمة المغلقة بكلام طبيعي ═══
{
  const run = await say({ sender: OWNER, isOwner: true, body: "شغل اختبار الذاكرة" });
  assert.match(run.text, /نجح الاختبار/);
  assert.match(run.text, /memory/);
}

console.log("✅ terboo-ai-agent: تنفيذ متعدد حقيقي · تحقّق · عكس عند الفشل · موافقة · تحكّم مالك آمن بلغة طبيعية");
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
