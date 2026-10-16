// اختبار الهوية النهائية Bot Terboo (§4 §5 §38 §41 §45 §61):
// الاسم ثابت في كل اللغات، الأشكال الخاطئة تُصحَّح في كل رد نموذج،
// مرادفات التوافق القديمة تعمل للاستدعاء ولا تُعرض، والترحيل لا يُضيع بيانات.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const ROOT = process.cwd();
const brand = await import("../src/lib/terboo-brand.js");
const config = (await import("../config.js")).default;

// ── 1. الهوية من config والاحتياط ──
assert.equal(config.bot.name, "Bot Terboo");
// V6 (Phase 1): الإصدار رُفع عمداً إلى 6.0 — الاسم والمطوّر ثابتان
assert.equal(config.bot.version, "6.0");
assert.equal(config.bot.developer, "Terboo");
assert.equal(brand.botName(), "Bot Terboo");
assert.equal(brand.FALLBACK.botName, "Bot Terboo");
assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).name, "bot-terboo");
// config.js قديم باسم «Bot Terboo v4.0» يُعرض «Bot Terboo»؛ الاسم الذي يختاره المالك يبقى كما هو
assert.equal(brand.displayName("Bot Terboo v4.0"), "Bot Terboo");
assert.equal(brand.displayName("bot terboo v4"), "Bot Terboo");
assert.equal(brand.displayName("Terboo Pro"), "Terboo Pro");
const legacy = brand.normalizeLegacyConfig({ bot: { name: "Bot Terboo v4.0" }, saluran: { name: "Bot Terboo v4.0" }, sticker: { packname: "Bot Terboo v4.0" } });
assert.deepEqual([legacy.bot.name, legacy.saluran.name, legacy.sticker.packname], ["Bot Terboo", "Bot Terboo", "Bot Terboo"]);

// ── 2. قفل الاسم: العربية تيربو، الإنجليزية والإسبانية Terboo حرفياً ──
assert.equal(brand.brandName("ar"), "تيربو");
assert.equal(brand.brandName("ar", { full: true }), "بوت تيربو");
assert.equal(brand.brandName("en"), "Terboo");
assert.equal(brand.brandName("es"), "Terboo");
assert.equal(brand.brandName("es", { full: true }), "Bot Terboo");

// ── 3. تصحيح كل شكل خاطئ في ردود النماذج ──
const fixed = brand.enforceBrand("أنا طربوش، وأحياناً تاربو أو تاربـو. I am Tarboo, Bot Tarboo, MaroBot, Maro-AI.");
assert.ok(!/طربوش|تاربو|تاربـو|Tarboo|MaroBot|Maro-AI/.test(fixed), `بقي اسم خاطئ: ${fixed}`);
assert.ok(fixed.includes("تيربو") && fixed.includes("Terboo"));
// لا يمس كلمات عربية/إنجليزية عادية
assert.equal(brand.enforceBrand("التربوية مهمة والـturbo سريع"), "التربوية مهمة والـturbo سريع");

// ── 4. تعليمة القفل تذهب لكل موجّه ذكاء ──
const prompt = brand.brandLockPrompt("ar");
assert.ok(prompt.includes('"Terboo"') && prompt.includes('"تيربو"') && prompt.includes("أنا تيربو"));
assert.ok(/Do not re-introduce yourself/.test(prompt), "يجب منع إعادة التعريف بالنفس (§41)");
const coreSrc = fs.readFileSync(path.join(ROOT, "src/lib/terboo-ai-core.js"), "utf8");
assert.ok(coreSrc.includes("brand.brandLockPrompt(language)"), "النواة لا تحقن قفل الهوية");
const providersSrc = fs.readFileSync(path.join(ROOT, "src/lib/terboo-ai-providers.js"), "utf8");
assert.ok(/enforceBrand\((?:routed\.)?text/.test(providersSrc), "مخرجات المزوّدات لا تمر على قفل الهوية");

// ── 5. ask() يصحّح رد أي مزوّد فعلياً (مزوّد محقون) ──
const { ask } = await import("../src/lib/terboo-ai-providers.js");
const answer = await ask({ message: "من أنت؟", instruction: "", language: "ar", history: [] }, null, {
  providers: { GeminiAPI: async () => ({ text: "أنا طربوش، مساعد Bot Tarboo" }) },
  throwOnError: true,
});
assert.ok(answer?.text, "لم يرجع المزوّد المحقون رداً");
assert.ok(!/طربوش|Tarboo/.test(answer.text) && /تيربو/.test(answer.text), `ask لم يصحّح الاسم: ${answer.text}`);

// ── 6. مرادفات التوافق: تُقبل ولا تُعرض ──
assert.equal(brand.isLegacyAlias("tarbooai"), true);
assert.equal(brand.isLegacyAlias("مارو"), true);
assert.equal(brand.isLegacyAlias("terboo"), false);
assert.deepEqual(brand.visibleAliases(["ai", "tarboo", "تاربوai", "ذكاء", "terbooai"]), ["ai", "ذكاء", "terbooai"]);
const identityPlugin = fs.readFileSync(path.join(ROOT, "plugins/ai/تيربو.js"), "utf8");
for (const alias of ["تاربو", "tarboo", "tarbooai", "تاربوai", "مارو", "maro"]) {
  assert.ok(identityPlugin.includes(`"${alias}"`), `مرادف التوافق ${alias} حُذف من تيربو.js`);
}

// ── 7. ترحيل الذاكرة والأصول من أسماء الإصدار السابق ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-brand-"));
try {
  const memDir = path.join(tmp, "memory");
  fs.mkdirSync(memDir);
  fs.writeFileSync(path.join(memDir, "tarboo-memory.json"), JSON.stringify({ version: 2, private: { "201000000001": { shortTerm: [] } }, groups: {} }));
  const { initMemory } = await import("../src/lib/terboo-ai-memory.js");
  const store = initMemory(memDir);
  assert.ok(fs.existsSync(path.join(memDir, "terboo-memory.json")), "لم يُنقل ملف الذاكرة");
  assert.ok(!fs.existsSync(path.join(memDir, "tarboo-memory.json")));
  assert.ok(store.data.private["201000000001"], "ضاعت ذاكرة مستخدم أثناء الترحيل");

  const assetDir = path.join(tmp, "assets");
  fs.mkdirSync(assetDir);
  fs.writeFileSync(path.join(assetDir, "tarboo-daftar.png"), "IMG");
  const { migrateLegacyAssets } = await import("../src/lib/terboo-asset-manager.js");
  const cwd = process.cwd();
  process.chdir(tmp);
  const assets = { "terboo-daftar": "./assets/terboo-daftar.png", "tarboo-extra": "./assets/tarboo-extra.png" };
  const result = migrateLegacyAssets(assets);
  process.chdir(cwd);
  assert.ok(fs.existsSync(path.join(assetDir, "terboo-daftar.png")), "لم يُنقل ملف الأصل");
  assert.equal(assets["terboo-extra"], "./assets/terboo-extra.png");
  assert.equal(result.files.length, 1);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
  const { initMemory } = await import("../src/lib/terboo-ai-memory.js");
  initMemory(path.join(os.tmpdir(), "terboo-brand-reset"));
}

// ── 8. لا ملف محلي باسم سابق، والحسابات الخارجية الحقيقية لم تُمس ──
const legacyFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "temp", "tmp"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (/tarboo|تاربو|^maro-/i.test(entry.name)) legacyFiles.push(path.relative(ROOT, full));
    if (entry.isDirectory()) walk(full);
  }
})(ROOT);
assert.deepEqual(legacyFiles, [], `ملفات باسم سابق: ${legacyFiles.join(", ")}`);
assert.equal(config.socialLinks.instagram, "https://www.instagram.com/tarboo455");
assert.equal(config.socialLinks.github, "https://github.com/Tarboobot2888");
assert.equal(config.socialLinks.gmail, "mahmoudtarboo09@gmail.com");

console.log("✅ terboo-brand-lock: الهوية Terboo/تيربو ثابتة، الأشكال الخاطئة تُصحَّح، المرادفات القديمة مخفية، الترحيل يحفظ البيانات");
process.exit(0);
