// ═══════════════════════════════════════════════
// 🔍 Terboo Web Platform — Independent Inventory Generator
// ───────────────────────────────────────────────
// يولّد جرداً مستقلاً من checkout الحالي (تحليل static بحت):
//   • 01_FILE_INVENTORY.json   كل ملف ومساره ونوعه وحجمه وبصمته
//   • 03_PLUGIN_CATALOG.json   كل Plugin من المصدر: config · export shape · تعارضات
//   • 04_API_CATALOG.json      كل host/path من المصدر بلا أي قيمة سرية
//   • 07_ASSETS_AND_ROUTES.json أصل/مسار ومرجعه ووجوده الفعلي
//   • 02_IMPORT_CALL_GRAPH.json رسم الاستيراد ونقاط الدخول
// لا يستورد أي Plugin ولا ينفّذ أي كود منها ولا يلمس الشبكة أو قاعدة البيانات.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
// قفل الهوية (§5): أوصاف الإضافات تُكتب في التقارير بعد تصحيح أي اسم قديم،
// بنفس الدالة التي يستعملها البوت على ردود المزوّدات — لا اسم قديم يدخل docs/.
import { enforceBrand } from "../../src/lib/terboo-brand.js";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "docs", "web-platform");
const SKIP_DIRS = new Set(["node_modules", ".git", "tmp", "temp", "downloads", "session"]);

function decodeName(name) {
  return name.replace(/#U([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (entry.isFile()) acc.push(full);
  }
  return acc;
}

const KIND_BY_EXT = {
  ".js": "source", ".mjs": "source", ".cjs": "source", ".ts": "source", ".tsx": "source",
  ".json": "data", ".md": "doc", ".yaml": "config", ".yml": "config",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image", ".svg": "image",
  ".ttf": "font", ".otf": "font", ".woff": "font", ".woff2": "font",
  ".mp3": "audio", ".ogg": "audio", ".opus": "audio", ".wav": "audio", ".m4a": "audio",
  ".mp4": "video", ".webm": "video",
};

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch (error) {
    // لا بيانات Git في بيئة العمل ⇒ التقرير يُولَّد بلا بصمة commit
    console.warn(`[inventory] git HEAD unavailable: ${error.message}`);
    return "";
  }
}

// ── 01 — جرد الملفات ─────────────────────────────
function fileInventory(files) {
  const rows = [];
  for (const full of files) {
    const rel = path.relative(ROOT, full);
    const stat = fs.statSync(full);
    const ext = path.extname(full).toLowerCase();
    const kind = KIND_BY_EXT[ext] || "other";
    const row = {
      path: rel,
      decodedPath: decodeName(rel) === rel ? undefined : decodeName(rel),
      kind,
      ext,
      bytes: stat.size,
    };
    // بصمة للمصدر والبيانات فقط (الأصول الثقيلة بالحجم وحده)
    if (kind === "source" || kind === "config" || (kind === "data" && stat.size < 2_000_000)) {
      row.sha256 = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex").slice(0, 16);
    }
    rows.push(row);
  }
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return rows;
}

// ── 03 — سجل الإضافات (static) ───────────────────
const CONFIG_FIELDS = [
  "name", "alias", "category", "description", "usage", "example",
  "isOwner", "isPremium", "isGroup", "isPrivate", "isAdmin", "isBotAdmin",
  "cooldown", "limit", "energi", "isEnabled",
];

/** يقتطع كتلة كائن الإعداد نصّياً ثم يقرأ الحقول المعروفة بتعبيرات دقيقة */
function parsePluginConfig(src) {
  // الكتلة التي تحمل name: ثم description: — أي اسم متغير
  const start = src.search(/(?:const|let|var)\s+\w+\s*=\s*\{[^]*?name\s*:/);
  const literal = src.match(/export\s+const\s+config\s*=\s*\{/);
  let from = -1;
  if (literal) from = literal.index + literal[0].length - 1;
  else if (start !== -1) from = src.indexOf("{", start);
  if (from === -1) return null;
  // توازن الأقواس لاقتطاع الكتلة
  let depth = 0; let end = -1;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end === -1) return null;
  const block = src.slice(from, end + 1);
  const out = {};
  for (const field of CONFIG_FIELDS) {
    const re = new RegExp(`(?:^|[{,\\s])${field}\\s*:\\s*(\\[[^\\]]*\\]|'(?:[^'\\\\]|\\\\.)*'|"(?:[^"\\\\]|\\\\.)*"|\`(?:[^\`\\\\]|\\\\.)*\`|true|false|-?\\d+(?:\\.\\d+)?)`, "m");
    const hit = block.match(re);
    if (!hit) continue;
    let raw = hit[1].trim();
    if (raw === "true") out[field] = true;
    else if (raw === "false") out[field] = false;
    else if (/^-?\d/.test(raw)) out[field] = Number(raw);
    else if (raw.startsWith("[")) {
      out[field] = raw.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"`]|['"`]$/g, "")).filter(Boolean);
    } else out[field] = raw.slice(1, -1);
  }
  return Object.keys(out).length ? out : null;
}

function pluginCatalog() {
  const dir = path.join(ROOT, "plugins");
  if (!fs.existsSync(dir)) return { generatedAt: new Date().toISOString(), plugins: [], conflicts: [] };
  const rows = [];
  for (const category of fs.readdirSync(dir)) {
    const catPath = path.join(dir, category);
    if (!fs.statSync(catPath).isDirectory()) continue;
    for (const file of fs.readdirSync(catPath)) {
      if (!file.endsWith(".js")) continue;
      const rel = path.join("plugins", category, file);
      const full = path.join(catPath, file);
      const src = fs.readFileSync(full, "utf8");
      // قاعدة المحمّل الفعلية: ملفات تبدأ بـ "_" لا تُحمّل أبداً
      const skippedByLoader = file.startsWith("_");
      const hasConfig = /(?:config\s*:|name\s*:)/.test(src);
      const hasHandler = /\bhandler\b/.test(src);
      const exportsDefault = /export\s+default/.test(src);
      const exportsNamed = /export\s*\{[^}]*\bhandler\b/.test(src) || /export\s+(?:async\s+)?function\s+handler/.test(src);
      const cfg = parsePluginConfig(src);
      const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
      const usesScraper = imports.some((i) => i.includes("/scraper/"));
      const usesHttp = /\b(axios|fetch|undici|node-fetch|got)\b/.test(src);
      const usesTransport = imports.some((i) => i.includes("terboo-transport") || i.includes("terboo-builder") || i.includes("terboo-ui"));
      const directSend = /sock\.sendMessage\s*\(/.test(src);
      const interactive = /interactiveMessage|nativeFlowMessage|cta_url/.test(src);
      const needsMedia = /quoted|m\.quoted|downloadMedia|getMedia|mimetype/.test(src);
      const spawns = /child_process|exec\(|spawn\(|execSync/.test(src);
      const evals = /\beval\s*\(|new Function\s*\(/.test(src);

      rows.push({
        file: rel,
        decodedFile: decodeName(rel) === rel ? undefined : decodeName(rel),
        folderCategory: category,
        // «مسجَّل» = يحمّله loadPlugins فعلاً (config + handler + لا يبدأ بـ _)
        registered: Boolean(!skippedByLoader && hasConfig && hasHandler),
        skippedByLoader,
        exportShape: exportsNamed ? "named" : exportsDefault ? "default" : "unknown",
        command: cfg?.name ?? null,
        alias: cfg?.alias ?? [],
        category: cfg?.category ?? category,
        description: cfg?.description ? enforceBrand(cfg.description) : null,
        usage: cfg?.usage ? enforceBrand(cfg.usage) : null,
        permissions: {
          isOwner: cfg?.isOwner ?? false,
          isPremium: cfg?.isPremium ?? false,
          isGroup: cfg?.isGroup ?? false,
          isPrivate: cfg?.isPrivate ?? false,
          isAdmin: cfg?.isAdmin ?? false,
          isBotAdmin: cfg?.isBotAdmin ?? false,
        },
        cost: { cooldown: cfg?.cooldown ?? 3, energi: cfg?.energi ?? 0, limit: cfg?.limit ?? 1 },
        enabled: cfg?.isEnabled ?? true,
        signals: { usesScraper, usesHttp, usesTransport, directSend, interactive, needsMedia, spawns, evals },
        // قابلية الويب تُحكم لاحقاً في 10_WEB_CAPABILITY_MATRIX؛ هنا السبب التقني فقط
        webFeasibility: "whatsapp-only:handler-requires-serialized-message-and-live-socket",
        dependencies: imports.filter((i) => !i.startsWith(".")),
      });
    }
  }

  // تعارض الأسماء والـaliases بين الإضافات المسجّلة
  const byName = new Map();
  const conflicts = [];
  for (const row of rows.filter((r) => r.registered && r.command)) {
    for (const name of String(row.command).split("|").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
      if (byName.has(name)) conflicts.push({ type: "command", name, files: [byName.get(name), row.file] });
      else byName.set(name, row.file);
    }
  }
  const byAlias = new Map();
  for (const row of rows.filter((r) => r.registered)) {
    for (const alias of row.alias || []) {
      const key = String(alias).toLowerCase();
      if (!key) continue;
      if (byAlias.has(key)) conflicts.push({ type: "alias", name: key, files: [byAlias.get(key), row.file] });
      else byAlias.set(key, row.file);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    gitHead: gitHead(),
    method: "static source analysis — no plugin was imported or executed",
    totals: {
      files: rows.length,
      registered: rows.filter((r) => r.registered).length,
      skippedByLoader: rows.filter((r) => r.skippedByLoader).length,
      notRegisterable: rows.filter((r) => !r.registered && !r.skippedByLoader).length,
      withDirectSend: rows.filter((r) => r.signals.directSend).length,
      withEval: rows.filter((r) => r.signals.evals).length,
      withSpawn: rows.filter((r) => r.signals.spawns).length,
    },
    conflicts,
    plugins: rows,
  };
}

// ── 04 — سجل الـAPIs الخارجية ────────────────────
const SECRET_HINT = /(key|token|secret|auth|password|passwd|pwd|session|cookie|bearer|apikey)/i;

function apiCatalog(files) {
  const hosts = new Map();
  for (const full of files) {
    const ext = path.extname(full).toLowerCase();
    if (![".js", ".mjs", ".cjs"].includes(ext)) continue;
    const rel = path.relative(ROOT, full);
    if (rel.startsWith("node_modules")) continue;
    const src = fs.readFileSync(full, "utf8");
    for (const match of src.matchAll(/https?:\/\/([A-Za-z0-9._-]+)(\/[^\s'"`)\\]*)?/g)) {
      const host = match[1].toLowerCase();
      if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;
      // المسار بلا query ولا fragment ولا أي قيمة قد تحمل سراً
      let p = (match[2] || "/").split("?")[0].split("#")[0];
      p = p.replace(/\$\{[^}]*\}/g, ":var").slice(0, 120);
      const hadQuery = Boolean((match[2] || "").includes("?"));
      if (!hosts.has(host)) hosts.set(host, { host, paths: new Set(), files: new Set(), queryStringsSeen: false });
      const bucket = hosts.get(host);
      bucket.paths.add(p);
      bucket.files.add(rel);
      if (hadQuery) bucket.queryStringsSeen = true;
    }
  }
  // أسماء متغيرات الأسرار المستعملة (أسماء فقط — لا قيم أبداً)
  const envNames = new Set();
  for (const full of files) {
    if (![".js", ".mjs"].includes(path.extname(full).toLowerCase())) continue;
    const src = fs.readFileSync(full, "utf8");
    for (const m of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) envNames.add(m[1]);
  }

  const rows = [...hosts.values()]
    .map((b) => ({
      host: b.host,
      pathsWithoutQuery: [...b.paths].sort().slice(0, 25),
      pathCount: b.paths.size,
      calledFrom: [...b.files].sort().slice(0, 12),
      callerCount: b.files.size,
      // تحذير: الكود يبني query string لهذا المضيف ⇒ قد يحمل مفتاحاً في الرابط
      buildsQueryString: b.queryStringsSeen,
    }))
    .sort((a, b) => b.callerCount - a.callerCount);

  return {
    generatedAt: new Date().toISOString(),
    gitHead: gitHead(),
    policy: "hosts and paths only — query strings, tokens and credential values are never recorded",
    totals: { hosts: rows.length, secretEnvNames: envNames.size },
    secretEnvNames: [...envNames].sort(),
    hosts: rows,
  };
}

// ── 07 — الأصول والمسارات ────────────────────────
function assetManifest(files) {
  const assetFiles = files
    .map((f) => path.relative(ROOT, f))
    .filter((r) => r.startsWith("assets" + path.sep));
  const present = new Set(assetFiles);
  // كل مرجع نصّي لمسار assets/ داخل المصدر
  const refs = new Map();
  for (const full of files) {
    if (![".js", ".mjs", ".json"].includes(path.extname(full).toLowerCase())) continue;
    const rel = path.relative(ROOT, full);
    if (rel.startsWith("assets" + path.sep)) continue;
    const src = fs.readFileSync(full, "utf8");
    for (const m of src.matchAll(/["'`]((?:\.\/|\.\.\/)*assets\/[A-Za-z0-9._/#-]+)["'`]/g)) {
      const target = m[1].replace(/^(?:\.\.\/|\.\/)+/, "");
      if (!refs.has(target)) refs.set(target, new Set());
      refs.get(target).add(rel);
    }
  }
  const referenced = [...refs.entries()].map(([target, from]) => ({
    reference: target,
    exists: present.has(target.split("/").join(path.sep)),
    referencedFrom: [...from].sort().slice(0, 8),
  }));
  return {
    generatedAt: new Date().toISOString(),
    gitHead: gitHead(),
    totals: {
      assetFiles: assetFiles.length,
      referencedPaths: referenced.length,
      missingReferences: referenced.filter((r) => !r.exists).length,
    },
    missingReferences: referenced.filter((r) => !r.exists),
    assets: assetFiles.sort(),
    references: referenced.sort((a, b) => a.reference.localeCompare(b.reference)),
  };
}

// ── 02 — رسم الاستيراد ──────────────────────────
function importGraph(files) {
  const nodes = {};
  const sourceFiles = files.filter((f) => [".js", ".mjs"].includes(path.extname(f).toLowerCase()));
  for (const full of sourceFiles) {
    const rel = path.relative(ROOT, full);
    const src = fs.readFileSync(full, "utf8");
    const statics = [...src.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    const dynamics = [...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    const local = [...statics, ...dynamics].filter((i) => i.startsWith("."));
    const resolved = local.map((i) => {
      const abs = path.resolve(path.dirname(full), i);
      return path.relative(ROOT, abs);
    });
    nodes[rel] = {
      staticImports: statics.length,
      dynamicImports: dynamics.length,
      localTargets: [...new Set(resolved)].sort(),
      externalTargets: [...new Set([...statics, ...dynamics].filter((i) => !i.startsWith(".")))].sort(),
      exportsNamed: /export\s*\{/.test(src),
      exportsDefault: /export\s+default/.test(src),
    };
  }
  // من يستورد من؟ ⇒ الوحدات التي لم يثبت استدعاؤها
  const imported = new Set();
  for (const node of Object.values(nodes)) for (const t of node.localTargets) imported.add(t);
  const entryPoints = ["index.js"];
  const neverImported = Object.keys(nodes)
    .filter((f) => !entryPoints.includes(f))
    .filter((f) => !imported.has(f))
    // الإضافات تُحمّل ديناميكياً بالمسار ⇒ غياب الاستيراد ليس دليل موت
    .map((f) => ({
      file: f,
      dynamicallyLoaded: f.startsWith("plugins" + path.sep) || f.startsWith("tools" + path.sep) || f.startsWith("tests" + path.sep),
    }));
  return {
    generatedAt: new Date().toISOString(),
    gitHead: gitHead(),
    note: "plugins/ are loaded dynamically by path — a missing static import is not proof of dead code",
    totals: { modules: Object.keys(nodes).length, neverStaticallyImported: neverImported.length },
    entryPoints,
    neverStaticallyImported: neverImported,
    modules: nodes,
  };
}

// ── التشغيل ─────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const files = walk(ROOT);
const write = (name, data) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + "\n", "utf8");
  const bytes = fs.statSync(path.join(OUT, name)).size;
  console.log(`  ✓ ${name}  (${(bytes / 1024).toFixed(1)} KB)`);
};

console.log(`Terboo web-platform inventory · ${files.length} files scanned · HEAD ${gitHead().slice(0, 8) || "n/a"}`);
write("01_FILE_INVENTORY.json", {
  generatedAt: new Date().toISOString(), gitHead: gitHead(), root: ".",
  totals: { files: files.length, bytes: files.reduce((n, f) => n + fs.statSync(f).size, 0) },
  files: fileInventory(files),
});
write("03_PLUGIN_CATALOG.json", pluginCatalog());
write("04_API_CATALOG.json", apiCatalog(files));
write("07_ASSETS_AND_ROUTES.json", assetManifest(files));
write("02_IMPORT_CALL_GRAPH.json", importGraph(files));
console.log("done.");
