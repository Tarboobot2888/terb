// اختبار وظيفي لمسار الانضمام الجديد في Bot Terboo
// يغطي: بطاقة اللغة، حفظ اللغة (V6: القائمة الرئيسية مباشرةً بلا تسجيل)، بطاقة التسجيل اليدوية الواحدة (تعديل/حفظ/إلغاء)،
// الاستثناءات، وأمان المجموعات.
// لا يتصل بواتساب: يستخدم sock/m وهميين وقاعدة بيانات مؤقتة.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ملاحظة: src/lib/terboo-lid.js يسجّل معالج uncaughtException يبتلع الأخطاء،
// لذلك نضمن هنا أن أي فشل في الاختبار يُظهر رسالة ويعيد كود خروج غير صفري.
process.on("uncaughtException", (error) => {
  console.error("❌ فشل الاختبار:", error?.message || error);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  console.error("❌ فشل الاختبار:", error?.message || error);
  process.exit(1);
});

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-onboarding-"));

const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmpDb);
const db = getDatabase();

const onboarding = await import("../src/lib/terboo-onboarding.js");
const registration = await import("../plugins/user/daftar.js");
const { getUserLanguage } = await import("../src/lib/terboo-localization.js");

const sent = [];

function makeSock() {
  return {
    user: { jid: "2348093093240@s.whatsapp.net", id: "2348093093240:1@s.whatsapp.net" },
    async relayMessage(jid, message, opts) {
      const interactive = message?.viewOnceMessage?.message?.interactiveMessage || message?.interactiveMessage;
      sent.push({ kind: "relay", jid, message, text: interactive?.body?.text || "" });
      return { key: { id: `relay-${sent.length}` } };
    },
    async sendMessage(jid, content) {
      if (content?.delete) {
        sent.push({ kind: "delete", jid, id: content.delete.id });
        return { key: { id: `delete-${sent.length}` } };
      }
      sent.push({ kind: "send", jid, text: content?.text || content?.caption || "" });
      return { key: { id: `send-${sent.length}` } };
    },
  };
}

function makeMessage({
  sender,
  body = "",
  type = "conversation",
  isCommand = false,
  command = "",
  chat = null,
  isGroup = false,
  isOwner = false,
  isPremium = false,
  isPartner = false,
} = {}) {
  const jid = `${sender}@s.whatsapp.net`;
  const replies = [];
  return {
    sender: jid,
    chat: chat || (isGroup ? "12345-67890@g.us" : jid),
    body,
    type,
    isCommand,
    command,
    prefix: ".",
    args: [],
    isGroup,
    isOwner,
    isPremium,
    isPartner,
    isBot: false,
    fromMe: false,
    isNewsletter: false,
    pushName: "Tester",
    raw: {
      key: { remoteJid: chat || (isGroup ? "12345-67890@g.us" : jid), fromMe: false, id: "RAWID", participant: isGroup ? jid : undefined },
      message: { conversation: body || "." },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: "Tester",
    },
    replies,
    async reply(text) {
      replies.push(String(text));
      sent.push({ kind: "reply", jid: this.chat, text: String(text) });
      return { key: { id: `reply-${sent.length}` } };
    },
    async react() {
      return true;
    },
  };
}

function lastRelayButtons() {
  const relay = [...sent].reverse().find((s) => s.kind === "relay");
  if (!relay) return [];
  const interactive =
    relay.message?.viewOnceMessage?.message?.interactiveMessage ||
    relay.message?.interactiveMessage;
  const buttons = interactive?.nativeFlowMessage?.buttons || [];
  return buttons.map((b) => {
    try {
      return JSON.parse(b.buttonParamsJson || "{}").id;
    } catch {
      return null;
    }
  });
}

const sock = makeSock();

// ── TEST 01: مستخدم جديد → بطاقة اختيار اللغة ─────────────────────────
{
  sent.length = 0;
  const m = makeMessage({ sender: "111000000001", body: ".menu", isCommand: true, command: "menu" });
  const handled = await onboarding.handleOnboarding(m, sock, db);
  assert.equal(handled, true, "TEST 01: يجب أن تُعالج البوابة رسالة المستخدم الجديد");
  const ids = lastRelayButtons();
  assert.deepEqual(
    ids,
    ["terboo_language_ar", "terboo_language_en"],
    "TEST 01: يجب عرض أزرار اللغتين",
  );
}

// ── TEST 02: زر العربية → حفظ اللغة ← البوت جاهز (V6: لا بطاقة تسجيل، نمط الاستخدام قابل للتخطي) ──
//    ثم التسجيل اليدوي الاختياري (.daftar) يعمل كما هو ببطاقته الواحدة
const REG_BUTTONS = ["terboo_reg_name", "terboo_reg_age", "terboo_reg_gender", "terboo_reg_save", "terboo_reg_cancel"];
{
  sent.length = 0;
  const m = makeMessage({
    sender: "111000000001",
    body: "terboo_language_ar",
    type: "interactiveResponseMessage",
  });
  const handled = await onboarding.handleOnboarding(m, sock, db);
  assert.equal(handled, true, "TEST 02: يجب معالجة ضغطة الزر");
  assert.equal(getUserLanguage(db.getUser(m.sender)), "ar", "TEST 02: يجب حفظ اللغة = ar");
  let texts = sent.map((s) => s.text || "").join("\n");
  assert.doesNotMatch(texts, /إنشاء حسابك|سجّل أولاً|registration/i, "TEST 02: V6 — لا بطاقة تسجيل بعد اللغة");
  assert.doesNotMatch(texts, /كيف ستستخدم Terboo/, "TEST 02: V6 — لا خطوة نمط استخدام بعد اللغة");
  assert.ok(!lastRelayButtons().some((id) => /usage/.test(String(id))), "TEST 02: لا أزرار نمط استخدام");
  assert.ok(sent.some((s) => s.kind === "delete"), "TEST 02: بطاقة اللغة تُزال بعد الاختيار (لا تكدّس)");
  assert.equal(onboarding.isRegistrationRequired(db), false, "TEST 02: لا تسجيل إجباري");
  // التسجيل اليدوي الاختياري
  sent.length = 0;
  await registration.startRegistration(makeMessage({ sender: "111000000001", body: ".daftar", isCommand: true, command: "daftar" }), sock);
  texts = sent.map((s) => s.text || "").join("\n");
  assert.match(texts, /إنشاء حسابك/, "TEST 02: التسجيل اليدوي يعرض البطاقة بالعربية");
  assert.match(texts, /Tester/, "TEST 02: الاسم يُقترح من اسم واتساب");
  assert.deepEqual(lastRelayButtons(), REG_BUTTONS, "TEST 02: أزرار البطاقة الخمسة");
}

// ── TEST 03: زر الإنجليزية → بطاقة بالإنجليزية بالكامل ────────────────
{
  sent.length = 0;
  const m = makeMessage({
    sender: "111000000002",
    body: "terboo_language_en",
    type: "interactiveResponseMessage",
  });
  await onboarding.handleOnboarding(m, sock, db);
  assert.equal(getUserLanguage(db.getUser(m.sender)), "en", "TEST 03: يجب حفظ اللغة = en");
  assert.doesNotMatch(sent.map((s) => s.text || "").join("\n"), /Create your account/, "TEST 03: لا بطاقة تسجيل بعد اللغة");
  sent.length = 0;
  await registration.startRegistration(makeMessage({ sender: "111000000002", body: ".daftar", isCommand: true, command: "daftar" }), sock);
  const texts = sent.map((s) => s.text || "").join("\n");
  assert.match(texts, /Create your account/, "TEST 03: بطاقة التسجيل بالإنجليزية");
  assert.doesNotMatch(texts, /إنشاء حسابك|الاسم|العمر/, "TEST 03: لا يجوز بقاء نص عربي");
}

// ── TEST 05: البطاقة الواحدة: تعديل العمر/الجنس/الاسم بالأزرار ثم حفظ ───
{
  const sender = "111000000001";
  const press = (id) => makeMessage({ sender, body: id, type: "interactiveResponseMessage" });
  const say = (body) => makeMessage({ sender, body });
  const run = async (m) => {
    sent.length = 0;
    const handled = await registration.registrationAnswerHandler(m, sock);
    assert.equal(handled, true, `TEST 05: يجب معالجة «${m.body}»`);
    return sent.map((s) => s.text || "").join("\n");
  };

  // حفظ قبل اكتمال الحقول ⇒ لا حفظ، والبطاقة تذكر الناقص
  let texts = await run(press("terboo_reg_save"));
  assert.match(texts, /أكمل أولاً/, "TEST 05: الحفظ يرفض الحقول الناقصة");
  assert.notEqual(db.getUser(`${sender}@s.whatsapp.net`)?.isRegistered, true, "TEST 05: لا تسجيل بحقول ناقصة");

  texts = await run(press("terboo_reg_age"));
  assert.match(texts, /اكتب عمرك/, "TEST 05: طلب العمر");
  texts = await run(say("abc"));
  assert.match(texts, /عمر غير صالح/, "TEST 05: العمر غير الصالح يُرفض");
  texts = await run(say("21"));
  assert.match(texts, /إنشاء حسابك/, "TEST 05: البطاقة تُحدَّث بعد العمر");
  assert.ok(sent.some((s) => s.kind === "delete"), "TEST 05: البطاقة القديمة/طلب الإدخال يُستبدلان");

  texts = await run(press("terboo_reg_gender"));
  assert.match(texts, /اختر الجنس/, "TEST 05: اختيار الجنس بالأزرار");
  assert.deepEqual(lastRelayButtons(), ["terboo_reg_g_m", "terboo_reg_g_f"], "TEST 05: زرّا الجنس");
  await run(press("terboo_reg_g_m"));

  // كلمات التعديل المكتوبة القديمة ما زالت تعمل
  texts = await run(say("تعديل الاسم"));
  assert.match(texts, /اكتب الاسم/, "TEST 05: كلمة «تعديل الاسم» المكتوبة تعمل");
  await run(say("Mahmoud"));

  texts = await run(press("terboo_reg_save"));
  assert.match(texts, /اكتمل التسجيل/, "TEST 05: الحفظ ينجح بعد اكتمال الحقول");

  const user = db.getUser(`${sender}@s.whatsapp.net`);
  assert.equal(user.isRegistered, true, "TEST 05: يجب أن يصبح المستخدم مسجّلاً");
  assert.equal(user.regName, "Mahmoud", "TEST 05: يجب حفظ الاسم");
  assert.equal(user.regAge, 21, "TEST 05: يجب حفظ العمر");
  assert.equal(user.regGender, "ذكر", "TEST 05: القيمة المخزّنة للجنس يجب ألا تتغير");
  assert.equal(user.language, "ar", "TEST 05: يجب بقاء حقل اللغة");
  assert.ok(user.koin > 0, "TEST 05: يجب منح مكافأة التسجيل");
}

// ── TEST 05b: الإلغاء من البطاقة ─────────────────────────────────────
{
  const sender = "111000000002";
  sent.length = 0;
  const handled = await registration.registrationAnswerHandler(makeMessage({ sender, body: "terboo_reg_cancel", type: "interactiveResponseMessage" }), sock);
  assert.equal(handled, true, "TEST 05b: زر الإلغاء يُعالج");
  assert.match(sent.map((s) => s.text || "").join("\n"), /cancel|Registration cancelled|cancelled/i, "TEST 05b: رسالة الإلغاء بلغته");
  assert.equal(global.registrationSessions["111000000002"], undefined, "TEST 05b: الجلسة تُحذف");
}

// ── TEST 06: رسالة بعد التسجيل → وصول طبيعي بلا تدخل ──────────────────
{
  sent.length = 0;
  const m = makeMessage({ sender: "111000000001", body: ".menu", isCommand: true, command: "menu" });
  const handled = await onboarding.handleOnboarding(m, sock, db);
  assert.equal(handled, false, "TEST 06: لا يجوز اعتراض مستخدم مكتمل");
  assert.equal(sent.length, 0, "TEST 06: لا يجوز إرسال أي رسالة إضافية");
}

// ── TEST 07: مستخدم قديم مسجّل بلا لغة → بطاقة واحدة فقط بلا حجب ──────
{
  const sender = "111000000009";
  const jid = `${sender}@s.whatsapp.net`;
  db.setUser(jid, { isRegistered: true, regName: "Old", regAge: 30, regGender: "ذكر" });

  sent.length = 0;
  const first = makeMessage({ sender, body: ".menu", isCommand: true, command: "menu" });
  const handled = await onboarding.handleOnboarding(first, sock, db);
  assert.equal(handled, false, "TEST 07: لا يجوز حجب مستخدم مسجّل");
  assert.deepEqual(
    lastRelayButtons(),
    ["terboo_language_ar", "terboo_language_en"],
    "TEST 07: يجب عرض بطاقة اللغة مرة واحدة",
  );

  sent.length = 0;
  const second = makeMessage({ sender, body: ".menu", isCommand: true, command: "menu" });
  await onboarding.handleOnboarding(second, sock, db);
  assert.equal(sent.length, 0, "TEST 07: لا يجوز تكرار البطاقة في الرسالة التالية");
}

// ── TEST 08: مستخدم مسجّل وله لغة → لا Onboarding إطلاقاً ─────────────
{
  const sender = "111000000010";
  const jid = `${sender}@s.whatsapp.net`;
  db.setUser(jid, { isRegistered: true, language: "en" });
  sent.length = 0;
  const m = makeMessage({ sender, body: ".menu", isCommand: true, command: "menu" });
  const handled = await onboarding.handleOnboarding(m, sock, db);
  assert.equal(handled, false, "TEST 08: لا يجوز اعتراضه");
  assert.equal(sent.length, 0, "TEST 08: لا يجوز إرسال أي شيء");
}

// ── TEST 09 + 10: المالك والمميز يمرّان دون تغيير ─────────────────────
{
  sent.length = 0;
  const owner = makeMessage({ sender: "201225655220", body: ".menu", isCommand: true, command: "menu", isOwner: true });
  assert.equal(await onboarding.handleOnboarding(owner, sock, db), false, "TEST 09: المالك لا يُعترض");

  const premium = makeMessage({ sender: "111000000011", body: ".menu", isCommand: true, command: "menu", isPremium: true });
  assert.equal(await onboarding.handleOnboarding(premium, sock, db), false, "TEST 10: المميز لا يُعترض");
  assert.equal(sent.length, 0, "TEST 09/10: لا رسائل إضافية للمستثنين");
}

// ── TEST 11: المجموعات — لا تصادم بين جلسات مستخدمين مختلفين ──────────
{
  const groupChat = "99999-88888@g.us";
  const userA = "111000000021";
  const userB = "111000000022";

  db.setUser(`${userA}@s.whatsapp.net`, { language: "ar" });
  db.setUser(`${userB}@s.whatsapp.net`, { language: "en" });

  await registration.startRegistration(
    makeMessage({ sender: userA, isGroup: true, chat: groupChat }),
    sock,
  );
  await registration.startRegistration(
    makeMessage({ sender: userB, isGroup: true, chat: groupChat }),
    sock,
  );

  sent.length = 0;
  await registration.registrationAnswerHandler(makeMessage({ sender: userA, body: "terboo_reg_name", type: "interactiveResponseMessage", isGroup: true, chat: groupChat }), sock);
  const answerA = makeMessage({ sender: userA, body: "AliceName", isGroup: true, chat: groupChat });
  await registration.registrationAnswerHandler(answerA, sock);

  assert.equal(
    global.registrationSessions[userA].name,
    "AliceName",
    "TEST 11: يجب أن تُحفظ الإجابة في جلسة صاحبها",
  );
  assert.equal(
    global.registrationSessions[userB].name,
    "Tester",
    "TEST 11: يجب ألا تتأثر جلسة مستخدم آخر في نفس المجموعة",
  );

  // رسالة غير أمر داخل مجموعة من مستخدم جديد لا تُنتج سبام بطاقة لغة
  sent.length = 0;
  const chatter = makeMessage({ sender: "111000000023", body: "السلام عليكم", isGroup: true, chat: groupChat });
  const handled = await onboarding.handleOnboarding(chatter, sock, db);
  assert.equal(handled, false, "TEST 11: الدردشة العادية في المجموعة لا تُعترض");
  assert.equal(sent.length, 0, "TEST 11: لا سبام داخل المجموعات");

  registration.clearRegistrationSession(`${userA}@s.whatsapp.net`);
  registration.clearRegistrationSession(`${userB}@s.whatsapp.net`);
}

// ── TEST 12 + أمان: معرّف الزر كنص عادي لا يُنفَّذ ────────────────────
{
  sent.length = 0;
  const fake = makeMessage({
    sender: "111000000031",
    body: "terboo_language_en",
    type: "conversation", // نص عادي وليس ضغطة زر
  });
  const handled = await onboarding.handleOnboarding(fake, sock, db);
  assert.equal(handled, false, "SECURITY: النص العادي لا يُعامل كضغطة زر");
  assert.equal(
    db.getUser(fake.sender)?.language ?? null,
    null,
    "SECURITY: لا يجوز حفظ اللغة من نص عادي",
  );
}

// ── V6: التسجيل اختياري — الإعداد القديم المخزّن (من ترقية v5) يُطفأ مرة واحدة ولا يُعاد ──
db.setting("terbooRegistrationOptionalV6", false);
db.setting("registrationRequired", true);
onboarding.ensureRegistrationSetting(db);
assert.equal(db.setting("registrationRequired"), false, "REGISTRATION: الإعداد الإجباري القديم يُطفأ");
assert.equal(onboarding.isRegistrationRequired(db), false, "REGISTRATION: لا تسجيل إجباري أبداً");
db.setting("registrationRequired", true); // حتى لو فعّله أحد يدوياً في قاعدة البيانات
assert.equal(onboarding.isRegistrationRequired(db), false, "REGISTRATION: لا بوابة مهما كانت القيمة المخزّنة");

console.log("✅ terboo-onboarding: كل الاختبارات نجحت");

try {
  fs.rmSync(tmpDb, { recursive: true, force: true });
} catch {}
process.exit(0);
