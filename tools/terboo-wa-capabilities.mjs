#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🧭 Terboo WA Capability Discovery (§10) → docs/terboo-wa-capabilities.json
// ───────────────────────────────────────────────
// لكل قدرة: Detected (نوع WAProto + حقوله من WAProto.proto المشحون)
//   + Tested (بناء عبر البنّاء المركزي ⇒ تحقق create/encode/decode ⇒ ضغطة محاكاة ⇒ المحلّل)
//   + Verified (نتيجة الفحص هنا). العرض على الأجهزة: unverified-in-sandbox بصدق.
//
//   node tools/terboo-wa-capabilities.mjs [--out docs/terboo-wa-capabilities.json] [--check]
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const strict = args.includes("--check");

const caps = await import("../src/lib/terboo-wa-capabilities.js");
const builder = await import("../src/lib/terboo-interactive-builder.js");
const { extractSelection, normalizeSelection } = await import("../src/lib/terboo-interactive.js");
const { buildRichContent } = await import("../src/lib/terboo-rich-response.js");
const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "node_modules/@whiskeysockets/baileys/package.json"), "utf8"));

const { button, header, nativeFlow, carousel, legacyToNativeFlow } = builder;
const ID = ".ping";

/** حمولة عيّنة حقيقية لكل قدرة قابلة للإرسال */
const SAMPLES = {
  "text": { extendedTextMessage: { text: "Terboo ✦" } },
  "native_flow.single_select": nativeFlow({ text: "Menu", buttons: [button.select("Open", [{ title: "Main", rows: [{ id: ID, title: "Ping" }] }])] }),
  "native_flow.quick_reply": nativeFlow({ text: "Menu", buttons: [button.quickReply(ID, "Ping")] }),
  "native_flow.cta_url": nativeFlow({ text: "Link", buttons: [button.url("Open", "https://example.com")] }),
  "native_flow.cta_copy": nativeFlow({ text: "Code", buttons: [button.copy("Copy", "TERBOO-123")] }),
  "native_flow.cta_call": nativeFlow({ text: "Call", buttons: [button.call("Call", "+201000000000")] }),
  "interactive.header_image": nativeFlow({ text: "Card", header: header.image({ url: "https://mmg.whatsapp.net/x", mimetype: "image/jpeg", directPath: "/x", mediaKey: Buffer.alloc(32), fileLength: 1 }), buttons: [button.quickReply(ID, "Ping")] }),
  "carousel": carousel({ text: "Cards", cards: [{ title: "A", body: "a", buttons: [button.url("Open", "https://example.com/a")] }, { title: "B", body: "b", buttons: [button.quickReply(ID, "Ping")] }] }),
  "legacy.buttonsMessage": { buttonsMessage: { contentText: "Menu", headerType: 1, buttons: [{ buttonId: ID, buttonText: { displayText: "Ping" }, type: 1 }] } },
  "legacy.listMessage": { listMessage: { title: "Menu", buttonText: "Open", listType: 1, sections: [{ title: "Main", rows: [{ rowId: ID, title: "Ping" }] }] } },
  "legacy.templateMessage": { templateMessage: { hydratedTemplate: { hydratedContentText: "Menu", hydratedButtons: [{ index: 0, quickReplyButton: { displayText: "Ping", id: ID } }] } } },
  "rich_response": buildRichContent([{ type: "text", text: "Example" }, { type: "code", language: "javascript", code: "const a = 1;\nconsole.log(a);" }]),
  "album": { albumMessage: { expectedImageCount: 2 } },
  "poll": { pollCreationMessage: { name: "Q?", options: [{ optionName: "A" }, { optionName: "B" }], selectableOptionsCount: 1 } },
  "event": { eventMessage: { name: "Meet", startTime: 1800000000, isCanceled: false } },
  // وسائط بشكلها بعد الرفع (prepareWAMessageMedia): مرجع CDN + مفتاح + مسار — بلا رفع فعلي
  "media.image": { imageMessage: { url: "https://mmg.whatsapp.net/i", mimetype: "image/jpeg", directPath: "/i", mediaKey: Buffer.alloc(32, 1), fileLength: 1024, caption: "img" } },
  "media.video": { videoMessage: { url: "https://mmg.whatsapp.net/v", mimetype: "video/mp4", directPath: "/v", mediaKey: Buffer.alloc(32, 2), fileLength: 2048, seconds: 3 } },
  "media.audio": { audioMessage: { url: "https://mmg.whatsapp.net/a", mimetype: "audio/ogg; codecs=opus", directPath: "/a", mediaKey: Buffer.alloc(32, 3), fileLength: 512, seconds: 2, ptt: true } },
  "media.document": { documentMessage: { url: "https://mmg.whatsapp.net/d", mimetype: "application/pdf", directPath: "/d", mediaKey: Buffer.alloc(32, 4), fileLength: 4096, fileName: "report.pdf" } },
  "media.sticker": { stickerMessage: { url: "https://mmg.whatsapp.net/s", mimetype: "image/webp", directPath: "/s", mediaKey: Buffer.alloc(32, 5), fileLength: 256 } },
  "media.location": { locationMessage: { degreesLatitude: 30, degreesLongitude: 31, name: "Cairo" } },
  "media.contact": { contactMessage: { displayName: "Terboo", vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:Terboo\nEND:VCARD" } },
  "media.reaction": { reactionMessage: { key: { remoteJid: "201000000000@s.whatsapp.net", id: "X", fromMe: false }, text: "✅" } },
};

/** ضغطة محاكاة بكل صيغة رد ⇒ المعرّف الذي يصل للمحلّل */
const PRESSES = {
  "response.buttons": ["buttonsResponseMessage", { buttonsResponseMessage: { selectedButtonId: ID, selectedDisplayText: "Ping" } }],
  "response.list": ["listResponseMessage", { listResponseMessage: { title: "Ping", singleSelectReply: { selectedRowId: ID } } }],
  "response.template": ["templateButtonReplyMessage", { templateButtonReplyMessage: { selectedId: ID, selectedDisplayText: "Ping" } }],
  "response.native_flow": ["interactiveResponseMessage", { interactiveResponseMessage: { body: { text: "Ping" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id: ID }), version: 3 } } }],
  "response.native_flow.nested": ["interactiveResponseMessage", { interactiveResponseMessage: { nativeFlowResponseMessage: { name: "single_select", paramsJson: JSON.stringify({ response_json: JSON.stringify({ selectedRowId: ID }) }) } } }],
};

const discovered = caps.discover();
const report = [];
for (const capability of discovered.capabilities) {
  const sample = SAMPLES[capability.name];
  let tested = null;
  if (sample) {
    const check = caps.validateMessage(sample);
    tested = { builder: Boolean(SAMPLES[capability.name]), validate: check.ok, bytes: check.bytes || 0, error: check.error || null };
    // القديم ⇒ يتحوّل حتمياً إلى Native Flow بنفس المعرّف
    if (capability.name.startsWith("legacy.")) {
      const converted = legacyToNativeFlow(sample);
      const ids = (caps.innerOf(converted).interactiveMessage?.nativeFlowMessage?.buttons || []).map((b) => JSON.stringify(JSON.parse(b.buttonParamsJson)));
      tested.convertsToNativeFlow = Boolean(converted) && caps.validateMessage(converted).ok && ids.some((x) => x.includes(ID));
    }
  }
  let parser = null;
  for (const [name, [type, message]] of Object.entries(PRESSES)) {
    if (!name.startsWith(capability.name)) continue;
    const id = normalizeSelection(extractSelection(message, type));
    parser = { ...(parser || {}), [name]: id === ID };
  }
  // Verified = Detected + Tested + نجاح كل فحص — لا قدرة «موثّقة» بلا اختبار
  const verified = capability.detected
    && Boolean(tested || parser)
    && (tested ? tested.validate && (tested.convertsToNativeFlow ?? true) : true)
    && (parser ? Object.values(parser).every(Boolean) : true);
  report.push({
    name: capability.name,
    source: `WAProto ${capability.source}`,
    payload: capability.payload,
    requiredFields: capability.required,
    responseType: capability.response,
    parser: parser ? { ok: Object.values(parser).every(Boolean), cases: parser } : capability.response ? "src/lib/terboo-interactive.js (via response.* entries)" : null,
    privateSupport: capability.private,
    groupSupport: capability.group,
    webSupport: capability.web,
    mobileSupport: capability.mobile,
    policy: capability.policy,
    runtimeTest: tested,
    protoFields: capability.protoFields,
    fallback: capability.fallback,
    knownLimitations: capability.limitations,
    detected: capability.detected,
    tested: Boolean(tested || parser),
    verified,
  });
}

const doc = {
  generatedAt: new Date().toISOString(),
  runtime: { package: "@whiskeysockets/baileys", version: pkg.version, protoSource: discovered.protoSource },
  method: "Detected = runtime WAProto class + fields parsed from the shipped WAProto.proto. Tested = central builder sample → validateMessage (fromObject type check + create/encode/decode, the rc14 transport path) and simulated presses through the real interactive parser. Device rendering cannot be observed without a WhatsApp session, so web/mobile are reported as unverified-in-sandbox.",
  deliveryRule: "The first payload of any menu is chosen from policy before sending (primary only). ACK ≥ 2 means delivered, not rendered; a recipient that cannot render a legacy buttonsMessage sends no error ACK, so legacy payloads are opt-in (config.ui.legacyButtons or setting legacyButtons) and plugin-sent legacy payloads are converted to Native Flow with identical IDs.",
  summary: {
    capabilities: report.length,
    detected: report.filter((r) => r.detected).length,
    tested: report.filter((r) => r.tested).length,
    verified: report.filter((r) => r.verified).length,
    primary: report.filter((r) => r.policy === "primary").map((r) => r.name),
    optIn: report.filter((r) => r.policy === "opt-in").map((r) => r.name),
  },
  capabilities: report,
};

if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`✅ ${outFile}`);
}
console.log(JSON.stringify(doc.summary));
const bad = report.filter((r) => !r.verified).map((r) => r.name);
if (bad.length) console.log("unverified:", bad.join(", "));
process.exit(strict && bad.length ? 1 : 0);
