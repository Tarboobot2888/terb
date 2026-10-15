// اختبار نظام التصميم الموحّد (§33–§36، §47)
//
//  1. طبقة التصميم: الإطارات القديمة ⇒ صفوف «> ◈» وأقسام «❋»، backticks الزخرفة ⇒ تُزال،
//     كتل الكود متعددة الأسطر ولوحات الألعاب لا تُمس.
//  2. المحرّك نفسه (terboo-ui-theme.js) لا يُخرج backticks ولا زخارف قديمة، وصفوفه بشكل «> ◈ الاسم: تيربو».
//  3. حدّ الإرسال الحقيقي (installLocalization): تصميم ⇒ ترجمة ⇒ رموز لغة المستلم؛ الرد الخام لا يُمس.
//  4. بلوقنات حقيقية عبر messageHandler الحقيقي (مساعدة، بحث، تحميل، ألعاب، RPG، ذكاء،
//     ملف شخصي، صلاحيات مالك/مجموعة/مميز…) بالعربية والإنجليزية: صفر مخالفات تصميم في كل رد.
//  5. الفحص الثابت الصارم: design = 0.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const { designText, designViolations, themeGlyphs } = await import("../src/lib/terboo-design.js");
const UI = await import("../src/lib/terboo-ui-theme.js");

// ═══ 1. طبقة التصميم ═══
const legacy = [
  "╭┈┈⬡「 📋 *القوالب* 」",
  "┃ ◦ `.menu` القائمة",
  "┃ ◦ الاسم: `تيربو`",
  "╰┈┈┈┈┈┈┈┈⬡",
  "",
  "━━━━━━━━━━━━",
  "➤ *الحالة:* ```نشط```",
].join("\n");
assert.equal(designText(legacy), [
  "❋ 📋 *القوالب*",
  "> ◈ .menu القائمة",
  "> ◈ الاسم: تيربو",
  "",
  "┄┄┄┄┄┄┄┄┄┄┄┄┄┄",
  "> ◈ *الحالة:* نشط",
].join("\n"));
assert.equal(designText("╭─── 🎯 *تحدي* ───╮\n│\n│  اقفز\n│\n╰─────────────╯"), "❋ 🎯 *تحدي*\n\n> ◈ اقفز");
assert.equal(designText("💍 ════『 زوجاتك 』════ 💍"), "*❋ 💍 زوجاتك*");
assert.equal(designText("═══ المشرفين ═══"), "*❋ المشرفين*");
assert.equal(designText("├──〔 الوسائط العامة 〕\n│ صورة 1"), "*❋ الوسائط العامة*\n> ◈ صورة 1");
// كتلة كود حقيقية تبقى حرفياً، والقيمة المفردة تُنظَّف
assert.equal(designText("```\nconst a = `x`;\n```\nنص `قيمة`"), "```\nconst a = `x`;\n```\nنص قيمة");
// لوحة لعبة: محتوى وظيفي لا يُمس
const board = "┌───┬───┬───┐\n│ ❌ │ ⭕ │ 3 │\n└───┴───┴───┘";
assert.equal(designText(board), board);
assert.deepEqual(designViolations(board), []);
// نص المحرّك الحديث لا يتغيّر
const modern = "✧ *العنوان*\n┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n> ◈ الاسم: تيربو\n*❋ قسم*";
assert.equal(designText(modern), modern);
assert.deepEqual(designViolations(designText(legacy)), []);
assert.deepEqual(designViolations(legacy).sort(), ["backtick", "legacy-glyph"]);
// رموز لغة المستلم بعد الترجمة
assert.equal(themeGlyphs(modern, "en"), "◆ *العنوان*\n────────────────\n> › الاسم: تيربو\n*▸ قسم*");

// ═══ 2. المحرّك: بلا backticks، والصف بالشكل المطلوب ═══
assert.equal(UI.row("الاسم", "تيربو"), "> ◈ الاسم: تيربو");
assert.equal(UI.row("الحالة", "متصل"), "> ◈ الحالة: متصل");
assert.match(UI.row("الأوامر", 1200), /^> ◈ الأوامر: ⁦1200⁩$/);
for (const lang of ["ar", "en", "es"]) {
  const samples = [
    UI.card({ title: "Terboo", subtitle: "sub", blocks: [[UI.row("A", "v1.0"), UI.command("menu", "desc", { lang, prefix: "." }), UI.status("S", "ok", { lang, ok: true })]], footer: "f", lang }),
    UI.header("H", { lang, subtitle: "s" }), UI.menuItem("x", "y", { lang, prefix: "." }), UI.code("one-line"), UI.label("L", lang),
    UI.infoCard("i", ["a", "b"], { lang }), UI.errorCard("e", "x", { lang }), UI.successCard("s", "x", { lang }),
    UI.warningCard("w", "x", { lang }), UI.profile("p", [["k", "v"]], { lang }), UI.commandCard("c", ["a", "b"], ".", { lang }),
    UI.registrationCard({ title: "r", step: 1, total: 3, stepLabel: "s", lang }),
  ];
  for (const text of samples) assert.deepEqual(designViolations(text), [], `${lang}: المحرّك أخرج زخرفة قديمة: ${text}`);
}
assert.ok(UI.code("a\nb").startsWith("```\n"), "الكود متعدد الأسطر يبقى كتلة كود حقيقية");

// ═══ 3. حدّ الإرسال الحقيقي ═══
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-design-"));
const BOT = "201111111119";
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
db.setting("audioMenu", false);
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { installLocalization, markRaw } = await import("../src/lib/terboo-i18n/runtime.js");

const out = [];
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net`, name: "Terboo" },
  async relayMessage(jid, message) { out.push({ jid, message }); return {}; },
  async sendMessage(jid, content) { out.push({ jid, content }); return { key: { id: `S${out.length}` } }; },
  async sendPresenceUpdate() { },
  async readMessages() { },
  async groupMetadata() { return { id: "g@g.us", subject: "G", participants: [] }; },
  async profilePictureUrl() { throw new Error("no pp"); },
  waUploadToServer: async () => ({}),
};
installLocalization(sock, { getDatabase });
const EN = "201700000001@s.whatsapp.net";
db.setUser(EN, { isRegistered: true, regName: "Tester", language: "en" });
await sock.sendMessage(EN, { text: "╭┈┈⬡「 📋 *معلومات* 」\n┃ ◦ الاسم: `تيربو`\n╰┈┈┈┈┈┈┈┈⬡" });
const boundary = out.at(-1).content.text;
assert.deepEqual(designViolations(boundary), [], `حدّ الإرسال ترك زخرفة: ${boundary}`);
assert.match(boundary, /^▸ 📋 \*/m, "القسم برمز الإنجليزية");
assert.match(boundary, /^> › /m, "الصف برمز الإنجليزية");
const rawReply = "هذا `كود` من رد الذكاء ┃";
await sock.sendMessage(EN, { text: markRaw(rawReply) });
assert.equal(out.at(-1).content.text, rawReply, "الرد الخام لا يُعاد تصميمه");
await sock.sendMessage(EN, { text: board });
assert.equal(out.at(-1).content.text, board, "لوحة اللعبة تمر كما هي");

// ═══ 4. بلوقنات حقيقية عبر messageHandler ═══
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");

// ردود محلية حتمية بلا وسائط: مساعدة/استخدام، بحث، تحميل، ألعاب، RPG، ذكاء، ملف شخصي، معلومات،
// ورسائل الصلاحيات (مالك فقط · مجموعات فقط · مميز فقط)
const COMMANDS = {
  help: ["2شات", "ai", "اسأل", "بحث", "ايلون", "رمز_QR", "الايت_موشن", "2اقتباس_واتساب"],
  search: ["apk", "playch", "ابل", "بحث_روبلوكس", "تجسس_انستغرام", "تجسس_بنترست", "تجسس_تويتر"],
  download: ["aio", "happydl", "بكسل_درين", "تحميل"],
  canvas: ["bratlocal", "ميوزك_وهمي", "بكسل", "glitchtext", "فلتر", "2انمي_برات", "attp2", "bratbahlil"],
  game: ["الأبراج", "تحدي", "تحقق_الأناقة", "برجك", "تفسير_الأحلام", "توافق_الأسماء"],
  rpg: ["أسبوعي", "استشفاء", "استهلاك", "معلومات_العشيرة", "buyenergi", "buyfitur"],
  profile: ["birthday", "المتصدرين", "ايقاف_البوت_الفرعي"],
  info: ["شخصية_بلو_ارشيف", "مميزات_الشريك", "قرآن_صوتي", "قرآن_نصي", "قرآني", "موسيقى", "تفقد"],
  permission: ["انمي_تلقائي", "اعتراف", "3d"],
};
const EN_SAMPLE = new Set(["ai", "بحث", "apk", "تحميل", "glitchtext", "الأبراج", "استهلاك", "buyenergi", "birthday", "مميزات_الشريك", "قرآن_نصي", "انمي_تلقائي", "اعتراف", "3d", "رمز_QR", "aio"]);

let seq = 0;
async function run(command, lang) {
  const user = `2016${lang === "en" ? "71" : "70"}${String(++seq).padStart(6, "0")}@s.whatsapp.net`;
  db.setUser(user, { isRegistered: true, regName: "مختبر", language: lang });
  const before = out.length;
  const raw = { key: { remoteJid: user, fromMe: false, id: `DESIGN${seq}ABCDEF` }, message: { conversation: `.${command}` }, pushName: "مختبر", messageTimestamp: Math.floor(Date.now() / 1000) };
  await Promise.race([messageHandler(raw, sock), new Promise((resolve) => setTimeout(resolve, 4000))]);
  return out.slice(before).map((row) => row.content?.text || row.content?.caption || "").filter(Boolean);
}

let checked = 0;
const byCategory = {};
for (const [category, list] of Object.entries(COMMANDS)) {
  for (const command of list) {
    for (const lang of EN_SAMPLE.has(command) ? ["ar", "en"] : ["ar"]) {
      const texts = await run(command, lang);
      assert.ok(texts.length > 0, `${command} (${lang}): لم يرسل أي رد`);
      for (const text of texts) {
        assert.deepEqual(designViolations(text), [], `${command} (${lang}) خرج بتصميم قديم:\n${text}`);
        if (lang === "en") assert.ok(!/^> ◈ /m.test(text), `${command} (en): صف برمز عربي:\n${text}`);
        checked += 1;
      }
      byCategory[category] = (byCategory[category] || 0) + texts.length;
    }
  }
}
assert.ok(checked >= 60, `عدد الردود المفحوصة قليل: ${checked}`);

// ═══ 5. الفحص الثابت الصارم ═══
const audit = execFileSync(process.execPath, ["tools/terboo-audit.mjs", "--strict"], { encoding: "utf8" });
assert.match(audit, /✅ design\s+0/, "Strict Design Audit يجب أن يكون صفراً");

console.log(`✅ terboo-design: طبقة التصميم + المحرّك + حدّ الإرسال + ${checked} رداً حقيقياً من ${Object.values(COMMANDS).flat().length} بلوقن (${Object.entries(byCategory).map(([k, v]) => `${k}:${v}`).join(" · ")}) بلا backticks ولا زخارف قديمة، وdesign audit = 0`);
process.exit(0);
