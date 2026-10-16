// ═══════════════════════════════════════════════
// 🧪 Terboo — بلاغات التشغيل في المجموعات والوسائط (كل حالة من لقطات المالك)
// ───────────────────────────────────────────────
//   1. «اكتب كود…» ⇒ الكود يصل رسالة نصية ظاهرة (```) لا رسالة غنية لا تُعرض.
//   2. «افحص الصورة دي تحتوي علي اي» رداً على صورة ⇒ رؤية حقيقية بالعربي، لا «.صورة_لنص» الإنجليزية.
//   3. فويس عربي قصير التُقط إنجليزياً/إندونيسياً ⇒ تفريغ عربي؛ وكلام إنجليزي حقيقي يبقى إنجليزياً.
//   4. بطاقة جهة اتصال + «اضف العضو دا @تيربو» ⇒ رقم البطاقة لا LID البوت.
//   5. المناداة: تيربو · تربو · تيربوو · تربوو · terboo · tarboo · terbo · tarbo.
//   6. المالك: «متتكلمش في المجموعة» · «متتكلمش مع ده» · «اتكلم» · «اتكلم معاه عادي».
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-group-reports-"));
process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid.json");
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
const db = await initDatabase(tmp);
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
memory.resetAll();
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const core = await import("../src/lib/terboo-ai-core.js");
const gate = await import("../src/lib/terboo-intent-gate.js");
const mm = await import("../src/lib/terboo-multimodal.js");
const talk = await import("../src/lib/terboo-ai-talk-control.js");
const serialize = await import("../src/lib/terboo-serialize.js");
const identity = await import("../src/lib/terboo-identity.js");
const { installTransport } = await import("../src/lib/terboo-transport.js");
const config = (await import("../config.js")).default;

const OWNER = `${String(config.owner.number[0]).replace(/\D/g, "")}@s.whatsapp.net`;
const MEMBER = "201077770001@s.whatsapp.net";
const OTHER = "201077770002@s.whatsapp.net";
const GROUP = "120363000000000777@g.us";
const BOT_PN = "2348093093240";
const BOT_LID = "276536653570247";
const sock = { user: { id: `${BOT_PN}:12@s.whatsapp.net`, lid: `${BOT_LID}:12@lid` } };
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };
let seq = 0;

/** رسالة مجموعة عبر النواة الحقيقية؛ النموذج مُحاكى ويُسجَّل كل نداء له */
async function groupSay(sender, body, { quoted = null, mentions = [], ask = null, media = null, extra = {} } = {}) {
  const replies = [];
  const dispatched = [];
  const calls = [];
  const m = {
    key: { remoteJid: GROUP, fromMe: false, id: `GR${++seq}`, participant: sender }, id: `GR${seq}`, sender, chat: GROUP, isGroup: true, body,
    type: "conversation", isCommand: false, prefix: ".", isOwner: sender === OWNER, mentionedJid: mentions, quoted, pushName: "عضو",
    async reply(text, options = {}) { replies.push({ text: String(text), mentions: options.mentions || [] }); return { key: { id: "r" } }; }, async react() {},
    ...extra,
  };
  const defaultAsk = async (payload) => {
    calls.push(payload.instruction || "");
    if (/Choose exactly one decision/.test(payload.instruction || "")) return { text: JSON.stringify({ decision: "CHAT", reply: "أهلاً! أنا تيربو." }), provider: "GPT" };
    return { text: "أهلاً! أنا تيربو.", provider: "GPT" };
  };
  const outcome = await core.runKernel(m, sock, db, {
    ask: ask || defaultAsk, rateLimit: false, media: media || {},
    dispatch: async (_m, _s, request) => { dispatched.push(`${request.command} ${request.args || ""}`.trim()); return { ok: true }; },
  });
  return { outcome, text: replies.map((r) => r.text).join("\n"), replies, dispatched, calls };
}
const fromMember = (sender, body = "رسالة") => ({ key: { fromMe: false, id: `Q${++seq}`, participant: sender, remoteJid: GROUP }, sender, body, type: "conversation", message: { conversation: body } });
const fromBot = (body = "أهلاً") => ({ key: { fromMe: true, id: `QB${++seq}`, participant: `${BOT_PN}@s.whatsapp.net`, remoteJid: GROUP }, sender: `${BOT_PN}@s.whatsapp.net`, body, type: "conversation", message: { conversation: body } });

// ── 1. الكود يصل ظاهراً ─────────────────────────
await check("code-visible-by-default", async () => {
  const sent = [];
  const relayed = [];
  const fake = {
    user: { id: `${BOT_PN}:3@s.whatsapp.net` }, ev: { on() {}, off() {} },
    async relayMessage(jid, message, options = {}) { relayed.push(message); return options.messageId; },
    async sendMessage(jid, content, options = {}) { sent.push(content); return { key: { id: `S${sent.length}`, remoteJid: jid, fromMe: true } }; },
  };
  installTransport(fake, { getDatabase: () => getDatabase() });
  getDatabase().setting("richCode", "text"); // وضع النص: الكود يظهر كنص على كل الأجهزة
  await fake.sendMessage(MEMBER, { text: "إليك كود بسيط:\n```js\nconsole.log(\"مرحبا\");\n```" });
  assert.equal(relayed.filter((message) => message.richResponseMessage).length, 0, "رسالة غنية لا تُعرض على الأجهزة العادية");
  const text = sent.map((content) => content.text || "").join("\n");
  assert.match(text, /```[\s\S]*console\.log\("مرحبا"\);[\s\S]*```/, text);
});

// ── 2. سؤال عن صورة ⇒ رؤية حقيقية بالعربي ────────
await check("image-question-vision", async () => {
  for (const text of ["افحص الصورة دي تحتوي علي اي", "الصورة دي فيها ايه", "شوف الصورة دي", "ترجم الصورة دي"]) {
    const g = gate.classify({ text, m: { quoted: { isImage: true } } });
    assert.deepEqual([g.intent, g.op, g.deterministic], ["VISION", "describe", true], text);
  }
  for (const text of ["اعملها ستيكر", "شيل الخلفية", "حولها لبرومبت"]) assert.notEqual(gate.classify({ text, m: { isImage: true } }).deterministic, true, `أداة: ${text}`);
  const png = await (await import("sharp")).default({ create: { width: 32, height: 32, channels: 3, background: "#888" } }).png().toBuffer();
  const media = { vision: async () => ({ ok: true, text: "A smiling man in a suit", provider: "GPTVision" }), ocr: async () => ({ ok: false, text: "" }) };
  const answerAsk = async (payload) => (/Choose exactly one decision/.test(payload.instruction || "")
    ? { text: JSON.stringify({ decision: "COMMAND", command: "صورة_لنص", args: "" }), provider: "GPT" }
    : { text: "في الصورة رجل مبتسم يرتدي بدلة رسمية.", provider: "GPT" });
  // رد على صورة
  const quotedImage = { ...fromMember(OTHER, ""), type: "imageMessage", isImage: true, isMedia: true, message: { imageMessage: { mimetype: "image/png", fileLength: png.length } }, download: async () => png };
  const asked = await groupSay(MEMBER, "تيربو افحص الصورة دي تحتوي علي اي", { quoted: quotedImage, ask: answerAsk, media });
  assert.deepEqual(asked.dispatched, [], `نُفّذ أمر: ${asked.dispatched}`);
  assert.match(asked.text, /رجل مبتسم/);
  assert.doesNotMatch(asked.text, /^CHAT$/m);
  // صورة مرفقة + طلب فيه فعل أداة يذكر الصورة (يقرّره النموذج) ⇒ اختار «صورة_لنص» ⇒ رؤية حقيقية بدلها
  assert.equal(gate.classify({ text: "خلي الصورة دي كلام", m: { isImage: true } }).deterministic, false);
  const own = await groupSay(MEMBER, "تيربو خلي الصورة دي كلام", { ask: answerAsk, media, extra: { isImage: true, type: "imageMessage", message: { imageMessage: { mimetype: "image/png", fileLength: png.length } }, download: async () => png } });
  assert.deepEqual(own.dispatched, [], `نُفّذ أمر: ${own.dispatched}`);
  assert.match(own.text, /رجل مبتسم/);
});

// ── 3. لغة التفريغ ───────────────────────────────
await check("voice-language-choice", async () => {
  const out = path.join(tmp, "tone.ogg");
  await promisify(execFile)(await mm.ffmpegPath(), ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libopus", out], { shell: false, timeout: 60_000 });
  const tone = fs.readFileSync(out);
  const provider = (byLanguage) => [{ name: "fake-whisper", fn: async (_wav, { language, prompt }) => ({ ...byLanguage(language), prompt }) }];
  // عربي مصري قصير ⇒ «Intasmaka ia» إندونيسية ⇒ إعادة بالعربي (أوثق)
  const arabic = await mm.transcribeAudio(tone, { hint: "ar", providers: provider((language) => (language === "ar" ? { text: "انت اسمك ايه", language: "Arabic", confidence: -0.36 } : { text: "Intasmaka ia.", language: "Indonesian", confidence: -0.44 })) });
  assert.deepEqual([arabic.ok, arabic.text, arabic.language], [true, "انت اسمك ايه", "ar"]);
  // إنجليزي حقيقي ⇒ يبقى إنجليزياً (العربي المفروض أضعف بوضوح)
  const english = await mm.transcribeAudio(tone, { hint: "ar", providers: provider((language) => (language === "ar" ? { text: "مرحباً هذا تست", language: "Arabic", confidence: -1.08 } : { text: "Hello, this is a voice test.", language: "English", confidence: -0.21 })) });
  assert.deepEqual([english.text, english.language], ["Hello, this is a voice test.", "en"]);
  // هلوسة معروفة في المحاولتين ⇒ «مسمعتش كويس» لا «الخدمة معطلة»
  const phantom = await mm.transcribeAudio(tone, { hint: "ar", providers: provider(() => ({ text: "اشتركوا في القناة", language: "Arabic", confidence: -0.5 })) });
  assert.deepEqual([phantom.ok, phantom.error], [false, "unclear"]);
  // «شكرا» حقيقية تبقى
  const thanks = await mm.transcribeAudio(tone, { hint: "ar", providers: provider(() => ({ text: "شكرا", language: "Arabic", confidence: -0.3 })) });
  assert.equal(thanks.text, "شكرا");
  // موجّه المفردات بلغة المستخدم يصل للمزوّد
  let seenPrompt = "";
  await mm.transcribeAudio(tone, { hint: "ar", providers: [{ name: "p", fn: async (_w, { prompt }) => { seenPrompt = prompt; return { text: "ازيك", language: "ar", confidence: -0.2 }; } }] });
  assert.match(seenPrompt, /تيربو/);
});

// ── 4. بطاقة جهة اتصال ⇒ رقمها ───────────────────
await check("add-from-contact-card", async () => {
  const vcard = "BEGIN:VCARD\nVERSION:3.0\nN:;رقمي 2;;;\nFN:رقمي 2\nitem1.TEL;waid=201055556666:+20 10 5555 6666\nitem1.X-ABLabel:Mobile\nEND:VCARD";
  assert.deepEqual(serialize.vcardNumbers(vcard), ["201055556666"]);
  assert.deepEqual(serialize.vcardNumbers("BEGIN:VCARD\nFN:x\nTEL;type=CELL:+44 7700 900123\nEND:VCARD"), ["447700900123"]);
  const cards = serialize.contactsOf({ contactsArrayMessage: { contacts: [{ displayName: "أ", vcard }, { displayName: "ب", vcard: vcard.replace(/201055556666/g, "201055557777") }] } }, "contactsArrayMessage");
  assert.deepEqual(cards.map((card) => card.numbers[0]), ["201055556666", "201055557777"]);

  const add = (await import("../plugins/group/اضف.js")).handler;
  const checked = [];
  const groupSock = {
    user: sock.user,
    async onWhatsApp(jid) { checked.push(jid); return [{ exists: true, jid }]; },
    async groupParticipantsUpdate() { return [{ status: "200" }]; },
    async groupInviteCode() { return "x"; }, async groupMetadata() { return { subject: "G" }; },
  };
  const replies = [];
  const base = { chat: GROUP, sender: OWNER, pushName: "mahmoud", async reply(text) { replies.push(String(text)); }, async react() {} };
  // الرد على البطاقة مع «@تيربو» (LID البوت) في الوسائط
  await add({ ...base, args: [`@${BOT_LID}`], body: `.اضف @${BOT_LID}`, quoted: { key: { fromMe: false }, body: "", contacts: [{ name: "رقمي 2", numbers: ["201055556666"] }] } }, { sock: groupSock });
  assert.deepEqual(checked, ["201055556666@s.whatsapp.net"], `فُحص: ${checked}`);
  assert.match(replies.join("\n"), /تمت الإضافة/);
  // «.اضف @البوت» بلا بطاقة ولا رقم آخر ⇒ لا محاولة لإضافة البوت نفسه
  checked.length = 0;
  await add({ ...base, args: [`@${BOT_LID}`], body: `.اضف @${BOT_LID}`, quoted: null }, { sock: groupSock });
  assert.deepEqual(checked, [], "لم يُحاول إضافة البوت");
  // بطاقة أُرسلت قبل قليل ثم «.اضف» بلا رد
  serialize.rememberContacts(GROUP, OWNER, [{ name: "رقمي 3", numbers: ["201055558888"] }]);
  await add({ ...base, args: [], body: ".اضف", quoted: null }, { sock: groupSock });
  assert.deepEqual(checked, ["201055558888@s.whatsapp.net"]);
  // النواة: «@تيربو» في الطلب لا يصير وسيطاً للأمر
  const viaKernel = await groupSay(OWNER, `اضف العضو دا للمجموعة @${BOT_LID}`, {
    mentions: [`${BOT_LID}@lid`], quoted: { ...fromMember(OWNER, ""), type: "contactMessage", isContact: true, contacts: [{ name: "رقمي 2", numbers: ["201055556666"] }] },
    ask: async () => ({ text: JSON.stringify({ decision: "COMMAND", command: "اضف", args: `@${BOT_LID}` }), provider: "GPT" }),
  });
  assert.deepEqual(viaKernel.dispatched, ["اضف 201055556666"], `الأمر: ${viaKernel.dispatched}`);
  // النموذج اختار رقم مرسل البطاقة (المالك) هدفاً ⇒ رقم البطاقة بدلاً منه (بلاغ حي)
  const ownerDigits = OWNER.split("@")[0];
  const senderPicked = await groupSay(OWNER, "تيربو اضف العضو دا", {
    quoted: { ...fromMember(OWNER, ""), type: "contactMessage", isContact: true, contacts: [{ name: "رقمي 2", numbers: ["201055556666"] }] },
    ask: async () => ({ text: JSON.stringify({ decision: "COMMAND", command: "اضف", args: `@${ownerDigits}` }), provider: "GPT" }),
  });
  assert.deepEqual(senderPicked.dispatched, ["اضف 201055556666"], `الأمر: ${senderPicked.dispatched}`);
  // النموذج اختار «اضف_بريميوم» وادّعى «تمت إضافة الرقم» قبل التنفيذ (بلاغ حي) ⇒ «اضف» بلا ادعاء
  const sibling = await groupSay(OWNER, "تيربو اضف العضو دا للمجموعة", {
    quoted: { ...fromMember(OWNER, ""), type: "contactMessage", isContact: true, contacts: [{ name: "رقمي 2", numbers: ["201055556666"] }] },
    ask: async () => ({ text: JSON.stringify({ decision: "COMMAND", command: "اضف_بريميوم", args: "201055556666", reply: "تمت إضافة الرقم للمجموعة." }), provider: "GPT" }),
  });
  assert.deepEqual(sibling.dispatched, ["اضف 201055556666"], `الأمر: ${sibling.dispatched}`);
  assert.doesNotMatch(sibling.text, /تمت إضافة/);
});

// ── 5. المناداة بكل الصيغ ────────────────────────
await check("name-variants", async () => {
  for (const text of ["تيربو ازيك", "تربو عامل ايه", "تيربوو اكتب كود", "تربوو", "terboo hi", "tarboo hi", "Terbo what's up", "tarbo", "ازيك يا تربو؟", "عامل ايه تيربو", "hey tarbo"]) assert.ok(core.nameTrigger(text), text);
  for (const text of ["مساحة تربو على الألف متر", "التربوي", "قول لتربو", "turbo mode"]) assert.ok(!core.nameTrigger(text), text);
  const named = await groupSay(MEMBER, "تربو");
  assert.equal(named.outcome, "answered", "النداء بالاسم وحده يُرد عليه");
  assert.match(named.text, /أهلاً/);
});

// ── 6. تحكّم المالك في الكلام ─────────────────────
await check("owner-talk-control", async () => {
  // صمت المجموعة
  const silenced = await groupSay(OWNER, "تيربو متتكلمش في المجموعة غير لما اقولك اتكلم");
  assert.equal(talk.talkState(db, GROUP).silent, true);
  assert.match(silenced.text, /مش هتكلم/);
  assert.equal(silenced.calls.length, 0, "أمر التحكّم بلا نموذج");
  const ignoredWhileSilent = await groupSay(MEMBER, "تيربو ازيك");
  assert.equal(ignoredWhileSilent.outcome, false);
  assert.equal(ignoredWhileSilent.replies.length, 0);
  assert.equal(ignoredWhileSilent.calls.length, 0, "لا نداء للنموذج أثناء الصمت");
  // المالك لا يُصمت عنه
  assert.equal((await groupSay(OWNER, "تيربو ازيك")).outcome, "answered");
  // عضو يحاول التحكّم ⇒ للمالك فقط، والحالة كما هي
  const denied = await groupSay(MEMBER, "تيربو اتكلم", { quoted: fromBot() });
  assert.match(denied.text, /للمالك/);
  assert.equal(talk.talkState(db, GROUP).silent, true);
  // «اتكلم» من المالك بلا مناداة أثناء الصمت
  const resumed = await groupSay(OWNER, "اتكلم");
  assert.equal(talk.talkState(db, GROUP).silent, false);
  assert.match(resumed.text, /رجعت/);
  assert.equal((await groupSay(MEMBER, "تيربو ازيك")).outcome, "answered");

  // تجاهل عضو محدد (رداً على رسالته)
  const ignored = await groupSay(OWNER, "تيربو متتكلمش مع العضو دا", { quoted: fromMember(MEMBER, "يا تيربو قول نكتة") });
  assert.ok(talk.talkState(db, GROUP).ignored.some((jid) => identity.sameUser(jid, MEMBER)));
  assert.deepEqual(ignored.replies.at(-1).mentions, [MEMBER], "منشن العضو في التأكيد");
  assert.equal((await groupSay(MEMBER, "تيربو ازيك")).outcome, false, "العضو المتجاهَل");
  assert.equal((await groupSay(OTHER, "تيربو ازيك")).outcome, "answered", "باقي الأعضاء");
  // المالك لا يُتجاهل
  const ownerTarget = await groupSay(OWNER, "تيربو متتكلمش معاه", { mentions: [OWNER] });
  assert.match(ownerTarget.text, /المالك/);
  // «اتكلم معاه عادي» (منشن)
  await groupSay(OWNER, "تيربو اتكلم معاه عادي", { mentions: [MEMBER] });
  assert.equal(talk.talkState(db, GROUP).ignored.length, 0);
  assert.equal((await groupSay(MEMBER, "تيربو ازيك")).outcome, "answered");

  // «اتكلم عن الفيزياء» طلب عادي لا تحكّم
  const topic = await groupSay(OWNER, "تيربو اتكلم عن الفيزياء");
  assert.ok(topic.calls.length > 0, "ذهب للنموذج");
  // «متتكلمش» بين عضوين (بلا مناداة البوت) ⇒ لا شيء
  const between = await groupSay(MEMBER, "متتكلمش معايا كده", { quoted: fromMember(OTHER, "x") });
  assert.equal(between.outcome, false);
  assert.equal(talk.talkState(db, GROUP).silent, false);
  // صمت + «اتكلم مع الكل» يمسح كل شيء
  await groupSay(OWNER, "تيربو اسكت");
  await groupSay(OWNER, "تيربو متتكلمش مع ده", { mentions: [OTHER] });
  await groupSay(OWNER, "تيربو اتكلم مع الكل");
  assert.deepEqual(talk.talkState(db, GROUP), { silent: false, ignored: [] });
});

// ── 7. ذاكرة المجموعات المؤقتة تتبع الكتابة (كانت تعيد القديم 10 دقائق) ──
await check("group-cache-follows-writes", () => {
  const jid = "120363000000000888@g.us";
  db.setGroup(jid, { antilink: true });
  assert.equal(db.getGroup(jid).antilink, true);
  db.setGroup(jid, { ...db.getGroup(jid), antilink: false });
  assert.equal(db.getGroup(jid).antilink, false, "getGroup أعاد نسخة قديمة بعد setGroup");
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-group-ai-reports: ${results.join(" · ")}`);
process.exit(0);
