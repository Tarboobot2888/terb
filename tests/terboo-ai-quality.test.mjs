// جودة المحادثة ومسار الذكاء الموحّد (§8 §14 §39–§41 §52 §53)
//
//  1. Response Diversity Engine: لا إعادة تعريف لمن يعرف البوت، تحية مختلفة حسب حالة
//     المحادثة، لا بداية/خاتمة/إيموجي مكرّرة — ومعزولة لكل محادثة.
//  2. عبر النواة الحقيقية (runKernel) بنموذج مُبرمج يكرر نفس الأسلوب عمداً.
//  3. عبر composeReply (المسار المشترك لـAuto AI وكل واجهات الدردشة).
//  4. Error Guard: تصنيف وترجمة، بلا Stack Trace ولا مسارات لغير المالك، وحدّ الإرسال الحقيقي.
//  5. Message ID deduplication: إعادة تسليم نفس الرسالة لا تستدعي المزوّد مرتين.
//  6. النواة الواحدة: لا مسار ذكاء مستقل يستدعي المزوّدين خارج النواة.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-quality-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
memory.resetAll();
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const core = await import("../src/lib/terboo-ai-core.js");
const { diversify, fingerprint, resetDiversity, GREETINGS } = await import("../src/lib/terboo-ai-diversity.js");
const guard = await import("../src/lib/terboo-error-guard.js");
const { installLocalization } = await import("../src/lib/terboo-i18n/runtime.js");
const { latencyReport, resetLatency } = await import("../src/lib/terboo-latency.js");

const BOT = "2348093093240";
const sock = { user: { id: `${BOT}:12@s.whatsapp.net` } };
const USER_A = "201000000101@s.whatsapp.net";
const USER_B = "201000000102@s.whatsapp.net";
const USER_EN = "201000000103@s.whatsapp.net";
const GROUP = "120363000000000888@g.us";
const norm = (s) => String(s).replace(/\p{Extended_Pictographic}|️/gu, "").trim();

// ═══ 1. الطبقة نفسها ═══
{
  resetDiversity();
  const key = "private:unit";
  const first = diversify("أهلاً بك! 👋 أنا تيربو، المساعد الذكي. كيف أساعدك؟", { key, lang: "ar", userText: "مرحبا" });
  assert.match(first.text, /أنا تيربو/, "أول تعارف: التعريف بالنفس مقبول");
  const second = diversify("أهلاً بك! 👋 أنا تيربو، المساعد الذكي. أقدر أحمّل الفيديوهات وأبحث لك. هل تحتاج أي مساعدة أخرى؟", { key, lang: "ar", userText: "بتعمل اي" });
  assert.doesNotMatch(second.text, /أنا تيربو/, "لا إعادة تعريف لمن يعرف البوت (§41)");
  assert.doesNotMatch(second.text, /^أهلاً بك/, "لا تكرار لنفس البداية (§14)");
  assert.match(second.text, /أقدر أحمّل الفيديوهات/, "المحتوى الحقيقي لا يُحذف");
  const third = diversify("بالتأكيد! جهزت لك الملف. هل تحتاج أي مساعدة أخرى؟", { key, lang: "ar", userText: "اعمل كذا" });
  assert.doesNotMatch(third.text, /هل تحتاج أي مساعدة أخرى/, "الخاتمة العامة المكرّرة تُحذف");
  const fourth = diversify("بالتأكيد! خليته أسرع.", { key, lang: "ar", userText: "خليه اسرع" });
  assert.equal(fourth.text, "خليته أسرع.", "بداية الحشو المكرّرة تُحذف");
  const greet = diversify("أهلاً بك! 👋", { key, lang: "ar", userText: "مرحبا تاني" });
  assert.ok(GREETINGS.ar.again.includes(greet.text), `تحية الرجوع من مجموعة العربية: ${greet.text}`);
  const greet2 = diversify("أهلاً بك! 👋", { key, lang: "ar", userText: "هاي" });
  assert.notEqual(norm(greet2.text), norm(greet.text), "تحيتان متتاليتان مختلفتان (§40)");
  const who = diversify("أنا تيربو، المساعد الذكي لبوت تيربو.", { key, lang: "ar", userText: "مين انت؟" });
  assert.match(who.text, /أنا تيربو/, "إذا سأل «مين انت» يعرّف بنفسه");
  // الإيموجي المكرّر بنفس التسلسل يُزال من الطرفين
  diversify("تم ✅", { key: "private:emoji", lang: "ar" });
  assert.equal(diversify("تم الحفظ ✅", { key: "private:emoji", lang: "ar" }).text, "تم الحفظ");
  // عزل: محادثة جديدة لا تتأثر ببصمات محادثة أخرى
  const other = diversify("أهلاً بك! 👋 أنا تيربو، المساعد الذكي.", { key: "private:other", lang: "ar", userText: "مرحبا" });
  assert.match(other.text, /أنا تيربو/, "بصمات محادثة لا تتسرب لأخرى");
  // الإنجليزية
  for (const [lang, intro, ask] of [["en", "Hello! 👋 I'm Terboo, your smart assistant.", "hi"]]) {
    const k = `private:${lang}`;
    diversify(`${intro} How can I help?`, { key: k, lang, userText: ask });
    const again = diversify(`${intro} I can download videos for you.`, { key: k, lang, userText: "what can you do" });
    assert.doesNotMatch(again.text, /Terboo/, `${lang}: لا إعادة تعريف`);
    const hello = diversify(intro.split(" ")[0] + " 👋", { key: k, lang, userText: ask });
    assert.ok(GREETINGS[lang].again.includes(hello.text), `${lang}: تحية الرجوع بلغة المستخدم: ${hello.text}`);
  }
  assert.ok(fingerprint("أهلاً! 👋 تمام").emoji === "👋");
}

// ═══ 2. عبر النواة الحقيقية ═══
const calls = [];
let script = () => ({ decision: "CHAT", reply: "…", confidence: 0.9 });
async function ask(payload) {
  calls.push(payload);
  return { text: JSON.stringify(script(payload)), provider: "Scripted" };
}
const deps = { ask, rateLimit: false };
let seq = 0;
function message({ sender = USER_A, body, group = false, id = null }) {
  const replies = [];
  return {
    key: { remoteJid: group ? GROUP : sender, fromMe: false, id: id || `QUAL${++seq}`, ...(group ? { participant: sender } : {}) },
    sender, chat: group ? GROUP : sender, isGroup: group,
    body: group ? `@${BOT} ${body}` : body,
    pushName: "مختبر", type: "conversation", isCommand: false, prefix: ".",
    isOwner: false, isPremium: false, isPartner: false, isAdmin: group, isBotAdmin: true,
    isBot: false, fromMe: false, isNewsletter: false, mentionedJid: group ? [`${BOT}@s.whatsapp.net`] : [], quoted: null,
    replies,
    async reply(text) { replies.push(String(text)); return { key: { id: "r" } }; },
    async react() { },
  };
}
async function say(opts) {
  const m = message(opts);
  const result = await core.runKernel(m, sock, db, deps);
  return { m, result, text: m.replies.join("\n").replace(/^[⁣⁤]+/, "") };
}
{
  resetDiversity();
  const repetitive = "أهلاً بك! 👋 أنا تيربو، المساعد الذكي.";
  script = () => ({ decision: "CHAT", reply: `${repetitive} كيف أساعدك اليوم؟`, confidence: 0.9 });
  const hello = await say({ body: "مرحبا" });
  assert.equal(hello.result, "answered");
  assert.match(hello.text, /أنا تيربو/);
  script = (payload) => {
    assert.ok(payload.history.some((turn) => turn.role === "assistant"), "المحادثة السابقة تصل للنموذج (§15)");
    return { decision: "CHAT", reply: `${repetitive} أقدر أحمّل وأبحث وأنفّذ الأوامر. هل تحتاج أي مساعدة أخرى؟`, confidence: 0.9 };
  };
  const what = await say({ body: "بتعمل اي" });
  assert.doesNotMatch(what.text, /أنا تيربو/, `النواة أعادت التعريف: ${what.text}`);
  assert.match(what.text, /أقدر أحمّل/);
  script = () => ({ decision: "CHAT", reply: "أهلاً بك! 👋", confidence: 0.9 });
  const again = await say({ body: "مرحبا تاني" });
  assert.ok(GREETINGS.ar.again.includes(again.text.trim()), `تحية الرجوع عبر النواة: ${again.text}`);
  // مستخدم آخر: محادثته مستقلة (يتعرّف لأول مرة)
  script = () => ({ decision: "CHAT", reply: `${repetitive} كيف أساعدك؟`, confidence: 0.9 });
  const other = await say({ sender: USER_B, body: "مرحبا" });
  assert.match(other.text, /أنا تيربو/, "محادثة المستخدم B لا تتأثر بمحادثة A");
  // نفس المستخدم داخل مجموعة: نطاق مختلف عن الخاص
  const inGroup = await say({ sender: USER_A, body: "مرحبا", group: true });
  assert.match(inGroup.text, /أنا تيربو/, "نطاق المجموعة مستقل عن الخاص");
}

// ═══ 3. composeReply (Auto AI وكل واجهات الدردشة) ═══
{
  const replyText = "Hello! 👋 I'm Terboo, your smart assistant. Sure, here is the answer.";
  const plainAsk = async () => ({ text: replyText, provider: "Scripted" });
  const m1 = message({ sender: USER_EN, body: "hi there" });
  const r1 = await core.composeReply({ m: m1, db, text: "hi there", lang: "en", ask: plainAsk });
  assert.match(r1.text, /I'm Terboo/);
  const m2 = message({ sender: USER_EN, body: "and what else?" });
  const r2 = await core.composeReply({ m: m2, db, text: "and what else?", lang: "en", ask: plainAsk });
  assert.doesNotMatch(r2.text, /I'm Terboo/, `composeReply أعاد التعريف: ${r2.text}`);
  assert.match(r2.text, /here is the answer/);
}

// ═══ 4. Error Guard ═══
{
  const raw = "❌ فشل التحميل: AxiosError: Request failed with status code 404\n    at settle (/home/user/bot/node_modules/axios/lib/core/settle.js:19:12)\n    at async handler (file:///home/user/bot/plugins/downloader/x.js:40:5)";
  const safe = guard.sanitizeForUser(raw, "ar");
  assert.equal(safe, "❌ فشل التحميل: لم يتم العثور على المطلوب (رمز 404).");
  assert.ok(guard.leaksInternals(raw) && !guard.leaksInternals(safe));
  assert.equal(guard.sanitizeForUser("Error: TypeError: Cannot read properties of undefined (reading 'data')", "en"), "An internal error occurred and was logged for the developer.");
  assert.equal(guard.userError(Object.assign(new Error("x"), { response: { status: 429 } }), "ar"), "الخدمة مزدحمة بالطلبات حالياً، انتظر قليلاً ثم أعد المحاولة.");
  assert.equal(guard.classifyError(new Error("timeout of 30000ms exceeded")).kind, "timeout");
  assert.equal(guard.sanitizeForUser("نص عادي بلا أخطاء", "ar"), "نص عادي بلا أخطاء", "النص العادي لا يتغيّر");

  // حدّ الإرسال الحقيقي: غير المالك يرى رسالة مصنّفة بلغته، والمالك في الخاص يرى التفاصيل
  const OWNER = "201999999999@s.whatsapp.net";
  const sent = [];
  const boundary = { async sendMessage(jid, content) { sent.push({ jid, text: content.text }); return {}; } };
  installLocalization(boundary, { getDatabase, isOwner: (jid) => String(jid).startsWith("201999999999") });
  db.setUser(USER_EN, { language: "en" });
  await boundary.sendMessage(USER_EN, { text: raw });
  assert.equal(sent.at(-1).text.includes("settle"), false, "لا Stack Trace لغير المالك");
  assert.match(sent.at(-1).text, /wasn't found \(code 404\)/, `رسالة مصنّفة بالإنجليزية: ${sent.at(-1).text}`);
  await boundary.sendMessage(OWNER, { text: raw });
  assert.match(sent.at(-1).text, /status code 404[\s\S]*settle\.js/, "المالك في الخاص يرى التفاصيل للتشخيص");
  await boundary.sendMessage(GROUP, { text: raw });
  assert.equal(guard.leaksInternals(sent.at(-1).text), false, "المجموعة لا ترى تفاصيل داخلية حتى لو كان المالك فيها");

  const autoSource = fs.readFileSync("src/lib/terboo-auto-ai.js", "utf8");
  assert.doesNotMatch(autoSource, /error:\s*(?:e|reviewError)\.message/, "أخطاء إجراءات Auto AI مصنّفة ومترجمة");
}

// ═══ 5. Message ID deduplication ═══
{
  resetLatency();
  script = () => ({ decision: "CHAT", reply: "إجابة واحدة", confidence: 0.9 });
  const m = message({ sender: USER_B, body: "سؤال واحد فقط", id: "DUPLICATE-ID-1" });
  const before = calls.length;
  assert.equal(await core.runKernel(m, sock, db, deps), "answered");
  const redelivered = message({ sender: USER_B, body: "سؤال واحد فقط", id: "DUPLICATE-ID-1" });
  assert.equal(await core.runKernel(redelivered, sock, db, deps), "duplicate");
  assert.equal(calls.length - before, 1, "المزوّد استُدعي مرة واحدة فقط لنفس الرسالة");
  assert.equal(redelivered.replies.length, 0, "لا رد ثانٍ لإعادة التسليم");
  assert.equal(latencyReport().duplicatesBlocked, 1);
  // معرّف مختلف ⇒ رسالة جديدة تُعالَج
  assert.equal(await core.runKernel(message({ sender: USER_B, body: "سؤال واحد فقط" }), sock, db, deps), "answered");
}

// ═══ 5ب. Smart Concurrency (v5 §17): لا تأخير ثابت، الدفعة قرار واحد بسياقها، والإغراق يُشار إليه ═══
{
  script = () => ({ decision: "CHAT", reply: "تمام", confidence: 0.9 });
  const FAST = "201000000109@s.whatsapp.net";
  const burst = [1, 2, 3, 4].map((n) => {
    const m = message({ sender: FAST, body: `رسالة سريعة رقم ${n}` });
    m.reactions = [];
    m.react = async (emoji) => { m.reactions.push(emoji); };
    return m;
  });
  const seen = [];
  const slowAsk = async (payload, ...rest) => {
    seen.push(payload.instruction || "");
    await new Promise((r) => setTimeout(r, 150)); // زمن مزوّد حقيقي تقريبي
    return ask(payload, ...rest);
  };
  const started = Date.now();
  const results = await Promise.all(burst.map((m) => core.runKernel(m, sock, db, { ask: slowAsk, rateLimit: true })));
  const elapsed = Date.now() - started;
  const answered = burst.filter((m) => m.replies.length);
  assert.equal(answered.length, 1, `الدفعة يجب أن تُجاب مرة واحدة لا ${answered.length} (${results})`);
  assert.equal(answered[0], burst[3], "الرد يجب أن يكون للرسالة الأحدث");
  assert.equal(results.filter((r) => r === "superseded").length, 3, `السابقة تُدمج لا تُهمل: ${results}`);
  const lastInstruction = seen.at(-1);
  for (const n of [1, 2, 3]) assert.ok(lastInstruction.includes(`رسالة سريعة رقم ${n}`), `القرار الأحدث لا يرى الرسالة ${n} كسياق دفعة`);
  assert.ok(elapsed < 2000, `تأخير مصطنع: ${elapsed}ms (كان ≥ 7000ms بنافذة 4 ثوانٍ)`);
  assert.equal(burst.filter((m) => m.reactions.includes("⏳")).length, 0, "لا إغراق داخل الحدود");

  // أول رسالة في ممرّ فارغ لا تنتظر شيئاً
  const solo = message({ sender: "201000000110@s.whatsapp.net", body: "سؤال منفرد" });
  const t0 = Date.now();
  assert.equal(await core.runKernel(solo, sock, db, { ask, rateLimit: true }), "answered");
  assert.ok(Date.now() - t0 < 500, "الرسالة الأولى تأخرت");

  // إغراق فوق حد الطابور ⇒ ⏳ مرئية لا صمت
  const flood = [1, 2, 3, 4, 5, 6].map((n) => {
    const m = message({ sender: "201000000111@s.whatsapp.net", body: `إغراق ${n}` });
    m.reactions = [];
    m.react = async (emoji) => { m.reactions.push(emoji); };
    return m;
  });
  await Promise.all(flood.map((m) => core.runKernel(m, sock, db, { ask: slowAsk, rateLimit: true })));
  assert.ok(flood.some((m) => m.reactions.includes("⏳")), "الإغراق لم يأخذ إشارة ⏳");
  assert.ok(flood.some((m) => m.replies.length), "الإغراق أسكت الرد الأخير أيضاً");
}

// ═══ 6. نواة واحدة: لا مسار يستدعي المزوّدين خارجها (§8) ═══
{
  const walk = (dir, out = []) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.m?js$/.test(entry.name)) out.push(full.split(path.sep).join("/"));
    }
    return out;
  };
  const importers = [...walk("src"), ...walk("plugins")]
    .filter((file) => /from\s+["'][^"']*terboo-ai-(?:providers|router)\.js["']/.test(fs.readFileSync(file, "utf8")));
  const allowed = new Set([
    "src/lib/terboo-ai-core.js", "src/lib/terboo-ai-providers.js", "src/lib/terboo-ai-router.js",
    "src/lib/terboo-auto-ai.js", // يمرّر مزوّدي الشخصية إلى composeReply في النواة
    "plugins/owner/تحكم.js", // أسماء المزوّدين فقط للعرض
  ]);
  for (const file of importers) assert.ok(allowed.has(file), `مسار ذكاء مستقل خارج النواة: ${file}`);
  const autoSource = fs.readFileSync("src/lib/terboo-auto-ai.js", "utf8");
  assert.match(autoSource, /await composeReply\(/, "Auto AI يرد عبر المسار المشترك في النواة");
  assert.doesNotMatch(autoSource, /claudeChat\(\s*\{/, "لا نداء مزوّد مباشر من Auto AI خارج composeReply");
  const owner = fs.readFileSync("plugins/owner/تحكم.js", "utf8");
  assert.doesNotMatch(owner, /\b(?:ask|chat|runRoutedChat)\(/, "لوحة التحكم لا تستدعي مزوّداً");
}

console.log("✅ terboo-ai-quality: تنويع الردود (هوية · تحية · بداية · خاتمة · إيموجي، معزول لكل محادثة) عبر النواة وcomposeReply، حارس الأخطاء المصنّفة المترجمة عند حدّ الإرسال، منع معالجة الرسالة مرتين، ونواة واحدة لكل مسارات الذكاء");
process.exit(0);
