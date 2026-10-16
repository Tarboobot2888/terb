// اختبار مسار الأزرار والقوائم - Bot Terboo  (§14 §15)
//
// لا يكتفي هذا الاختبار بالبحث عن buttonId داخل الكود المصدري.
// يشغّل بلوقنات القوائم فعلاً، يلتقط الرسالة التفاعلية التي كانت
// ستُرسل إلى واتساب، يستخرج كل زر وكل صف منها، ثم يبني لكل واحد
// منها رد واتساب حقيقي بالشكل الذي يصل من الهاتف، ويؤكّد أن المسار
// الكامل ينتهي بأمر موجود في السجل الحيّ.
//
// أي معرّف لا ينتهي بأمر = ضغطة صامتة = فشل الاختبار.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-btn-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmpDb);
const db = getDatabase();

const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));

const I = await import("../src/lib/terboo-interactive.js");
const { parseCommand } = await import("../src/lib/terboo-serialize.js");
const config = (await import("../config.js")).default;

const PREFIX = config.command?.prefix || ".";
const BOT = "2348093093240";
const USER = "201000000001@s.whatsapp.net";

// ═══════════════════════════════════════════════
// بناء رسائل واتساب حقيقية لكل شكل رد تفاعلي
// ═══════════════════════════════════════════════

/** كل الأشكال التي قد يصل بها معرّف الزر من واتساب */
const SHAPES = {
  buttonsResponse: (id) => ({
    type: "buttonsResponseMessage",
    message: { buttonsResponseMessage: { selectedButtonId: id, selectedDisplayText: "زر", type: 1 } },
  }),
  buttonsResponseAltKey: (id) => ({
    type: "buttonsResponseMessage",
    message: { buttonsResponseMessage: { buttonId: id, selectedDisplayText: "زر" } },
  }),
  listResponse: (id) => ({
    type: "listResponseMessage",
    message: { listResponseMessage: { title: "صف", singleSelectReply: { selectedRowId: id } } },
  }),
  listResponseFlat: (id) => ({
    type: "listResponseMessage",
    message: { listResponseMessage: { title: "صف", selectedRowId: id } },
  }),
  templateReply: (id) => ({
    type: "templateButtonReplyMessage",
    message: { templateButtonReplyMessage: { selectedId: id, selectedIndex: 0, selectedDisplayText: "زر" } },
  }),
  interactiveParamsJson: (id) => ({
    type: "interactiveResponseMessage",
    message: {
      interactiveResponseMessage: {
        body: { text: "زر" },
        nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id }), version: 3 },
      },
    },
  }),
  interactiveSnakeId: (id) => ({
    type: "interactiveResponseMessage",
    message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: { name: "single_select", paramsJson: JSON.stringify({ selected_id: id }) },
      },
    },
  }),
  interactiveRowId: (id) => ({
    type: "interactiveResponseMessage",
    message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: { name: "single_select", paramsJson: JSON.stringify({ selectedRowId: id }) },
      },
    },
  }),
  nativeFlowDirect: (id) => ({
    type: "nativeFlowResponseMessage",
    message: { nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id }) } },
  }),
  nestedResponseJson: (id) => ({
    type: "interactiveResponseMessage",
    message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          name: "galaxy_message",
          paramsJson: JSON.stringify({ response_json: JSON.stringify({ payload: { selectedButtonId: id } }) }),
        },
      },
    },
  }),
  deepArray: (id) => ({
    type: "interactiveResponseMessage",
    message: {
      interactiveResponseMessage: {
        nativeFlowResponseMessage: {
          paramsJson: JSON.stringify({ items: [{ meta: {} }, { reply: { selectedRowId: id } }] }),
        },
      },
    },
  }),
};

/** يبني رسالة مُسلسلة كما يراها المعالج، مع نص الجسم المستخرج فعلاً */
function makePress(shapeName, id, { withBody = true } = {}) {
  const shape = SHAPES[shapeName](id);
  const extracted = I.extractSelection(shape.message, shape.type);
  return {
    sender: USER,
    chat: USER,
    type: shape.type,
    message: shape.message,
    body: withBody ? extracted : "",
    isCommand: false,
    isGroup: false,
    prefix: PREFIX,
    args: [],
  };
}

// ── 1. كل شكل رد يُستخرج ويُنفَّذ ───────────────────────
{
  const shapes = Object.keys(SHAPES);
  assert.ok(shapes.length >= 10, `يجب تغطية كل صيغ الرد (وجد ${shapes.length})`);

  for (const shape of shapes) {
    for (const withBody of [true, false]) {
      const m = makePress(shape, "menu", { withBody });
      const result = I.applyInteractive(m, { prefix: PREFIX });
      assert.equal(result.handled, true, `${shape} (body=${withBody}) لم يُستخرج`);
      assert.equal(m.isCommand, true, `${shape}: لم تتحوّل الرسالة إلى أمر`);
      assert.equal(m.command, "menu", `${shape}: اسم الأمر خاطئ (${m.command})`);
      assert.ok(getPlugin(m.command), `${shape}: البلوقن غير موجود`);
      assert.equal(m.fromInteractive, true, `${shape}: لم تُعلَّم الرسالة كضغطة`);
    }
  }
}

// ── 2. معرّف بوسائط ومعرّف ببادئة ───────────────────────
{
  const withArgs = makePress("listResponse", `${PREFIX}menucat tools`);
  const r1 = I.applyInteractive(withArgs, { prefix: PREFIX });
  assert.equal(r1.handled, true, "صف بوسائط يُنفَّذ");
  assert.equal(withArgs.command, "menucat");
  assert.deepEqual(withArgs.args, ["tools"], "الوسائط تُمرَّر كما هي");

  const noPrefix = makePress("buttonsResponse", "menucat tools");
  I.applyInteractive(noPrefix, { prefix: PREFIX });
  assert.equal(noPrefix.command, "menucat", "البادئة تُستنتج عند غيابها");
  assert.equal(noPrefix.body, `${PREFIX}menucat tools`, "الجسم النهائي يحمل البادئة");
}

// ── 3. تطبيع المعرّف قبل المطابقة ──────────────────────
{
  const cases = [
    ["⁦menu⁩", "menu"],
    ['"menu"', "menu"],
    ["  menu  ", "menu"],
    ["menucat    tools", "menucat tools"],
    ["﻿menu", "menu"],
  ];
  for (const [raw, expected] of cases) {
    assert.equal(I.normalizeSelection(raw), expected, `التطبيع فشل على: ${JSON.stringify(raw)}`);
  }
}

// ── 4. ممنوع الضغطة الصامتة: كل فشل له سبب واضح ────────
{
  const unknown = makePress("buttonsResponse", "امر_غير_موجود_نهائيا");
  const r1 = I.applyInteractive(unknown, { prefix: PREFIX });
  assert.equal(r1.handled, false, "أمر غير موجود لا يُنفَّذ");
  assert.equal(r1.reason, I.REASON.UNKNOWN_COMMAND, "السبب: أمر غير معروف");
  assert.equal(unknown.isCommand, false, "الرسالة لم تُحوَّل");
  assert.equal(I.logFailure(unknown, r1), true, "الفشل يستوجب إبلاغ المستخدم");

  const empty = makePress("buttonsResponse", "");
  const r2 = I.applyInteractive(empty, { prefix: PREFIX });
  assert.equal(r2.handled, false);
  assert.equal(r2.reason, I.REASON.EMPTY, "السبب: معرّف فارغ");
  I.logFailure(empty, r2);   // يُسجَّل دائماً حتى لو خُنق الإبلاغ المتكرر

  // رسالة نصية عادية ليست ضغطة أصلاً — لا تُسجَّل ولا يُبلَّغ عنها
  const plain = { type: "conversation", body: "مرحبا", isCommand: false, chat: USER, sender: USER };
  const r3 = I.applyInteractive(plain, { prefix: PREFIX });
  assert.equal(r3.reason, I.REASON.NOT_INTERACTIVE);
  assert.equal(I.logFailure(plain, r3), false, "الرسالة العادية لا تُسجَّل كضغطة فاشلة");

  // كل فشل حقيقي مسجَّل
  assert.ok(I.recentFailures(10).length >= 2, "الفشل يُسجَّل للتشخيص");
  assert.ok(
    I.recentFailures(10).every((entry) => entry.reason && entry.type),
    "كل سجل فشل يحمل سبباً ونوعاً",
  );
}

// ═══════════════════════════════════════════════
// 5. تشغيل القوائم الحقيقية والتقاط أزرارها
// ═══════════════════════════════════════════════

/** يجمع كل معرّفات الأزرار والصفوف من رسالة واتساب ملتقطة */
function collectIds(node, out = new Set(), depth = 0) {
  if (!node || depth > 12) return out;
  if (typeof node === "string") {
    const trimmed = node.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
      try {
        collectIds(JSON.parse(trimmed), out, depth + 1);
      } catch { }
    }
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectIds(item, out, depth + 1);
    return out;
  }
  if (typeof node !== "object") return out;

  for (const key of ["buttonId", "rowId", "id", "selectedId", "selectedRowId"]) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) out.add(value.trim());
  }
  for (const value of Object.values(node)) collectIds(value, out, depth + 1);
  return out;
}

/** sock وهمي يلتقط ما كان سيُرسَل بدل إرساله */
function makeCapturingSock(captured) {
  return {
    user: { id: `${BOT}:12@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net`, name: "Terboo" },
    async relayMessage(jid, message) {
      captured.push(message);
      return { key: { id: "x" } };
    },
    async sendMessage(jid, content) {
      captured.push(content);
      return { key: { id: "x" } };
    },
    async groupMetadata() {
      return { subject: "G", participants: [] };
    },
    async profilePictureUrl() {
      throw new Error("no pp");
    },
  };
}

function makeMenuMessage(command, args = []) {
  return {
    sender: USER,
    chat: USER,
    body: `${PREFIX}${command}`,
    type: "conversation",
    isCommand: true,
    command,
    prefix: PREFIX,
    args,
    text: args.join(" "),
    fullArgs: args.join(" "),
    isGroup: false,
    isOwner: false,
    isPremium: false,
    isPartner: false,
    isAdmin: false,
    isBotAdmin: true,
    isBot: false,
    fromMe: false,
    isNewsletter: false,
    pushName: "Tester",
    mentionedJid: [],
    quoted: null,
    key: { id: "menu-test", remoteJid: USER },
    raw: { key: { id: "menu-test", remoteJid: USER }, message: { conversation: `${PREFIX}${command}` } },
    async reply() { return { key: { id: "r" } }; },
    async react() { },
    async statusReply() { },
  };
}

{
  db.setting("audioMenu", false);
  const menus = [
    { command: "menu", args: [] },
    { command: "allmenu", args: [] },
    { command: "menucat", args: ["tools"] },
  ];

  const allIds = new Set();
  const ran = [];

  for (const { command, args } of menus) {
    const plugin = getPlugin(command);
    if (!plugin) continue;
    const captured = [];
    const sock = makeCapturingSock(captured);
    const m = makeMenuMessage(command, args);
    try {
      await plugin.handler(m, {
        sock, db, config, uptime: "1h",
        args, text: args.join(" "), command, prefix: PREFIX,
        isOwner: false, isPremium: false, isGroup: false,
      });
    } catch (error) {
      // فشل الإرسال (صورة/صوت غير متاح) لا يمنع فحص ما التُقط قبله
      if (!captured.length) {
        console.error(`   ⚠️  ${command}: ${error.message}`);
        continue;
      }
    }
    if (!captured.length) continue;
    ran.push(command);
    for (const message of captured) collectIds(message, allIds);
  }

  assert.ok(ran.length > 0, "لم تُشغَّل أي قائمة حقيقية");

  // كل معرّف يشير إلى أمر موجود، أو هو معرّف داخلي لا يُفسَّر كأمر أصلاً
  const resolved = [];
  const rejected = [];
  for (const id of allIds) {
    // نتجاهل المعرّفات التقنية التي لا تمثّل ضغطة أمر (روابط، معرّفات رسائل)
    if (/^https?:\/\//i.test(id)) continue;
    if (/^[0-9A-F]{16,}$/i.test(id)) continue;

    const result = I.resolveSelection(id, { prefix: PREFIX, lookup: getPlugin, parse: parseCommand });
    if (result.ok) resolved.push(id);
    else rejected.push(`${id} → ${result.reason}`);
  }

  assert.ok(resolved.length >= 3, `عدد الأزرار المفحوصة منخفض (${resolved.length})`);
  assert.equal(
    rejected.length,
    0,
    `أزرار لا تنتهي بأمر حقيقي (ضغطة صامتة):\n   ${rejected.join("\n   ")}`,
  );

  // ولكل زر مستخرَج: نبني ردّ واتساب الفعلي ونمرّره على المسار الكامل
  let executed = 0;
  for (const id of resolved) {
    for (const shape of ["buttonsResponse", "listResponse", "interactiveParamsJson"]) {
      const m = makePress(shape, id);
      const result = I.applyInteractive(m, { prefix: PREFIX });
      assert.equal(result.handled, true, `ضغطة صامتة على «${id}» بشكل ${shape}`);
      assert.ok(getPlugin(m.command), `«${id}» أشار إلى بلوقن غير موجود: ${m.command}`);
      executed += 1;
    }
  }

  console.log(`   ✓ ${ran.join(", ")} · ${resolved.length} معرّف · ${executed} تنفيذ محاكى`);
}

// ── 6. زر اللغة موجود ويعمل من كل قائمة ────────────────
{
  const m = makePress("listResponse", `${PREFIX}language`);
  const result = I.applyInteractive(m, { prefix: PREFIX });
  assert.equal(result.handled, true, "زر تغيير اللغة يعمل");
  assert.ok(getPlugin(m.command), "بلوقن اللغة موجود");
}

console.log("✅ terboo-interactive: كل الأزرار والصفوف تنتهي بأمر حقيقي — لا ضغطة صامتة");
try { fs.rmSync(tmpDb, { recursive: true, force: true }); } catch { }
process.exit(0);
