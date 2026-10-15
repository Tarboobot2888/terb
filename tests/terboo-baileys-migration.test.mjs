// ═══════════════════════════════════════════════
// 🧪 Terboo — الانتقال إلى Baileys الرسمي (v4 §2–§3)
// ───────────────────────────────────────────────
// يثبت بالاستدعاء الفعلي لمكتبة @whiskeysockets/baileys@7.0.0-rc14 المثبّتة:
//   1. الإصدار المثبّت والمعتمد هو الرسمي، ولا أثر للـfork السابق.
//   2. كل اسم يستورده المشروع من المكتبة موجود فعلاً في تصديرها (بلا افتراض).
//   3. مقبس رسمي حقيقي (makeWASocket) يقبل طبقات Terboo بالترتيب الصحيح.
//   4. كل شكل موسّع كان يوفّره الـfork يُترجم لرسالة WAProto صالحة (ترميز/فك حقيقي):
//      أزرار تفاعلية + عقدة biz · interactiveMessage · ألبوم مرتبط · حدث · طلب دفع ·
//      حزمة ملصقات (بديل موثّق) · معاينة رابط · كتلة كود/جدول غنية · معرّف قناة.
//   5. رفض جهاز المستلم للرسالة الغنية (ack ERROR من الرسمي) ⇒ بطاقة نصية تلقائياً.
//   6. نقاط إنشاء المقبس (الرئيسي والفرعي) تثبّت الطبقات بالترتيب نفسه.
// لا اتصال بواتساب: النقل (relay/send) يُسجَّل بدل إرساله، وكل ما قبله حقيقي.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pino from "pino";
import sharp from "sharp";
import * as baileys from "@whiskeysockets/baileys";
import { installWhatsAppCompat, interactiveTypeOf, tableRowsFromV2 } from "../src/lib/terboo-wa-compat.js";
import { installCodeRenderer } from "../src/lib/terboo-code-renderer.js";
import { _resetDelivery, deliveryLog } from "../src/lib/terboo-menu-delivery.js";

const ROOT = process.cwd();
const { makeWASocket, initAuthCreds, makeCacheableSignalKeyStore, proto } = baileys;
const results = [];
const check = async (name, fn) => {
  await fn();
  results.push(name);
};
const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/** ترميز ثم فك حقيقي بـWAProto: يثبت أن الرسالة صالحة لخادم واتساب الرسمي */
function roundTrip(message) {
  const bytes = proto.Message.encode(message).finish();
  assert.ok(bytes.length > 0, "ترميز فارغ");
  return proto.Message.decode(bytes);
}

// ── 1. الإصدار والاعتماد ─────────────────────────
await check("official-version", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@whiskeysockets/baileys/package.json"), "utf8"));
  assert.equal(pkg.name, "@whiskeysockets/baileys");
  assert.equal(pkg.version, "7.0.0-rc14");
  const project = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(project.dependencies["@whiskeysockets/baileys"], "7.0.0-rc14", "الإصدار مثبّت حرفياً (بلا ^)");
  assert.equal(project.dependencies.maro, undefined, "الـfork السابق ما زال معتمداً");
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  assert.equal(lock.packages["node_modules/@whiskeysockets/baileys"]?.version, "7.0.0-rc14");
  assert.ok(lock.packages["node_modules/@whiskeysockets/baileys"]?.integrity, "بلا بصمة integrity في القفل");
  assert.equal(lock.packages["node_modules/maro"], undefined, "الـfork السابق ما زال في القفل");
  assert.equal(fs.existsSync(path.join(ROOT, "node_modules/maro")), false, "الـfork السابق ما زال مثبّتاً");
});

// ── 2. كل اسم مستورد موجود في التصدير الرسمي ─────────
await check("imports-exist", () => {
  const SKIP = new Set(["node_modules", ".git", "session", "tmp", "temp", "backup", "database", "downloads"]);
  const used = new Map();
  const add = (name, file) => used.set(name, [...(used.get(name) || []), file]);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.m?js$/.test(entry.name)) {
        const rel = path.relative(ROOT, full);
        const src = fs.readFileSync(full, "utf8");
        for (const m of src.matchAll(/import\s*(?:\w+\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["']@whiskeysockets\/baileys["']/g)) {
          for (const name of (m[1] || "").split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean)) add(name, rel);
        }
        for (const m of src.matchAll(/(?:const|let|var)\s*\{([^}]*)\}\s*=\s*await\s+import\(\s*["']@whiskeysockets\/baileys["']\s*\)/g)) {
          for (const name of m[1].split(",").map((s) => s.trim().split(/\s*:\s*/)[0]).filter(Boolean)) add(name, rel);
        }
      }
    }
  };
  walk(ROOT);
  assert.ok(used.size >= 20, `عدد الأسماء المستوردة منخفض بشكل مريب: ${used.size}`);
  const missing = [...used].filter(([name]) => name !== "default" && !(name in baileys));
  assert.deepEqual(missing, [], `أسماء غير موجودة في Baileys الرسمي: ${JSON.stringify(missing)}`);
  assert.equal(typeof baileys.default, "function", "التصدير الافتراضي makeWASocket");
});

// ── 3. مقبس رسمي حقيقي + الطبقات ─────────────────────
const logger = pino({ level: "silent" });
const keyStore = {};
const keys = {
  get: async (type, ids) => Object.fromEntries(ids.map((id) => [id, keyStore[`${type}-${id}`]])),
  set: async (data) => {
    for (const type in data) for (const id in data[type]) keyStore[`${type}-${id}`] = data[type][id];
  },
};
// عنوان مغلق عمداً: المقبس يُبنى كاملاً ولا يصل لواتساب
const sock = makeWASocket({ waWebSocketUrl: "ws://127.0.0.1:9", logger, auth: { creds: initAuthCreds(), keys: makeCacheableSignalKeyStore(keys, logger) }, connectTimeoutMs: 2000 });
sock.ev.on("connection.update", () => {});
sock.user = { id: "201000000001:5@s.whatsapp.net", jid: "201000000001@s.whatsapp.net" };

// النقل مسجَّل بدل الإرسال — كل ما فوقه حقيقي
const relayed = [];
const sent = [];
const uploads = [];
const newsletterCalls = [];
sock.relayMessage = async (jid, message, options = {}) => {
  relayed.push({ jid, message, options });
  return options.messageId;
};
sock.sendMessage = async (jid, content, options = {}) => {
  const msg = await baileys.generateWAMessage(jid, content, { userJid: sock.user.jid, upload: sock.waUploadToServer, logger });
  sent.push({ jid, content, options, message: msg.message });
  return msg;
};
const uploadedBytes = [];
sock.waUploadToServer = async (filePath, { mediaType }) => {
  uploads.push(mediaType);
  uploadedBytes.push(fs.readFileSync(filePath));
  return { mediaUrl: `https://mmg.whatsapp.net/v/t62/${mediaType}-${uploads.length}`, directPath: `/v/t62/${mediaType}-${uploads.length}` };
};
sock.newsletterMetadata = async (type, key) => {
  newsletterCalls.push([type, key]);
  return { id: "120363000000000000@newsletter", type, key };
};

// مسار الرسالة الغنية (richCode = "rich") صراحة لفحص البروتوكول؛ الافتراضي في البوت بطاقة صورة
const richSetting = { value: "rich" };
const richSettings = { setting: (key) => (key === "richCode" ? richSetting.value : undefined) };

await check("layers-install", () => {
  installWhatsAppCompat(sock, { langOf: () => "ar" });
  installCodeRenderer(sock, { getDatabase: () => richSettings });
  assert.equal(sock.__terbooCompat, true);
  assert.equal(sock.__terbooCodeRenderer, true);
  for (const name of ["sendPreview", "sendCodeBlock", "sendCodeBlockV2", "sendTable", "sendTableV2", "sendList", "sendLinkV2", "sendLatex", "cekIDSaluran", "newsletterMsg", "sendCode"]) {
    assert.equal(typeof sock[name], "function", `الطريقة ${name} مفقودة`);
  }
  // تثبيت ثانٍ لا يغلّف مرتين
  const before = sock.sendMessage;
  installWhatsAppCompat(sock);
  installCodeRenderer(sock);
  assert.equal(sock.sendMessage, before);
  // واجهات رسمية يعتمد عليها المشروع
  assert.equal(typeof sock.signalRepository?.lidMapping?.getPNForLID, "function");
  assert.equal(typeof sock.groupMetadata, "function");
  assert.equal(typeof sock.newsletterFollow, "function");
});

const JID = "201234567890@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";
const last = () => relayed[relayed.length - 1];
const bizOf = (entry) => (entry.options.additionalNodes || []).find((node) => node.tag === "biz");

// ── 4. الأشكال الموسّعة ⇒ رسائل رسمية صالحة ─────────
await check("relay-biz-node", async () => {
  const interactive = { viewOnceMessage: { message: { interactiveMessage: { body: { text: "x" }, nativeFlowMessage: { buttons: [] } } } } };
  await sock.relayMessage(GROUP, interactive, { messageId: "A1" });
  const biz = bizOf(last());
  assert.ok(biz, "لا عقدة biz للرسالة التفاعلية");
  assert.equal(biz.content.find((node) => node.tag === "interactive")?.content?.[0]?.attrs?.name, "mixed");
  await sock.relayMessage(GROUP, { conversation: "نص" }, { messageId: "A2" });
  assert.equal(bizOf(last()), undefined, "عقدة biz أُضيفت لنص عادي");
  await sock.relayMessage("120363000000000000@newsletter", interactive, { messageId: "A3" });
  assert.equal(bizOf(last()), undefined, "عقدة biz أُضيفت لرسالة قناة");
  await sock.relayMessage(GROUP, interactive, { messageId: "A4", additionalNodes: [{ tag: "biz", attrs: {}, content: [] }] });
  assert.equal(last().options.additionalNodes.filter((node) => node.tag === "biz").length, 1, "عقدة biz مكررة");
  assert.equal(interactiveTypeOf({ listMessage: {} }), "list");
  assert.equal(interactiveTypeOf({ buttonsMessage: {} }), "buttons");
  assert.equal(interactiveTypeOf({ extendedTextMessage: { text: "x" } }), null);
});

await check("interactive-buttons", async () => {
  const result = await sock.sendMessage(GROUP, {
    text: "القائمة",
    footer: "تيربو",
    title: "العنوان",
    interactiveButtons: [
      { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "الأوامر", id: ".menu" }) },
      { name: "cta_url", buttonParamsJson: { display_text: "الموقع", url: "https://example.com" } },
    ],
  });
  assert.ok(result?.key?.id, "لا مفتاح للرسالة المرسلة");
  const entry = last();
  const decoded = roundTrip(entry.message);
  const im = decoded.viewOnceMessage.message.interactiveMessage;
  assert.equal(im.body.text, "القائمة");
  assert.equal(im.footer.text, "تيربو");
  assert.equal(im.nativeFlowMessage.buttons.length, 2);
  assert.equal(JSON.parse(im.nativeFlowMessage.buttons[1].buttonParamsJson).url, "https://example.com");
  assert.equal(decoded.viewOnceMessage.message.messageContextInfo.messageSecret.length, 32);
  assert.ok(bizOf(entry), "الأزرار بلا عقدة biz");
});

await check("interactive-message-forms", async () => {
  await sock.sendMessage(GROUP, { interactiveMessage: { title: "مختصر", footer: "ت", buttons: [{ name: "quick_reply", buttonParamsJson: "{}" }] } });
  assert.equal(roundTrip(last().message).viewOnceMessage.message.interactiveMessage.body.text, "مختصر");
  await sock.sendMessage(GROUP, { interactiveMessage: { body: { text: "بروتو" }, nativeFlowMessage: { buttons: [], messageParamsJson: "{}" } } });
  assert.equal(roundTrip(last().message).viewOnceMessage.message.interactiveMessage.body.text, "بروتو");
  await sock.sendMessage(GROUP, { interactiveMessage: { body: { text: "كاروسيل" }, carouselMessage: { cards: [{ body: { text: "بطاقة 1" } }, { body: { text: "بطاقة 2" } }] } } });
  const carousel = roundTrip(last().message).viewOnceMessage.message.interactiveMessage.carouselMessage;
  assert.equal(carousel.cards.length, 2);
  assert.ok(bizOf(last()), "الكاروسيل بلا عقدة biz");
});

const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 20, g: 90, b: 160 } } }).png().toBuffer();

await check("album", async () => {
  const start = relayed.length;
  const header = await sock.sendMessage(GROUP, { albumMessage: [{ image: png, caption: "1" }, { image: png, caption: "2" }] });
  const batch = relayed.slice(start);
  assert.equal(batch.length, 3, "ألبوم = رأس + وسيطان");
  const album = roundTrip(batch[0].message).albumMessage;
  assert.equal(album.expectedImageCount, 2);
  for (const child of batch.slice(1)) {
    const decoded = roundTrip(child.message);
    assert.equal(decoded.messageContextInfo.messageAssociation.associationType, proto.MessageAssociation.AssociationType.MEDIA_ALBUM);
    assert.equal(decoded.messageContextInfo.messageAssociation.parentMessageKey.id, header.key.id);
    assert.ok(decoded.imageMessage.directPath.startsWith("/v/t62/image"), "الوسيط لم يُرفع");
  }
  assert.ok(uploads.filter((type) => type === "image").length >= 2);
});

await check("event", async () => {
  await sock.sendMessage(GROUP, { eventMessage: { name: "مسابقة", description: "الجمعة", startTime: "1790000000" } });
  const decoded = roundTrip(last().message);
  assert.equal(decoded.eventMessage.name, "مسابقة");
  assert.equal(Number(decoded.eventMessage.startTime), 1790000000);
  assert.deepEqual(last().options.additionalNodes, [{ tag: "meta", attrs: { event_type: "creation" } }]);
});

await check("payment", async () => {
  await sock.sendMessage(JID, { requestPaymentMessage: { amount: 50000, note: "رسوم" } });
  const payment = roundTrip(last().message).requestPaymentMessage;
  assert.equal(payment.currencyCodeIso4217, "EGP");
  assert.equal(Number(payment.amount1000), 50000);
  assert.equal(payment.noteMessage.extendedTextMessage.text, "رسوم");
});

await check("product", async () => {
  await sock.sendMessage(JID, { productMessage: { title: "منتج", productId: "p1", retailerId: "r1", url: "https://example.com", thumbnail: png } });
  const product = roundTrip(last().message).viewOnceMessage.message.interactiveMessage.header.productMessage.product;
  assert.equal(product.title, "منتج");
  assert.ok(product.productImage.directPath);
});

await check("sticker-pack-fallback", async () => {
  const webp = await sharp(png).webp().toBuffer();
  const start = sent.length;
  await sock.sendMessage(JID, { stickerPack: { name: "حزمة", stickers: [{ data: webp }, { data: webp }] } });
  const batch = sent.slice(start);
  assert.equal(batch.length, 2, "الملصقات لم تُرسل فردياً");
  assert.ok(batch.every((entry) => entry.message.stickerMessage), "ليست رسائل ملصق رسمية");
});

await check("passthrough", async () => {
  const start = sent.length;
  await sock.sendMessage(JID, { text: "نص عادي بلا كود" });
  await sock.sendMessage(JID, { poll: { name: "تصويت", values: ["أ", "ب"], selectableCount: 1 } });
  await sock.sendMessage(JID, { event: { name: "حدث رسمي", startDate: new Date(1790000000000) } });
  const batch = sent.slice(start);
  assert.equal(batch.length, 3, "المحتوى الرسمي لم يمر كما هو");
  assert.equal(batch[0].message.extendedTextMessage?.text || batch[0].message.conversation, "نص عادي بلا كود");
  assert.ok(batch[1].message.pollCreationMessage || batch[1].message.pollCreationMessageV3);
  assert.equal(batch[2].message.eventMessage.name, "حدث رسمي");
});

await check("send-preview", async () => {
  const id = await sock.sendPreview(JID, { text: "اقرأ https://example.com", url: "https://example.com", title: "مثال", description: "وصف", image: png });
  assert.equal(typeof id, "string");
  const ext = roundTrip(last().message).extendedTextMessage;
  assert.equal(ext.matchedText, "https://example.com");
  assert.equal(ext.title, "مثال");
  assert.ok(ext.thumbnailDirectPath, "الصورة المصغّرة لم تُرفع");
  // كما في link-preview.js الرسمي: مفاتيح "Link Thumbnail" للتشفير ومسار رفع الصور.
  // فك التشفير الفعلي بتلك المفاتيح يعيد الصورة الأصلية حرفياً.
  const { iv, cipherKey } = await baileys.getMediaKeys(ext.mediaKey, "thumbnail-link");
  const encrypted = uploadedBytes[uploadedBytes.length - 1];
  const decipher = crypto.createDecipheriv("aes-256-cbc", cipherKey, iv);
  const plain = Buffer.concat([decipher.update(encrypted.subarray(0, -10)), decipher.final()]);
  assert.ok(plain.equals(png), "الصورة المصغّرة لم تُشفَّر بمفاتيح thumbnail-link");
});

// ── 5. الرسائل الغنية + بديل الرفض ─────────────────────
const CODE = "def total(items):\n    # مجموع\n    return sum(i * 2 for i in items)\n\nprint(total([1, 2, 3]))\n";

await check("code-block-modes", async () => {
  // الوضع الافتراضي (richCode غير مضبوط) = rich: يُرسل كرسالة غنية native code.
  richSetting.value = undefined;
  try {
    const relayedBefore = relayed.length;
    await sock.sendCodeBlock(JID, CODE, null, { language: "python", title: "مثال" });
    assert.ok(relayed.slice(relayedBefore).some((item) => item.message.richResponseMessage), "الوضع الافتراضي rich يرسل رسالة غنية");
    // الوضع النصي: بديل نصي حرفي بلا رسالة غنية ولا صورة
    richSetting.value = "text";
    const relayedText = relayed.length;
    const sentBefore = sent.length;
    await sock.sendCodeBlock(JID, CODE, null, { language: "python" });
    assert.equal(relayed.slice(relayedText).filter((item) => item.message.richResponseMessage).length, 0, "وضع النص لا يرسل رسالة غنية");
    const out = sent.slice(sentBefore);
    assert.ok(!out.some((item) => item.message.imageMessage), "وضع النص لا يرسل صورة");
    const text = out.map((item) => item.message.extendedTextMessage?.text || item.message.conversation || "").join("\n");
    assert.ok(text.includes(CODE.trimEnd()), "نسخة النص لا تحوي الكود حرفياً");
  } finally {
    richSetting.value = "rich";
  }
});

await check("code-block-rich", async () => {
  await sock.sendCodeBlock(JID, CODE, null, { language: "python", title: "مثال" });
  const decoded = roundTrip(last().message);
  const rich = decoded.richResponseMessage;
  assert.equal(rich.messageType, 1);
  const code = rich.submessages.find((sub) => sub.messageType === 5);
  assert.equal(code.codeMetadata.codeLanguage, "python");
  assert.equal(code.codeMetadata.codeBlocks.map((block) => block.codeContent).join(""), CODE, "الكود تغيّر (يجب أن يبقى حرفياً)");
  assert.ok(code.codeMetadata.codeBlocks.some((block) => block.highlightType === 1), "بلا تلوين كلمات مفتاحية");
  const serialized = JSON.stringify(decoded);
  assert.ok(!/@bot|867051314767696|forwardedAiBotMessageInfo|botForwardedMessage|botJid/.test(serialized), "انتحال هوية Meta AI");
});

await check("table-rich", async () => {
  await sock.sendTable(JID, "الأسعار", ["العنصر", "السعر"], [["أ", "10"], ["ب", "20"]], null);
  const table = roundTrip(last().message).richResponseMessage.submessages.find((sub) => sub.messageType === 4);
  assert.equal(table.tableMetadata.title, "الأسعار");
  assert.equal(table.tableMetadata.rows.length, 3);
  assert.equal(table.tableMetadata.rows[0].isHeading, true);
  const parsed = tableRowsFromV2(["عنوان", "أ|ب", "1|2;;3|4"]);
  assert.equal(parsed.rows.length, 3);
  await sock.sendTableV2(JID, ["عنوان", "أ|ب", "1|2;;3|4"], null);
  assert.equal(roundTrip(last().message).richResponseMessage.submessages.find((sub) => sub.messageType === 4).tableMetadata.rows.length, 3);
});

await check("text-with-fence-routes-to-rich", async () => {
  const start = relayed.length;
  await sock.sendMessage(JID, { text: "هذا الحل:\n```js\nconst x = 1;\nconsole.log(x);\n```\nجرّبه." });
  const entry = relayed.slice(start).find((item) => item.message.richResponseMessage);
  assert.ok(entry, "نص فيه كتلة كود لم يمر بالمسار الغني");
  const subs = roundTrip(entry.message).richResponseMessage.submessages;
  assert.deepEqual(subs.map((sub) => sub.messageType), [2, 5, 2]);
  assert.equal(subs[1].codeMetadata.codeLanguage, "javascript");
});

await check("ack-error-fallback", async () => {
  // المقبس التجريبي يُغلق فوراً (عنوان مغلق) والرسمي يدمّر ev عند الإغلاق (socket.js end ⇒ ev.destroy).
  // المقبس الحي يحتفظ بـev؛ هنا نعطيه مُصدِر أحداث رسمياً جديداً من المكتبة نفسها (makeEventBuffer).
  sock.ev = baileys.makeEventBuffer(logger);
  _resetDelivery();
  const start = sent.length;
  await sock.sendCodeBlock(JID, CODE, null, { language: "python" });
  const id = last().options.messageId;
  // Baileys الرسمي يصدر messages.update بالحالة ERROR (0) عند رفض الخادم/الجهاز
  sock.ev.emit("messages.update", [{ key: { remoteJid: JID, id, fromMe: true }, update: { status: proto.WebMessageInfo.Status.ERROR, messageStubParameters: ["479"] } }]);
  await tick(50);
  const fallback = sent.slice(start);
  assert.equal(fallback.length, 1, "لم تُرسل بطاقة بديلة بعد الرفض");
  const text = fallback[0].message.extendedTextMessage?.text || fallback[0].message.conversation;
  assert.ok(text.includes(CODE.trimEnd()), "البطاقة البديلة لا تحوي الكود حرفياً");
  assert.ok(text.includes("```"), "البطاقة البديلة ليست أحادية المسافة");
  const log = deliveryLog();
  assert.ok(log.some((row) => row.stage === "native-rich-code" && row.outcome === "rejected" && /479/.test(row.error)), "الرفض لم يُسجَّل");
  assert.ok(log.some((row) => row.stage === "code-text" && row.fallbackFrom === "ack:479"), "البديل لم يُسجَّل");
});

await check("newsletter", async () => {
  await sock.cekIDSaluran("https://whatsapp.com/channel/0029VaAbCdEfGh");
  await sock.newsletterMsg("120363000000000000@newsletter");
  assert.deepEqual(newsletterCalls, [["invite", "0029VaAbCdEfGh"], ["jid", "120363000000000000@newsletter"]]);
});

// ── 6. نقاط إنشاء المقبس تثبّت الطبقات بالترتيب ─────────
await check("wiring-order", async () => {
  const order = (file, names) => {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    const positions = names.map((name) => [name, src.indexOf(`${name}(`, src.indexOf("makeWASocket({"))]);
    for (const [name, at] of positions) assert.ok(at > 0, `${file}: ${name} غير مستدعى بعد makeWASocket`);
    for (let i = 1; i < positions.length; i += 1) {
      assert.ok(positions[i - 1][1] < positions[i][1], `${file}: ${positions[i - 1][0]} يجب أن يسبق ${positions[i][0]}`);
    }
    assert.ok(!/makeWASocket\(\{[\s\S]{0,400}printQRInTerminal\s*:/.test(src), `${file}: خيار printQRInTerminal المهمل ما زال ممرراً`);
  };
  // v5 §8: المقبسان يمرّان بـ Transport Core واحد، وهو وحده يملك ترتيب الطبقات
  order("src/connection.js", ["installTransport"]);
  order("src/lib/terboo-jadibot-manager.js", ["installTransport"]);
  const transportSrc = fs.readFileSync(path.join(ROOT, "src/lib/terboo-transport.js"), "utf8");
  const body = transportSrc.slice(transportSrc.indexOf("function installTransport("));
  const at = (name) => body.indexOf(name === "extendSocket" ? "extend(sock)" : `${name}(sock`);
  const { LAYER_ORDER } = await import("../src/lib/terboo-transport.js");
  for (let i = 1; i < LAYER_ORDER.length; i += 1) {
    assert.ok(at(LAYER_ORDER[i - 1]) > 0 && at(LAYER_ORDER[i - 1]) < at(LAYER_ORDER[i]), `Transport: ${LAYER_ORDER[i - 1]} يجب أن يسبق ${LAYER_ORDER[i]}`);
  }
});

await check("transport-installs-all-layers", async () => {
  const { EventEmitter } = await import("node:events");
  const { installTransport } = await import("../src/lib/terboo-transport.js");
  let extended = false;
  const fake = { user: { id: "201000000001:2@s.whatsapp.net" }, ev: new EventEmitter(), relayMessage: async () => "id", sendMessage: async () => ({ key: { id: "x" } }) };
  installTransport(fake, { extend: () => { extended = true; } });
  for (const flag of ["__terbooCompat", "__terbooCodeRenderer", "__terbooMenuDelivery", "__terbooIdentity", "__terbooTransport"]) assert.ok(fake[flag], `طبقة غير مثبّتة: ${flag}`);
  assert.ok(extended, "امتدادات المقبس لم تُستدعَ");
  assert.equal(typeof fake.terboo?.send, "function", "sock.terboo.send غير متاح");
});

sock.end(undefined);
console.log(`✅ terboo-baileys-migration: ${results.length} فحص (Baileys ${JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@whiskeysockets/baileys/package.json"), "utf8")).version} الرسمي)`);
process.exit(0);
