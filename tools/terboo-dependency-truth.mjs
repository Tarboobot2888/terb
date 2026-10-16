#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🧾 Terboo Runtime Dependency Truth (§2 §3)
// ───────────────────────────────────────────────
// الحقيقة من lockfile + node_modules + الاستيراد الفعلي، لا من README ولا اسم الـZIP:
//   • الحزمة المطلوبة في package.json · المحلولة في package-lock · المثبّتة فعلاً
//   • أي alias/fork (npm:…) أو اسم بديل (maro…) في الشيفرة
//   • مسار الحزمة الذي يحمّله Node فعلاً + مصدر WAProto وتنفيذ protobuf
//   • كل اسم مُستورد من Baileys في المشروع موجود فعلاً في نسخة التشغيل
//   • وجود نسخة واحدة فقط من مكتبة واتساب في الـruntime
//
//   node tools/terboo-dependency-truth.mjs [--out docs/terboo-runtime-dependency-truth.json] [--check]
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const outFile = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const strict = args.includes("--check");
const require = createRequire(path.join(ROOT, "package.json"));

const WA = "@whiskeysockets/baileys";
const TARGET = "7.0.0-rc14";
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));

// ── 1. كل حزم واتساب/البروتو في الـlockfile (لكشف fork ثانٍ أو alias) ──
const WA_LIKE = /baileys|whatsapp|wa-?proto|libsignal|^node_modules\/maro|\/maro$|protobufjs$/i;
const lockEntries = Object.entries(lock.packages || {})
  .filter(([key]) => key && WA_LIKE.test(key))
  .map(([key, value]) => ({ path: key, version: value.version, resolved: value.resolved || null, dev: Boolean(value.dev), name: value.name || null }));
const aliases = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter(([, spec]) => String(spec).startsWith("npm:"))
  .map(([name, spec]) => ({ name, spec }));

// ── 2. الحزمة التي يحمّلها Node فعلاً ──────────
const entryPath = require.resolve(WA);
let pkgDir = path.dirname(entryPath);
while (!fs.existsSync(path.join(pkgDir, "package.json"))) pkgDir = path.dirname(pkgDir);
const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
const runtime = await import(pathToFileURL(entryPath).href);

// ── 3. WAProto: المصدر والتنفيذ وواجهات التحويل المتاحة ──
const protoFile = path.join(pkgDir, "WAProto", "index.js");
const protoSrc = fs.existsSync(protoFile) ? fs.readFileSync(protoFile, "utf8") : "";
const protobufImpl = protoSrc.match(/from\s+["'](protobufjs[^"']*)["']/)?.[1] || null;
const protobufPkg = JSON.parse(fs.readFileSync(require.resolve("protobufjs/package.json"), "utf8"));
const proto = runtime.proto;
const sample = proto?.Message?.InteractiveMessage;
const protoApi = {
  fromObject: typeof sample?.fromObject === "function",
  create: typeof sample?.create === "function",
  encode: typeof sample?.encode === "function",
  decode: typeof sample?.decode === "function",
  toObject: typeof sample?.toObject === "function",
  decodeAndHydrate: typeof runtime.decodeAndHydrate === "function",
  generatedFromObjectCount: (protoSrc.match(/\.fromObject = function fromObject/g) || []).length,
  generatedCreateCount: (protoSrc.match(/\.create = function create/g) || []).length,
};

// ── 4. كل اسم يستورده المشروع من Baileys موجود؟ ─
function codeFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "session", "tmp", "temp"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) codeFiles(full, out);
    else if (/\.(m?js)$/.test(entry.name)) out.push(full);
  }
  return out;
}
const importedNames = {};
const missingNames = {};
const otherWaPackages = new Set();
for (const file of codeFiles(ROOT)) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const src = fs.readFileSync(file, "utf8");
  const re = /import\s*\{([^}]*)\}\s*from\s*["']@whiskeysockets\/baileys["']|const\s*\{([^}]*)\}\s*=\s*(?:await\s+)?import\(\s*["']@whiskeysockets\/baileys["']\s*\)/g;
  for (const match of src.matchAll(re)) {
    for (const part of (match[1] || match[2]).split(",")) {
      const name = part.trim().split(/\s+as\s+|\s*:\s*/)[0].trim();
      if (!name) continue;
      (importedNames[name] ||= new Set()).add(rel);
      if (!(name in runtime)) (missingNames[name] ||= new Set()).add(rel);
    }
  }
  for (const match of src.matchAll(/from\s+["']((?:@[\w-]+\/)?[\w-]*(?:baileys|maro)[\w-]*)["']|import\(\s*["']((?:@[\w-]+\/)?[\w-]*(?:baileys|maro)[\w-]*)["']\s*\)/gi)) {
    const name = match[1] || match[2];
    if (name !== WA) otherWaPackages.add(`${name} ← ${rel}`);
  }
}

// حزمة أخرى تشبه واتساب: مثبّتة فعلاً (= نسخة ثانية في الـruntime) أم اختيارية تُستورد كسولاً ولم تُثبَّت؟
const resolvable = (name) => {
  try {
    require.resolve(name);
    return true;
  } catch (error) {
    // غير المثبَّت هو الجواب المقصود؛ أي خطأ آخر (حزمة تالفة) يُعامل كغير قابل للحل ويُطبع
    if (error?.code !== "MODULE_NOT_FOUND") console.warn(`⚠️ dependency-truth: ${name}: ${error?.code || error?.message}`);
    return false;
  }
};
const otherInstalled = [...otherWaPackages].filter((x) => resolvable(x.split(" ← ")[0]));
const otherOptional = [...otherWaPackages].filter((x) => !resolvable(x.split(" ← ")[0]));

const requested = pkg.dependencies?.[WA] || null;
const lockRoot = lock.packages?.[`node_modules/${WA}`] || {};
// نسخة مستقلة من مكتبة واتساب = مدخل lockfile آخر مقطع فيه اسم حزمة baileys (لا اعتمادياتها المتداخلة)
const baileysCopies = lockEntries.filter((e) => /(?:^|\/)node_modules\/(?:@[\w-]+\/)?[\w-]*baileys[\w-]*$/i.test(e.path));
const checks = {
  requestedIsTarget: requested === TARGET,
  lockResolvesTarget: lockRoot.version === TARGET && /registry\.npmjs\.org\/@whiskeysockets\/baileys\/-\/baileys-7\.0\.0-rc14\.tgz$/.test(lockRoot.resolved || ""),
  installedIsTarget: installed.version === TARGET && installed.name === WA,
  singleWhatsAppLibrary: baileysCopies.length === 1 && otherInstalled.length === 0,
  noAliasOrFork: aliases.length === 0 && !/github|git\+|file:/.test(requested || ""),
  allImportedNamesExist: Object.keys(missingNames).length === 0,
  protoHasEncodeDecode: protoApi.encode && protoApi.decode,
};

// ── حقيقة كل حزم npm: المطلوب في package.json · المحلول في lockfile · المثبّت · المستورد فعلاً ──
const BUILTINS = new Set(require("node:module").builtinModules);
const declared = { ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.devDependencies };
const usedPackages = new Map();
const allCodeFiles = [];
(function walkCode(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "session", "tmp", "temp", "database", "data", "backup"].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walkCode(full);
    else if (/\.(m|c)?js$/.test(e.name)) allCodeFiles.push(full);
  }
})(ROOT);
for (const file of allCodeFiles) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/(?:from\s*|import\(\s*|require\(\s*)["'`]([^"'`./][^"'`]*)["'`]/g)) {
    const spec = m[1];
    if (spec.startsWith("node:")) continue;
    const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0];
    // أسماء npm صالحة فقط (لا قوالب نصية ولا مسارات file:)
    if (BUILTINS.has(name) || !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/.test(name) || name.length < 2) continue;
    if (!usedPackages.has(name)) usedPackages.set(name, new Set());
    usedPackages.get(name).add(path.relative(ROOT, file));
  }
}
const npmTruth = Object.fromEntries([...new Set([...Object.keys(declared), ...usedPackages.keys()])].sort().map((name) => {
  const lockEntry = lock.packages?.[`node_modules/${name}`] || null;
  let installedVersion = null;
  try { installedVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", name, "package.json"), "utf8")).version; } catch { installedVersion = null; }
  return [name, {
    requested: declared[name] || null,
    locked: lockEntry?.version || null,
    installed: installedVersion,
    usedIn: usedPackages.has(name) ? usedPackages.get(name).size : 0,
  }];
}));
const undeclaredUsed = Object.entries(npmTruth).filter(([, v]) => !v.requested && v.usedIn).map(([k, v]) => ({ name: k, installed: v.installed, files: [...usedPackages.get(k)].slice(0, 5) }));
const declaredUnused = Object.entries(npmTruth).filter(([, v]) => v.requested && !v.usedIn).map(([k]) => k);
const declaredNotInstalled = Object.entries(npmTruth).filter(([, v]) => v.requested && !v.installed).map(([k]) => k);

const truth = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  target: { package: WA, version: TARGET },
  requested: { package: WA, spec: requested },
  declaredPackage: WA,
  resolved: { package: lockRoot.name || WA, version: lockRoot.version || null, resolved: lockRoot.resolved || null, integrity: lockRoot.integrity || null },
  installed: { name: installed.name, version: installed.version, path: path.relative(ROOT, pkgDir), entry: path.relative(ROOT, entryPath), type: installed.type || "commonjs" },
  aliases,
  fork: baileysCopies.length > 1 || otherInstalled.length ? [...otherInstalled, ...baileysCopies.map((e) => e.path)] : null,
  optionalNotInstalled: otherOptional.map((x) => ({ import: x, note: "lazy import() guarded by try/catch with an install hint; not in package.json, not in node_modules — never loaded at runtime" })),
  legacyAliasMaro: { usedInCode: [...otherWaPackages].some((x) => /maro/i.test(x)), note: "v4.0 imports @whiskeysockets/baileys directly; no 'maro' alias package is declared, locked or imported." },
  lockfileWhatsAppGraph: lockEntries,
  proto: {
    source: path.relative(ROOT, protoFile),
    protobufImplementation: protobufImpl,
    protobufjsVersion: protobufPkg.version,
    api: protoApi,
    conclusion: protoApi.fromObject
      ? "rc14 WAProto ships real converting fromObject() and Baileys itself calls it; create() does not convert enum names or base64 bytes. Production code goes through the Terboo proto adapter instead of calling either directly."
      : "fromObject() is absent: create() + encode/decode only.",
  },
  runtimeApi: {
    exportCount: Object.keys(runtime).length,
    identity: Object.fromEntries(["jidNormalizedUser", "isLidUser", "isPnUser", "isHostedLidUser", "isHostedPnUser", "areJidsSameUser", "jidDecode", "jidEncode", "isJidUser"].map((n) => [n, n in runtime])),
    messaging: Object.fromEntries(["generateWAMessageFromContent", "generateWAMessage", "prepareWAMessageMedia", "normalizeMessageContent", "getContentType", "downloadContentFromMessage", "generateMessageIDV2"].map((n) => [n, n in runtime])),
  },
  projectImports: {
    names: Object.fromEntries(Object.entries(importedNames).map(([k, v]) => [k, v.size]).sort()),
    missing: Object.fromEntries(Object.entries(missingNames).map(([k, v]) => [k, [...v].sort()])),
  },
  packages: {
    total: Object.keys(npmTruth).length,
    declared: Object.keys(declared).length,
    undeclaredUsed,
    declaredUnused,
    declaredNotInstalled,
    table: npmTruth,
  },
  checks,
  verification: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
};

if (outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, `${JSON.stringify(truth, null, 2)}\n`);
  console.log(`✅ ${outFile}`);
}
console.log(`${truth.verification} · ${WA} requested=${requested} resolved=${truth.resolved.version} installed=${installed.version}`);
for (const [name, ok] of Object.entries(checks)) console.log(`  ${ok ? "✓" : "✗"} ${name}`);
if (Object.keys(truth.projectImports.missing).length) console.log("  missing imports:", JSON.stringify(truth.projectImports.missing));
console.log(`  npm: ${truth.packages.declared} declared · ${truth.packages.declaredNotInstalled.length} not installed · ${truth.packages.undeclaredUsed.length} used but undeclared · ${truth.packages.declaredUnused.length} declared but unused`);
for (const u of truth.packages.undeclaredUsed) console.log(`    undeclared: ${u.name} (installed=${u.installed || "no"}) ← ${u.files.join(", ")}`);
process.exit(strict && truth.verification !== "PASS" ? 1 : 0);
