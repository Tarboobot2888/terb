#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🗂️ Terboo Inventory — جرد هندسي كامل (المرحلة 1)
// ───────────────────────────────────────────────
//   node tools/terboo-inventory.mjs [--out docs/inventory]
// يجمع بين التحميل الحقيقي (ما سُجّل فعلاً في السجل) والفحص الثابت لكل ملف:
//   plugins.json      · سجل لكل ملف في plugins/: الاسم · المرادفات · الفئة · الصلاحيات · المتطلبات · الواجهات
//                       الخارجية · الاعتمادات · نقل واتساب المباشر · الواجهات التفاعلية · تنفيذ العمليات
//                       · معالجة الأخطاء · العمل في الخلفية · شكل التصدير · سبب عدم التسجيل إن لم يُسجَّل
//   commands.json     · الأوامر والمرادفات والتصادمات (اسم/مرادف واحد لأكثر من ملف)
//   permissions.json  · صلاحيات كل أمر
//   apis.json         · كل نطاق/رابط خارجي ⇒ الملفات
//   process.json      · child_process/exec/spawn/ssh2/eval/Function لكل ملف
//   transport.json    · استعمال sock.sendMessage/relayMessage/بناء رسائل تفاعلية مباشرة
//   background.json   · setInterval/cron/enqueueTask
//   db-writes.json    · كتابات قاعدة البيانات والملفات
//   config-keys.json  · مفاتيح config المستعملة في الكود
//   summary.json      · الأعداد
// لا يطبع أي قيمة سرية: الروابط تُحفظ بنطاقها ومسارها فقط (بلا query).
// ═══════════════════════════════════════════════

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const OUT = path.join(ROOT, args.includes("--out") ? args[args.indexOf("--out") + 1] : "docs/inventory");

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-inventory-"));
const { initDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmpDb);
const { loadPlugins, pluginStore } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(ROOT, "plugins"));

const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "session", "sessions", "tmp", "temp"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, filter, out);
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}
const CODE = (name) => /\.(?:js|mjs|cjs)$/.test(name);
const codeFiles = [
  ...walk(path.join(ROOT, "plugins"), CODE),
  ...walk(path.join(ROOT, "src"), CODE),
  ...walk(path.join(ROOT, "case"), CODE),
  ...walk(path.join(ROOT, "tools"), CODE),
  ...["index.js", "config.js"].map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f)),
];

// ── فاحصات ثابتة ──
const URL_RE = /https?:\/\/[^\s"'`<>)\\]+/g;
const IMPORT_RE = /(?:import\s[^"'`]*?from\s*|import\s*\(\s*|require\s*\(\s*)["'`]([^"'`]+)["'`]/g;
const PATTERNS = {
  sendMessage: /\bsendMessage\s*\(/g,
  relayMessage: /\brelayMessage\s*\(/g,
  generateWAMessage: /\bgenerateWAMessage(?:FromContent)?\s*\(/g,
  buttonsMessage: /\bbuttonsMessage\b/g,
  listMessage: /\blistMessage\b/g,
  interactiveMessage: /\binteractiveMessage\b/g,
  nativeFlowMessage: /\bnativeFlowMessage\b/g,
  templateMessage: /\btemplateMessage\b/g,
  centralUi: /terboo-(?:ui-kit|menu-delivery|interactive-builder|transport|builder)\.js/g,
  childProcess: /\bchild_process\b/g,
  exec: /\bexec(?:Sync)?\s*\(/g,
  execFile: /\bexecFile(?:Sync)?\s*\(/g,
  spawn: /\bspawn(?:Sync)?\s*\(/g,
  shellTrue: /shell\s*:\s*true/g,
  ssh2: /["'`]ssh2["'`]/g,
  sshExec: /\bconn\.exec\s*\(|\.exec\s*\(\s*["'`]|client\.exec\s*\(/g,
  evalCall: /(?<![.\w])eval\s*\(/g,
  newFunction: /new\s+Function\s*\(/g,
  tryCatch: /\bcatch\s*\(/g,
  emptyCatch: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
  noteFailure: /\bnoteFailure\s*\(/g,
  setInterval: /\bsetInterval\s*\(/g,
  cron: /\bcron\b|node-cron|schedule\(/g,
  enqueueTask: /\benqueueTask\s*\(/g,
  setUser: /\.setUser\s*\(/g,
  setGroup: /\.setGroup\s*\(/g,
  setSetting: /\.setting\s*\(\s*["'`][^"'`]+["'`]\s*,/g,
  writeFile: /\bwrite(?:File|FileSync|JSON)\s*\(/g,
  axios: /\baxios\b/g,
  fetch: /\bfetch\s*\(/g,
  timeout: /\btimeout\s*:/g,
};
const count = (text, re) => (text.match(re) || []).length;

/** النطاق + المسار بلا query (لا أسرار في الجرد) */
function safeUrl(raw) {
  const text = raw.replace(/[.,;]+$/, "");
  if (!URL.canParse(text)) return null;
  const u = new URL(text);
  if (!/^https?:$/.test(u.protocol)) return null;
  return { host: u.hostname.toLowerCase(), path: u.pathname.replace(/\/{2,}/g, "/").slice(0, 120) };
}

const IGNORED_HOSTS = /(?:^|\.)(?:whatsapp\.com|wa\.me|github\.com|githubusercontent\.com|npmjs\.com|nodejs\.org|w3\.org|schema\.org|example\.(?:com|org)|localhost|127\.0\.0\.1|virtualizor\.com|pterodactyl\.io)$/;

function scan(file) {
  const text = fs.readFileSync(file, "utf8");
  const metrics = Object.fromEntries(Object.entries(PATTERNS).map(([k, re]) => [k, count(text, re)]));
  const urls = [];
  for (const raw of text.match(URL_RE) || []) {
    const u = safeUrl(raw);
    if (u && !IGNORED_HOSTS.test(u.host)) urls.push(u);
  }
  const imports = [...text.matchAll(IMPORT_RE)].map((m) => m[1]);
  const configKeys = [...text.matchAll(/\bconfig\??\.((?:[A-Za-z_$][\w$]*\??\.?)+)/g)].map((m) => m[1].replace(/\?/g, "").replace(/\.$/, "")).filter(Boolean);
  return { text, metrics, urls, imports, configKeys };
}

// ── السجل الحقيقي: اسم/مرادف ⇒ ملف ──
const registeredByFile = new Map();
for (const plugin of new Set(pluginStore.commands.values())) {
  if (plugin?.filePath) registeredByFile.set(rel(path.resolve(plugin.filePath)), plugin);
}

// ── الأوامر والمرادفات والتصادمات (من التصريحات، لا من الخريطة التي يكتب آخرها فوق أولها) ──
const nameOwners = new Map();
const aliasOwners = new Map();
const toList = (value) => (Array.isArray(value) ? value : value ? [value] : []).map((x) => String(x).toLowerCase()).filter(Boolean);

const plugins = [];
for (const file of walk(path.join(ROOT, "plugins"), CODE).sort()) {
  const r = rel(file);
  const { text, metrics, urls, imports } = scan(file);
  const plugin = registeredByFile.get(r);
  let exportsKind = "none";
  let mod = null;
  try {
    mod = await import(`${path.resolve(file)}`);
    exportsKind = mod.config && typeof mod.handler === "function" ? "config+handler"
      : mod.default?.config && typeof mod.default?.handler === "function" ? "default{config,handler}"
      : typeof mod.default === "function" ? "default-function"
      : Object.keys(mod).length ? `named:${Object.keys(mod).slice(0, 6).join(",")}` : "none";
  } catch (error) {
    exportsKind = `import-error:${String(error?.message || error).slice(0, 120)}`;
  }
  const cfg = plugin?.config || mod?.config || mod?.default?.config || null;
  const names = cfg ? toList(cfg.name) : [];
  const aliases = cfg ? toList(cfg.alias) : [];
  // المعطّل (isEnabled:false) لا يُسجَّل أصلاً ⇒ لا يدخل التصادمات
  if (cfg && cfg.isEnabled !== false) {
    for (const n of names) nameOwners.set(n, [...(nameOwners.get(n) || []), r]);
    for (const a of aliases) aliasOwners.set(a, [...(aliasOwners.get(a) || []), r]);
  }
  const interactiveDirect = metrics.buttonsMessage + metrics.listMessage + metrics.interactiveMessage + metrics.nativeFlowMessage + metrics.templateMessage;
  plugins.push({
    path: r,
    registered: Boolean(plugin),
    notRegisteredReason: plugin ? null : !cfg ? `no-plugin-exports (${exportsKind})` : cfg.isEnabled === false ? "disabled" : "shadowed-by-collision",
    exportsKind,
    name: names[0] || null,
    aliases,
    category: cfg?.category || null,
    description: cfg?.description || "",
    usage: cfg?.usage || "",
    enabled: cfg ? cfg.isEnabled !== false : null,
    permissions: cfg ? { owner: Boolean(cfg.isOwner), premium: Boolean(cfg.isPremium), admin: Boolean(cfg.isAdmin), botAdmin: Boolean(cfg.isBotAdmin), group: Boolean(cfg.isGroup), private: Boolean(cfg.isPrivate), partner: Boolean(cfg.isPartner), skipRegistration: Boolean(cfg.skipRegistration) } : null,
    externalApis: [...new Set(urls.map((u) => u.host))].sort(),
    dependencies: [...new Set(imports)].sort(),
    directTransport: { sendMessage: metrics.sendMessage, relayMessage: metrics.relayMessage, generateWAMessage: metrics.generateWAMessage },
    interactiveUi: { direct: interactiveDirect, centralLayer: metrics.centralUi > 0 },
    processExecution: { childProcess: metrics.childProcess, exec: metrics.exec, execFile: metrics.execFile, spawn: metrics.spawn, shellTrue: metrics.shellTrue, ssh2: metrics.ssh2, eval: metrics.evalCall + metrics.newFunction },
    errorHandling: { catches: metrics.tryCatch, emptyCatches: metrics.emptyCatch, noteFailure: metrics.noteFailure },
    background: { setInterval: metrics.setInterval, enqueueTask: metrics.enqueueTask },
    http: { axios: metrics.axios > 0, fetch: metrics.fetch, timeouts: metrics.timeout },
    lines: text.split("\n").length,
  });
}

const collisions = {
  names: Object.fromEntries([...nameOwners].filter(([, files]) => files.length > 1)),
  aliases: Object.fromEntries([...aliasOwners].filter(([, files]) => new Set(files).size > 1)),
  aliasShadowsName: Object.fromEntries([...aliasOwners].filter(([alias, files]) => nameOwners.has(alias) && !nameOwners.get(alias).some((f) => files.includes(f))).map(([alias, files]) => [alias, { aliasIn: files, nameIn: nameOwners.get(alias) }])),
};

// ── المسح العام لكل ملفات الكود ──
const apis = new Map();
const processRows = [];
const transportRows = [];
const backgroundRows = [];
const dbRows = [];
const configKeys = new Map();
for (const file of codeFiles) {
  const r = rel(file);
  if (r.startsWith("tools/terboo-inventory")) continue;
  const { metrics, urls, configKeys: keys } = scan(file);
  for (const u of urls) {
    if (!apis.has(u.host)) apis.set(u.host, { host: u.host, paths: new Set(), files: new Set() });
    apis.get(u.host).paths.add(u.path);
    apis.get(u.host).files.add(r);
  }
  const p = metrics;
  if (p.childProcess || p.exec || p.execFile || p.spawn || p.ssh2 || p.evalCall || p.newFunction) {
    processRows.push({ file: r, childProcess: p.childProcess, exec: p.exec, execFile: p.execFile, spawn: p.spawn, shellTrue: p.shellTrue, ssh2: p.ssh2, sshExec: p.sshExec, eval: p.evalCall, newFunction: p.newFunction });
  }
  if (p.sendMessage || p.relayMessage || p.generateWAMessage || p.buttonsMessage || p.listMessage || p.interactiveMessage || p.nativeFlowMessage) {
    transportRows.push({ file: r, sendMessage: p.sendMessage, relayMessage: p.relayMessage, generateWAMessage: p.generateWAMessage, buttonsMessage: p.buttonsMessage, listMessage: p.listMessage, interactiveMessage: p.interactiveMessage, nativeFlowMessage: p.nativeFlowMessage, centralLayer: p.centralUi > 0 });
  }
  if (p.setInterval || p.cron || p.enqueueTask) backgroundRows.push({ file: r, setInterval: p.setInterval, cron: p.cron, enqueueTask: p.enqueueTask });
  if (p.setUser || p.setGroup || p.setSetting || p.writeFile) dbRows.push({ file: r, setUser: p.setUser, setGroup: p.setGroup, setSetting: p.setSetting, writeFile: p.writeFile });
  for (const key of keys) {
    const top = key.split(".").slice(0, 2).join(".");
    if (!configKeys.has(top)) configKeys.set(top, new Set());
    configKeys.get(top).add(r);
  }
}

// ── أدوات الذكاء والـscrapers ──
const { allTools } = await import("../src/lib/terboo-tool-registry.js");
const tools = allTools().map(({ id, source, category, kind, inputKind, permission, modelVisible }) => ({ id, source, category, kind, inputKind, permission, modelVisible }));
const scraperFiles = walk(path.join(ROOT, "src", "scraper"), CODE).map(rel).sort();
const { listScrapers } = await import("../src/lib/terboo-scraper-registry.js");
const registeredScrapers = listScrapers().map((s) => ({ id: s.id, kind: s.kind, input: s.input, plugins: s.plugins || [] }));

// ── الكتابة ──
fs.mkdirSync(OUT, { recursive: true });
const write = (name, data) => fs.writeFileSync(path.join(OUT, name), `${JSON.stringify(data, null, 2)}\n`);
const commandRows = plugins.filter((p) => p.registered).map((p) => ({ command: p.name, aliases: p.aliases, category: p.category, path: p.path }));
write("plugins.json", plugins);
write("commands.json", { commands: commandRows, collisions });
write("permissions.json", plugins.filter((p) => p.registered).map((p) => ({ command: p.name, path: p.path, ...p.permissions })));
write("apis.json", [...apis.values()].map((a) => ({ host: a.host, paths: [...a.paths].sort().slice(0, 30), files: [...a.files].sort() })).sort((a, b) => b.files.length - a.files.length || a.host.localeCompare(b.host)));
write("process.json", processRows);
write("transport.json", transportRows);
write("background.json", backgroundRows);
write("db-writes.json", dbRows);
write("config-keys.json", Object.fromEntries([...configKeys].sort().map(([k, files]) => [k, [...files].sort()])));
write("ai-tools.json", { tools, scraperFiles, registeredScrapers });
const summary = {
  generatedAt: new Date().toISOString(),
  pluginFiles: plugins.length,
  registeredPlugins: plugins.filter((p) => p.registered).length,
  notRegistered: plugins.filter((p) => !p.registered).map((p) => ({ path: p.path, reason: p.notRegisteredReason })),
  storeCommands: pluginStore.commands.size,
  storeAliases: pluginStore.aliases.size,
  declaredNames: nameOwners.size,
  declaredAliases: aliasOwners.size,
  nameCollisions: Object.keys(collisions.names).length,
  aliasCollisions: Object.keys(collisions.aliases).length,
  aliasShadowsName: Object.keys(collisions.aliasShadowsName).length,
  externalHosts: apis.size,
  processFiles: processRows.length,
  shellTrueFiles: processRows.filter((r) => r.shellTrue).map((r) => r.file),
  ssh2Files: processRows.filter((r) => r.ssh2).map((r) => r.file),
  evalFiles: processRows.filter((r) => r.eval || r.newFunction).map((r) => r.file),
  directInteractivePlugins: plugins.filter((p) => p.interactiveUi.direct > 0 && !p.interactiveUi.centralLayer).map((p) => p.path),
  emptyCatchFiles: plugins.filter((p) => p.errorHandling.emptyCatches > 0).map((p) => p.path),
  backgroundFiles: backgroundRows.length,
  dbWriteFiles: dbRows.length,
  configTopKeys: configKeys.size,
  tools: tools.length,
  scraperFiles: scraperFiles.length,
  registeredScrapers: registeredScrapers.length,
};
write("summary.json", summary);
// force: true لا يرمي لمسار غير موجود؛ أي خطأ آخر (صلاحيات) يُطبع ولا يُبتلع
fs.rmSync(tmpDb, { recursive: true, force: true });
console.log(`✅ inventory ⇒ ${rel(OUT)}: ${summary.pluginFiles} plugin files · ${summary.registeredPlugins} registered · ${summary.nameCollisions} name collisions · ${summary.aliasCollisions} alias collisions · ${summary.externalHosts} hosts · ${summary.processFiles} process files · ${summary.directInteractivePlugins.length} direct-interactive plugins`);
process.exit(0);
