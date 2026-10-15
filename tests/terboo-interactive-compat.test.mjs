// ═══════════════════════════════════════════════
// 🧪 Terboo — توافق الردود التفاعلية على الـBaileys الرسمي (v4 §32)
// ───────────────────────────────────────────────
// ما يغطيه terboo-interactive.test.mjs: استخراج المعرّف من كائنات مبنية يدوياً.
// ما يثبته هذا الاختبار فوق ذلك: المسار الكامل كما يحدث فعلاً على الـBaileys الرسمي 7.0.0-rc14:
//   ضغطة بكل صيغة ← ترميز WAProto الرسمي (encode) ← فك الترميز (decode) كما تصل من السوكت
//   ← messageHandler الحقيقي (serialize ← applyInteractive ← الصلاحيات ← البلوقن) ← الأمر نُفّذ
//   لنفس المرسل وفي نفس الدردشة. وكل ذلك داخل الأغلفة: عادية · ephemeralMessage · viewOnceMessageV2.
//
// الصيغ المطلوبة (§32): buttonsResponseMessage · listResponseMessage · templateButtonReplyMessage
//   · interactiveResponseMessage · nativeFlowResponseMessage · selectedRowId · selectedId
//   · selectedButtonId · buttonId · paramsJson · response_json
//
// ملاحظة موثّقة من الـproto الرسمي: nativeFlowResponseMessage لا يوجد إلا داخل
// interactiveResponseMessage، و buttonId / selectedId (داخل native flow) / response_json
// تصل داخل paramsJson. الصيغ غير الموجودة في الـproto (nativeFlowResponseMessage في الجذر،
// buttonsResponseMessage.buttonId) يحذفها الترميز الرسمي — تُختبر كما يمررها كود داخل العملية
// (بلا ترميز) لأن البوت يدعمها للتوافق.
//
// ولا ضغطة صامتة: معرّف لا يطابق أمراً ⇒ سجل بسبب واضح + رسالة للمستخدم في نفس الدردشة.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111132";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-icompat-"));
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
const PREFIX = config.command?.prefix || ".";
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (error) { console.warn("تنظيف:", error.message); } });
const db = getDatabase();
db.setting("audioMenu", false);
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");
const { installLocalization } = await import("../src/lib/terboo-i18n/runtime.js");
const { installMenuDelivery } = await import("../src/lib/terboo-menu-delivery.js");
const interactive = await import("../src/lib/terboo-interactive.js");
const { proto } = await import("@whiskeysockets/baileys");
const baileysVersion = JSON.parse(fs.readFileSync(path.join(process.cwd(), "node_modules/@whiskeysockets/baileys/package.json"), "utf8")).version;
assert.equal(baileysVersion, "7.0.0-rc14", "الاختبار يجب أن يعمل على الـBaileys الرسمي");

// ── واتساب: كل ما يصل يُسجَّل بعد حدّ الإرسال الحقيقي ──
const delivered = [];
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net`, name: "Terboo" },
  ev: { on() { } },
  async relayMessage(jid, message, options = {}) { delivered.push({ jid, message, id: options.messageId }); return options.messageId || "R"; },
  async sendMessage(jid, content) { delivered.push({ jid, content }); return { key: { id: `S${delivered.length}`, remoteJid: jid, fromMe: true } }; },
  async sendPresenceUpdate() { }, async readMessages() { },
  async groupMetadata() { return { id: "g@g.us", subject: "G", participants: [] }; },
  async profilePictureUrl() { throw new Error("no pp"); },
  waUploadToServer: async () => ({}),
};
installLocalization(sock, { getDatabase });
installMenuDelivery(sock);

// ── البلوقن الهدف حقيقي في السجل؛ جسمه وحده جاسوس يثبت أن الضغطة وصلت ──
const ping = getPlugin("ping");
assert.ok(ping, "بلوقن ping موجود");
const runs = [];
ping.handler = async (m) => { runs.push({ sender: m.sender, chat: m.chat, command: m.command, type: m.type }); };

// ── الصيغ ──
const native = (name, params) => ({
  interactiveResponseMessage: {
    body: { text: "زر", format: 0 },
    nativeFlowResponseMessage: { name, paramsJson: JSON.stringify(params), version: 3 },
  },
});
/** [اسم الصيغة، الحقول المغطاة، باني المحتوى] — كلها موجودة في WAProto الرسمي */
const WIRE_SHAPES = [
  ["buttonsResponseMessage.selectedButtonId", ["buttonsResponseMessage", "selectedButtonId"], (id) => ({ buttonsResponseMessage: { selectedButtonId: id, selectedDisplayText: "زر", type: 1 } })],
  ["listResponseMessage.singleSelectReply.selectedRowId", ["listResponseMessage", "selectedRowId"], (id) => ({ listResponseMessage: { title: "صف", listType: 1, singleSelectReply: { selectedRowId: id } } })],
  ["templateButtonReplyMessage.selectedId", ["templateButtonReplyMessage", "selectedId"], (id) => ({ templateButtonReplyMessage: { selectedId: id, selectedIndex: 0, selectedDisplayText: "زر" } })],
  ["interactiveResponseMessage.nativeFlowResponseMessage.paramsJson{id}", ["interactiveResponseMessage", "nativeFlowResponseMessage", "paramsJson"], (id) => native("quick_reply", { id })],
  ["nativeFlow paramsJson{selectedId}", ["selectedId"], (id) => native("single_select", { selectedId: id })],
  ["nativeFlow paramsJson{selectedRowId}", ["selectedRowId"], (id) => native("single_select", { selectedRowId: id })],
  ["nativeFlow paramsJson{selectedButtonId}", ["selectedButtonId"], (id) => native("quick_reply", { selectedButtonId: id })],
  ["nativeFlow paramsJson{buttonId}", ["buttonId"], (id) => native("quick_reply", { buttonId: id })],
  ["nativeFlow paramsJson{selected_id}", [], (id) => native("single_select", { selected_id: id })],
  ["nativeFlow paramsJson{response_json:{id}}", ["response_json"], (id) => native("galaxy_message", { response_json: JSON.stringify({ id }) })],
  ["nativeFlow paramsJson{response_json:{payload:{selectedRowId}}}", ["response_json"], (id) => native("galaxy_message", { response_json: JSON.stringify({ payload: { selectedRowId: id } }) })],
];
/** صيغ لا يعرفها الـproto الرسمي: يمررها كود داخل العملية (توافق) */
const IN_PROCESS_SHAPES = [
  ["nativeFlowResponseMessage (root)", ["nativeFlowResponseMessage"], (id) => ({ nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id }) } })],
  ["buttonsResponseMessage.buttonId", ["buttonId"], (id) => ({ buttonsResponseMessage: { buttonId: id, selectedDisplayText: "زر" } })],
];
const WRAPPERS = {
  plain: (message) => message,
  ephemeral: (message) => ({ ephemeralMessage: { message } }),
  viewOnceV2: (message) => ({ viewOnceMessageV2: { message } }),
};

/** ذهاب وإياب عبر WAProto الرسمي — ما يصل من السوكت فعلاً */
function wire(content) {
  const bytes = proto.Message.encode(proto.Message.fromObject(content)).finish();
  return proto.Message.decode(bytes);
}

let seq = 0;
async function press(message, { group = false } = {}) {
  seq += 1;
  // مرسل مختلف لكل ضغطة: cooldown البلوقن (5 ث) لا يخفي نتيجة أي صيغة
  const sender = `20155${String(700000 + seq).padStart(7, "0")}@s.whatsapp.net`;
  db.setUser(sender, { isRegistered: true, regName: "مختبر", language: "ar" });
  const chat = group ? "120363000000000932@g.us" : sender;
  const before = { runs: runs.length, delivered: delivered.length };
  const raw = {
    key: { remoteJid: chat, fromMe: false, id: `ICOMPAT${seq}ABCDEF`, ...(group ? { participant: sender } : {}) },
    message, pushName: "مختبر", messageTimestamp: Math.floor(Date.now() / 1000),
  };
  await messageHandler(raw, sock);
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { sender, chat, runs: runs.slice(before.runs), out: delivered.slice(before.delivered) };
}

const covered = new Set();
const table = [];

// ── 1. كل صيغة × كل غلاف × (مع البادئة وبدونها) عبر الترميز الرسمي ⇒ الأمر نُفّذ ──
for (const [label, fields, build] of WIRE_SHAPES) {
  for (const [wrapName, wrap] of Object.entries(WRAPPERS)) {
    for (const id of [`${PREFIX}ping`, "ping"]) {
      const decoded = wire(wrap(build(id)));
      assert.ok(JSON.stringify(decoded.toJSON()).includes(JSON.stringify(id).slice(1, -1)), `${label}/${wrapName}: المعرّف ضاع في الترميز الرسمي`);
      const result = await press(decoded);
      assert.equal(result.runs.length, 1, `${label}/${wrapName}/${id}: الضغطة لم تنفّذ الأمر (عدد التنفيذ ${result.runs.length})`);
      assert.deepEqual([result.runs[0].sender, result.runs[0].chat], [result.sender, result.chat], `${label}: نُفّذ لمرسل/دردشة أخرى`);
      assert.equal(getPlugin(result.runs[0].command), ping, `${label}: أمر غير متوقع (${result.runs[0].command})`);
      assert.ok(result.out.every((entry) => entry.jid === result.chat), `${label}: رد وصل لغير الدردشة`);
    }
  }
  fields.forEach((field) => covered.add(field));
  table.push([label, "wire ✓", "plain · ephemeral · viewOnceV2"]);
}

// ── 2. الصيغ خارج الـproto: الترميز الرسمي يحذفها (موثّق) والبوت يدعمها داخل العملية ──
for (const [label, fields, build] of IN_PROCESS_SHAPES) {
  const content = build(`${PREFIX}ping`);
  const decoded = proto.Message.decode(proto.Message.encode(proto.Message.fromObject(content)).finish());
  assert.ok(!JSON.stringify(decoded.toJSON()).includes("ping"), `${label}: توقعنا أن الـproto الرسمي لا يحمل هذا الحقل`);
  for (const [wrapName, wrap] of Object.entries(WRAPPERS)) {
    const result = await press(wrap(build(`${PREFIX}ping`)));
    assert.equal(result.runs.length, 1, `${label}/${wrapName}: لم تُنفَّذ داخل العملية`);
  }
  fields.forEach((field) => covered.add(field));
  table.push([label, "not in proto", "in-process ✓"]);
}

// ── 3. في مجموعة: الضغطة تُنفَّذ للمرسل في نفس المجموعة (لا خلط هدف) ──
{
  const result = await press(wire(native("quick_reply", { id: `${PREFIX}ping` })), { group: true });
  assert.equal(result.runs.length, 1, "ضغطة في مجموعة لم تُنفَّذ");
  assert.equal(result.runs[0].chat, result.chat);
  assert.equal(result.runs[0].sender, result.sender);
  table.push(["group press (nativeFlow)", "wire ✓", "same group · same sender"]);
}

// ── 4. قائمة حقيقية: ضغطة «menu» تُرسل القائمة لنفس الدردشة ──
{
  const result = await press(wire(WIRE_SHAPES[1][2](`${PREFIX}menu`)));
  assert.ok(result.out.length >= 1, "ضغطة menu لم تُرسل شيئاً");
  assert.ok(result.out.every((entry) => entry.jid === result.chat), "القائمة وصلت لغير الدردشة");
  table.push(["listResponse → real menu", "wire ✓", "menu delivered to same chat"]);
}

// ── 5. لا ضغطة صامتة: معرّف مجهول ⇒ سجل + رسالة ──
{
  const failuresBefore = interactive.recentFailures(50).length;
  const error = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args.join(" "));
  let result;
  try {
    result = await press(wire(native("quick_reply", { id: `${PREFIX}لا_يوجد_أمر_كهذا_${Date.now()}` })));
  } finally {
    console.error = error;
  }
  assert.equal(result.runs.length, 0);
  const failures = interactive.recentFailures(50);
  assert.ok(failures.length > failuresBefore, "الضغطة الفاشلة لم تُسجَّل");
  assert.equal(failures.at(-1).reason, interactive.REASON.UNKNOWN_COMMAND);
  assert.equal(failures.at(-1).type, "interactiveResponseMessage");
  assert.ok(logged.some((line) => line.includes("ضغطة لم تُنفَّذ")), "لا سطر سجل للضغطة الفاشلة");
  const text = result.out.map((entry) => entry.content?.text || JSON.stringify(entry.message || "")).join("\n");
  assert.ok(result.out.length >= 1 && result.out.every((entry) => entry.jid === result.chat), "المستخدم لم يُبلَّغ في نفس الدردشة");
  assert.match(text, /لم أتعرّف على هذا الاختيار/, "رسالة الضغطة المجهولة لم تصل");
  table.push(["unknown id", "wire ✓", "logged (unknown-command) + user notified"]);
}

// ── 6. كل الحقول المطلوبة في §32 مغطّاة ──
const REQUIRED = ["buttonsResponseMessage", "listResponseMessage", "templateButtonReplyMessage", "interactiveResponseMessage", "nativeFlowResponseMessage", "selectedRowId", "selectedId", "selectedButtonId", "buttonId", "paramsJson", "response_json"];
assert.deepEqual(REQUIRED.filter((field) => !covered.has(field)), [], "حقول §32 غير مغطّاة");

console.log(`\n  ${"shape".padEnd(62)} ${"transport".padEnd(14)} result`);
for (const [label, transport, result] of table) console.log(`  ${label.padEnd(62)} ${transport.padEnd(14)} ${result}`);
console.log(`\n✅ terboo-interactive-compat: ${REQUIRED.length}/${REQUIRED.length} حقول §32 · ${WIRE_SHAPES.length} صيغة عبر WAProto الرسمي (${baileysVersion}) × 3 أغلفة × بادئة/بدون · مجموعة · قائمة حقيقية · لا ضغطة صامتة · ${runs.length} تنفيذ حقيقي`);
process.exit(0);
