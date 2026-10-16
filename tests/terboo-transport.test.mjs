// ═══════════════════════════════════════════════
// 🧪 Terboo Message Transport + UI matrix (§7 §8 §12 §107 §108)
// ───────────────────────────────────────────────
// 1. sock.terboo.send لكل نوع: text · image · video · audio · voice · document · sticker
//    · location · contact · reaction · edit · buttons · select · cta · carousel · code
//    — هدف LID يُحلّ بالهوية، الاقتباس صحيح، النتيجة منظّمة، الإحصاءات تُحدَّث.
// 2. حمولة تفاعلية لا تمر بالتحقق ⇒ نص فوري بنفس المحتوى (بلا relay وبلا انتظار ACK).
// 3. مصفوفة الواجهة من طرف لطرف: كل قائمة حقيقية (Main · Categories · Category · Settings
//    · More · Owner · Language · AI) ⇒ الحمولة المُرسلة فعلاً ⇒ كل معرّف زر/صف فيها
//    ⇒ ضغطة بكل صيغ الرد الخمس ⇒ serialize ⇒ المحلّل ⇒ أمر ⇒ بلوقن موجود.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-transport-"));
process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid.json");
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const config = (await import("../config.js")).default;
const { installTransport, transportStats } = await import("../src/lib/terboo-transport.js");
const identity = await import("../src/lib/terboo-identity.js");
const { serialize } = await import("../src/lib/terboo-serialize.js");
const { applyInteractive } = await import("../src/lib/terboo-interactive.js");
const { innerOf } = await import("../src/lib/terboo-wa-capabilities.js");

const BOT = "201000000001";
const USER_PN = "201033334444@s.whatsapp.net";
const USER_LID = "150000000000333@lid";
config.owner.number = ["201011112222"];
identity.learn(USER_LID, USER_PN);

function makeSock() {
  const ev = new EventEmitter();
  const sock = {
    ev, user: { id: `${BOT}:3@s.whatsapp.net`, name: "Terboo" }, relayed: [], sent: [],
    async relayMessage(jid, message, options = {}) { sock.relayed.push({ jid, message, options }); return options.messageId; },
    async sendMessage(jid, content, options = {}) { sock.sent.push({ jid, content, options }); return { key: { id: `S${sock.sent.length}`, remoteJid: jid, fromMe: true } }; },
    waUploadToServer: async () => ({ mediaUrl: "https://mmg.example/x", directPath: "/x" }),
    async groupMetadata(jid) { return { id: jid, subject: "G", participants: [] }; },
  };
  installTransport(sock, { getDatabase: () => getDatabase() });
  return sock;
}

const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };
let seq = 0;
const userMessage = (body = ".menu") => ({ key: { remoteJid: USER_LID, fromMe: false, id: `U${++seq}` }, message: { conversation: body }, pushName: "User", messageTimestamp: Math.floor(Date.now() / 1000) });

// ── 1. كل نوع حمولة ──────────────────────────────
await check("all-kinds", async () => {
  const sock = makeSock();
  const m = await serialize(sock, userMessage());
  const cases = [
    [{ text: "مرحبا" }, "send", (c) => c.text === "مرحبا"],
    [{ image: Buffer.from("x"), caption: "صورة" }, "send", (c) => c.caption === "صورة" && c.image],
    [{ video: Buffer.from("x"), caption: "v" }, "send", (c) => c.video],
    [{ audio: Buffer.from("x") }, "send", (c) => c.audio && c.ptt === false],
    [{ voice: Buffer.from("x") }, "send", (c) => c.audio && c.ptt === true && /opus/.test(c.mimetype)],
    [{ document: Buffer.from("x"), fileName: "r.pdf", mimetype: "application/pdf" }, "send", (c) => c.fileName === "r.pdf"],
    [{ sticker: Buffer.from("x") }, "send", (c) => c.sticker],
    [{ location: { lat: 30, lng: 31, name: "Cairo" } }, "send", (c) => c.location.degreesLatitude === 30],
    [{ contact: { name: "Terboo", number: "201000000001" } }, "send", (c) => /waid=201000000001/.test(c.contacts.contacts[0].vcard)],
    [{ react: "✅", key: m.key }, "send", (c) => c.react.text === "✅"],
    [{ edit: { id: "E1", remoteJid: USER_PN, fromMe: true }, text: "معدّل" }, "send", (c) => c.edit.id === "E1" && c.text === "معدّل"],
  ];
  for (const [payload, stage, ok] of cases) {
    const res = await sock.terboo.send(m, payload, { quoted: true });
    assert.equal(res.ok, true, `${Object.keys(payload)[0]}: ${res.error}`);
    assert.equal(res.stage, stage);
    assert.equal(res.target, USER_PN, "هدف LID لم يُحلّ إلى الرقم الحقيقي");
    const last = sock.sent.at(-1);
    assert.ok(ok(last.content), `${Object.keys(payload)[0]}: محتوى خاطئ ${JSON.stringify(Object.keys(last.content))}`);
    assert.equal(last.options.quoted?.key?.id, m.key.id, `${Object.keys(payload)[0]}: بلا اقتباس`);
  }
});

await check("interactive-kinds", async () => {
  const sock = makeSock();
  const m = await serialize(sock, userMessage());
  const interactive = [
    [{ text: "اختر", buttons: [{ id: ".ping", text: "Ping" }, { id: ".menu", text: "Menu" }] }, (im) => im.nativeFlowMessage.buttons.length === 2],
    [{ text: "قائمة", select: { title: "افتح", sections: [{ title: "s", rows: [{ id: ".ping", title: "Ping" }] }] } }, (im) => im.nativeFlowMessage.buttons[0].name === "single_select"],
    [{ text: "روابط", cta: [{ type: "url", text: "فتح", value: "https://example.com" }, { type: "copy", text: "نسخ", value: "CODE1" }, { type: "call", text: "اتصال", value: "+201000000001" }] }, (im) => im.nativeFlowMessage.buttons.map((b) => b.name).join() === "cta_url,cta_copy,cta_call"],
    [{ carousel: { text: "بطاقات", cards: [{ title: "A", body: "a", buttons: [{ text: "فتح", url: "https://e.x/a" }] }, { title: "B", body: "b", buttons: [{ id: ".ping", text: "Ping" }] }] } }, (im) => im.carouselMessage.cards.length === 2],
  ];
  for (const [payload, ok] of interactive) {
    const res = await sock.terboo.send(m, payload, { quoted: true });
    assert.equal(res.ok, true, res.error);
    assert.equal(res.stage, "relay");
    const relayed = sock.relayed.at(-1);
    assert.equal(relayed.jid, USER_PN);
    const im = innerOf(relayed.message).interactiveMessage;
    assert.ok(ok(im), `${Object.keys(payload)[0]}: حمولة خاطئة`);
    assert.equal(im.contextInfo?.stanzaId, m.key.id, "التفاعلي لا يقتبس رسالة المستخدم");
    assert.ok(relayed.options.additionalNodes?.some((n) => n.tag === "biz"), "بلا عقدة biz");
  }
  // الكود يمر بمسار الكود نفسه (Rich Code أو بديله) بلا تعديل حرفي
  const code = "def f(x):\n    return x * 2  # *not bold* _not italic_\n";
  const res = await sock.terboo.send(m, { code, language: "python" }, { quoted: true });
  assert.equal(res.ok, true, res.error);
  // إعادة تجميع الكود من رسالة الكود الغنية (codeBlocks الملوّنة) أو من البديل النصي ⇒ مطابقة حرفية
  const rich = sock.relayed.map((r) => innerOf(r.message).richResponseMessage).find(Boolean);
  const fromRich = (rich?.submessages || []).filter((s) => s.codeMetadata).map((s) => s.codeMetadata.codeBlocks.map((b) => b.codeContent).join("")).join("");
  const fromText = sock.sent.map((x) => x.content?.text || "").find((t) => t.includes("return x * 2")) || "";
  assert.ok(fromRich === code || fromRich === code.trimEnd() || fromText.includes(code.trimEnd()), `الكود تغيّر أثناء الإرسال:\n${JSON.stringify(fromRich)}`);
});

// ── 2. فشل معروف ⇒ نص فوري ──────────────────────
await check("invalid-falls-back", async () => {
  const sock = makeSock();
  const m = await serialize(sock, userMessage());
  const before = sock.relayed.length;
  const res = await sock.terboo.send(m, { text: "اختر", buttons: [{ id: "", text: "" }].map(() => ({ id: ".x", text: "X" })), header: { title: 5, hasMediaAttachment: "nope", imageMessage: "broken" } });
  assert.equal(res.ok, true);
  assert.equal(res.fallback, true, "حمولة معطوبة لم تسقط إلى نص");
  assert.equal(sock.relayed.length, before, "relay لحمولة لن تُعرض");
  assert.match(sock.sent.at(-1).content.text, /› X — \.x/, "البديل لا يحمل الأزرار كأوامر قابلة للكتابة");
  const stats = transportStats();
  assert.ok(stats.byKind.buttons.fallback >= 1 && stats.sent > 0);
});

// ── 3. مصفوفة الواجهة: render → send → press(5 صيغ) → parse → dispatch ──
const PRESS_SHAPES = {
  buttonsResponseMessage: (id) => ({ buttonsResponseMessage: { selectedButtonId: id, selectedDisplayText: "x" } }),
  listResponseMessage: (id) => ({ listResponseMessage: { title: "x", singleSelectReply: { selectedRowId: id } } }),
  templateButtonReplyMessage: (id) => ({ templateButtonReplyMessage: { selectedId: id, selectedDisplayText: "x" } }),
  interactiveResponseMessage: (id) => ({ interactiveResponseMessage: { body: { text: "x" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id }), version: 3 } } }),
  nested: (id) => ({ interactiveResponseMessage: { nativeFlowResponseMessage: { name: "single_select", paramsJson: JSON.stringify({ response_json: JSON.stringify({ selectedRowId: id }) }) } } }),
};

function idsOf(message) {
  const im = innerOf(message).interactiveMessage;
  const ids = [];
  for (const b of im?.nativeFlowMessage?.buttons || []) {
    const params = JSON.parse(b.buttonParamsJson || "{}");
    if (params.id) ids.push(params.id);
    for (const s of params.sections || []) for (const r of s.rows || []) ids.push(r.id);
  }
  return ids;
}

await check("ui-matrix", async () => {
  getDatabase().setting("audioMenu", false);
  const SCREENS = [
    ["Main Menu", "menu", []], ["More", "menu", ["more"]], ["Categories", "فئة", []], ["Category", "فئة", ["tools"]],
    ["Settings", "menu", ["settings"]], ["Language", "menu", ["language"]], ["AI", "menu", ["ai"]], ["Owner", "menu", ["owner"]],
  ];
  let presses = 0;
  const reached = new Set();
  for (const [label, plugin, args] of SCREENS) {
    const sock = makeSock();
    const owner = label === "Owner";
    const m = await serialize(sock, userMessage(`.${plugin} ${args.join(" ")}`.trim()));
    m.args = args; m.prefix = "."; m.command = plugin;
    if (owner) { m.isOwner = true; }
    await getPlugin(plugin).handler(m, { sock, db: getDatabase(), config, uptime: 1000, args, command: plugin, prefix: "." });
    assert.equal(sock.relayed.length, 1, `${label}: لم تُرسل الشاشة`);
    const ids = idsOf(sock.relayed[0].message);
    assert.ok(ids.length > 0, `${label}: بلا أزرار/صفوف`);
    for (const id of ids) {
      for (const [shape, build] of Object.entries(PRESS_SHAPES)) {
        const raw = { key: { remoteJid: USER_LID, fromMe: false, id: `P${++seq}` }, message: build(id), pushName: "User", messageTimestamp: Math.floor(Date.now() / 1000) };
        const press = await serialize(sock, raw);
        if (owner) press.isOwner = true;
        // نفس مسار handler: المحلّل يعمل فقط إن لم تصبح الضغطة أمراً من serialize نفسه
        if (!press.isCommand) {
          const outcome = applyInteractive(press, { prefix: "." });
          assert.ok(outcome.handled, `${label} · ${shape} · ${id}: ضغطة صامتة (${outcome.reason})`);
          if (outcome.internal) continue;
        }
        assert.ok(press.isCommand, `${label} · ${shape} · ${id}: لم تصبح أمراً`);
        assert.ok(getPlugin(press.command), `${label} · ${id}: الأمر ${press.command} بلا بلوقن`);
        reached.add(press.command);
        presses += 1;
      }
    }
  }
  for (const command of ["menu", "فئة", "لغة", "اغلاق_القائمة", "بروفايل"]) assert.ok([...reached].some((c) => getPlugin(c) === getPlugin(command)), `الشاشات لا تصل إلى ${command} (Back/Close/Profile/Language)`);
  results.push(`ui-presses:${presses}`);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-transport: ${results.join(" · ")}`);
process.exit(0);
