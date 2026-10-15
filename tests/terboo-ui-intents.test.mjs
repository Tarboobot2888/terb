// ═══════════════════════════════════════════════
// 🧪 Terboo V6 §28 — نوايا الواجهة (sendCard · sendCarousel) عبر طبقة التسليم الموحّدة
// ───────────────────────────────────────────────
//   1. قائمة اختيار + أزرار ⇒ Native Flow واحدة، والبديل النصي يحمل كل صف وكل زر
//   2. رأس فيديو/مستند/صورة بلا تخزين مؤقت متصادم
//   3. to ⇒ التسليم لدردشة المستلم بلا اقتباس رسالة من دردشة أخرى · منشن محفوظ
//   4. Carousel: بطاقة يفشل وسيطها تُسقط وحدها؛ لا بطاقات ⇒ Native Flow بأول بطاقة ثم نص
//   5. بلوقن مُرحّل حقيقي (ping2) عبر messageHandler: بطاقة واحدة بزرين حقيقيين فقط
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111117";
const USER = "201555555557@s.whatsapp.net";
const OTHER = "201555555558@s.whatsapp.net";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-ui-intents-"));
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { sendCard, sendCarousel } = await import("../src/lib/terboo-ui-kit.js");

const relays = [];
const texts = [];
let uploads = 0;
let failUploadFor = null;
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net` },
  async relayMessage(jid, message) { relays.push({ jid, message }); return "R"; },
  async sendMessage(jid, content, opts) { texts.push({ jid, content, opts }); return { key: { id: `S${texts.length}` } }; },
  async sendPresenceUpdate() { },
  async readMessages() { },
  waUploadToServer: async (_stream, { mediaType } = {}) => {
    uploads += 1;
    if (failUploadFor && failUploadFor === mediaType) throw new Error("upload refused");
    return { mediaUrl: `https://mmg.example/${uploads}`, directPath: `/${uploads}` };
  },
};
const m = { chat: USER, sender: USER, isGroup: false, key: { remoteJid: USER, id: "IN1", fromMe: false }, message: { conversation: "hi" } };
const node = (r) => r?.message?.viewOnceMessage?.message?.interactiveMessage || r?.message?.interactiveMessage;
const params = (r) => (node(r)?.nativeFlowMessage?.buttons || []).map((b) => ({ name: b.name, ...JSON.parse(b.buttonParamsJson) }));
const reset = () => { relays.length = 0; texts.length = 0; };

// 1
reset();
await sendCard(sock, m, {
  cardId: "t-select",
  text: "اختر",
  buttons: [{ id: ".a", text: "A" }],
  select: { title: "القائمة", sections: [{ title: "S", rows: [{ id: ".row1", title: "R1" }, { id: ".row2", title: "R2" }] }] },
});
assert.equal(relays.length, 1, "رسالة واحدة");
const kinds = params(relays[0]).map((b) => b.name);
assert.ok(kinds.includes("single_select") && kinds.includes("quick_reply"), "قائمة + زر");
const { textFallback } = await import("../src/lib/terboo-menu-send.js");
assert.equal(typeof textFallback, "function");
// البديل النصي: نُجبر الطبقة النصية برفض البنّاء (نص فقط عند فشل كل الطبقات التفاعلية)
const realRelay = sock.relayMessage;
sock.relayMessage = async () => { throw new Error("device rejects interactive"); };
reset();
await sendCard(sock, m, { cardId: "t-fallback", text: "اختر", buttons: [{ id: ".a", text: "A" }], select: { title: "Q", sections: [{ title: "S", rows: [{ id: ".row1", title: "R1" }] }] }, links: [{ text: "موقع", url: "https://terboo.example.com" }] });
const fallbackText = texts.at(-1)?.content?.text || "";
assert.match(fallbackText, /\.row1/, "صف القائمة في البديل النصي");
assert.match(fallbackText, /\.a/, "الزر في البديل النصي");
assert.match(fallbackText, /https:\/\/terboo\.example\.com/, "الرابط في البديل النصي");
sock.relayMessage = realRelay;

// 2
reset();
await sendCard(sock, m, { cardId: "t-video", text: "v", media: { type: "video", buffer: Buffer.from("vid"), gifPlayback: true }, buttons: [{ id: ".again", text: "↻" }] });
assert.ok(node(relays[0])?.header?.videoMessage, "رأس فيديو");
reset();
await sendCard(sock, m, { cardId: "t-doc", text: "d", media: { type: "document", buffer: Buffer.from("x"), mimetype: "application/javascript", fileName: "a.js" }, copies: [{ text: "نسخ", code: "x" }] });
assert.equal(node(relays[0])?.header?.documentMessage?.fileName, "a.js", "رأس مستند");
const before = uploads;
await sendCard(sock, m, { cardId: "t-img", text: "1", media: { type: "image", buffer: Buffer.from("img1") }, buttons: [{ id: ".x", text: "x" }] });
await sendCard(sock, m, { cardId: "t-img", text: "2", media: { type: "image", buffer: Buffer.from("img2") }, buttons: [{ id: ".x", text: "x" }] });
assert.equal(uploads - before, 2, "كل نتيجة ترفع صورتها (لا تخزين مؤقت متصادم)");

// 3
reset();
await sendCard(sock, m, { cardId: "t-to", to: OTHER, text: "بياناتك", mentions: [OTHER], copies: [{ text: "نسخ", code: "secret-like" }] });
assert.equal(relays[0].jid, OTHER, "التسليم لدردشة المستلم");
assert.deepEqual(node(relays[0])?.contextInfo?.mentionedJid, [OTHER], "المنشن محفوظ");
assert.equal(relays[0].message?.viewOnceMessage?.message?.interactiveMessage?.contextInfo?.quotedMessage, undefined, "لا اقتباس من دردشة أخرى");

// 4
reset();
failUploadFor = "video";
await sendCarousel(sock, m, {
  cardId: "t-carousel",
  text: "نتائج",
  cards: [
    { media: { type: "image", buffer: Buffer.from("a") }, title: "A", body: "a", links: [{ text: "فتح", url: "https://a.example" }] },
    { media: { type: "video", buffer: Buffer.from("b") }, title: "B", body: "b" },
    { media: { type: "image", buffer: Buffer.from("c") }, title: "C", body: "c", buttons: [{ id: ".c", text: "C" }] },
  ],
});
failUploadFor = null;
const cards = node(relays[0])?.carouselMessage?.cards || [];
assert.equal(cards.length, 2, "البطاقة التي فشل وسيطها تُسقط وحدها");
assert.deepEqual(cards.map((c) => c.header?.title), ["A", "C"]);

// 5
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
getPlugin("ping2").config.cooldown = 0;
db.setUser(USER, { language: "ar" });
const { messageHandler } = await import("../src/handler.js");
reset();
await messageHandler({ key: { remoteJid: USER, fromMe: false, id: "P2X1" }, message: { conversation: ".ping2" }, pushName: "Tester", messageTimestamp: Math.floor(Date.now() / 1000) }, sock);
await new Promise((r) => setTimeout(r, 30));
assert.equal(relays.length, 1, "ping2: بطاقة واحدة");
const ids = params(relays[0]).map((b) => b.id);
assert.deepEqual(ids, [".ping2", ".menu"], "زرّان حقيقيان فقط");
assert.doesNotMatch(JSON.stringify(relays[0].message), /google\.com|628123456789|inapp_signup/, "لا أزرار وهمية");

console.log("✅ terboo-ui-intents: قائمة+أزرار+بديل نصي · رؤوس فيديو/مستند/صورة · to+منشن · carousel · ping2 مُرحّل");
process.exit(0);
