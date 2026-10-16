// اختبار تسليم القوائم (§28–§31 §58 §59 · v5 §7 §11) — المشكلة المُبلَّغ عنها تحديداً:
// «القائمة الرئيسية والأقسام تظهر من جهة البوت ولا تصل لدردشة المستخدم، بينما الإعدادات والمزيد تعمل».
// نقارن حرفياً: الهدف (JID)، مفتاح الرسالة، مسار relay، نوع الحمولة، الاقتباس — للرئيسية
// والأقسام مقابل الإعدادات و«المزيد»، في دردشة LID وخاصة ومجموعة، ثم نثبت البديل عند رفض العرض.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-menu-delivery-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const config = (await import("../config.js")).default;
const delivery = await import("../src/lib/terboo-menu-delivery.js");

const BOT = "2348093093240";
const BOT_JID = `${BOT}@s.whatsapp.net`;
const USER_PN = "201555555555@s.whatsapp.net";
const USER_LID = "148823344556677@lid";

/** مقبس وهمي يلتقط كل ما يُرسل، ويحلّ LID كما يفعل Baileys، ويطلق messages.update */
function makeSock() {
  const ev = new EventEmitter();
  const sock = {
    user: { id: `${BOT}:7@s.whatsapp.net`, jid: BOT_JID },
    ev,
    relayed: [],
    sent: [],
    signalRepository: { lidMapping: { getPNForLID: async (jid) => (jid === USER_LID ? USER_PN : null) } },
    async relayMessage(jid, message, options = {}) { sock.relayed.push({ jid, message, options }); return options.messageId; },
    async sendMessage(jid, content, options = {}) { sock.sent.push({ jid, content, options }); return { key: { id: `TXT${sock.sent.length}`, remoteJid: jid } }; },
    waUploadToServer: async () => ({ mediaUrl: "https://mmg.example/x", directPath: "/x" }),
  };
  return sock;
}

let seq = 0;
function makeMessage({ chat = USER_LID, sender = USER_LID, isGroup = false, args = [] } = {}) {
  seq++;
  const key = { remoteJid: chat, fromMe: false, id: `USERMSG${seq}`, ...(isGroup ? { participant: sender } : {}) };
  const message = { conversation: ".menu" };
  return {
    chat, sender, isGroup, fromMe: false, key, message, raw: { key, message }, args, prefix: ".", command: "menu",
    isOwner: false, isPremium: false, pushName: "User", replies: [],
    async reply(text) { this.replies.push(text); return { key: { id: "R" } }; },
    async react() { },
  };
}

const unwrapInteractive = (message) => message?.viewOnceMessage?.message?.interactiveMessage || null;

async function runPlugin(name, m, sock) {
  const plugin = getPlugin(name);
  assert.ok(plugin, `البلوقن ${name} غير موجود`);
  await plugin.handler(m, { sock, db: getDatabase(), config, uptime: 1000, args: m.args, command: m.command, prefix: "." });
}

delivery._resetDelivery();
getDatabase().setting("audioMenu", false);

// ── 1. مقارنة حرفية: الرئيسية / الأقسام / قسم / الإعدادات / المزيد — في دردشة LID ──
const cases = [
  { label: "main", plugin: "menu", args: [] },
  { label: "categories", plugin: "فئة", args: [] },
  { label: "category", plugin: "فئة", args: ["tools"] },
  { label: "settings", plugin: "menu", args: ["settings"] },
  { label: "more", plugin: "menu", args: ["more"] },
];
const observed = {};
for (const variant of [1, 2, 3]) {
  getDatabase().setting("menuVariant", variant);
  for (const c of cases) {
    const sock = makeSock();
    const m = makeMessage({ args: c.args });
    await runPlugin(c.plugin, m, sock);
    assert.equal(sock.relayed.length, 1, `${c.label}/v${variant}: عدد رسائل القائمة ${sock.relayed.length}`);
    const { jid, message, options } = sock.relayed[0];
    // الهدف: رقم المستخدم المحلول — لا LID الخام ولا رقم البوت
    assert.equal(jid, USER_PN, `${c.label}/v${variant}: أُرسلت إلى ${jid} بدل دردشة المستخدم`);
    assert.notEqual(jid, BOT_JID);
    // «.menu more» ليست قائمة فرعية: تعرض القائمة الرئيسية نفسها
    const cardCase = variant === 1 && (c.label === "main" || c.label === "more");
    if (cardCase) {
      // السبب الجذري (v5 §11): الشكل 1 كان يبدأ بـ buttonsMessage قديم لا يُعرض على جهاز المستلم
      // ولا يُرسل خطأ ACK. الآن: Native Flow بصورة البوت كرأس + نفس الأزرار الثلاثة كـ quick_reply.
      assert.ok(!message.buttonsMessage, `${c.label}/v1: buttonsMessage قديم ما زال الطبقة الأولى`);
      const im = unwrapInteractive(message);
      assert.ok(im?.header?.imageMessage, `${c.label}/v1: بطاقة البوت (صورة الرأس) مفقودة`);
      const buttons = im.nativeFlowMessage.buttons;
      assert.equal(buttons[0].name, "single_select", "main/v1: زر الأقسام يفتح القائمة المنسدلة");
      assert.ok(JSON.parse(buttons[0].buttonParamsJson).sections.length > 0);
      const quick = buttons.filter((b) => b.name === "quick_reply").map((b) => JSON.parse(b.buttonParamsJson));
      assert.equal(quick.length, 3, "main/v1: الأزرار الثلاثة نفسها");
      assert.ok(quick.every((q) => q.id?.startsWith(".") && q.display_text), "main/v1: كل زر بمعرّف أمر ونص");
      assert.equal(im.contextInfo?.stanzaId, m.key.id, "main/v1: تقتبس رسالة المستخدم");
    } else {
      const im = unwrapInteractive(message);
      // الحمولة: Native Flow التفاعلي (الشكل المجرّب للإعدادات) — لا externalAdReply
      assert.ok(im, `${c.label}/v${variant}: الحمولة ليست interactiveMessage (${Object.keys(message)})`);
      assert.ok(!message.buttonsMessage, `${c.label}/v${variant}: buttonsMessage كطبقة أولى`);
      assert.ok(!im.contextInfo?.externalAdReply, `${c.label}/v${variant}: externalAdReply داخل القائمة التفاعلية`);
      assert.ok(im.nativeFlowMessage.buttons.length > 0);
    }
    // مفتاح الرسالة ومسار relay متطابقان ومسجّلان
    assert.ok(options.messageId, `${c.label}: بلا messageId`);
    const row = delivery.deliveryLog().at(-1);
    assert.equal(row.messageId, options.messageId);
    assert.equal(row.target, USER_PN);
    assert.equal(row.outcome, "sent");
    observed[`${c.label}/v${variant}`] = { jid, payload: row.payloadType, stage: row.stage };
  }
}
// الرئيسية والأقسام تسلك الآن نفس مسار الإعدادات و«المزيد» تماماً (الهدف والنوع)
for (const variant of [1, 2, 3]) {
  const ref = observed[`settings/v${variant}`];
  for (const label of ["main", "categories", "category", "more"]) {
    const got = observed[`${label}/v${variant}`];
    assert.equal(got.jid, ref.jid, `${label}/v${variant}: هدف مختلف عن الإعدادات`);
    assert.match(got.payload, /^interactiveMessage/, `${label}/v${variant}: نوع حمولة مختلف عن الإعدادات (يجب Native Flow)`);
  }
}

// ── 1ب. الأزرار العائمة القديمة باقية كخيار صريح للمالك (opt-in) لا كطبقة افتراضية ──
{
  getDatabase().setting("menuVariant", 1);
  getDatabase().setting("legacyButtons", true);
  const sock = makeSock();
  const m = makeMessage();
  await runPlugin("menu", m, sock);
  const bm = sock.relayed[0].message.buttonsMessage;
  assert.ok(bm, "legacyButtons=true: الأزرار العائمة لم تعد متاحة كخيار");
  assert.equal(bm.headerType, 6, "بطاقة الموقع فوق الأزرار");
  assert.ok(bm.locationMessage?.jpegThumbnail?.length, "صورة البطاقة المصغّرة");
  assert.deepEqual(bm.buttons.slice(1).map((b) => b.type), [1, 1, 1]);
  getDatabase().setting("legacyButtons", false);
}

// ── 2. الاقتباس هو رسالة المستخدم الحقيقية ──
{
  getDatabase().setting("menuVariant", 3);
  const sock = makeSock();
  const m = makeMessage();
  await runPlugin("menu", m, sock);
  const im = unwrapInteractive(sock.relayed[0].message);
  assert.equal(im.contextInfo?.stanzaId, m.key.id, "القائمة لا تقتبس رسالة المستخدم");
}

// ── 3. مجموعة: الهدف المجموعة نفسها ──
{
  const sock = makeSock();
  const m = makeMessage({ chat: "120363000000000001@g.us", sender: USER_PN, isGroup: true });
  await runPlugin("menu", m, sock);
  assert.equal(sock.relayed[0].jid, "120363000000000001@g.us");
}

// ── 4. حارس «البوت يرسل لنفسه»: هدف = رقم البوت في دردشة خاصة ⇒ خاص المرسل ──
{
  const sock = makeSock();
  const m = makeMessage({ chat: BOT_JID, sender: USER_PN });
  assert.equal(await delivery.resolveTarget(m, sock), USER_PN);
  const self = makeMessage({ chat: BOT_JID, sender: BOT_JID });
  self.fromMe = true;
  assert.equal(await delivery.resolveTarget(self, sock), BOT_JID, "دردشة البوت مع نفسه تبقى كما هي");
}

// ── 5. رفض العرض من الجهاز/الخادم ⇒ الطبقة التالية تلقائياً حتى النص (§31 §59) ──
//    (آلية ACK نفسها تُختبر بمسار opt-in الكامل؛ الافتراضي لا يبدأ بحمولة قديمة أصلاً)
{
  getDatabase().setting("menuVariant", 1);
  getDatabase().setting("legacyButtons", true);
  const sock = makeSock();
  const m = makeMessage();
  await runPlugin("menu", m, sock);
  const firstId = sock.relayed[0].options.messageId;
  assert.equal(delivery.deliveryLog().at(-1).stage, "floating");
  assert.ok(sock.relayed[0].message.buttonsMessage, "الطبقة الأولى الأزرار العائمة");
  const reject = (id) => sock.ev.emit("messages.update", [{ key: { id, remoteJid: USER_PN, fromMe: true }, update: { status: 0, messageStubParameters: ["479"] } }]);
  const settle = () => new Promise((r) => setTimeout(r, 30));

  reject(firstId); await settle();
  assert.equal(sock.relayed.length, 2, "لا طبقة بديلة بعد رفض الأزرار العائمة");
  assert.equal(delivery.deliveryLog().at(-1).stage, "native-image");
  assert.ok(unwrapInteractive(sock.relayed[1].message).header?.imageMessage, "الطبقة الثانية Native Flow بصورة البوت");

  reject(sock.relayed[1].options.messageId); await settle();
  assert.equal(delivery.deliveryLog().at(-1).stage, "native");
  assert.ok(!unwrapInteractive(sock.relayed[2].message).header, "الطبقة الثالثة بلا رأس صورة");

  reject(sock.relayed[2].options.messageId); await settle();
  assert.equal(sock.sent.length, 1, "الطبقة الأخيرة نص");
  assert.equal(sock.sent[0].jid, USER_PN);
  assert.ok(sock.sent[0].options.quoted?.key?.id === m.key.id, "النص الاحتياطي يقتبس رسالة المستخدم");
  assert.ok(/menu|\.لغة|\.فئة/.test(sock.sent[0].content.text), "النص الاحتياطي بلا أوامر قابلة للكتابة");
  const rejected = delivery.deliveryLog().filter((r) => r.outcome === "rejected");
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((r) => r.error === "ack:479" && r.target === USER_PN && r.messageId && r.menuId === "main"), "الرفض لا يُسجَّل بتفاصيله");
  getDatabase().setting("legacyButtons", false);
}

// ── 5ب. الافتراضي: الطبقة الأولى من سياسة القدرات (primary) لكل شكل وقائمة ──
{
  const { allowsPrimary } = await import("../src/lib/terboo-wa-capabilities.js");
  for (const variant of [1, 2, 3]) {
    getDatabase().setting("menuVariant", variant);
    for (const c of cases) {
      const sock = makeSock();
      await runPlugin(c.plugin, makeMessage({ args: c.args }), sock);
      const first = delivery.deliveryLog().at(-1);
      assert.ok(allowsPrimary(first.payloadType), `${c.label}/v${variant}: الطبقة الأولى ${first.payloadType} ليست primary`);
    }
  }
}

// ── 5ج. حمولة لا تمر بالتحقق ⇒ فشل معروف ⇒ الطبقة التالية فوراً بلا انتظار ACK ──
{
  getDatabase().setting("menuVariant", 3);
  const sock = makeSock();
  const m = makeMessage();
  await delivery.deliverMenu(sock, m, {
    menuId: "broken", text: "x", footer: "", title: "t",
    sections: [{ title: "s", rows: [{ id: ".menu", title: "ok" }] }],
    quickReplies: [{ name: "quick_reply", buttonParamsJson: "{not-json" }],
    fallbackText: ".menu",
  });
  const log = delivery.deliveryLog().slice(-2);
  assert.equal(log[0].outcome, "error");
  assert.match(log[0].error, /invalid_payload:bad-buttonParamsJson/);
  assert.equal(sock.relayed.length, 0, "حمولة معطوبة أُرسلت");
  assert.equal(sock.sent.length, 1, "البديل النصي لم يُرسل فوراً");
}

// ── 6. قبول الخادم ⇒ لا تكرار؛ بلا رد ⇒ لا تكرار أيضاً ──
{
  getDatabase().setting("menuVariant", 3);
  const sock = makeSock();
  await runPlugin("menu", makeMessage(), sock);
  sock.ev.emit("messages.update", [{ key: { id: sock.relayed[0].options.messageId }, update: { status: 2 } }]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sock.relayed.length + sock.sent.length, 1, "أُرسلت القائمة مرتين رغم القبول");
  assert.equal(delivery.deliveryLog().at(-1).outcome, "acknowledged");
}

// ── 7. فشل relay فوري (استثناء) ⇒ الطبقة التالية فوراً ومسجّلة (لا catch صامت) ──
{
  const sock = makeSock();
  let first = true;
  const originalRelay = sock.relayMessage;
  sock.relayMessage = async (...a) => { if (first) { first = false; throw new Error("relay boom"); } return originalRelay(...a); };
  await runPlugin("menu", makeMessage(), sock);
  const errors = delivery.deliveryLog().filter((r) => r.outcome === "error" && r.error === "relay boom");
  assert.equal(errors.length, 1);
  // الطبقة التالية الحتمية بعد Native Flow (والأزرار القديمة opt-in) هي النص
  assert.equal(sock.relayed.length + sock.sent.length, 1, "الطبقة التالية لم تُرسل بعد فشل relay");
  assert.equal(delivery.deliveryLog().at(-1).stage, "text");
}

// ── 8. المحوّل على حدود المقبس: بلوقن يرسل قائمة تفاعلية بنفسه ──
{
  const sock = makeSock();
  delivery.installMenuDelivery(sock);
  const { generateWAMessageFromContent } = await import("@whiskeysockets/baileys");
  const content = { viewOnceMessage: { message: { interactiveMessage: {
    body: { text: "نتائج البحث" }, footer: { text: "Terboo" },
    nativeFlowMessage: { buttons: [{ name: "single_select", buttonParamsJson: JSON.stringify({ title: "اختر", sections: [{ title: "النتائج", rows: [{ title: "فيديو 1", id: ".يوت_فيديو https://youtu.be/a" }] }] }) }] },
  } } } };
  const msg = generateWAMessageFromContent(USER_LID, content, { userJid: BOT_JID });
  await sock.relayMessage(USER_LID, msg.message, { messageId: msg.key.id });
  assert.equal(sock.relayed.at(-1).jid, USER_PN, "المحوّل لم يحلّ LID لرسائل البلوقنات");
  sock.ev.emit("messages.update", [{ key: { id: msg.key.id }, update: { status: 0, messageStubParameters: ["479"] } }]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sock.sent.at(-1).jid, USER_PN);
  assert.match(sock.sent.at(-1).content.text, /فيديو 1 — \.يوت_فيديو https:\/\/youtu\.be\/a/, "البديل النصي لا يحمل الصفوف كأوامر");
  // الرسائل غير التفاعلية تمر كما هي
  await sock.relayMessage(USER_LID, { conversation: "hi" }, { messageId: "PLAIN1" });
  assert.equal(sock.relayed.at(-1).jid, USER_LID, "المحوّل عدّل رسالة غير تفاعلية");

  // بلوقن يرسل buttonsMessage قديماً ⇒ Native Flow بنفس معرّفات الأزرار (حتمي)
  const legacy = generateWAMessageFromContent(USER_LID, { buttonsMessage: {
    contentText: "اختر", footerText: "Terboo", headerType: 1,
    buttons: [{ buttonId: ".ping", buttonText: { displayText: "Ping" }, type: 1 }, { buttonId: ".menu", buttonText: { displayText: "Menu" }, type: 1 }],
  } }, { userJid: BOT_JID });
  await sock.relayMessage(USER_LID, legacy.message, { messageId: legacy.key.id });
  const converted = unwrapInteractive(sock.relayed.at(-1).message);
  assert.ok(converted, "buttonsMessage القديم لم يتحوّل إلى Native Flow");
  assert.deepEqual(converted.nativeFlowMessage.buttons.map((b) => JSON.parse(b.buttonParamsJson).id), [".ping", ".menu"], "تغيّرت معرّفات الأزرار");
  assert.equal(converted.body.text, "اختر");
  assert.match(delivery.deliveryLog().at(-1).payloadType, /^interactiveMessage<buttonsMessage$/);

  // listMessage قديم ⇒ single_select بنفس rowId
  const list = generateWAMessageFromContent(USER_LID, { listMessage: {
    title: "القائمة", description: "اختر", buttonText: "افتح", listType: 1,
    sections: [{ title: "قسم", rows: [{ rowId: ".فئة tools", title: "الأدوات" }] }],
  } }, { userJid: BOT_JID });
  await sock.relayMessage(USER_LID, list.message, { messageId: list.key.id });
  const select = JSON.parse(unwrapInteractive(sock.relayed.at(-1).message).nativeFlowMessage.buttons[0].buttonParamsJson);
  assert.equal(select.sections[0].rows[0].id, ".فئة tools", "rowId القديم لم يبقَ معرّفاً");

  // حمولة معطوبة من بلوقن ⇒ بديل نصي فوري بنفس المحتوى (لا relay لحمولة لن تُعرض)
  const before = sock.relayed.length;
  await sock.relayMessage(USER_LID, { viewOnceMessage: { message: { interactiveMessage: {
    body: { text: "معطوبة" }, nativeFlowMessage: { buttons: [{ name: "quick_reply", buttonParamsJson: "{bad" }] },
  } } } }, { messageId: "BROKEN1" });
  assert.equal(sock.relayed.length, before, "relay لحمولة معطوبة");
  assert.match(sock.sent.at(-1).content.text, /معطوبة/);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log("✅ terboo-menu-delivery: الرئيسية (الشكل 1: Native Flow ببطاقة البوت ونفس الأزرار) والأقسام تسلك مسار الإعدادات والمزيد نفسه (LID محلول، اقتباس صحيح، طبقة أولى primary)، الأزرار العائمة القديمة opt-in، التحقق قبل النقل، تحويل حمولات البلوقنات القديمة بنفس المعرّفات، والرفض يُسقط للطبقة التالية حتى النص");
process.exit(0);
