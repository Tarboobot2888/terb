#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🔬 Terboo V6 — الفحص الجنائي القابل لإعادة التوليد (Phase 0)
// ───────────────────────────────────────────────
// لا يكرر أدوات الجرد الموجودة: يشغّل tools/terboo-forensic-snapshot.mjs وtools/terboo-inventory.mjs
// ويقرأ مخرجاتهما، ثم يضيف ما ينقصهما للمرحلة 0:
//   • الإخفاق الصامت في كل شجرة الإنتاج (index.js · config.js · case · tools · src · plugins · web)
//   • بوابات التسجيل الإجباري · انحراف الإصدار · انحراف التوثيق · المسارات القديمة · حالة الموقع
//   • نصوص تشبه الأسرار خارج config.js (المكان والنوع فقط — لا قيمة ولا جزء منها)
//
//   node tools/terboo-forensic-v6.mjs [--out docs/TERBOO_V6_FORENSIC_AUDIT.md] [--json file]
// ═══════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const flag = (name, fallback = null) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const OUT = flag("--out", "docs/TERBOO_V6_FORENSIC_AUDIT.md");
const JSON_OUT = flag("--json");
const SKIP = new Set(["node_modules", ".git", "session", "sessions", "tmp", "temp", "downloads", "data", "database", "backup", ".cache", "coverage", "dist"]);
const rel = (full) => path.relative(ROOT, full).split(path.sep).join("/");
const exists = (p) => fs.existsSync(path.join(ROOT, p));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function walk(dir, test, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, test, out);
    else if (test(entry.name)) out.push(rel(full));
  }
  return out;
}
const lineOf = (src, index) => src.slice(0, index).split("\n").length;

// ── 1. الأدوات الموجودة ──────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-forensic-"));
const snapFile = path.join(tmp, "snapshot.json");
execFileSync(process.execPath, ["tools/terboo-forensic-snapshot.mjs", "--out", snapFile], { cwd: ROOT, stdio: "ignore" });
const snap = JSON.parse(fs.readFileSync(snapFile, "utf8"));
const invDir = path.join(tmp, "inventory");
execFileSync(process.execPath, ["tools/terboo-inventory.mjs", "--out", path.relative(ROOT, invDir)], { cwd: ROOT, stdio: "ignore" });
const inventory = JSON.parse(fs.readFileSync(path.join(invDir, "summary.json"), "utf8"));
const apis = fs.existsSync(path.join(invDir, "apis.json")) ? JSON.parse(fs.readFileSync(path.join(invDir, "apis.json"), "utf8")) : null;
fs.rmSync(tmp, { recursive: true, force: true });

// ── 2. الإخفاق الصامت (نفس أنماط tests/terboo-no-silent-catch.test.mjs) ──
const SILENT = [
  ["empty catch", /catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/g],
  ["comment-only catch", /catch\s*(?:\(\s*\w*\s*\))?\s*\{(\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)+\}/g],
  ["catch returning a constant", /catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*return(\s+(?:null|undefined|false|true|\[\]|\{\}|""|''|0))?\s*;?\s*\}/g],
  ["promise catch with empty body", /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*\{\s*\}\s*\)/g],
  ["promise catch returning a constant", /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(?:null|undefined|false)\s*\)/g],
];
const PROD_ROOTS = ["index.js", "config.js", "case", "tools", "src", "plugins", "web", "website"];
const prodFiles = PROD_ROOTS.flatMap((p) => {
  if (!exists(p)) return [];
  return fs.statSync(path.join(ROOT, p)).isDirectory() ? walk(path.join(ROOT, p), (n) => /\.(m?js|cjs)$/.test(n)) : [p];
});
const silentByRoot = {};
const silent = [];
const SELF = "tools/terboo-forensic-v6.mjs";
for (const file of prodFiles.filter((f) => f !== SELF)) {
  const src = read(file);
  for (const [label, re] of SILENT) {
    for (const match of src.matchAll(re)) {
      silent.push({ file, line: lineOf(src, match.index), kind: label });
      const top = file.includes("/") ? file.split("/")[0] : file;
      silentByRoot[top] = (silentByRoot[top] || 0) + 1;
    }
  }
}

// ── 3. نصوص تشبه الأسرار خارج config.js (المكان والنوع فقط) ──
const SECRET_SHAPES = [
  ["openai-style key", /\bsk-[A-Za-z0-9_-]{24,}/g],
  ["google api key", /\bAIza[0-9A-Za-z_-]{30,}/g],
  ["github token", /\bgh[pousr]_[A-Za-z0-9]{30,}/g],
  ["slack token", /\bxox[abpr]-[A-Za-z0-9-]{20,}/g],
  ["telegram bot token", /\b\d{8,10}:AA[0-9A-Za-z_-]{30,}/g],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ["pterodactyl key", /\bptl[ac]_[A-Za-z0-9]{30,}/g],
  ["hardcoded bearer", /Bearer\s+[A-Za-z0-9._-]{32,}/g],
];
const secretHits = [];
for (const file of prodFiles.filter((f) => f !== "config.js" && f !== SELF)) {
  const src = read(file);
  for (const [kind, re] of SECRET_SHAPES) for (const match of src.matchAll(re)) secretHits.push({ file, line: lineOf(src, match.index), kind });
}

// ── 4. بوابات التسجيل الإجباري ───────────────────
const GATE = /registrationRequired|enforceForNewUsers|isRegistrationRequired|skipRegistration/;
const gates = [];
for (const file of prodFiles.filter((f) => !f.startsWith("tools/"))) {
  const lines = read(file).split("\n");
  lines.forEach((text, i) => { if (GATE.test(text)) gates.push({ file, line: i + 1, text: text.trim().slice(0, 140) }); });
}

// ── 5. انحراف الإصدار ───────────────────────────
const pkg = JSON.parse(read("package.json"));
const configVersion = (read("config.js").match(/version:\s*"([^"]+)"/) || [])[1] || null;
const versionDrift = [
  { where: "package.json version", value: pkg.version },
  { where: "package.json description", value: (pkg.description.match(/v\d+(?:\.\d+)*/i) || ["—"])[0] },
  { where: "config.js bot.version", value: configVersion },
];
const docsFiles = [...walk(path.join(ROOT, "docs"), (n) => n.endsWith(".md")), ...fs.readdirSync(ROOT).filter((n) => /^TERBOO_.*\.md$/.test(n))];
const docVersions = {};
for (const file of docsFiles) {
  // «vN §MM» مرجع قسم من الخطة لا إصدار؛ وملفات docs/v6/* مخرجات V6 مولّدة
  const head = read(file).slice(0, 400);
  const nameMatch = file.match(/V(\d)|v(\d)\.\d/);
  const bodyMatch = head.match(/\b[Vv](\d)(?:\.\d+)?\b(?!\s*§)/);
  const m = nameMatch || bodyMatch;
  const v = file.startsWith("docs/archive/") ? "archived (historical)"
    : file.startsWith("docs/v6/") ? "V6"
      : m ? `V${m[1] || m[2]}` : "unversioned";
  (docVersions[v] ||= []).push(file);
}

// ── 6. المسارات القديمة والمعزولة ───────────────
// معزول = يحمل وسم legacy ولا يُفعَّل إلا بعلم صريح في الإعدادات (isEnabled مرتبط به)
const isIsolated = (file) => exists(file) && /\blegacy\s*[:=]/.test(read(file)) && /isEnabled:\s*(?:config|process\.env|.+?===\s*true)/.test(read(file));
const legacy = [];
const flagFile = (file, why) => { if (exists(file)) legacy.push({ file, why, isolated: isIsolated(file) }); };
for (const f of walk(path.join(ROOT, "plugins/vps"), (n) => n.endsWith(".js"))) flagFile(f, "DigitalOcean (legacy) — ليس مسار Virtualizor");
flagFile("src/lib/terboo-roles-digitalocean.js", "أدوار بائعي DigitalOcean (legacy)");
flagFile("plugins/owner/internetrakyat.js", "إرسال OTP لأرقام الغير — يجب عزله عن المسارات العامة والذكاء");
for (const n of inventory.notRegistered || []) legacy.push({ file: n.path, why: `غير مسجّل (${n.reason})`, isolated: true });

// ── 7. حالة الموقع ──────────────────────────────
const website = {
  dir: ["web", "website"].find(exists) || null,
  configSection: /\bwebsite\s*:\s*\{/.test(read("config.js")),
  envUrl: "TERBOO_SITE_URL",
};

// ── 8. التجميع ──────────────────────────────────
const c = snap.counts;
const report = {
  generatedAt: new Date().toISOString(),
  head: execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT }).toString().trim(),
  node: process.version,
  counts: {
    files: c.files, codeFiles: c.codeFiles, pluginFiles: inventory.pluginFiles, registeredPlugins: inventory.registeredPlugins,
    commands: c.commands, aliases: c.aliases, categories: c.categories, scrapers: c.scrapers, aiTools: c.aiTools,
    providers: c.providers, aiSystems: c.aiSystems, menus: c.menus, menuItems: c.menuItems, tests: c.tests,
    images: c.images, fonts: c.fonts, externalHosts: inventory.externalHosts, processFiles: inventory.processFiles,
    reachableSourceModules: c.reachableSourceModules, orphanSourceModules: c.orphanSourceModules, missingImports: c.missingImports,
  },
  ui: {
    directInteractivePlugins: (inventory.directInteractivePlugins || []).length,
    relayMessage: c["uses.relayMessage"], generateWAMessageFromContent: c["uses.generateWAMessageFromContent"],
    interactiveMessage: c["uses.interactiveMessage"], buttonsMessage: c["uses.buttonsMessage"], listMessage: c["uses.listMessage"],
  },
  shell: { shellTrueFiles: inventory.shellTrueFiles || [], evalFiles: inventory.evalFiles || [], ssh2Files: inventory.ssh2Files || [] },
  collisions: { names: inventory.nameCollisions, aliases: inventory.aliasCollisions, aliasShadowsName: inventory.aliasShadowsName },
  unregisteredScrapers: snap.manifest.unregisteredScrapers || [],
  orphans: snap.orphans || [],
  silent: { total: silent.length, byRoot: silentByRoot, items: silent },
  secretShapes: secretHits,
  gates, versionDrift, docVersions, legacy, website,
  apiHosts: apis ? (Array.isArray(apis) ? apis.length : Object.keys(apis.hosts || apis).length) : null,
};

// ── 9. العوائق (مشتقة من الأرقام، لا مكتوبة يدوياً) ──
const blockers = [];
if (report.gates.some((g) => /enforceForNewUsers:\s*true|setting\("registrationRequired",\s*true/.test(g.text))) blockers.push("التسجيل إجباري للمستخدمين الجدد (يخالف §Phase 1).");
if (versionDrift.some((v) => v.value && !/^6/.test(String(v.value).replace(/^v/i, "")))) blockers.push("انحراف الإصدار: الحزمة/الإعدادات ليست V6.");
const liveOld = Object.entries(docVersions).filter(([v]) => /^V[345]$/.test(v)).flatMap(([, files]) => files);
if (liveOld.length) blockers.push(`تقارير إصدارات سابقة خارج الأرشيف: ${liveOld.join("، ")}`);
if (!website.dir) blockers.push("لا يوجد موقع ويب (web/ أو website/).");
if (!website.configSection) blockers.push("لا يوجد قسم website في config.js (رابط زر الموقع).");
if (silent.length) blockers.push(`${silent.length} إخفاق صامت في شجرة الإنتاج خارج نطاق الاختبار الحالي.`);
if (secretHits.length) blockers.push(`${secretHits.length} نص يشبه سراً خارج config.js.`);
const otp = legacy.find((l) => l.file === "plugins/owner/internetrakyat.js");
if (otp && !otp.isolated) blockers.push("plugins/owner/internetrakyat.js غير معزول (OTP لأرقام الغير).");
if (!exists("src/lib/providers/virtualizor/virtualizor-provisioner.js")) blockers.push("لا يوجد مُنشئ VPS حقيقي (Virtualizor addvs/create).");
// إضافات تبني الحمولات فعلاً (لها استدعاءات بناء/إرسال منخفضة المستوى) — تُستثنى الكواشف والمتغيرات المسمّاة
const BUILD_CALL = /generateWAMessageFromContent|relayMessage\s*\(|prepareWAMessageMedia|nativeFlowMessage\s*:/;
const trueBuilders = (inventory.directInteractivePlugins || []).filter((f) => exists(f) && BUILD_CALL.test(read(f)));
if (trueBuilders.length) blockers.push(`${trueBuilders.length} إضافة تبني رسائل تفاعلية مباشرة بدل طبقة الواجهة: ${trueBuilders.join("، ")}`);
if (report.unregisteredScrapers.length) blockers.push(`${report.unregisteredScrapers.length} scraper غير مسجّل في السجل.`);
if (c.missingImports) blockers.push(`${c.missingImports} استيراد مفقود.`);
report.blockers = blockers;

// ── 10. الكتابة ─────────────────────────────────
const table = (rows, head) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const md = [
  "# 🔬 Bot Terboo V6 — الفحص الجنائي (Phase 0)",
  "",
  `> مولَّد آلياً بـ \`node tools/terboo-forensic-v6.mjs\` — لا أرقام مكتوبة يدوياً. HEAD \`${report.head}\` · Node ${report.node} · ${report.generatedAt}`,
  "",
  "## 1. الأعداد",
  "",
  table(Object.entries(report.counts).map(([k, v]) => [k, v ?? "—"]), ["البند", "العدد"]),
  "",
  "## 2. الواجهات التفاعلية (منشئات مباشرة)",
  "",
  table(Object.entries(report.ui).map(([k, v]) => [k, v ?? "—"]), ["الاستخدام", "عدد المواضع"]),
  "",
  "## 3. التنفيذ والـshell",
  "",
  `- ملفات تنفيذ بصدفة (shell): ${report.shell.shellTrueFiles.length ? report.shell.shellTrueFiles.join("، ") : "لا يوجد"}`,
  `- ملفات eval: ${report.shell.evalFiles.join("، ") || "لا يوجد"}`,
  `- ملفات ssh2: ${report.shell.ssh2Files.join("، ") || "لا يوجد"}`,
  `- تصادم الأسماء/المرادفات: ${report.collisions.names}/${report.collisions.aliases} · مرادف يحجب اسماً: ${report.collisions.aliasShadowsName}`,
  "",
  "## 4. الاستيرادات والوحدات اليتيمة",
  "",
  `- استيرادات مفقودة: ${report.counts.missingImports}`,
  `- وحدات مصدر غير مستوردة من نقاط الدخول: ${report.orphans.length}`,
  ...report.orphans.slice(0, 30).map((o) => `  - \`${typeof o === "string" ? o : o.file || o.path}\` (مستورد من الاختبارات: ${o.importedByTests ?? "—"})`),
  `- scrapers غير مسجّلة: ${report.unregisteredScrapers.length}`,
  "",
  "## 5. الإخفاق الصامت (كل شجرة الإنتاج)",
  "",
  `الإجمالي: **${report.silent.total}** — الاختبار الحالي يغطي src وplugins فقط.`,
  "",
  table(Object.entries(report.silent.byRoot).map(([k, v]) => [k, v]), ["الجذر", "العدد"]),
  "",
  ...report.silent.items.slice(0, 60).map((s) => `- \`${s.file}:${s.line}\` — ${s.kind}`),
  "",
  "## 6. نصوص تشبه الأسرار خارج config.js",
  "",
  "المكان والنوع فقط — لا تُطبع أي قيمة.",
  "",
  ...(report.secretShapes.length ? report.secretShapes.map((s) => `- \`${s.file}:${s.line}\` — ${s.kind}`) : ["- لا يوجد."]),
  "",
  "## 7. الواجهات الخارجية",
  "",
  `- مضيفات خارجية مكتشفة: ${report.counts.externalHosts} (التفاصيل: \`node tools/terboo-inventory.mjs\` ← apis.json، والتصنيف في docs/EXTERNAL_API_CLASSIFICATION.md).`,
  "",
  "## 8. بوابات التسجيل",
  "",
  ...report.gates.map((g) => `- \`${g.file}:${g.line}\` — \`${g.text.replace(/`/g, "'")}\``),
  "",
  "## 9. انحراف الإصدار",
  "",
  table(report.versionDrift.map((v) => [v.where, v.value ?? "—"]), ["الموضع", "القيمة"]),
  "",
  "### التوثيق حسب الإصدار",
  "",
  table(Object.entries(report.docVersions).map(([v, files]) => [v, files.length]), ["الإصدار", "عدد الملفات"]),
  "",
  "## 10. المسارات القديمة/المعزولة",
  "",
  ...report.legacy.map((l) => `- \`${l.file}\` — ${l.why}`),
  "",
  "## 11. حالة الموقع",
  "",
  `- مجلد الموقع: ${report.website.dir || "غير موجود"}`,
  `- قسم website في config.js: ${report.website.configSection ? "موجود" : "غير موجود"}`,
  "",
  "## 12. العوائق المشتقة",
  "",
  ...(report.blockers.length ? report.blockers.map((b) => `- ${b}`) : ["- لا يوجد."]),
  "",
].join("\n");

fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), md);
if (JSON_OUT) fs.writeFileSync(path.join(ROOT, JSON_OUT), `${JSON.stringify(report, null, 1)}\n`);
console.log(`✅ ${OUT} — ${report.blockers.length} عائق · ${report.silent.total} إخفاق صامت · ${report.secretShapes.length} نص يشبه سراً`);
