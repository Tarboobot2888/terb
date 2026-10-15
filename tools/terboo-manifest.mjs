// ═══════════════════════════════════════════════
// 📋 Bot Terboo — Project Manifest
// ───────────────────────────────────────────────
// يبني بصمة كاملة للمشروع: البلوقنات، الأوامر، المرادفات، الفئات،
// الـexports، مفاتيح config، حقول قاعدة البيانات، وملفات case.
// يُستخدم قبل/بعد أي تعديل لإثبات عدم فقد أي وظيفة.
//
// الاستخدام:
//   node tools/terboo-manifest.mjs > manifest-before.json
//   node tools/terboo-manifest.mjs --compare manifest-before.json
//   node tools/terboo-manifest.mjs --compare manifest-before.json --renames tools/terboo-rename-map.json
// ═══════════════════════════════════════════════

import fs from "fs";
import os from "os";
import path from "path";

const args = process.argv.slice(2);
const compareWith = args.includes("--compare") ? args[args.indexOf("--compare") + 1] : null;
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const renamesFile = args.includes("--renames") ? args[args.indexOf("--renames") + 1] : null;

// ── قاعدة بيانات مؤقتة حتى لا نلمس بيانات التشغيل ──
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-manifest-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmpDb);

const { loadPlugins, pluginStore } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));

const config = (await import("../config.js")).default;

// ── الأوامر والمرادفات ──────────────────────────
const commands = [...pluginStore.commands.keys()].sort();
const aliases = [...pluginStore.aliases.keys()].sort();
const categories = [...pluginStore.categories.keys()].sort();

// ── الأوامر مع بياناتها الكاملة ─────────────────
const commandDetails = {};
for (const [name, plugin] of pluginStore.commands.entries()) {
  const cfg = plugin?.config || {};
  commandDetails[name] = {
    category: cfg.category || "uncategorized",
    alias: (Array.isArray(cfg.alias) ? cfg.alias : cfg.alias ? [cfg.alias] : []).slice().sort(),
    isOwner: Boolean(cfg.isOwner),
    isPremium: Boolean(cfg.isPremium),
    isAdmin: Boolean(cfg.isAdmin),
    isBotAdmin: Boolean(cfg.isBotAdmin),
    isGroup: Boolean(cfg.isGroup),
    isPrivate: Boolean(cfg.isPrivate),
    cooldown: cfg.cooldown ?? null,
    energi: cfg.energi ?? null,
    skipRegistration: Boolean(cfg.skipRegistration),
    isEnabled: cfg.isEnabled !== false,
  };
}

// ── نظام case ───────────────────────────────────
let caseCommands = [];
try {
  const caseModule = await import("../case/terboo.js");
  if (typeof caseModule.getCasesByCategory === "function") {
    const byCat = caseModule.getCasesByCategory();
    caseCommands = Object.values(byCat).flat().sort();
  }
} catch (error) {
  // البيان يكتمل بدون أوامر case، لكن السبب يُطبع (لا بيان ناقص بصمت)
  console.warn(`⚠️ manifest: case/terboo.js تعذّر تحميله (${error?.message || error}) — caseCommands فارغة`);
}

// ── مفاتيح config (الأسماء فقط، لا القيم) ───────
function configShape(value, prefix = "", out = [], depth = 0) {
  if (depth > 3 || value === null || typeof value !== "object") return out;
  for (const key of Object.keys(value).sort()) {
    const full = prefix ? `${prefix}.${key}` : key;
    out.push(full);
    const child = value[key];
    if (child && typeof child === "object" && !Array.isArray(child) && typeof child !== "function") {
      configShape(child, full, out, depth + 1);
    }
  }
  return out;
}
const configKeys = configShape(config).filter((k) => !k.startsWith("APIkey."));
const apiKeyNames = Object.keys(config.APIkey || {}).sort();
// حالة كل مفتاح فقط (مضبوط/فارغ) — لا طول ولا أحرف من القيمة؛ القيم تأتي من البيئة (.env)
const apiKeyFingerprints = {};
for (const name of apiKeyNames) {
  apiKeyFingerprints[name] = String(config.APIkey[name] ?? "") ? "set" : "unset";
}

// ── حقول مستخدم قاعدة البيانات ──────────────────
const db = getDatabase();
const sampleJid = "100000000000@s.whatsapp.net";
db.setUser(sampleJid, {});
const userFields = Object.keys(db.getUser(sampleJid) || {}).sort();

// ── exports لكل ملف core و plugin ───────────────
function listExports(file) {
  // الملفات من walk() نفسها: قراءة فاشلة خطأ حقيقي يُرمى (لا قائمة فارغة صامتة)
  const src = fs.readFileSync(file, "utf8");
  const names = new Set();
  for (const match of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    // تعليقات داخل كتلة التصدير («// التوافق الخلفي») ليست أسماء
    const body = match[1].replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const part of body.split(",")) {
      const name = part.split(" as ").pop().trim();
      if (name) names.add(name);
    }
  }
  for (const match of src.matchAll(/export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z0-9_$]+)/g)) {
    names.add(match[1]);
  }
  if (/export\s+default/.test(src)) names.add("default");
  return [...names].sort();
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "database", "session", "tmp", "temp"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const projectFiles = walk(process.cwd()).map((f) => path.relative(process.cwd(), f)).sort();
const exportsMap = {};
for (const file of projectFiles) {
  const names = listExports(file);
  if (names.length) exportsMap[file] = names;
}

// ── السكرابرات وأدوات الذكاء والقوائم (§60) ─────
const scraperRegistry = await import("../src/lib/terboo-scraper-registry.js");
const menusRegistry = await import("../src/lib/terboo-menus.js");
const scrapers = projectFiles.filter((file) => /^src\/scraper\/[^/]+\.js$/.test(file)).sort();
const scraperAudit = await scraperRegistry.auditRegistry();
const aiTools = Object.keys(scraperRegistry.CATALOG).sort();
const menus = Object.keys(menusRegistry.MENUS).sort();
const menuItems = Object.keys(menusRegistry.ITEMS).sort();

// ── الاستيرادات الثابتة والديناميكية (ومسارها يُحلّ فعلاً) ──
const RESOLVE_EXT = ["", ".js", ".mjs", ".cjs", ".json", "/index.js"];
function importsOf(file) {
  const src = fs.readFileSync(path.join(process.cwd(), file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const statics = [...src.matchAll(/^\s*(?:import|export)\s[^;]*?from\s*["'`]([^"'`]+)["'`]|^\s*import\s*["'`]([^"'`]+)["'`]/gm)].map((m) => m[1] || m[2]);
  const dynamics = [...src.matchAll(/\bimport\(\s*["'`]([^"'`$]+)["'`]\s*\)/g)].map((m) => m[1]);
  return { statics: [...new Set(statics)], dynamics: [...new Set(dynamics)] };
}
function resolves(file, spec) {
  if (!spec.startsWith(".")) {
    if (spec.startsWith("node:")) return true;
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    try { return fs.existsSync(path.join(process.cwd(), "node_modules", name)) || process.binding("natives")[name] !== undefined; } catch { return fs.existsSync(path.join(process.cwd(), "node_modules", name)); }
  }
  const base = path.resolve(path.dirname(path.join(process.cwd(), file)), spec);
  return RESOLVE_EXT.some((ext) => fs.existsSync(base + ext) && fs.statSync(base + ext).isFile());
}
const importGraph = {};
const brokenImports = [];
for (const file of projectFiles) {
  const { statics, dynamics } = importsOf(file);
  if (statics.length || dynamics.length) importGraph[file] = { static: statics, dynamic: dynamics };
  for (const spec of [...statics, ...dynamics]) if (!resolves(file, spec)) brokenImports.push(`${file} -> ${spec}`);
}

// ── أنظمة الذكاء والمزوّدات والأدوات والمرسلات والمجدولات ──
const libFiles = projectFiles.filter((file) => /^src\/lib\//.test(file));
const aiSystems = libFiles.filter((file) => /terboo-(ai|agent|natural-ai|auto-ai|nvidia-ai|multimodal|intent|tool-registry|scraper-registry|task)/.test(file));
let providers = [];
try { const prov = await import("../src/lib/terboo-ai-providers.js"); providers = Object.keys(prov.PROVIDER_CAPS || {}).sort(); } catch (error) { providers = [`unavailable: ${error.message}`]; }
let toolRegistry = [];
try { const reg = await import("../src/lib/terboo-tool-registry.js"); toolRegistry = (reg.allTools?.() || []).map((tool) => tool.id || tool.name).filter(Boolean).sort(); } catch (error) { toolRegistry = [`unavailable: ${error.message}`]; }
const senderExports = {};
const builderExports = {};
for (const [file, names] of Object.entries(exportsMap)) {
  if (!/^src\//.test(file)) continue;
  const senders = names.filter((name) => /^send[A-Z]|^reply[A-Z]?|^relay|^deliver/.test(name));
  const builders = names.filter((name) => /native|interactive|button|carousel|list(Message|Content)|build[A-Z]/i.test(name));
  if (senders.length) senderExports[file] = senders;
  if (builders.length) builderExports[file] = builders;
}
const schedulers = projectFiles.filter((file) => /setInterval\(|node-cron|cron\.schedule|scheduleJob|registerTaskRunner\(|setTimeout\([^)]*,\s*\d{5,}/.test(fs.readFileSync(path.join(process.cwd(), file), "utf8"))).sort();

// ── الأصول والخطوط والاختبارات وحالة التشغيل والتكاملات ──
function listTree(dir, filter = () => true) {
  const root = path.join(process.cwd(), dir);
  if (!fs.existsSync(root)) return [];
  const out = [];
  const visit = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const full = path.join(d, e.name); if (e.isDirectory()) visit(full); else if (filter(e.name)) out.push({ path: path.relative(process.cwd(), full), bytes: fs.statSync(full).size }); } };
  visit(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
const assets = listTree("assets", (name) => !/\.(ttf|otf|woff2?)$/i.test(name));
const fonts = listTree("assets", (name) => /\.(ttf|otf|woff2?)$/i.test(name)).map((f) => f.path);
const tests = listTree("tests", (name) => /\.m?js$/.test(name)).map((f) => f.path);
const runtimeState = listTree("data").map((f) => f.path).concat(listTree("database").map((f) => f.path));
const INTEGRATION_KEYS = /pterodactyl|panel|virtualizor|vps|linode|digitalocean|cpanel|saluran|channel|otp|sticker|github|cloudflare|nvidia|manus|claude|openai|gemini|groq/i;
const integrations = Object.keys(config).filter((key) => INTEGRATION_KEYS.test(key) || (config[key] && typeof config[key] === "object" && INTEGRATION_KEYS.test(Object.keys(config[key]).join(" ")))).sort();

const manifest = {
  generatedAt: new Date().toISOString(),
  counts: {
    files: projectFiles.length,
    plugins: pluginStore.commands.size,
    commands: commands.length,
    aliases: aliases.length,
    categories: categories.length,
    caseCommands: caseCommands.length,
    configKeys: configKeys.length,
    apiKeys: apiKeyNames.length,
    userFields: userFields.length,
    scrapers: scrapers.length,
    aiTools: aiTools.length,
    menus: menus.length,
    menuItems: menuItems.length,
    importEdges: Object.values(importGraph).reduce((n, g) => n + g.static.length + g.dynamic.length, 0),
    dynamicImports: Object.values(importGraph).reduce((n, g) => n + g.dynamic.length, 0),
    brokenImports: brokenImports.length,
    aiSystems: aiSystems.length,
    providers: providers.length,
    tools: toolRegistry.length,
    schedulers: schedulers.length,
    assets: assets.length,
    fonts: fonts.length,
    tests: tests.length,
  },
  commands,
  aliases,
  categories,
  commandDetails,
  caseCommands,
  configKeys,
  apiKeyNames,
  apiKeyFingerprints,
  userFields,
  files: projectFiles,
  exports: exportsMap,
  scrapers,
  unregisteredScrapers: scraperAudit.unregistered || [],
  aiTools,
  menus,
  menuItems,
  imports: importGraph,
  brokenImports,
  aiSystems,
  providers,
  tools: toolRegistry,
  messageSenders: senderExports,
  interactiveBuilders: builderExports,
  schedulers,
  assets,
  fonts,
  tests,
  runtimeState,
  integrations,
};

// قاعدة البيانات تحفظ عند الخروج: نحذف المجلد المؤقت بعد ذلك (معالجات exit تعمل بترتيب تسجيلها)
process.on("exit", () => fs.rmSync(tmpDb, { recursive: true, force: true }));

// ── المقارنة ────────────────────────────────────
if (compareWith) {
  const before = JSON.parse(fs.readFileSync(compareWith, "utf8"));
  const problems = [];
  const notes = [];

  // مقارنة واعية بإعادة التسمية (§3/§45): ملفات الأسماء القديمة ← terboo-*، مفاتيح assets، أوامر قديمة صارت مرادفات
  const renames = renamesFile ? JSON.parse(fs.readFileSync(renamesFile, "utf8")) : null;
  if (renames) {
    const baseMap = new Map(Object.entries(renames.basenames || {}));
    const assetMap = new Map(Object.entries(renames.assetKeys || {}));
    const mapFile = (file) => renames.files?.[file]
      || (baseMap.has(file.split("/").pop()) ? file.replace(/[^/]+$/, baseMap.get(file.split("/").pop())) : file);
    const mapKey = (key) => renames.configKeys?.[key]
      || (key.startsWith("assets.") && assetMap.has(key.slice(7)) ? `assets.${assetMap.get(key.slice(7))}` : key);
    let renamedFiles = 0;
    before.files = before.files.map((file) => { const next = mapFile(file); if (next !== file) renamedFiles++; return next; });
    before.exports = Object.fromEntries(Object.entries(before.exports || {}).map(([file, names]) => [mapFile(file), names]));
    before.configKeys = before.configKeys.map(mapKey);
    // أمر قديم أُعيدت تسميته يجب أن يبقى مرادفاً للأمر الجديد، بنفس الصلاحيات
    const keptAsAlias = [];
    for (const [oldName, newName] of Object.entries(renames.commands || {})) {
      if (!before.commands.includes(oldName)) continue;
      const now = manifest.commandDetails[newName];
      if (!now) { problems.push(`الأمر المُعاد تسميته غير موجود: ${oldName} → ${newName}`); continue; }
      if (!(now.alias || []).includes(oldName)) problems.push(`الاسم القديم ${oldName} لم يبق مرادفاً لـ ${newName}`);
      before.commands = before.commands.map((c) => (c === oldName ? newName : c));
      if (before.commandDetails?.[oldName]) { before.commandDetails[newName] = before.commandDetails[oldName]; delete before.commandDetails[oldName]; }
      keptAsAlias.push(`${oldName} → ${newName}`);
    }
    notes.push(`إعادة تسمية مطبّقة: ${renamedFiles} ملف، ${keptAsAlias.length} أمر بقي اسمه القديم مرادفاً (${keptAsAlias.join("، ")})`);
  }

  const setDiff = (a, b) => a.filter((x) => !b.includes(x));

  const removedCommands = setDiff(before.commands, manifest.commands);
  const addedCommands = setDiff(manifest.commands, before.commands);
  const removedAliases = setDiff(before.aliases, manifest.aliases);
  const addedAliases = setDiff(manifest.aliases, before.aliases);
  const removedCategories = setDiff(before.categories, manifest.categories);
  const removedConfig = setDiff(before.configKeys, manifest.configKeys);
  const removedApiKeys = setDiff(before.apiKeyNames, manifest.apiKeyNames);
  const removedUserFields = setDiff(before.userFields, manifest.userFields);
  const addedUserFields = setDiff(manifest.userFields, before.userFields);
  const removedCases = setDiff(before.caseCommands, manifest.caseCommands);
  const removedFiles = setDiff(before.files, manifest.files);

  if (removedCommands.length) problems.push(`أوامر مفقودة (${removedCommands.length}): ${removedCommands.join(", ")}`);
  if (removedAliases.length) problems.push(`مرادفات مفقودة (${removedAliases.length}): ${removedAliases.join(", ")}`);
  if (removedCategories.length) problems.push(`فئات مفقودة: ${removedCategories.join(", ")}`);
  if (removedConfig.length) problems.push(`مفاتيح config مفقودة: ${removedConfig.join(", ")}`);
  if (removedApiKeys.length) problems.push(`مفاتيح API مفقودة: ${removedApiKeys.join(", ")}`);
  if (removedUserFields.length) problems.push(`حقول مستخدم مفقودة: ${removedUserFields.join(", ")}`);
  if (removedCases.length) problems.push(`أوامر case مفقودة: ${removedCases.join(", ")}`);
  if (removedFiles.length) problems.push(`ملفات مفقودة (${removedFiles.length}): ${removedFiles.slice(0, 10).join(", ")}`);

  // المفاتيح انتقلت إلى البيئة: غيابها في هذا الجهاز ملاحظة إعداد، لا فقد وظيفة في الكود
  for (const name of manifest.apiKeyNames) {
    if (before.apiKeyFingerprints?.[name] && manifest.apiKeyFingerprints[name] === "unset") {
      notes.push(`مفتاح API غير مضبوط في هذه البيئة (اضبطه في .env): ${name}`);
    }
  }

  for (const [file, names] of Object.entries(before.exports || {})) {
    const current = manifest.exports[file];
    if (!current) { problems.push(`ملف فقد كل exports أو حُذف: ${file}`); continue; }
    const missing = names.filter((n) => !current.includes(n));
    if (missing.length) problems.push(`exports مفقودة في ${file}: ${missing.join(", ")}`);
  }

  for (const [name, detail] of Object.entries(before.commandDetails || {})) {
    const now = manifest.commandDetails[name];
    if (!now) continue;
    for (const key of ["isOwner", "isPremium", "isAdmin", "isBotAdmin", "isGroup", "isPrivate", "skipRegistration"]) {
      if (detail[key] !== now[key]) problems.push(`صلاحية تغيّرت في ${name}.${key}: ${detail[key]} → ${now[key]}`);
    }
    const missingAlias = (detail.alias || []).filter((a) => !(now.alias || []).includes(a));
    if (missingAlias.length) problems.push(`مرادف مفقود في ${name}: ${missingAlias.join(", ")}`);
  }

  // السكرابرات: ملفات src/scraper قبل ⇒ ما زالت موجودة وكلها مسجّلة كأدوات للذكاء
  const beforeScrapers = before.scrapers || (before.files || []).filter((file) => /^src\/scraper\/[^/]+\.js$/.test(file));
  const removedScrapers = setDiff(beforeScrapers, manifest.scrapers);
  if (removedScrapers.length) problems.push(`سكرابرات مفقودة: ${removedScrapers.join(", ")}`);
  if (manifest.unregisteredScrapers.length) problems.push(`سكرابرات غير مسجّلة كأدوات: ${manifest.unregisteredScrapers.join(", ")}`);
  for (const [key, label] of [["aiTools", "أدوات ذكاء"], ["menus", "قوائم"], ["menuItems", "عناصر قوائم"]]) {
    if (!Array.isArray(before[key])) { notes.push(`${label}: ${manifest[key].length} (غير مسجّلة في الـmanifest السابق)`); continue; }
    const removed = setDiff(before[key], manifest[key]);
    if (removed.length) problems.push(`${label} مفقودة: ${removed.join(", ")}`);
  }
  notes.push(`سكرابرات: ${beforeScrapers.length} ← ${manifest.scrapers.length} · كلها مسجّلة كأدوات (${manifest.aiTools.length}) · فئات: ${before.categories.length} ← ${manifest.categories.length}`);

  if (addedCommands.length) notes.push(`أوامر مضافة (${addedCommands.length}): ${addedCommands.join(", ")}`);
  if (addedAliases.length) notes.push(`مرادفات مضافة (${addedAliases.length}): ${addedAliases.join(", ")}`);
  if (addedUserFields.length) notes.push(`حقول مستخدم مضافة: ${addedUserFields.join(", ")}`);

  console.log("═══ مقارنة Manifest ═══");
  console.log(`قبل : ${before.counts.plugins} بلوقن · ${before.counts.commands} أمر · ${before.counts.aliases} مرادف · ${before.counts.files} ملف`);
  console.log(`بعد : ${manifest.counts.plugins} بلوقن · ${manifest.counts.commands} أمر · ${manifest.counts.aliases} مرادف · ${manifest.counts.files} ملف`);
  console.log();
  for (const note of notes) console.log("ℹ️  " + note);
  console.log();
  if (problems.length === 0) {
    console.log("✅ لا يوجد أي انحدار: كل الوظائف السابقة موجودة.");
    process.exit(0);
  }
  for (const problem of problems) console.error("❌ " + problem);
  process.exit(1);
}

// نكتب إلى ملف لأن محمّل البلوقنات يطبع سجلات على stdout
if (outFile) {
  fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`✅ manifest -> ${outFile}`);
  console.log(JSON.stringify(manifest.counts, null, 2));
  process.exit(0);
} else {
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}
