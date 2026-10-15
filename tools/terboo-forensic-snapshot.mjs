#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🔬 Terboo Forensic Snapshot — بصمة المشروع الكاملة قبل/بعد أي تعديل (§1 §116 §119)
// ───────────────────────────────────────────────
// لا يكرر منطق tools/terboo-manifest.mjs: يشغّله كما هو ويضيف ما ينقصه:
//   • كل ملف ببصمة sha1 (لكشف الجديد/المحذوف/المعدّل)
//   • رسم الاستيراد (ثابت + ديناميكي) وقابلية الوصول من نقاط الدخول
//   • سلسلة الإثبات لكل وحدة: Declared → Imported → Registered → Called → Executed
//   • مرسلو الرسائل وبنّاؤو الواجهات التفاعلية، أنظمة الذكاء، المزوّدون، الجدولة والطوابير
//   • الأصول (الصور بأبعادها الحقيقية ونوعها) والخطوط وملفات قاعدة البيانات ومفاتيحها
//
// «Executed» لا يُفترض: يُقرأ من تغطية V8 حقيقية لتشغيل الاختبارات
// (NODE_V8_COVERAGE=dir npm run test:local ثم --coverage dir).
//
//   node tools/terboo-forensic-snapshot.mjs --out TERBOO_AFTER_MANIFEST.json [--coverage dir]
//   node tools/terboo-forensic-snapshot.mjs --compare TERBOO_BEFORE_MANIFEST.json TERBOO_AFTER_MANIFEST.json
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const SKIP = new Set(["node_modules", ".git", "session", "tmp", "temp", "downloads", ".cache", "coverage"]);
const CODE = /\.(js|mjs|cjs)$/;
const IMAGE = /\.(png|jpe?g|webp|gif|svg)$/i;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(path.relative(ROOT, full).split(path.sep).join("/"));
  }
  return out;
}

const sha1 = (buf) => crypto.createHash("sha1").update(buf).digest("hex").slice(0, 16);
const readText = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

// ── 1. المقارنة بين لقطتين ──────────────────────
if (args.includes("--compare")) {
  const [beforeFile, afterFile] = args.slice(args.indexOf("--compare") + 1);
  // لقطة كاملة (هذه الأداة) أو بيان مسطّح (tools/terboo-manifest.mjs — ملفات بلا بصمات وأصول قائمة)
  const asSnapshot = (snap) => {
    if (snap.manifest) return { ...snap, hashed: true };
    const files = Array.isArray(snap.files) ? Object.fromEntries(snap.files.map((f) => [typeof f === "string" ? f : f.path, null])) : snap.files || {};
    const images = Array.isArray(snap.assets)
      ? Object.fromEntries(snap.assets.filter((x) => /\.(?:png|jpe?g|webp|gif)$/i.test(x.path || "")).map((x) => [x.path, { bytes: x.bytes }]))
      : snap.assets?.images || {};
    return { manifest: snap, files, counts: snap.counts || {}, assets: { images }, hashed: false };
  };
  const before = asSnapshot(JSON.parse(fs.readFileSync(beforeFile, "utf8")));
  const after = asSnapshot(JSON.parse(fs.readFileSync(afterFile, "utf8")));
  const allowed = flag("--allow") ? JSON.parse(fs.readFileSync(flag("--allow"), "utf8")) : {};
  const diff = (a = [], b = []) => a.filter((x) => !b.includes(x));
  const problems = [];
  const notes = [];
  const check = (label, removed, key) => {
    const explained = new Set(Object.keys(allowed[key] || {}));
    const unexplained = removed.filter((x) => !explained.has(x));
    for (const x of removed.filter((x) => explained.has(x))) notes.push(`${label} أُزيل عمداً: ${x} — ${allowed[key][x]}`);
    if (unexplained.length) problems.push(`${label} مفقود (${unexplained.length}): ${unexplained.slice(0, 15).join(", ")}`);
  };
  check("أمر", diff(before.manifest.commands, after.manifest.commands), "commands");
  check("مرادف", diff(before.manifest.aliases, after.manifest.aliases), "aliases");
  check("فئة", diff(before.manifest.categories, after.manifest.categories), "categories");
  check("مفتاح config", diff(before.manifest.configKeys, after.manifest.configKeys), "configKeys");
  check("حقل مستخدم", diff(before.manifest.userFields, after.manifest.userFields), "userFields");
  check("سكرابر", diff(before.manifest.scrapers, after.manifest.scrapers), "scrapers");
  check("أداة ذكاء", diff(before.manifest.aiTools, after.manifest.aiTools), "aiTools");
  check("قائمة", diff(before.manifest.menus, after.manifest.menus), "menus");
  check("عنصر قائمة", diff(before.manifest.menuItems, after.manifest.menuItems), "menuItems");
  check("ملف", diff(Object.keys(before.files), Object.keys(after.files)), "files");
  // أسماء التصدير: بيانات قديمة قد تحمل نص تعليق من داخل كتلة export { … } — يُؤخذ المعرّف وحده
  const exportNames = (list) => (list || []).flatMap((name) => String(name).replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((line) => line.replace(/\/\/.*$/, "").trim()).filter(Boolean)).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
  for (const [file, names] of Object.entries(before.manifest.exports || {})) {
    const now = after.manifest.exports?.[file];
    if (!now) continue; // الملف نفسه يُفحص في «ملف»
    const missing = diff(exportNames(names), exportNames(now));
    if (missing.length) check(`export في ${file}`, missing, "exports");
  }
  for (const [name, detail] of Object.entries(before.manifest.commandDetails || {})) {
    const now = after.manifest.commandDetails?.[name];
    if (!now) continue;
    for (const key of ["isOwner", "isPremium", "isAdmin", "isBotAdmin", "isGroup", "isPrivate"]) {
      if (detail[key] !== now[key]) problems.push(`صلاحية تغيّرت ${name}.${key}: ${detail[key]} → ${now[key]}`);
    }
  }
  // أصل صورة كانت تُستعمل يجب أن يبقى مساره صالحاً أو يُستبدل صراحة في asset manifest
  for (const rel of Object.keys(before.assets.images || {})) {
    if (!after.assets.images?.[rel] && !(allowed.assets || {})[rel]) problems.push(`أصل صورة مفقود بلا تفسير: ${rel}`);
  }
  const added = diff(Object.keys(after.files), Object.keys(before.files));
  const changed = Object.keys(after.files).filter((f) => before.files[f] && before.files[f] !== after.files[f]);
  notes.push(`ملفات: ${Object.keys(before.files).length} → ${Object.keys(after.files).length} · مضاف ${added.length} · معدّل ${before.hashed && after.hashed ? changed.length : "— (بيان بلا بصمات)"}`);
  for (const key of Object.keys(after.counts)) {
    notes.push(`${key}: ${before.counts[key] ?? "—"} → ${after.counts[key]}`);
  }
  console.log("═══ Terboo Forensic Compare ═══");
  for (const note of notes) console.log(`ℹ️  ${note}`);
  if (problems.length) {
    for (const p of problems) console.error(`❌ ${p}`);
    process.exit(1);
  }
  console.log("✅ لا انحدار غير مفسّر بين اللقطتين");
  process.exit(0);
}

// ── 2. manifest الأساسي من الأداة الموجودة ─────
const tmpManifest = path.join(os.tmpdir(), `terboo-manifest-${process.pid}.json`);
execFileSync(process.execPath, [path.join(ROOT, "tools/terboo-manifest.mjs"), "--out", tmpManifest], { cwd: ROOT, stdio: "ignore", timeout: 300_000 });
const manifest = JSON.parse(fs.readFileSync(tmpManifest, "utf8"));
fs.rmSync(tmpManifest, { force: true });

// ── 3. الملفات وبصماتها ─────────────────────────
const allFiles = walk(ROOT).sort();
const files = {};
for (const rel of allFiles) files[rel] = sha1(fs.readFileSync(path.join(ROOT, rel)));
const byTop = {};
for (const rel of allFiles) {
  const top = rel.includes("/") ? rel.split("/")[0] : ".";
  byTop[top] = (byTop[top] || 0) + 1;
}

// ── 4. رسم الاستيراد ─────────────────────────────
const codeFiles = allFiles.filter((f) => CODE.test(f));
const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"`;]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /import\(\s*["'`]([^"'`$]+)["'`]\s*\)/g;
function resolveSpec(from, spec) {
  if (!spec.startsWith(".")) return { pkg: spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0] };
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  for (const candidate of [target, `${target}.js`, `${target}.mjs`, `${target}/index.js`]) {
    if (files[candidate]) return { file: candidate };
  }
  return { missing: target };
}
const graph = {};
const packages = {};
const missingImports = [];
for (const file of codeFiles) {
  const src = readText(file);
  const node = { static: [], dynamic: [], importedNames: {} };
  for (const [kind, re] of [["static", STATIC_IMPORT], ["dynamic", DYNAMIC_IMPORT]]) {
    for (const match of src.matchAll(re)) {
      const r = resolveSpec(file, match[1]);
      if (r.file) node[kind].push(r.file);
      else if (r.pkg) (packages[r.pkg] ||= new Set()).add(file);
      else if (r.missing && !/^tests\/fixtures\//.test(file)) missingImports.push(`${file} → ${match[1]}`);
    }
  }
  for (const match of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const r = resolveSpec(file, match[2]);
    if (!r.file) continue;
    const names = match[1].split(",").map((p) => p.trim().split(/\s+as\s+/)[0]).filter(Boolean);
    node.importedNames[r.file] = names;
  }
  graph[file] = node;
}
// نقاط الدخول الحقيقية: index.js، محمّل البلوقنات يحمّل كل plugins/**، case يُستورد من handler
// السكرابرات المسجّلة يحمّلها السجل بمسار محسوب (import(pathToFileURL(file))) ⇒ نقاط دخول أيضاً
const ENTRY = ["index.js", ...codeFiles.filter((f) => f.startsWith("plugins/")), ...manifest.scrapers.filter((f) => !manifest.unregisteredScrapers.includes(f))];
const reachable = new Set();
const queue = [...ENTRY];
while (queue.length) {
  const file = queue.pop();
  if (reachable.has(file) || !graph[file]) continue;
  reachable.add(file);
  for (const next of [...graph[file].static, ...graph[file].dynamic]) queue.push(next);
}
const importedBy = {};
for (const [file, node] of Object.entries(graph)) {
  for (const target of [...node.static, ...node.dynamic]) (importedBy[target] ||= []).push(file);
}
const calledNames = {};
for (const node of Object.values(graph)) {
  for (const [target, names] of Object.entries(node.importedNames)) {
    for (const name of names) (calledNames[target] ||= new Set()).add(name);
  }
}

// ── 5. التنفيذ الفعلي من تغطية V8 ──────────────
const executed = new Set();
const evaluatedOnly = new Set();
const coverageDir = flag("--coverage");
if (coverageDir && fs.existsSync(coverageDir)) {
  const rootUrl = pathToFileURL(ROOT + path.sep).href;
  for (const name of fs.readdirSync(coverageDir).filter((n) => n.endsWith(".json"))) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(coverageDir, name), "utf8")); } catch { continue; }
    for (const script of data.result || []) {
      if (!script.url?.startsWith(rootUrl)) continue;
      const rel = decodeURIComponent(script.url.slice(rootUrl.length));
      if (rel.startsWith("node_modules/")) continue;
      // تقييم الوحدة وحده (اختبار الصياغة يستورد كل ملف) لا يُعدّ تنفيذاً:
      // المطلوب دالة داخلية (ليست جسم الوحدة عند الإزاحة 0) نُفّذت فعلاً
      const ran = script.functions?.some((fn) => fn.ranges?.[0]?.startOffset > 0 && fn.ranges[0].count > 0);
      if (ran) executed.add(rel);
      else if (script.functions?.some((fn) => fn.ranges?.some((r) => r.count > 0))) evaluatedOnly.add(rel);
    }
  }
}

// سلسلة الإثبات لوحدات المصدر (src/** و case) — البلوقنات تُثبت بالتسجيل في pluginStore
const registeredScrapers = new Set(manifest.scrapers.filter((f) => !manifest.unregisteredScrapers.includes(f)));
const proof = {};
for (const file of codeFiles.filter((f) => /^(src|case)\//.test(f) || f === "index.js")) {
  proof[file] = {
    declared: true,
    exports: manifest.exports[file] || [],
    imported: reachable.has(file),
    importedBy: (importedBy[file] || []).filter((f) => !f.startsWith("tests/")).length,
    importedByTests: (importedBy[file] || []).filter((f) => f.startsWith("tests/")).length,
    registered: /^src\/scraper\//.test(file) ? registeredScrapers.has(file) : null,
    called: [...(calledNames[file] || [])].sort(),
    executed: coverageDir ? executed.has(file) : null,
    evaluatedOnly: coverageDir ? evaluatedOnly.has(file) && !executed.has(file) : null,
  };
}
// يتيم = لا يصل إليه أي مسار إنتاج (ثابت/ديناميكي/سجل) — مع دليل التنفيذ إن وُجد
const orphans = Object.entries(proof).filter(([, p]) => !p.imported).map(([f, p]) => ({ file: f, importedByTests: p.importedByTests, executedInTests: p.executed }));

// ── 6. الإرسال والواجهات التفاعلية والذكاء والجدولة ──
const PATTERNS = {
  sendMessage: /\bsendMessage\s*\(/g,
  relayMessage: /\brelayMessage\s*\(/g,
  generateWAMessageFromContent: /\bgenerateWAMessageFromContent\s*\(/g,
  protoFromObject: /\.fromObject\s*\(/g,
  protoCreate: /proto\.[\w.]+\.create\s*\(/g,
  interactiveMessage: /\binteractiveMessage\b/g,
  nativeFlowMessage: /\bnativeFlowMessage\b/g,
  carouselMessage: /\bcarouselMessage\b/g,
  buttonsMessage: /\bbuttonsMessage\b/g,
  listMessage: /\blistMessage\b/g,
  setInterval: /\bsetInterval\s*\(/g,
  cron: /\bnew\s+CronJob\b|\bcron\.schedule\b|from\s+["']cron["']/g,
  queue: /\bnew\s+PQueue\b|\benqueueTask\s*\(/g,
  emptyCatch: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
};
const usage = {};
const totals = {};
for (const file of codeFiles.filter((f) => !f.startsWith("tests/") && !f.startsWith("tools/"))) {
  const src = readText(file);
  for (const [key, re] of Object.entries(PATTERNS)) {
    const n = (src.match(re) || []).length;
    if (!n) continue;
    (usage[key] ||= {})[file] = n;
    totals[key] = (totals[key] || 0) + n;
  }
}

const aiSystems = codeFiles.filter((f) => /^src\/lib\/(terboo-(ai|auto-ai|natural-ai|agent|nvidia-ai|code-review|provider|scraper-registry|task|latency|rich-response|code-renderer|file-intelligence)[\w-]*|manus-api)\.js$/.test(f));
// المزوّدات تُسجَّل ديناميكياً (حسب المفاتيح المتاحة): نقرأ أسماء التسجيل من المصدر لا من بيئة هذا الجهاز
const providers = [...new Set([...readText("src/lib/terboo-ai-providers.js").matchAll(/providers\.(\w+)\s*=/g)].map((m) => m[1]))].sort();

// ── 7. الأصول والخطوط وقاعدة البيانات ─────────
const sharp = (await import("sharp")).default;
const images = {};
for (const rel of allFiles.filter((f) => f.startsWith("assets/") && IMAGE.test(f))) {
  const buf = fs.readFileSync(path.join(ROOT, rel));
  let meta = {};
  try { meta = await sharp(buf).metadata(); } catch { meta = {}; }
  images[rel] = { bytes: buf.length, width: meta.width || null, height: meta.height || null, format: meta.format || null, sha1: sha1(buf) };
}
const assetRefs = {};
for (const file of codeFiles.filter((f) => !f.startsWith("tests/") && !f.startsWith("tools/")).concat(["config.js"])) {
  const src = readText(file);
  for (const match of src.matchAll(/assets\/[\w./-]+\.(?:png|jpe?g|webp|gif|svg|mp3|mp4|ttf|otf|woff2?)/gi)) {
    (assetRefs[match[0]] ||= new Set()).add(file);
  }
}
const fonts = allFiles.filter((f) => /\.(ttf|otf|woff2?)$/i.test(f));
const media = allFiles.filter((f) => /^assets\/.*\.(mp3|mp4|ogg|wav)$/i.test(f));
const databaseFiles = allFiles.filter((f) => /^(database|data|src\/database)\//.test(f) && f.endsWith(".json"));
const databaseKeys = {};
for (const rel of databaseFiles) {
  try {
    const value = JSON.parse(readText(rel));
    databaseKeys[rel] = Array.isArray(value) ? "[array]" : Object.keys(value).sort();
  } catch { databaseKeys[rel] = "[invalid-json]"; }
}
const tests = allFiles.filter((f) => /^tests\/.*\.test\.mjs$/.test(f));

const snapshot = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  counts: {
    files: allFiles.length,
    codeFiles: codeFiles.length,
    plugins: manifest.counts.plugins,
    commands: manifest.counts.commands,
    aliases: manifest.counts.aliases,
    categories: manifest.counts.categories,
    scrapers: manifest.counts.scrapers,
    aiTools: manifest.counts.aiTools,
    menus: manifest.counts.menus,
    menuItems: manifest.counts.menuItems,
    tests: tests.length,
    images: Object.keys(images).length,
    fonts: fonts.length,
    databaseFiles: databaseFiles.length,
    aiSystems: aiSystems.length,
    providers: providers.length,
    reachableSourceModules: Object.values(proof).filter((p) => p.imported).length,
    executedSourceModules: coverageDir ? Object.values(proof).filter((p) => p.executed).length : null,
    orphanSourceModules: orphans.length,
    missingImports: missingImports.length,
    ...Object.fromEntries(Object.entries(totals).map(([k, v]) => [`uses.${k}`, v])),
  },
  filesByTop: byTop,
  files,
  manifest,
  importGraph: {
    packages: Object.fromEntries(Object.entries(packages).map(([k, v]) => [k, v.size]).sort()),
    missingImports,
    dynamicImports: Object.fromEntries(Object.entries(graph).filter(([, n]) => n.dynamic.length).map(([f, n]) => [f, n.dynamic])),
  },
  proof,
  orphans,
  usage,
  aiSystems,
  providers,
  assets: {
    images,
    references: Object.fromEntries(Object.entries(assetRefs).map(([k, v]) => [k, [...v].sort()])),
    fonts,
    media,
  },
  database: { files: databaseFiles, keys: databaseKeys },
  tests,
};

const out = flag("--out");
if (out) {
  fs.writeFileSync(out, JSON.stringify(snapshot, null, 1));
  console.log(`✅ forensic snapshot → ${out}`);
  console.log(JSON.stringify(snapshot.counts, null, 1));
} else {
  console.log(JSON.stringify(snapshot, null, 1));
}
process.exit(0);
