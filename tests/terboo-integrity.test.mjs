// اختبار سلامة المشروع - Bot Terboo
// يغطي: استيراد كل ملفات الـcore بلا أخطاء، تحميل كل البلوقنات،
// سلامة مفاتيح config، سلامة حقول قاعدة البيانات، ومعرّفات أزرار القوائم.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });

// لا توجد أعطال معروفة مسموح بها:
//  • البلوقنان اللذان لم يُحمَّلا منذ النسخة الأصلية (تشويش، أبيضوأسود) أُصلحا.
//  • ملفات الاختبار الثلاثة التي كانت داخل src/lib نُقلت إلى tests/ وتعمل.

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-integrity-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmpDb);
const db = getDatabase();

// ── 1. استيراد كل ملفات src/lib بلا استثناءات ──────────
const libDir = path.join(process.cwd(), "src", "lib");
const libFiles = fs
  .readdirSync(libDir)
  .filter((f) => f.endsWith(".js"));
const importFailures = [];
for (const file of libFiles) {
  try {
    await import(path.join(libDir, file));
  } catch (error) {
    importFailures.push(`${file}: ${error.message}`);
  }
}
assert.equal(
  importFailures.length,
  0,
  `فشل استيراد ملفات core:\n${importFailures.join("\n")}`,
);

// ── 2. ملفات النواة تُستورد بلا انهيار ─────────────────
for (const core of ["../config.js", "../src/handler.js", "../src/connection.js", "../case/terboo.js"]) {
  await import(core);
}

// ── 3. تحميل كل البلوقنات ──────────────────────────────
const { loadPlugins, pluginStore, getPlugin } = await import("../src/lib/terboo-plugins.js");
const loaded = await loadPlugins(path.join(process.cwd(), "plugins"));
// كل ملف بلوقن يجب أن يُحمَّل — لا بلوقن معطّل مسموح
const pluginFiles = [];
(function walkPlugins(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkPlugins(full);
    else if (entry.name.endsWith(".js")) pluginFiles.push(full);
  }
})(path.join(process.cwd(), "plugins"));
assert.equal(loaded, pluginFiles.length, `بلوقنات لم تُحمَّل: ${pluginFiles.length - loaded}`);
assert.ok(pluginStore.commands.size > 1000, `عدد الأوامر منخفض: ${pluginStore.commands.size}`);
assert.ok(pluginStore.categories.size >= 30, `عدد الفئات منخفض: ${pluginStore.categories.size}`);

// ── 4. الأوامر الأساسية موجودة بمعرّفاتها الأصلية ──────
const CORE_COMMANDS = [
  "menu", "help", "allmenu", "menucat", "owner", "rules",
  "daftar", "register", "unreg", "bataldaftar",
  "kick", "add", "promote", "demote",
  "profil", "stats", "language", "ذاكرة", "memory", "تحكم",
];
for (const name of CORE_COMMANDS) {
  assert.ok(getPlugin(name), `الأمر المطلوب مفقود: ${name}`);
}

// ── 5. معرّفات الأزرار القديمة ما زالت تعمل فعلياً (لا فحص نصّي للمصدر) ──
// رسائل القوائم القديمة باقية في محادثات المستخدمين؛ ضغطها اليوم يجب أن يصل
// لنفس البلوقن عبر المسار الحقيقي، حتى بعد نقل الصفوف إلى سجل القوائم.
{
  const { resolveSelection } = await import("../src/lib/terboo-interactive.js");
  const LEGACY_IDS = {
    ".menu": "menu", ".owner": "owner", ".rules": "القوانين", ".menucat tools": "فئة",
    ".فئة tools": "فئة", ".language": "لغة", ".allmenu": "الأوامر", ".help": "menu",
  };
  for (const [id, plugin] of Object.entries(LEGACY_IDS)) {
    const result = resolveSelection(id, { prefix: "." });
    assert.equal(result.ok, true, `معرّف زر قديم لم يعد يعمل: ${id} → ${result.reason}`);
    assert.equal([].concat(getPlugin(result.command).config.name)[0], plugin, `${id} يصل لبلوقن آخر`);
  }
}

// ── 6. مفاتيح config الحساسة سليمة ─────────────────────
const config = (await import("../config.js")).default;
assert.ok(config.APIkey && Object.keys(config.APIkey).length >= 11, "مفاتيح API ناقصة");
for (const [name, value] of Object.entries(config.APIkey)) {
  assert.equal(typeof value, "string", `مفتاح API غير نصي: ${name}`);
}
for (const key of ["bot", "owner", "session", "saluran", "sticker", "registration", "localization", "messages", "APIkey"]) {
  assert.ok(config[key], `قسم config مفقود: ${key}`);
}
assert.equal(config.bot.name, "Bot Terboo", "اسم البوت");
assert.equal(config.bot.developer, "Terboo", "اسم المطور");
assert.equal(config.owner.number[0], "201225655220", "رقم المالك");
assert.equal(config.session.pairingNumber, "2348093093240", "رقم البوت");
assert.equal(config.saluran.id, "120363418715609508@newsletter", "معرّف القناة");
assert.deepEqual(config.localization.supported, ["ar", "en", "es"], "اللغات المدعومة");

// ── 7. حقول قاعدة البيانات محفوظة + حقل اللغة ──────────
const jid = "201000000123@s.whatsapp.net";
db.setUser(jid, { language: "en" });
const user = db.getUser(jid);
for (const field of [
  "jid", "name", "number", "energi", "isPremium", "isBanned", "exp", "level",
  "koin", "saldo", "unlockedFeatures", "registeredAt", "registrationCount",
  "hasClaimedRegisterReward", "cooldowns", "clanId", "isRegistered",
  "regName", "regAge", "regGender", "rpg", "inventory", "access",
]) {
  assert.ok(field in user, `حقل مستخدم مفقود: ${field}`);
}
assert.equal(user.language, "en", "حقل اللغة يُحفظ");

// تغيير اللغة لا يمس التسجيل
db.setUser(jid, { isRegistered: true, regName: "Tester", koin: 500 });
db.setUser(jid, { language: "es" });
const after = db.getUser(jid);
assert.equal(after.isRegistered, true, "تغيير اللغة لا يلغي التسجيل");
assert.equal(after.regName, "Tester", "بيانات التسجيل محفوظة");
assert.equal(after.koin, 500, "الرصيد محفوظ");
assert.equal(after.language, "es", "اللغة الجديدة محفوظة");

// ── 8. بوابة الانضمام لا تعترض مستخدماً مكتملاً ────────
const onboarding = await import("../src/lib/terboo-onboarding.js");
const sock = { user: { id: "2348093093240:1@s.whatsapp.net", jid: "2348093093240@s.whatsapp.net" }, async relayMessage() {}, async sendMessage() {} };
const done = {
  sender: jid, chat: jid, body: ".menu", type: "conversation", isCommand: true,
  command: "menu", prefix: ".", args: [], isGroup: false, isOwner: false,
  isPremium: false, isPartner: false, isBot: false, fromMe: false,
  isNewsletter: false, pushName: "T", async reply() {}, async react() {},
};
assert.equal(await onboarding.handleOnboarding(done, sock, db), false, "مستخدم مكتمل لا يُعترض");

// ── 8.ب وحدات النواة الجديدة موجودة ومتماسكة ──────────
const CORE_MODULES = {
  "../src/lib/terboo-ai-core.js": ["runKernel", "DECISIONS", "shouldEngage", "isForbiddenRequest"],
  "../src/lib/terboo-ai-memory.js": ["scopeOf", "recordTurn", "recall", "forget", "redact"],
  "../src/lib/terboo-ai-context.js": ["buildContextPackage", "toHistory", "resolveReference"],
  "../src/lib/terboo-command-index.js": ["buildIndex", "rank", "shortlist", "findEntry"],
  "../src/lib/terboo-ai-providers.js": ["ask", "loadProviders", "providerNames"],
  "../src/lib/terboo-ai-tools.js": ["resolveSafe", "plan", "approve", "apply", "rollback"],
  "../src/lib/terboo-interactive.js": ["applyInteractive", "resolveSelection", "REASON"],
};
for (const [file, names] of Object.entries(CORE_MODULES)) {
  const mod = await import(file);
  for (const name of names) {
    assert.ok(name in mod, `${file}: التصدير مفقود ${name}`);
  }
}

// واجهة المساعد القديمة ما زالت كما هي (Adapter فوق النواة)
const assistant = await import("../src/lib/terboo-ai-assistant.js");
for (const name of [
  "handleAiAssistant", "shouldEngage", "rankCommands", "buildCommandCatalog",
  "invalidateCatalog", "isCommandAvailable", "cleanRequestText", "parseModelJson",
  "buildSystemInstruction", "rewriteAsCommand", "needsTarget", "resolveTarget", "preflight",
]) {
  assert.equal(typeof assistant[name], "function", `واجهة المساعد فقدت: ${name}`);
}

// النواة تستبدل العدد الثابت الصغير بفهرس شامل
const commandIndex = await import("../src/lib/terboo-command-index.js");
const indexed = commandIndex.indexStats();
assert.ok(indexed.commands > 800, `الفهرس الشامل ناقص: ${indexed.commands}`);

// واجهة الزخرفة المركزية كاملة (§18)
const UI = await import("../src/lib/terboo-ui-theme.js");
for (const fn of [
  "header", "section", "row", "quote", "code", "label", "divider",
  "success", "error", "warning", "footer", "menuItem", "profile", "status",
]) {
  assert.equal(typeof UI[fn], "function", `واجهة الزخرفة تفتقد: ${fn}`);
}

// ── 9. ملفات الاختبار المنقولة من src/lib موجودة في tests/ ──
for (const file of ["agent-health-memory", "agent-plugin", "agent-control"]) {
  assert.ok(fs.existsSync(path.join(process.cwd(), "tests", `${file}.test.mjs`)), `ملف الاختبار المنقول مفقود: ${file}`);
}

console.log(`✅ terboo-integrity: ${loaded} بلوقن · ${pluginStore.commands.size} أمر · ${pluginStore.aliases.size} مرادف · ${libFiles.length} ملف core`);
try { fs.rmSync(tmpDb, { recursive: true, force: true }); } catch {}
process.exit(0);
