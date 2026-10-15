// ═══════════════════════════════════════════════
// 🧪 Terboo Protobuf Compatibility (§4 §105)
// ───────────────────────────────────────────────
// على WAProto الخاص بـ @whiskeysockets/baileys@7.0.0-rc14 المثبّت فعلاً:
//   1. لا .fromObject( في كود الإنتاج خارج المحوّلين الموثّقين (البنّاء + سجل القدرات).
//   2. كل نوع proto يذكره المشروع موجود في الـruntime ويملك encode/decode.
//   3. create → encode → decode لكل رسالة حساسة (Interactive/Body/Footer/Header/NativeFlow
//      /Carousel/Buttons/List/ExtendedText/WebMessageInfo) مع بقاء الحقول.
//   4. خطر مسار create (الذي يستعمله rc14 في generateWAMessageFromContent): أسماء enum
//      النصية تُرمَّز 0 بصمت — والبنّاء لا يُنتج أي enum نصي.
//   5. generateWAMessageFromContent → WebMessageInfo ترميز/فك → relay عبر طبقة التوافق
//      مع عقدة biz.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as baileys from "@whiskeysockets/baileys";
import { button, carousel, header, legacyToNativeFlow, nativeFlow, protoMessage } from "../src/lib/terboo-interactive-builder.js";
import { innerOf, validateMessage } from "../src/lib/terboo-wa-capabilities.js";
import { installWhatsAppCompat } from "../src/lib/terboo-wa-compat.js";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const { proto, generateWAMessageFromContent } = baileys;
const ROOT = process.cwd();
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

function codeFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "session", "tmp", "temp", "tests", "tools", "docs"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) codeFiles(full, out);
    else if (/\.(m?js)$/.test(entry.name)) out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}
const FILES = codeFiles(ROOT);
const ADAPTERS = new Set(["src/lib/terboo-interactive-builder.js", "src/lib/terboo-wa-capabilities.js"]);

// ── 1. صفر .fromObject( في الإنتاج خارج المحوّلين ──
await check("no-production-fromObject", () => {
  const offenders = [];
  for (const file of FILES) {
    if (ADAPTERS.has(file)) continue;
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const [i, line] of src.split("\n").entries()) if (/\.fromObject\s*\(/.test(line)) offenders.push(`${file}:${i + 1}`);
  }
  assert.deepEqual(offenders, [], `استدعاء fromObject مباشر في الإنتاج:\n${offenders.join("\n")}`);
  // البلوقنات لا تبني أنواع proto يدوياً أصلاً (لا create ولا fromObject)
  const pluginCreates = FILES.filter((f) => f.startsWith("plugins/")).filter((f) => /proto\.[\w.]+\.(?:create|fromObject)\s*\(/.test(fs.readFileSync(path.join(ROOT, f), "utf8")));
  assert.deepEqual(pluginCreates, [], `بلوقنات تبني proto يدوياً: ${pluginCreates}`);
});

// ── 2. كل نوع proto مذكور في المشروع موجود في الـruntime ──
await check("referenced-types-exist", () => {
  const referenced = new Set();
  for (const file of FILES) {
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const match of src.matchAll(/\bproto\.((?:[A-Z]\w*\.)*[A-Z]\w*)/g)) referenced.add(match[1]);
  }
  const missing = [];
  for (const name of referenced) {
    let node = proto;
    for (const part of name.split(".")) node = node?.[part];
    // أصناف الرسائل تملك encode/decode؛ الـenum كائن قيم، وعضو الـenum رقم
    const ok = (typeof node === "function" && typeof node.encode === "function" && typeof node.decode === "function") || (node && typeof node === "object") || Number.isInteger(node);
    if (!ok) missing.push(name);
  }
  assert.ok(referenced.size >= 1, "لم يُعثر على أي مرجع proto (المسح معطوب؟)");
  assert.deepEqual(missing, [], `أنواع proto غير موجودة في rc14: ${missing}`);
});

// ── 3. create → encode → decode لكل رسالة حساسة ──
const roundTrip = (Type, value) => Type.decode(Type.encode(Type.create(value)).finish());

await check("sensitive-round-trips", () => {
  const IM = proto.Message.InteractiveMessage;
  assert.equal(roundTrip(IM.Body, { text: "مرحبا ✦" }).text, "مرحبا ✦");
  assert.equal(roundTrip(IM.Footer, { text: "Terboo" }).text, "Terboo");
  const h = roundTrip(IM.Header, { title: "T", subtitle: "S", hasMediaAttachment: false });
  assert.equal(h.title, "T"); assert.equal(h.hasMediaAttachment, false);
  const nf = roundTrip(IM.NativeFlowMessage, { buttons: [button.quickReply(".menu", "Menu"), button.select("Open", [{ title: "A", rows: [{ id: ".ping", title: "Ping" }] }])], messageParamsJson: "{}" });
  assert.equal(nf.buttons.length, 2);
  assert.equal(JSON.parse(nf.buttons[1].buttonParamsJson).sections[0].rows[0].id, ".ping");
  const card = { header: header.none("c"), body: { text: "b" }, footer: { text: "f" }, nativeFlowMessage: { buttons: [button.url("Open", "https://example.com")] } };
  const cm = roundTrip(IM.CarouselMessage, { cards: [card, card], messageVersion: 1 });
  assert.equal(cm.cards.length, 2);
  const im = roundTrip(IM, { body: { text: "x" }, nativeFlowMessage: { buttons: [button.copy("Copy", "ABC")] } });
  assert.equal(JSON.parse(im.nativeFlowMessage.buttons[0].buttonParamsJson).copy_code, "ABC");
  const bm = roundTrip(proto.Message.ButtonsMessage, { contentText: "c", headerType: 1, buttons: [{ buttonId: ".a", buttonText: { displayText: "A" }, type: 1 }] });
  assert.equal(bm.buttons[0].buttonId, ".a");
  const lm = roundTrip(proto.Message.ListMessage, { title: "t", buttonText: "b", listType: 1, sections: [{ title: "s", rows: [{ rowId: ".x", title: "X" }] }] });
  assert.equal(lm.sections[0].rows[0].rowId, ".x");
  const et = roundTrip(proto.Message.ExtendedTextMessage, { text: "```js\nconst a = 1;\n```", contextInfo: { mentionedJid: ["150000000000001@lid"] } });
  assert.equal(et.text, "```js\nconst a = 1;\n```", "نص الكود تغيّر في الترميز");
  assert.deepEqual(et.contextInfo.mentionedJid, ["150000000000001@lid"]);
  // الاستجابات: nativeFlowResponse بمعرّف متداخل
  const resp = roundTrip(proto.Message.InteractiveResponseMessage, { body: { text: "Ping" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id: ".ping" }), version: 3 } });
  assert.equal(JSON.parse(resp.nativeFlowResponseMessage.paramsJson).id, ".ping");
});

// ── 4. خطر create مع enum نصي + البنّاء رقمي دائماً ──
await check("enum-hazard-documented", () => {
  const viaCreate = roundTrip(proto.Message.ButtonsMessage, { contentText: "x", headerType: "IMAGE" });
  const viaConvert = proto.Message.ButtonsMessage.decode(proto.Message.ButtonsMessage.encode(protoMessage("Message.ButtonsMessage", { contentText: "x", headerType: "IMAGE" })).finish());
  assert.equal(viaCreate.headerType || 0, 0, "create لم يعد يُسقط enum النصي (تغيّر سلوك rc14؟ حدّث الوثيقة)");
  assert.equal(viaConvert.headerType, 4, "المحوّل لا يحوّل اسم enum");
  // كل حمولات البنّاء: لا قيم enum نصية (headerType/listType/type) في أي عمق
  const samples = [
    nativeFlow({ text: "t", buttons: [button.quickReply(".a", "A")] }),
    carousel({ text: "c", cards: [{ title: "x", body: "y", buttons: [button.url("u", "https://e.x")] }] }),
    legacyToNativeFlow({ buttonsMessage: { contentText: "c", headerType: 1, buttons: [{ buttonId: ".a", buttonText: { displayText: "A" }, type: 1 }] } }),
    legacyToNativeFlow({ listMessage: { title: "t", buttonText: "b", listType: 1, sections: [{ title: "s", rows: [{ rowId: ".x", title: "X" }] }] } }),
  ];
  const walk = (node, at = "") => {
    if (!node || typeof node !== "object" || Buffer.isBuffer(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (/^(headerType|listType|type|carouselCardType)$/.test(k)) assert.equal(typeof v, "number", `enum نصي ${at}.${k}`);
      walk(v, `${at}.${k}`);
    }
  };
  for (const sample of samples) { walk(sample); assert.ok(validateMessage(sample).ok, JSON.stringify(validateMessage(sample))); }
});

// ── 5. generateWAMessageFromContent → WebMessageInfo → relay + biz ──
await check("webmessageinfo-relay", async () => {
  const jid = "201033334444@s.whatsapp.net";
  const quoted = { key: { remoteJid: jid, fromMe: false, id: "Q1" }, message: { conversation: ".menu" } };
  const content = nativeFlow({ text: "القائمة", footer: "Terboo", buttons: [button.select("افتح", [{ title: "s", rows: [{ id: ".ping", title: "Ping" }] }])] });
  const msg = generateWAMessageFromContent(jid, content, { userJid: "201000000001@s.whatsapp.net", quoted });
  const info = proto.WebMessageInfo.decode(proto.WebMessageInfo.encode(proto.WebMessageInfo.create(msg)).finish());
  assert.equal(info.key.remoteJid, jid);
  const im = innerOf(info.message).interactiveMessage;
  assert.equal(im.body.text, "القائمة");
  assert.equal(im.contextInfo.stanzaId, "Q1", "الاقتباس ضاع في الترميز");
  const relayed = [];
  const sock = {
    user: { id: "201000000001:3@s.whatsapp.net" },
    relayMessage: async (to, message, options) => { relayed.push({ to, message, options }); return options.messageId; },
    sendMessage: async () => ({}),
  };
  installWhatsAppCompat(sock);
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id });
  const biz = relayed[0].options.additionalNodes?.find((n) => n.tag === "biz");
  assert.ok(biz, "لا عقدة biz للرسالة التفاعلية");
  assert.equal(biz.content.find((n) => n.tag === "interactive")?.attrs?.type, "native_flow");
});

// ── 6. البلوقنات المرحَّلة تُحمَّل وتستعمل مسار الإنتاج نفسه ──
await check("migrated-plugins-load", async () => {
  for (const file of ["plugins/search/اطار.js", "plugins/search/بنتر_فيد.js", "plugins/owner/نشر.js", "plugins/tools/صرف_العملات.js"]) {
    const mod = await import(`../${file}`);
    assert.ok(mod.handler || mod.default?.handler, `${file}: لا handler`);
    const src = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.ok(!/\bproto\./.test(src), `${file}: ما زال يستعمل proto مباشرة`);
  }
});

console.log(`✅ terboo-protobuf: ${results.length} فحص · ${results.join(" · ")} (Baileys ${JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/@whiskeysockets/baileys/package.json"), "utf8")).version})`);
process.exit(0);
