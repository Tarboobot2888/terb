// ═══════════════════════════════════════════════
// 🧪 Terboo — مصفوفة الذكاء الكاملة (v4 §42) + المتابعة (§18)
// ───────────────────────────────────────────────
// النواة الحقيقية + الذاكرة الحقيقية + أدوات المالك الحقيقية + الموزّع الحقيقي.
// المستبدَل فقط: المزوّد الخارجي (نموذج نصّي مُبرمج يتحقق مما يصله) والمعالج النهائي للأوامر
// والـscrapers (مسجّلان: لا شبكة). لكل فئة: طلب أول ثم متابعة تعتمد على ما سبق.
//   CHAT     «اشرح…» ← «خليها أبسط» (تلميح تعديل + الإجابة السابقة) ← «رجع النسخة اللي قبلها» (بلا نموذج)
//   COMMAND  «تيربو اطرد الشخص ده» (مجموعة) ← «وده كمان» على هدف جديد (بلا نموذج)
//   SCRAPER  رابط TikTok ← «هات الصوت بس» (نفس الرابط mp3، بلا نموذج)
//   IMAGE    «عايز صورة لقطة…» ← «خليها زرقاء» (النموذج يعدّل الوصف بتلميح التعديل)
//   SEARCH   «ابحث في تيك توك…» ← «حمل التاني» (رابط النتيجة الثانية)
//   VISION   صورة + «حلل الصورة» ← «اعملها كرتون» على الصورة المقتبسة
//   FILE     «اقرأ الملف …» (مالك) ← «افحصه» ← «الملف اللي فوق»
//   AGENT    خطة خطوتين ← «نفس اللي فوق» (تكرار آخر أمر)
//   OWNER    «افحص القوائم» ← «اختبر»
//   MEMORY   معلومة من المحادثة ← تصل للنموذج في رسالة لاحقة ← «ايش تعرف عني» ← «انسى آخر حاجة»
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-matrix-"));
const { initDatabase } = await import("../src/lib/terboo-database.js");
const db = await initDatabase(tmp);
// التنظيف بعد تفريغ القاعدة عند الخروج (مستمعو exit يعملون بترتيب تسجيلهم)
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (error) { console.warn("تنظيف:", error.message); } });
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
memory.resetAll();
const core = await import("../src/lib/terboo-ai-core.js");
const latency = await import("../src/lib/terboo-latency.js");
const realTools = await import("../src/lib/terboo-ai-tools.js");
const { dispatchCommand } = await import("../src/lib/terboo-command-dispatch.js");

const BOT = "2348093093240";
const sock = { user: { id: `${BOT}:12@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net` } };
const GROUP = "120363000000000888@g.us";
const USER = "201000000041@s.whatsapp.net";
const OWNER = "201225655220@s.whatsapp.net";
const T1 = "201000000071@s.whatsapp.net";
const T2 = "201000000072@s.whatsapp.net";
const canonical = (name) => { const c = getPlugin(name).config.name; return Array.isArray(c) ? c[0] : c; };
const PNG = Buffer.from("89504e470d0a1a0a", "hex");

// ── نموذج مُبرمج · أوامر مسجّلة · أدوات مسجّلة ──
const modelCalls = [];
let script = () => ({ decision: "CHAT", reply: "…", confidence: 0.9 });
const ask = async (payload) => { modelCalls.push(payload); return { text: JSON.stringify(script(payload)), provider: "Scripted" }; };
const executed = [];
const dispatch = (m, s, request) => dispatchCommand(m, s, request, {
  handler: async (synthetic, _sock, options) => {
    executed.push(synthetic.message.extendedTextMessage.text);
    options.observer.done({ ok: true, status: "done" });
  },
});
const toolRuns = [];
let toolResult = () => ({ ok: true, deliveries: [{ type: "video" }], via: "scraper" });
const runTool = async ({ id, input }) => {
  toolRuns.push({ id, input });
  return toolResult({ id, input });
};
let toolsDep = realTools;
const deps = () => ({ ask, dispatch, runTool, rateLimit: false, tools: toolsDep });

let seq = 0;
function message({ sender = USER, body, group = false, quoted = null, isOwner = false, isAdmin = false, image = false }) {
  const replies = [];
  return {
    key: { remoteJid: group ? GROUP : sender, fromMe: false, id: `MX${++seq}`, ...(group ? { participant: sender } : {}) },
    sender, chat: group ? GROUP : sender, isGroup: group, body,
    pushName: "مختبر", type: image ? "imageMessage" : "conversation", isCommand: false, prefix: ".",
    isOwner, isPremium: false, isPartner: false, isAdmin, isBotAdmin: true, isBot: false, fromMe: false, isNewsletter: false,
    mentionedJid: [], quoted, isImage: image, download: image ? async () => PNG : undefined,
    replies,
    async reply(text) { replies.push(String(text)); return { key: { id: "r" } }; },
    async react() { },
  };
}
async function say(opts) {
  const before = { model: modelCalls.length, tools: toolRuns.length, executed: executed.length };
  const m = message(opts);
  const outcome = await core.runKernel(m, sock, db, deps());
  return {
    m, outcome, text: m.replies.join("\n"),
    modelCalls: modelCalls.length - before.model,
    tool: toolRuns.length > before.tools ? toolRuns.at(-1) : null,
    command: executed.length > before.executed ? executed.at(-1) : null,
    trace: latency.recentTraces(1)[0],
  };
}
const rows = [];
const row = (category, first, followUp) => rows.push({ category, first, followUp });

// ═══ CHAT ═══
{
  script = () => ({ decision: "CHAT", reply: "let يمكن إعادة إسنادها، أما const فلا يمكن إعادة إسنادها.", confidence: 0.95 });
  const first = await say({ body: "اشرح الفرق بين let و const" });
  assert.equal(first.outcome, "answered");
  assert.equal(first.modelCalls, 1);
  assert.match(first.text, /const/);
  script = (payload) => {
    assert.match(payload.instruction, /MODIFIES the previous result/, "تلميح التعديل لم يصل");
    assert.ok(payload.history.some((turn) => turn.role === "assistant" && /إعادة إسنادها/.test(turn.content)), "الإجابة السابقة لم تصل");
    return { decision: "CHAT", reply: "باختصار: const ثابتة و let متغيّرة.", confidence: 0.95 };
  };
  const simpler = await say({ body: "خليها أبسط" });
  assert.match(simpler.text, /ثابتة/);
  const revert = await say({ body: "لا، رجع النسخة اللي قبلها" });
  assert.equal(revert.modelCalls, 0, "الرجوع حتمي");
  assert.match(revert.text, /إعادة إسنادها/);
  row("CHAT", "model CHAT", "modify hint → revert (no model)");
}

// ═══ COMMAND ═══
{
  const q1 = { key: { id: "Q1", fromMe: false, participant: T1 }, body: "سبام", sender: T1 };
  const q2 = { key: { id: "Q2", fromMe: false, participant: T2 }, body: "سبام تاني", sender: T2 };
  script = () => ({ decision: "COMMAND", command: "طرد", args: "", reply: "", confidence: 0.92 });
  const kick = await say({ body: "تيربو اطرد الشخص ده", group: true, isAdmin: true, quoted: q1 });
  assert.equal(kick.outcome, "answered");
  assert.match(kick.command || "", new RegExp(`^\\.${canonical("طرد")} @201000000071`));
  const again = await say({ body: "تيربو وده كمان", group: true, isAdmin: true, quoted: q2 });
  assert.equal(again.modelCalls, 0, "«وده كمان» بلا نموذج");
  assert.match(again.command || "", new RegExp(`^\\.${canonical("طرد")} @201000000072`), "نفس الأمر على الهدف الجديد");
  row("COMMAND", "kick @t1 (dispatcher)", "same command on @t2 (no model)");
}

// ═══ SCRAPER ═══
{
  const url = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
  const first = await say({ body: `حمل الفيديو ده ${url}` });
  assert.deepEqual([first.tool?.id, first.tool?.input.url, first.tool?.input.format], ["tiktok", url, "mp4"]);
  assert.equal(first.modelCalls, 0);
  const audio = await say({ body: "هات الصوت بس" });
  assert.deepEqual([audio.tool?.id, audio.tool?.input.url, audio.tool?.input.format], ["tiktok", url, "mp3"], "«الصوت بس» لم يعد لنفس الرابط");
  assert.equal(audio.modelCalls, 0);
  assert.match(audio.trace.pipeline.find((s) => s.stage === "strategy").detail, /followup-tool:variant:mp3/);
  row("SCRAPER", "tiktok mp4", "same link mp3 (no model)");
}

// ═══ IMAGE ═══
{
  const first = await say({ body: "عايز صورة لقطة في الفضاء" });
  assert.equal(first.tool?.id, "txt2img2");
  assert.equal(first.modelCalls, 0);
  script = (payload) => {
    assert.match(payload.instruction, /MODIFIES the previous result/);
    return { decision: "TOOL", tool: "txt2img2", input: { prompt: "قطة زرقاء في الفضاء" }, confidence: 0.9 };
  };
  const blue = await say({ body: "خليها زرقاء" });
  assert.equal(blue.modelCalls, 1);
  assert.deepEqual([blue.tool?.id, blue.tool?.input.prompt], ["txt2img2", "قطة زرقاء في الفضاء"]);
  row("IMAGE", "txt2img2 (fast)", "modified prompt via model → txt2img2");
}

// ═══ SEARCH ═══
{
  toolResult = ({ id }) => (id === "tiktoksearch"
    ? { ok: true, via: "scraper", deliveries: [{ type: "text" }], result: { items: [{ title: "أ", url: "https://www.tiktok.com/@a/video/7000000000000000001" }, { title: "ب", url: "https://www.tiktok.com/@b/video/7000000000000000002" }] } }
    : { ok: true, via: "scraper", deliveries: [{ type: "video" }] });
  const search = await say({ body: "ابحث في تيك توك عن وصفات سريعة" });
  assert.equal(search.tool?.id, "tiktoksearch");
  const second = await say({ body: "حمل التاني" });
  assert.deepEqual([second.tool?.id, second.tool?.input.url], ["tiktok", "https://www.tiktok.com/@b/video/7000000000000000002"], "«حمل التاني» لم يأخذ النتيجة الثانية");
  assert.equal(second.modelCalls, 0);
  toolResult = () => ({ ok: true, deliveries: [{ type: "video" }], via: "scraper" });
  row("SEARCH", "tiktoksearch (fast)", "download 2nd result (no model)");
}

// ═══ VISION ═══
{
  const vision = await say({ body: "حلل الصورة", image: true });
  assert.equal(vision.tool?.id, "img2prompt");
  assert.equal(vision.modelCalls, 0);
  const quotedImage = { key: { id: "IMG1", fromMe: false }, body: "", isImage: true, type: "imageMessage", sender: USER, download: async () => PNG };
  // التعديل (ثقة 0.75) يمر بالنموذج ليصقل الوصف — والنموذج يجب أن يرى الصورة المقتبسة وأداة img2img
  script = (payload) => {
    const seenByModel = JSON.stringify(payload);
    assert.match(seenByModel, /attached an image/, "النموذج لم يعرف أن هناك صورة مقتبسة");
    assert.match(seenByModel, /img2img/, "img2img ليست ضمن الأدوات المعروضة");
    return { decision: "TOOL", tool: "img2img", input: { prompt: "كرتون" }, confidence: 0.9 };
  };
  const cartoon = await say({ body: "اعملها كرتون", quoted: quotedImage });
  assert.equal(cartoon.modelCalls, 1);
  assert.deepEqual([cartoon.tool?.id, cartoon.tool?.input.prompt], ["img2img", "كرتون"], "التعديل على الصورة المقتبسة");
  row("VISION", "img2prompt (image, fast)", "img2img on quoted image (model sees image)");
}

// ═══ FILE (مالك) ═══
{
  const read = await say({ body: "اقرأ الملف src/lib/terboo-brand.js", sender: OWNER, isOwner: true });
  assert.match(read.text, /terboo-brand\.js/);
  assert.equal(read.trace.pipeline.find((s) => s.stage === "tool").detail, "owner:read");
  const check = await say({ body: "افحصه", sender: OWNER, isOwner: true });
  assert.equal(check.trace.pipeline.find((s) => s.stage === "tool")?.detail, "owner:syntax", "«افحصه» لم يُحل للملف السابق");
  assert.match(check.text, /terboo-brand\.js/);
  const above = await say({ body: "الملف اللي فوق", sender: OWNER, isOwner: true });
  assert.equal(above.trace.pipeline.find((s) => s.stage === "tool")?.detail, "owner:read");
  assert.match(above.text, /terboo-brand\.js/);
  const stranger = await say({ body: "افحصه" });
  assert.ok(!/terboo-brand/.test(stranger.text), "ذاكرة ملف المالك تسرّبت لغيره");
  row("FILE", "owner read", "«افحصه» → syntax · «الملف اللي فوق» → read");
}

// ═══ AGENT ═══
{
  script = () => ({ decision: "AGENT", steps: [{ command: "ping" }, { command: "menu" }], reply: "سأفحص السرعة ثم أعرض القائمة", confidence: 0.9 });
  const before = executed.length;
  const agent = await say({ body: "افحص السرعة وبعدها اعرض القائمة" });
  assert.equal(agent.outcome, "answered");
  assert.deepEqual(executed.slice(before), [`.${canonical("ping")}`, `.${canonical("menu")}`], "خطوتا الخطة لم تُنفّذا بالترتيب");
  assert.equal(agent.trace.pipeline.find((s) => s.stage === "verify").detail, "done");
  const repeat = await say({ body: "نفس اللي فوق" });
  assert.equal(repeat.modelCalls, 0);
  assert.equal(repeat.command, `.${canonical("menu")}`, "التكرار لم ينفّذ آخر أمر");
  row("AGENT", "2-step plan (dispatcher)", "repeat last command (no model)");
}

// ═══ OWNER ═══
{
  const calls = [];
  toolsDep = { ...realTools, test: async (name) => { calls.push(name); return { test: name, ok: true, output: `✅ ${name}` }; } };
  const menus = await say({ body: "افحص القوائم", sender: OWNER, isOwner: true });
  assert.match(menus.text, /سجل تسليم القوائم/);
  const quick = await say({ body: "اختبر", sender: OWNER, isOwner: true });
  assert.deepEqual(calls, ["menus", "syntax", "imports", "integrity"]);
  assert.equal(quick.modelCalls, 0);
  const denied = await say({ body: "افحص القوائم" });
  assert.doesNotMatch(denied.text, /سجل تسليم القوائم/, "غير المالك استعمل أداة مالك");
  toolsDep = realTools;
  row("OWNER", "inspect menus (real test runner)", "quick test suite");
}

// ═══ MEMORY ═══
{
  const MEM = "201000000049@s.whatsapp.net";
  script = () => ({ decision: "CHAT", reply: "جميل، سأتذكر ذلك.", confidence: 0.9, facts: [{ text: "لون المستخدم المفضل هو الأزرق", type: "preference", confidence: 0.9 }] });
  await say({ body: "بالمناسبة لوني المفضل أزرق", sender: MEM });
  let seen = null;
  script = (payload) => { seen = JSON.stringify(payload); return { decision: "CHAT", reply: "لونك المفضل هو الأزرق.", confidence: 0.9 }; };
  const recall = await say({ body: "ايه لوني المفضل؟", sender: MEM });
  assert.match(seen, /الأزرق/, "المعلومة المحفوظة لم تصل للنموذج في رسالة لاحقة");
  assert.match(recall.text, /الأزرق/);
  const shown = await say({ body: "ايش تعرف عني", sender: MEM });
  assert.equal(shown.modelCalls, 0);
  assert.match(shown.text, /الأزرق/);
  await say({ body: "انسى اخر حاجه", sender: MEM });
  const after = await say({ body: "ايش تعرف عني", sender: MEM });
  assert.doesNotMatch(after.text, /الأزرق/, "النسيان لم يحذف المعلومة");
  // العزل: نداء القرار لمستخدم آخر (لا نداء التلخيص الخلفي لمحادثته هو) لا يحمل معلومة MEM
  seen = null;
  script = (payload) => {
    if (payload.purpose !== "summary") seen = JSON.stringify(payload);
    return { decision: "CHAT", reply: "لا أعرف لونك المفضل بعد.", confidence: 0.9 };
  };
  await say({ body: "ايه لوني المفضل؟", sender: USER });
  assert.ok(seen, "نداء القرار للمستخدم الآخر لم يحدث");
  assert.doesNotMatch(seen || "", /الأزرق/, "ذاكرة مستخدم تسرّبت لآخر");
  row("MEMORY", "fact from chat → reaches model later", "show → forget-last · isolated");
}

assert.equal(rows.length, 10, "كل الفئات العشر");
console.log(`\n  ${"category".padEnd(9)} ${"first request".padEnd(36)} follow-up`);
for (const r of rows) console.log(`  ${r.category.padEnd(9)} ${r.first.padEnd(36)} ${r.followUp}`);
console.log(`\n✅ terboo-ai-matrix: ${rows.length}/10 فئات (CHAT · COMMAND · SCRAPER · IMAGE · SEARCH · VISION · FILE · AGENT · OWNER · MEMORY) مع متابعة لكل فئة`);
process.exit(0);
