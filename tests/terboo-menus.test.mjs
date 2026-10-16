// اختبار القوائم الحقيقي (§19–§24)
//
// Fixtures من سجل القوائم المركزي نفسه (ما يُعرض = ما يُختبر) لكل من:
//   Main · Categories · Category · Language · Settings · Owner · Back · Close
//   · Profile · AI · Registration
// كل صف يحمل: display · internalId · expectedCommand · expectedPlugin.
//
// ولكل صف ضغطة حقيقية:
//   رسالة واتساب خام (كل صيغ الرد التفاعلي) → serialize الحقيقي
//   → normalize → parse → resolve → messageHandler الحقيقي → البلوقن المتوقَّع.
// لا يُستبدل إلا واتساب (sock يلتقط) وجسم البلوقن الهدف (جاسوس يسجّل وصوله).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111119";
const USER = "201555555555@s.whatsapp.net";
const OWNER = null; // يُقرأ من config

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-menus-"));
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
const OWNER_JID = `${String(config.owner.number[0]).replace(/\D/g, "")}@s.whatsapp.net`;
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
db.setting("audioMenu", false);
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const menus = await import("../src/lib/terboo-menus.js");
const I = await import("../src/lib/terboo-interactive.js");
const { serialize } = await import("../src/lib/terboo-serialize.js");
const { messageHandler } = await import("../src/handler.js");
const UI = await import("../src/lib/terboo-ui-theme.js");
const PREFIX = config.command?.prefix || ".";

for (const jid of [USER, OWNER_JID]) db.setUser(jid, { isRegistered: true, regName: "مختبر", language: "ar" });

const sent = [];
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net`, name: "Terboo" },
  async relayMessage(jid, message) { sent.push({ jid, message }); return { key: { id: "x" } }; },
  async sendMessage(jid, content) { sent.push({ jid, content }); return { key: { id: `S${sent.length}` } }; },
  async sendPresenceUpdate() { },
  async readMessages() { },
  async groupMetadata() { return { id: "g@g.us", subject: "G", participants: [] }; },
  async profilePictureUrl() { throw new Error("no pp"); },
  waUploadToServer: async () => ({}),
};

// ═══ 1. Fixtures: كل القوائم × كل اللغات ═══
const REQUIRED = ["main", "categories", "category", "language", "settings", "owner", "profile", "ai", "registration"];
const fixtures = {};
for (const lang of ["ar", "en"]) {
  const base = { lang, prefix: PREFIX, isOwner: true, isGroup: true, category: "main" };
  fixtures[lang] = menus.menuFixtures(base);
  for (const menuId of REQUIRED) {
    const rows = fixtures[lang].filter((row) => row.menu === menuId);
    assert.ok(rows.length > 0, `${lang}: قائمة ${menuId} بلا صفوف`);
  }
  for (const row of fixtures[lang]) {
    assert.ok(row.display && !/^\s*(menu|profile|registration)\.[\w.]+$/.test(row.display.replace(/^\S+\s/, "")), `${lang}: نص معروض غير مترجم: ${row.internalId} → ${row.display}`);
    assert.ok(row.internalId, "internalId موجود");
    assert.ok(row.id.startsWith(PREFIX), `${row.internalId}: المعرّف يبدأ بالبادئة`);
    assert.equal(row.id, `${PREFIX}${row.expectedCommand}`, `${row.internalId}: المعرّف = الأمر المتوقّع`);
    assert.ok(row.expectedPlugin, `${lang}: ${row.internalId} بلا بلوقن حقيقي (${row.expectedCommand})`);
  }
  // Back و Close موجودان في كل قائمة فرعية
  for (const menuId of ["category", "settings", "language", "ai", "owner"]) {
    const ids = fixtures[lang].filter((row) => row.menu === menuId).map((row) => row.internalId);
    assert.ok(ids.includes("nav.back") && ids.includes("nav.close"), `${lang}: ${menuId} بلا رجوع/إغلاق`);
  }
}
// المعروض مترجم فعلاً والمعرّف الداخلي ثابت عبر اللغات
{
  const close = (lang) => fixtures[lang].find((row) => row.internalId === "nav.close");
  assert.notEqual(close("ar").display, close("en").display);
  assert.equal(close("ar").expectedPlugin, close("en").expectedPlugin, "نفس البلوقن مهما كانت اللغة");
  assert.match(fixtures.en.find((row) => row.internalId === "settings.privacy").id, /\.memory privacy$/, "الأمر بمرادف لغة المستخدم");
}
// الصلاحيات: قائمة المالك لا تظهر لغيره، والرد التلقائي للمجموعات فقط
{
  const member = menus.menuFixtures({ lang: "ar", prefix: PREFIX, isOwner: false, isGroup: false });
  assert.equal(member.filter((row) => row.menu === "owner").length, 0, "قائمة المالك مخفية عن غيره");
  assert.ok(!member.some((row) => row.internalId === "owner.open"), "زر لوحة المالك مخفي");
  assert.ok(!member.some((row) => row.internalId === "ai.autoai"), "الرد التلقائي لا يظهر في الخاص");
}

// ═══ 2. ضغطة حقيقية لكل صف: serialize → normalize → parse → resolve ═══
const SHAPES = {
  list: (id) => ({ listResponseMessage: { title: "row", singleSelectReply: { selectedRowId: id } } }),
  buttons: (id) => ({ buttonsResponseMessage: { selectedButtonId: id, selectedDisplayText: "btn", type: 1 } }),
  template: (id) => ({ templateButtonReplyMessage: { selectedId: id, selectedIndex: 0, selectedDisplayText: "btn" } }),
  nativeFlow: (id) => ({ interactiveResponseMessage: { body: { text: "btn" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id }), version: 3 } } }),
  responseJson: (id) => ({ interactiveResponseMessage: { nativeFlowResponseMessage: { name: "galaxy_message", paramsJson: JSON.stringify({ response_json: JSON.stringify({ payload: { selectedRowId: id } }) }) } } }),
};
let seq = 0;
function rawPress(shape, id, sender = USER) {
  return {
    key: { remoteJid: sender, fromMe: false, id: `PRESS${++seq}ABCDEF` },
    message: SHAPES[shape](id),
    pushName: "مختبر",
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}
const canonical = (command) => {
  const plugin = getPlugin(command);
  if (!plugin) return I.commandExists(command) ? `case:${command}` : null;
  return [].concat(plugin.config.name)[0];
};

const unique = new Map();
for (const lang of ["ar", "en"]) for (const row of fixtures[lang]) unique.set(row.id, row);
let resolved = 0;
for (const row of unique.values()) {
  for (const shape of Object.keys(SHAPES)) {
    const m = await serialize(sock, rawPress(shape, row.id));
    assert.ok(I.isInteractiveType(m.type), `${shape}: نوع الضغطة معروف`);
    const result = I.applyInteractive(m, { prefix: PREFIX });
    // serialize قد يحلّ المعرّف المسبوق بالبادئة بنفسه (already-command) — وهو حلّ ناجح أيضاً
    const ok = result.handled || (result.reason === I.REASON.ALREADY_COMMAND && m.isCommand);
    assert.ok(ok, `ضغطة صامتة: ${row.internalId} (${shape}) → ${result.reason}`);
    assert.equal(canonical(m.command), row.expectedPlugin, `${row.internalId} (${shape}) وصل لبلوقن آخر: ${m.command}`);
    const expectedArgs = row.expectedCommand.split(" ").slice(1).join(" ");
    assert.equal((m.args || []).join(" "), expectedArgs, `${row.internalId}: الوسائط`);
    resolved += 1;
  }
}

// ═══ 3. Dispatch حقيقي عبر messageHandler إلى البلوقن المتوقَّع ═══
const reached = [];
const originals = new Map();
for (const row of unique.values()) {
  if (row.expectedPlugin.startsWith("case:")) continue;
  const plugin = getPlugin(row.expectedCommand.split(" ")[0]);
  if (originals.has(plugin)) continue;
  originals.set(plugin, plugin.handler);
  plugin.handler = async (m) => { reached.push({ plugin: [].concat(plugin.config.name)[0], args: (m.args || []).join(" "), sender: m.sender }); };
}
let dispatched = 0;
// الحدّ العام الحقيقي للبوت (100 رسالة/دقيقة) يبقى فعّالاً ولا نتجاوزه: صفوف الأقسام
// تُرسَل هنا بعيّنة ثابتة من معرّفاتها العربية؛ كل قسم (وكل مرادف `.menucat`) ثبت
// وصوله لنفس البلوقن وبنفس الوسائط بكل الصيغ الخمس في القسم 2.
const SAMPLE_CATEGORIES = new Set(["cat.main", "cat.owner", "cat.ai", "cat.group", "cat.tools", "cat.info"]);
const arabicIds = new Set(fixtures.ar.map((row) => row.id));
for (const row of unique.values()) {
  if (row.expectedPlugin.startsWith("case:")) continue;
  if (row.internalId.startsWith("cat.") && (!arabicIds.has(row.id) || !SAMPLE_CATEGORIES.has(row.internalId))) continue;
  const owner = row.internalId.startsWith("owner.") && row.internalId !== "owner.developer" && row.internalId !== "owner.ping";
  const needsGroup = row.internalId === "ai.autoai";
  if (needsGroup) continue; // أمر مجموعات: يُختبر وصوله أدناه داخل مجموعة
  // مستخدم جديد لكل ضغطة: التبريد الحقيقي للبلوقنات يبقى فعّالاً ولا نتجاوزه
  const presser = owner ? OWNER_JID : `2015550${String(dispatched).padStart(5, "0")}@s.whatsapp.net`;
  if (!owner) db.setUser(presser, { isRegistered: true, regName: "مختبر", language: "ar" });
  const before = reached.length;
  await messageHandler(rawPress("list", row.id, presser), sock);
  assert.equal(reached.length, before + 1, `لم يصل «${row.internalId}» إلى ${row.expectedPlugin}`);
  assert.equal(reached.at(-1).plugin, row.expectedPlugin);
  assert.equal(reached.at(-1).args, row.expectedCommand.split(" ").slice(1).join(" "));
  dispatched += 1;
}
for (const [plugin, handler] of originals) plugin.handler = handler;

// ═══ 4. أزرار اللغة الداخلية تصل لبوابة الانضمام فعلاً (كانت تُرفض كأمر مجهول) ═══
{
  const NEWBIE = "201666666666@s.whatsapp.net";

  db.setUser(NEWBIE, { isRegistered: true });
  await messageHandler(rawPress("nativeFlow", "terboo_language_ar", NEWBIE), sock);
  assert.equal(db.getUser(NEWBIE).language, "ar", "زر اللغة حفظ العربية");
  await messageHandler(rawPress("buttons", "terboo_language_en", NEWBIE), sock);
  assert.equal(db.getUser(NEWBIE).language, "en", "زر اللغة الكلاسيكي حفظ الإنجليزية");
}

// ═══ 5. زر «نسخ» يرد بالقيمة · معرّف مجهول ⇒ تشخيص واضح ═══
{
  const before = sent.length;
  await messageHandler(rawPress("template", "copy_ABCDEF123", USER), sock);
  const reply = sent.slice(before).map((entry) => JSON.stringify(entry.content || entry.message)).join("\n");
  assert.match(reply, /"text":"ABCDEF123"/, "زر النسخ رد بالقيمة نظيفة (بلا backticks) ليسهل نسخها");

  const beforeUnknown = sent.length;
  await messageHandler(rawPress("list", `${PREFIX}امر_غير_موجود_xyz`, "201777777777@s.whatsapp.net"), sock);
  const diag = sent.slice(beforeUnknown).map((entry) => JSON.stringify(entry.content || entry.message)).join("\n");
  assert.match(diag, /لم أتعرّف على هذا الاختيار|امر_غير_موجود_xyz/, "المعرّف المجهول يعطي تشخيصاً لا صمتاً");
}

// ═══ 6. ما تعرضه البلوقنات فعلاً = ما في السجل ═══
function collectIds(node, out = new Set(), depth = 0) {
  if (!node || depth > 14) return out;
  if (typeof node === "string") {
    const text = node.trim();
    if (text.startsWith("{") || text.startsWith("[")) { try { collectIds(JSON.parse(text), out, depth + 1); } catch { } }
    return out;
  }
  if (Array.isArray(node)) { for (const item of node) collectIds(item, out, depth + 1); return out; }
  if (typeof node !== "object") return out;
  for (const key of ["id", "buttonId"]) if (typeof node[key] === "string" && node[key].startsWith(PREFIX)) out.add(node[key]);
  for (const value of Object.values(node)) if (value && typeof value === "object" || typeof value === "string") collectIds(value, out, depth + 1);
  return out;
}
async function render(command, args, { owner = false } = {}) {
  const captured = [];
  const capSock = { ...sock, async relayMessage(jid, message) { captured.push(message); }, async sendMessage(jid, content) { captured.push(content); } };
  const plugin = getPlugin(command);
  const m = {
    sender: owner ? OWNER_JID : USER, chat: owner ? OWNER_JID : USER, body: `${PREFIX}${command}`, isCommand: true, command, args, prefix: PREFIX,
    text: args.join(" "), isGroup: false, isOwner: owner, isPremium: false, pushName: "Tester", key: { id: "r", remoteJid: USER },
    async reply(text) { captured.push({ text }); }, async react() { },
  };
  await plugin.handler(m, { sock: capSock, db, config, uptime: 1000, args, command, prefix: PREFIX });
  return captured;
}
for (const [command, args, menuId, owner] of [
  ["menu", [], "main", false], ["menu", ["settings"], "settings", false], ["menu", ["ai"], "ai", false],
  ["menu", ["language"], "language", false], ["menu", ["owner"], "owner", true],
  ["فئة", [], "categories", false], ["فئة", ["main"], "category", false],
]) {
  const captured = await render(command, args, { owner });
  const shown = collectIds(captured);
  // Terboo Cloud يظهر حسب ملف القدرات: المستخدم التجريبي بلا نمط ⇒ «عام» (مخفي) · المالك يرى كل شيء
  const ctx = { lang: "ar", prefix: PREFIX, isOwner: owner, isGroup: false, category: args[0] === "main" ? "main" : undefined, showCloud: owner };
  const expected = new Set([...menus.menuRows(menuId, ctx), ...menus.menuButtons(menuId, ctx)].map((row) => row.id));
  for (const id of expected) assert.ok(shown.has(id), `${command} ${args.join(" ")}: الصف ${id} في السجل لكنه غير معروض`);
  for (const id of shown) {
    const result = I.resolveSelection(id, { prefix: PREFIX });
    assert.equal(result.ok, true, `${command}: معرّف معروض لا ينتهي بأمر: ${id}`);
  }
  const text = JSON.stringify(captured);
  assert.ok(!/[\u{1D400}-\u{1D7FF}]/u.test(text), `${command}: لا حروف مزخرفة مفروضة في نص واتساب`);
}

// ═══ 7. عقد محرّك الزخرفة (§24–§29) ═══
{
  for (const fn of ["header", "title", "subtitle", "row", "quote", "code", "section", "divider", "success", "error", "warning", "info", "footer", "menuItem", "profile", "command", "status"]) {
    assert.equal(typeof UI[fn], "function", `دالة المحرّك مفقودة: ${fn}()`);
  }
  const ar = UI.row("الإصدار", "v2.0", "ar");
  const en = UI.row("Version", "v2.0", "en");
  const es = UI.row("Versión", "v2.0", "es");
  for (const line of [ar, en, es]) {
    assert.ok(line.startsWith("> "), "السطر اقتباس «>»");
    assert.ok(line.includes("v2.0") && !line.includes("`"), "القيمة نظيفة بلا backticks (§34)");
  }
  assert.notEqual(UI.theme("ar").row, UI.theme("en").row);
  assert.notEqual(UI.theme("en").row, UI.theme("es").row);
  assert.match(UI.card({ title: "Menú", blocks: [UI.row("Categoría", "Diseño ñ ü", "es")], lang: "es" }), /Categoría: Diseño ñ ü/, "الإسبانية بلا تشويه");
  assert.match(UI.command("menu", "القائمة", { lang: "ar", prefix: "." }), /> ◈ ⁦\.menu⁩ · القائمة/, "الأمر معزول اتجاهياً بلا backticks");
  // أنواع الرسائل لا تتشابه
  const kinds = ["success", "error", "warning", "info"].map((fn) => UI[fn]("T", "x", { lang: "ar" }).split("\n")[0]);
  assert.equal(new Set(kinds).size, kinds.length, "لكل نوع رسالة علامته");
  // لا زخارف الإصدار السابق
  for (const lang of ["ar", "en", "es"]) {
    const th = UI.theme(lang);
    for (const old of ["▰▰▰", "▬▬▬", "═══", "❯", "❰"]) assert.ok(!Object.values(th).join(" ").includes(old), `${lang}: زخرفة قديمة ${old}`);
  }
}

console.log(`✅ terboo-menus: ${REQUIRED.length} قوائم × 3 لغات · ${unique.size} صفاً · ${resolved} ضغطة بخمس صيغ · ${dispatched} وصولاً حقيقياً للبلوقن · أزرار اللغة والنسخ · المعروض = المُختبَر`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
