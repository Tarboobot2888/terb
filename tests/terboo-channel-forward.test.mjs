// ═══════════════════════════════════════════════
// 🧪 Terboo Channel Forward — كل رسائل البوت «معاد توجيهها» من القناة (config.saluran.forwardAll)
// ───────────────────────────────────────────────
//   1. نص/وسائط عبر sendMessage ⇒ سياق القناة مع بقاء الإشارات والاقتباس والإعلان الخارجي.
//   2. أزرار Native Flow/قوائم عبر relayMessage ⇒ السياق على interactiveMessage والأزرار كما هي حرفياً،
//      والرسالة صالحة في WAProto وتُرمَّز وتُفك.
//   3. لا يُمس: تفاعل · حذف · تعديل · تصويت · القنوات نفسها · الحالة · الرد الغني (كود) · الألبوم.
//   4. forwardAll:false يوقفه بالكامل.
//   5. عبر Transport كاملاً (المقبس الحقيقي بطبقاته): نص · صورة · أزرار · قائمة.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-channel-"));
process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid.json");
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const config = (await import("../config.js")).default;
const compat = await import("../src/lib/terboo-wa-compat.js");
const { installTransport } = await import("../src/lib/terboo-transport.js");
const { nativeFlow, button } = await import("../src/lib/terboo-interactive-builder.js");
const { validateMessage } = await import("../src/lib/terboo-wa-capabilities.js");
const { generateWAMessage, proto } = await import("@whiskeysockets/baileys");

const USER = "201033334444@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";
const CHANNEL = config.saluran.id;
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };
const isChannel = (ctx) => ctx?.isForwarded === true && ctx?.forwardedNewsletterMessageInfo?.newsletterJid === CHANNEL && ctx.forwardedNewsletterMessageInfo.newsletterName === config.saluran.name && ctx.forwardingScore > 0;

assert.equal(config.saluran.forwardAll, true, "الإعداد الافتراضي: مفعّل");

await check("content-text-media", () => {
  const original = { text: "مرحبا @201011112222", mentions: ["201011112222@s.whatsapp.net"], contextInfo: { externalAdReply: { title: "Terboo" } } };
  const out = compat.withChannelContent(USER, original);
  assert.ok(isChannel(out.contextInfo));
  assert.equal(out.contextInfo.externalAdReply.title, "Terboo", "الإعلان الخارجي باقٍ");
  assert.deepEqual(out.mentions, original.mentions);
  assert.equal(original.contextInfo.isForwarded, undefined, "الأصل لا يُعدَّل");
  for (const content of [{ image: Buffer.from("x"), caption: "صورة" }, { video: { url: "https://x/v.mp4" } }, { audio: Buffer.from("x"), ptt: true }, { document: Buffer.from("x"), fileName: "a.pdf" }, { sticker: Buffer.from("x") }]) {
    assert.ok(isChannel(compat.withChannelContent(GROUP, content).contextInfo), Object.keys(content)[0]);
  }
  // سياق قناة موجود (من بلوقن) يبقى كما هو
  const own = { text: "x", contextInfo: { forwardedNewsletterMessageInfo: { newsletterJid: "1@newsletter", newsletterName: "Other" } } };
  assert.equal(compat.withChannelContent(USER, own), own);
});

await check("content-skips", () => {
  const key = { id: "K", remoteJid: USER, fromMe: true };
  for (const content of [{ react: { text: "👍", key } }, { delete: key }, { text: "x", edit: key }, { poll: { name: "?", values: ["a", "b"] } }, { pin: key }]) {
    assert.equal(compat.withChannelContent(USER, content), content, Object.keys(content).join(","));
  }
  assert.equal(compat.withChannelContent("120363418715609508@newsletter", { text: "x" }).contextInfo, undefined, "القناة نفسها");
  assert.equal(compat.withChannelContent("status@broadcast", { text: "x" }).contextInfo, undefined, "الحالة");
});

await check("native-flow-buttons-intact", () => {
  const message = nativeFlow({ text: "اختر اللغة", footer: "Terboo", buttons: [button.quickReply(".lang ar", "العربية"), button.quickReply(".lang en", "English"), button.url("القناة", config.saluran.link)] });
  const before = JSON.stringify(message.viewOnceMessage.message.interactiveMessage.nativeFlowMessage);
  compat.withChannelMessage(USER, message);
  const im = message.viewOnceMessage.message.interactiveMessage;
  assert.ok(isChannel(im.contextInfo));
  assert.equal(JSON.stringify(im.nativeFlowMessage), before, "الأزرار لم تتغير");
  assert.equal(validateMessage(message).ok, true, `WAProto: ${validateMessage(message).error}`);
  const decoded = proto.Message.decode(proto.Message.encode(proto.Message.fromObject(message)).finish());
  const back = decoded.viewOnceMessage.message.interactiveMessage;
  assert.equal(back.contextInfo.forwardedNewsletterMessageInfo.newsletterJid, CHANNEL);
  assert.equal(back.nativeFlowMessage.buttons.length, 3);
  // اقتباس موجود يبقى، ولا تكرار عند المرور مرتين
  const quoted = nativeFlow({ text: "x", buttons: [button.quickReply("a", "A")], contextInfo: { stanzaId: "Q1", participant: USER, quotedMessage: { conversation: "اللغة" } } });
  compat.withChannelMessage(USER, quoted);
  compat.withChannelMessage(USER, quoted);
  const ctx = quoted.viewOnceMessage.message.interactiveMessage.contextInfo;
  assert.equal(ctx.stanzaId, "Q1");
  assert.ok(isChannel(ctx));
});

await check("relay-skips", () => {
  const rich = { messageContextInfo: {}, richResponseMessage: { messageType: 1, submessages: [] } };
  compat.withChannelMessage(USER, rich);
  assert.equal(rich.richResponseMessage.contextInfo, undefined, "الرد الغني (الكود) كما هو");
  const album = { messageContextInfo: {}, albumMessage: { expectedImageCount: 2 } };
  compat.withChannelMessage(USER, album);
  assert.equal(album.albumMessage.contextInfo, undefined);
  const child = { messageContextInfo: { messageAssociation: { associationType: 1 } }, imageMessage: { caption: "x" } };
  compat.withChannelMessage(USER, child);
  assert.equal(child.imageMessage.contextInfo, undefined, "عنصر ألبوم");
  const reaction = { reactionMessage: { text: "👍" } };
  compat.withChannelMessage(USER, reaction);
  assert.equal(reaction.reactionMessage.contextInfo, undefined);
  const text = { conversation: "نص قديم" };
  compat.withChannelMessage(USER, text);
  assert.ok(isChannel(text.extendedTextMessage.contextInfo), "conversation ⇒ extendedTextMessage بسياق القناة");
  assert.equal(text.extendedTextMessage.text, "نص قديم");
});

await check("baileys-merge-with-quote-and-mentions", async () => {
  const quoted = { key: { remoteJid: USER, fromMe: false, id: "QQ1" }, message: { conversation: "🌐 اللغة" } };
  const content = compat.withChannelContent(USER, { text: "اختر @201011112222", mentions: ["201011112222@s.whatsapp.net"] });
  const msg = await generateWAMessage(USER, content, { userJid: "201000000001@s.whatsapp.net", quoted });
  const ctx = proto.Message.decode(proto.Message.encode(msg.message).finish()).extendedTextMessage.contextInfo;
  assert.ok(isChannel(ctx));
  assert.equal(ctx.stanzaId, "QQ1", "الاقتباس باقٍ");
  assert.deepEqual(ctx.mentionedJid, ["201011112222@s.whatsapp.net"], "الإشارات باقية");
});

await check("toggle-off", () => {
  config.saluran.forwardAll = false;
  try {
    assert.equal(compat.withChannelContent(USER, { text: "x" }).contextInfo, undefined);
    const message = nativeFlow({ text: "x", buttons: [button.quickReply("a", "A")] });
    compat.withChannelMessage(USER, message);
    assert.equal(message.viewOnceMessage.message.interactiveMessage.contextInfo, undefined);
  } finally {
    config.saluran.forwardAll = true;
  }
});

await check("through-transport", async () => {
  const sock = {
    user: { id: "201000000001:3@s.whatsapp.net", name: "Terboo" }, relayed: [], sent: [],
    async relayMessage(jid, message, options = {}) { sock.relayed.push({ jid, message, options }); return options.messageId; },
    async sendMessage(jid, content, options = {}) { sock.sent.push({ jid, content, options }); return { key: { id: `S${sock.sent.length}`, remoteJid: jid, fromMe: true } }; },
    ev: { on() {}, off() {} },
  };
  installTransport(sock, { getDatabase: () => getDatabase() });
  await sock.sendMessage(USER, { text: "رد الذكاء الاصطناعي" });
  await sock.sendMessage(GROUP, { image: Buffer.from("x"), caption: "قائمة" });
  assert.ok(sock.sent.every((s) => isChannel(s.content.contextInfo)), "نص وصورة");
  const buttons = await sock.terboo.send(USER, { text: "القائمة", buttons: [{ id: ".menu", text: "القائمة" }, { id: ".ping", text: "بنج" }] });
  const select = await sock.terboo.send(USER, { text: "اختر", select: { title: "الأقسام", sections: [{ title: "عام", rows: [{ id: ".menu", title: "القائمة" }] }] } });
  assert.equal(buttons.stage, "relay");
  assert.equal(select.stage, "relay");
  for (const { message, options } of sock.relayed) {
    const im = message.viewOnceMessage?.message?.interactiveMessage || message.interactiveMessage;
    assert.ok(isChannel(im.contextInfo), "أزرار/قائمة");
    assert.ok(im.nativeFlowMessage.buttons.length >= 1, "الأزرار موجودة");
    assert.ok((options.additionalNodes || []).some((node) => node.tag === "biz"), "عقدة biz للأزرار باقية");
  }
  await sock.sendMessage(USER, { react: { text: "👍", key: { id: "K", remoteJid: USER, fromMe: false } } });
  assert.equal(sock.sent.at(-1).content.contextInfo, undefined, "التفاعل كما هو");
});

await check("rich-code-from-channel", async () => {
  // الكود: richResponseMessage + codeBlocks مع سياق القناة
  const db = getDatabase();
  const relayed = [];
  const sent = [];
  const sock = {
    user: { id: "201000000001:3@s.whatsapp.net", name: "Terboo" }, ev: { on() {}, off() {} },
    async relayMessage(jid, message, options = {}) { relayed.push(message); return options.messageId; },
    async sendMessage(jid, content, options = {}) { sent.push(content); return { key: { id: `S${sent.length}`, remoteJid: jid, fromMe: true } }; },
  };
  installTransport(sock, { getDatabase: () => db });
  const fenced = { text: "تفضل:\n```js\nconsole.log(1);\n```\nجرّبه." };
  await sock.sendMessage(USER, fenced);
  const rich = relayed.find((message) => message.richResponseMessage)?.richResponseMessage;
  assert.ok(rich, "لم تُرسل الرسالة الغنية");
  const code = rich.submessages.find((sub) => sub.messageType === 5);
  assert.equal(code?.codeMetadata?.codeLanguage, "javascript");
  assert.equal(code?.codeMetadata?.codeBlocks?.map((block) => block.codeContent).join(""), "console.log(1);\n");
  assert.ok(isChannel(rich.contextInfo), "سياق القناة مفقود");
  assert.equal(sent.some((content) => content.image || content.document), false, "ما زالت بطاقة/نسخة منفصلة");
  assert.ok(!JSON.stringify(relayed).match(/forwardedAiBotMessageInfo|botForwardedMessage|867051314767696/), "علامة Meta AI");

  const { handler } = await import("../plugins/owner/بطاقة_الكود.js");
  const replies = [];
  const m = { chat: USER, sender: USER, prefix: ".", key: { id: "RC1", remoteJid: USER, fromMe: false }, message: { conversation: ".بطاقة_الكود" }, async reply(text) { replies.push(String(text)); } };
  const before = sent.length;
  await handler({ ...m, text: "تجربة" }, { sock });
  assert.ok(relayed.some((message) => message.richResponseMessage), "التجربة لم ترسل Rich Code");
  await handler({ ...m, text: "نص" }, { sock });
  assert.equal(db.setting("richCode"), "text");
  const textBefore = sent.length;
  await sock.sendMessage(USER, fenced);
  assert.ok(!sent.slice(textBefore).some((content) => content.image), "وضع النص أرسل صورة");
  await handler({ ...m, text: "صورة" }, { sock });
  assert.equal(db.setting("richCode"), "image");
});

await check("rich-code-and-channel-image-one-message", async () => {
  const relayed = [];
  const sent = [];
  const sock = {
    user: { id: "201000000001:3@s.whatsapp.net", name: "Terboo" }, ev: { on() {}, off() {} },
    async relayMessage(jid, message, options = {}) { relayed.push(message); return options.messageId; },
    async sendMessage(jid, content, options = {}) { sent.push(content); return { key: { id: `S${sent.length}`, remoteJid: jid, fromMe: true } }; },
  };
  installTransport(sock, { getDatabase: () => getDatabase() });
  await sock.sendCode(USER, "const x = 1;\n", { language: "javascript", image: "https://example.com/code.png", text: "صورة + كود" });
  const rich = relayed.map((message) => message.richResponseMessage).find(Boolean);
  assert.ok(rich);
  assert.deepEqual(rich.submessages.map((sub) => sub.messageType), [3, 2, 5]);
  assert.equal(rich.submessages[0].imageMetadata.imageUrl.imagePreviewUrl, "https://example.com/code.png");
  assert.equal(rich.submessages[2].codeMetadata.codeLanguage, "javascript");
  assert.equal(rich.submessages[2].codeMetadata.codeBlocks.map((b) => b.codeContent).join(""), "const x = 1;\n");
  assert.ok(isChannel(rich.contextInfo));
  assert.equal(sent.length, 0, "الصورة خرجت كرسالة منفصلة");
  assert.ok(!/forwardedAiBotMessageInfo|botForwardedMessage|867051314767696/.test(JSON.stringify(relayed)));
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-channel-forward: ${results.join(" · ")}`);
process.exit(0);
