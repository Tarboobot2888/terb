// ═══════════════════════════════════════════════
// 🧪 Terboo AI Recovery — «اكتبلي كود برمجي بسيط بلغة js» (بلاغ من التشغيل الحقيقي)
// ───────────────────────────────────────────────
// قبل الإصلاح: النموذج أجاب بالكود مباشرة (لا JSON) ⇒ فشل JSON.parse ⇒ «الرجوع المحلي» نفّذ
// أداة المالك «.كود» (استخراج JSON رسالة) لأن اسمها يشبه كلمة في الطلب.
//   1. رد نصي مباشر/JSON بأسطر خام/صيغة متساهلة ⇒ يُفهم ويُسلَّم الرد.
//   2. طلب كود ⇒ توليد مباشر (نداء واحد) والكود يصل كما هو.
//   3. المزوّد لا يرد ⇒ رسالة صريحة، ولا تنفيذ أي أمر لطلب محادثي.
//   4. الرجوع المحلي لا ينفّذ أداة مالك تلقائياً أبداً.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-recovery-"));
process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid.json");
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
const { initDatabase } = await import("../src/lib/terboo-database.js");
const db = await initDatabase(tmp);
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
memory.resetAll();
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const core = await import("../src/lib/terboo-ai-core.js");
const config = (await import("../config.js")).default;

const OWNER = `${String(config.owner.number[0]).replace(/\D/g, "")}@s.whatsapp.net`;
const sock = { user: { id: "2348093093240:12@s.whatsapp.net" } };
const CODE = "إليك كود بسيط:\n```js\nfunction add(a, b) { return a + b; }\nconsole.log(add(2, 3));\n```";
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };
let seq = 0;
async function run(body, ask, { owner = true } = {}) {
  const replies = [];
  const dispatched = [];
  const dispatchedArgs = [];
  const sender = owner ? OWNER : `20100000${String(++seq).padStart(4, "0")}@s.whatsapp.net`;
  const m = {
    key: { remoteJid: sender, fromMe: false, id: `RC${++seq}` }, id: `RC${seq}`, sender, chat: sender, isGroup: false, body,
    type: "conversation", isCommand: false, prefix: ".", isOwner: owner, mentionedJid: [], quoted: null,
    async reply(text) { replies.push(String(text)); return { key: { id: "r" } }; }, async react() {},
  };
  const outcome = await core.runKernel(m, sock, db, { ask, rateLimit: false, dispatch: async (_m, _s, request) => { dispatched.push(request.command); dispatchedArgs.push(request.args); return { ok: true }; } });
  return { outcome, replies: replies.join("\n"), dispatched, dispatchedArgs };
}

await check("parse-tolerant", () => {
  const ok = (raw, decision) => assert.equal(core.parseModelJson(raw)?.decision, decision, `لم يُفهم: ${raw.slice(0, 60)}`);
  ok(`{"decision":"CHAT","reply":"سطر\nسطر","confidence":0.9}`, "CHAT"); // أسطر خام داخل النص
  ok(`{decision: "CHAT", reply: "تمام", confidence: 0.9}`, "CHAT"); // مفاتيح بلا علامات
  ok(`{'decision': 'COMMAND', 'command': 'menu',}`, "COMMAND"); // علامات مفردة + فاصلة زائدة
  ok("الرد:\n```json\n{\"decision\":\"CHAT\",\"reply\":\"اهلا\"}\n```", "CHAT");
  ok(`function f() { return 1 }\n{"decision":"CHAT","reply":"x"}`, "CHAT"); // كائن صالح بعد كود
  assert.equal(core.parseModelJson("نص بلا JSON"), null);
  assert.equal(core.parseModelJson(""), null);
});

await check("code-request-direct", async () => {
  let calls = 0;
  const ask = async (payload) => { calls += 1; assert.doesNotMatch(payload.instruction || "", /Choose exactly one decision/, "طلب الكود مرّ بقرار JSON"); return { text: CODE, provider: "GPT" }; };
  const out = await run("اكتبلي كود برمجي بسيط بلغة js", ask);
  assert.deepEqual(out.dispatched, [], `نُفّذ أمر: ${out.dispatched}`);
  assert.match(out.replies, /```js[\s\S]*function add/);
  assert.equal(calls, 1);
});

await check("raw-text-answer-is-chat", async () => {
  // سؤال عادي والنموذج تجاهل صيغة القرار وأجاب نصاً
  const out = await run("ايه الفرق بين let و const؟", async () => ({ text: "let تسمح بإعادة الإسناد، const لا تسمح.", provider: "GPT" }));
  assert.deepEqual(out.dispatched, []);
  assert.match(out.replies, /const لا تسمح/);
  // JSON بأسطر خام داخل reply
  const raw = await run("اشرح الدوال في جافاسكربت", async () => ({ text: `{"decision":"CHAT","reply":"الدالة:\nfunction f() {}","confidence":0.9}`, provider: "GPT" }));
  assert.match(raw.replies, /function f\(\) \{\}/);
});

await check("provider-down-no-command", async () => {
  for (const body of ["اكتبلي كود برمجي بسيط بلغة js", "ايه افضل لغة برمجة؟", "احكيلي نكتة"]) {
    const out = await run(body, async () => null);
    assert.deepEqual(out.dispatched, [], `«${body}» نفّذ أمراً رغم أنه طلب محادثة: ${out.dispatched}`);
    assert.match(out.replies, /لا ترد الآن/);
  }
});

await check("fallback-never-runs-owner-tool", async () => {
  // حتى لطلب أمر صريح بلا نموذج: أداة المالك لا تُشغَّل تلقائياً من الرجوع المحلي
  const out = await run("استخراج كود الرسالة json", async () => null);
  assert.ok(!out.dispatched.includes("كود"), `شُغّلت أداة المالك: ${out.dispatched}`);
});

// ═══ بلاغات التشغيل الحقيقي (لقطات الشاشة) ═══
const router = await import("../src/lib/terboo-ai-router.js");
const { guardContentText } = await import("../src/lib/terboo-wa-compat.js");
const gate = await import("../src/lib/terboo-intent-gate.js");
const registry = await import("../src/lib/terboo-scraper-registry.js");
const { ChatGPT } = await import("../src/scraper/gpt52.js");

await check("no-object-object", async () => {
  // DeepSeek كان يُغلَّف كاملاً {text: {success, answer…}} ⇒ «[object Object]»
  const n = router.normalizeProviderText;
  assert.equal(n({ text: { success: true, answer: "كود" } }), "كود");
  assert.equal(n({ text: { success: false, answer: "", raw: "{\"message\":\"wrong params\"}" } }), "");
  assert.equal(n("[object Object]"), "");
  assert.equal(n({ content: [{ type: "text", text: "كتلة" }] }), "كتلة");
  // الموجّه: مزوّد يعيد كائن فشل ⇒ البديل التالي يجيب
  const out = await router.runRoutedChat({
    route: { task: "code", primary: "DeepSeek", fallbacks: ["GPT"] },
    providers: { DeepSeek: async () => ({ text: { status: 200, success: false, answer: "" } }), GPT: async () => ({ text: "```js\nconsole.log(1)\n```" }) },
    payload: { message: "x" },
  });
  assert.equal(out.provider, "GPT");
  assert.equal(typeof out.text, "string");
  // الحارس الأخير قبل واتساب
  assert.equal(guardContentText({ text: "[object Object]" }), null);
  assert.deepEqual(guardContentText({ text: { answer: "نص" } }), { text: "نص" });
  // رد قرار بكائن ⇒ نص لا «[object Object]»
  const ask = async () => ({ text: JSON.stringify({ decision: "CHAT", reply: { text: "رد حقيقي" } }), provider: "GPT" });
  const reply = await run("سؤال عادي عن الطقس اليوم", ask, { owner: false });
  assert.doesNotMatch(reply.replies, /\[object Object\]/);
  assert.match(reply.replies, /رد حقيقي/);
});

await check("gpt52-stream-shapes", async () => {
  // رقعة واحدة · تكملة {"v":"…"} · دفعة رقع — كان يُقرأ شكل واحد فقط («1500 EGP**»)
  const events = [
    { v: { message: { id: "m1", author: { role: "assistant" }, content: { parts: [""] } } } },
    { p: "/message/content/parts/0", o: "append", v: "الموجود " },
    { v: "في الصورة: " },
    { o: "patch", v: [{ p: "/message/content/parts/0", o: "append", v: "فاتورة " }, { p: "/message/metadata", o: "add", v: {} }] },
    { v: [{ p: "/message/content/parts/0", o: "append", v: "1500 EGP" }] },
  ];
  const body = (async function* () { for (const e of events) yield new TextEncoder().encode(`data: ${JSON.stringify(e)}\n\n`); yield new TextEncoder().encode("data: [DONE]\n\n"); })();
  const parsed = await ChatGPT.prototype._parseSSE.call({}, body, { stream: false });
  assert.equal(parsed.text, "الموجود في الصورة: فاتورة 1500 EGP");
});

await check("gate-patterns-from-reports", () => {
  const c = (text, m = null) => gate.classify({ text, m });
  assert.equal(c("اي الموجود في الصورة", { isImage: true }).op, "describe");
  assert.equal(c("اي الموجود في الصورة", { isImage: true }).deterministic, true);
  assert.equal(c("انشيء صورة احترافية لبوت تربو").intent, "CREATIVE");
  assert.equal(registry.resolveScraperIntent("انشيء صورة احترافية لبوت تربو")?.id, "txt2img2");
  assert.equal(c("ايه رأيك في الكلام ده", { isAudio: true }).intent, "AUDIO");
  assert.equal(c("ترجم الملف ده", { isDocument: true }).intent, "DOCUMENT");
  assert.equal(c("شكرا", { quoted: { isAudio: true } }).intent, "CHAT", "رد على تسجيل قديم بكلمة شكر لا يعيد تفريغه");
});

await check("decision-repair-and-request", async () => {
  assert.equal(core.repairDecision({ decision: "ترجم", command: ".ترجم", args: ["العربية", "hello"], confidence: 0 }).decision, "COMMAND");
  const repaired = core.repairDecision({ decision: "ترجم", args: ["a", "b"], confidence: 0 });
  assert.equal(repaired.args, "a b");
  assert.equal(repaired.confidence, undefined);
  assert.equal(core.looksLikeRequest("مرحبا بك في تيربو هذا اختبار للرد الصوتي الفاتورة الإجمالية 1500 جنيه"), false);
  assert.equal(core.looksLikeRequest("انشيء مجموعة جديدة واضفني فيها"), true);
  assert.equal(core.looksLikeRequest("عايز اعرف الطقس"), true);
  // جملة خبرية + النموذج اختار أمراً ⇒ محادثة، لا تنفيذ
  const statement = await run("الفاتورة وصلت امبارح والحمد لله كله تمام", async (payload) => (/Choose exactly one decision/.test(payload.instruction || "")
    ? { text: JSON.stringify({ decision: "COMMAND", command: "فاتورة", args: "", reply: "" }), provider: "GPT" }
    : { text: "الحمد لله، تمام!", provider: "GPT" }), { owner: false });
  assert.deepEqual(statement.dispatched, [], `نُفّذ أمر لجملة خبرية: ${statement.dispatched}`);
  assert.match(statement.replies, /الحمد لله/);
});

await check("no-false-action-claim", async () => {
  // النموذج يدّعي «تم» دون تنفيذ ⇒ لا يصل الادعاء؛ الأوامر الحقيقية تُعرض
  const out = await run("انشيء مجموعة جديدة واضفني فيها", async () => ({ text: JSON.stringify({ decision: "CHAT", reply: "تم إنشاء المجموعة وإضافتك فيها." }), provider: "GPT" }));
  assert.doesNotMatch(out.replies, /تم إنشاء المجموعة/);
  assert.match(out.replies, /لم أنفّذ/);
});

await check("group-create-add-me", async () => {
  // النموذج: أمر خاطئ (عشيرة) + وسائط قالبية منسوخة ⇒ الأمر الصحيح + رقم المرسل
  const ask = async () => ({ text: JSON.stringify({ decision: "COMMAND", command: ".إنشاء_عشيرة", args: "اسم_المجموعة|رقمك|0", reply: "تم إنشاء العشيرة بنجاح" }), provider: "GPT" });
  const out = await run("انشيء مجموعة جديدة واضفني فيها", ask);
  const digits = OWNER.split("@")[0];
  assert.deepEqual(out.dispatched, ["انشاء_مجموعة"], `الأمر المنفّذ: ${out.dispatched}`);
  assert.doesNotMatch(out.replies, /تم إنشاء العشيرة/);
  assert.match(out.dispatchedArgs[0], new RegExp(`^Bot Terboo\\|${digits}(?:\\|0)?$`), out.dispatchedArgs[0]);
  const named = await run("انشيء مجموعة اسمها اصحاب تيربو واضفني فيها", async () => ({ text: JSON.stringify({ decision: "COMMAND", command: "انشاء_مجموعة", args: "" }), provider: "GPT" }));
  assert.deepEqual(named.dispatched, ["انشاء_مجموعة"]);
  assert.match(named.dispatchedArgs[0], new RegExp(`^اصحاب تيربو\\|${digits}(?:\\|0)?$`), named.dispatchedArgs[0]);
});

await check("no-contradicting-preface", async () => {
  // النموذج يطلب بيانات («زودني باسم المجموعة…») ثم يختار الأمر ⇒ الأمر يُنفَّذ بلا مقدمة متناقضة
  const out = await run("انشيء مجموعة جديدة واضفني فيها", async () => ({ text: JSON.stringify({ decision: "COMMAND", command: "انشاء_مجموعة", args: "", reply: "رجاءً زودني باسم المجموعة والرقم الذي تريد أن تضيفه." }), provider: "GPT" }));
  assert.deepEqual(out.dispatched, ["انشاء_مجموعة"]);
  assert.doesNotMatch(out.replies, /زودني/);
});

await check("chat-claim-rewritten", async () => {
  // تفريغ تسجيل (ليس طلباً) ⇒ النموذج رد «تم إنشاء الفاتورة…» ⇒ يُعاد الرد بلا ادعاء
  const asks = [];
  const out = await run("مرحبا بك في تيربو هذا اختبار للرد الصوتي الفاتورة الإجمالية 1500 جنيه", async (payload) => {
    asks.push(payload.instruction || "");
    if (/Choose exactly one decision/.test(payload.instruction || "")) return { text: JSON.stringify({ decision: "CHAT", reply: "تم إنشاء الفاتورة بمبلغ 1500 جنيه. هل تود شيء آخر؟" }), provider: "GPT" };
    return { text: "أهلاً! وصلني الاختبار: الفاتورة الإجمالية 1500 جنيه.", provider: "GPT" };
  }, { owner: false });
  assert.deepEqual(out.dispatched, []);
  assert.doesNotMatch(out.replies, /تم إنشاء/);
  assert.match(out.replies, /1500/);
  assert.ok(asks.some((instruction) => /performed no action/.test(instruction)), "إعادة الصياغة تمنع الادعاء صراحة");
});

await check("vision-fallback-caption", async () => {
  // مزوّد الرؤية متقطع (يرمي/نص فارغ) ⇒ وصف img2prompt الحقيقي بدل «لا أرى»؛ المُحقن لا يلمس الشبكة
  const mm = await import("../src/lib/terboo-multimodal.js");
  const sharp = (await import("sharp")).default;
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#3366ff" } }).png().toBuffer();
  const down = async () => { throw new Error("GPTVision: <!DOCTYPE html> is not valid JSON"); };
  const viaCaption = await mm.describeImage(png, { ask: down, caption: async (buf) => { assert.ok(buf.length > 0); return "A plain blue square."; } });
  assert.deepEqual([viaCaption.ok, viaCaption.provider, viaCaption.text], [true, "img2prompt", "A plain blue square."]);
  const empty = await mm.describeImage(png, { ask: async () => ({ text: "  ", provider: "GPTVision" }), caption: async () => "A plain blue square." });
  assert.equal(empty.provider, "img2prompt");
  await assert.rejects(mm.describeImage(png, { ask: down }), /not valid JSON/, "مزوّد مُحقن بلا بديل: الخطأ يظهر كما هو");
  const bothDown = await mm.describeImage(png, { ask: down, caption: async () => { throw new Error("img2prompt_failed"); } });
  assert.equal(bothDown.ok, false);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-ai-recovery: ${results.join(" · ")}`);
process.exit(0);
