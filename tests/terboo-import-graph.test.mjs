// اختبار رسم الاستيرادات (§43)
//
// يحلّل كل ملف JavaScript بمحلّل AST حقيقي (acorn) — لا بتعابير نصية — ويجمع:
//   • import … from "x"      • export … from "x"      • import "x"
//   • import("x") بنص ثابت   • require("x") بنص ثابت
// ثم يتأكد أن:
//   • كل مسار نسبي يشير إلى ملف موجود فعلاً (ESM يشترط الامتداد الصريح).
//   • كل حزمة خارجية مثبّتة في node_modules أو من وحدات Node المدمجة.
//   • لا يوجد أي استيراد محلي بالأسماء القديمة maro-* بعد إعادة التسمية.
//   • مكتبة واتساب الوحيدة هي @whiskeysockets/baileys@7.0.0-rc14 الرسمية (v4 §2).
//
// الاستيراد الديناميكي بمسار مُركّب وقت التشغيل (template فيه ${…}) خارج
// نطاق الفحص الثابت لأنه لا يُعرف إلا عند التشغيل.

import assert from "node:assert/strict";
import fs from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import * as acorn from "acorn";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "plugins", "tests", "tools", "case"];
const SKIP = new Set(["node_modules", ".git", "session", "temp", "tmp", "downloads"]);
const EXT = /\.(js|mjs|cjs)$/;
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXT.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [
  ...SCAN_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))),
  ...fs.readdirSync(ROOT).filter((name) => EXT.test(name)).map((name) => path.join(ROOT, name)),
];

/** نص ثابت من عقدة Literal أو TemplateLiteral بلا تعابير */
function staticString(node) {
  if (!node) return null;
  if (node.type === "Literal" && typeof node.value === "string") return node.value;
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) return node.quasis[0].value.cooked;
  return null;
}

/** مرور عام على شجرة AST */
function visit(node, fn) {
  if (!node || typeof node.type !== "string") return;
  fn(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) for (const item of child) visit(item, fn);
    else if (child && typeof child === "object" && typeof child.type === "string") visit(child, fn);
  }
}

function collectSpecifiers(file) {
  const code = fs.readFileSync(file, "utf8");
  const isCjs = file.endsWith(".cjs");
  const ast = acorn.parse(code, {
    ecmaVersion: "latest",
    sourceType: isCjs ? "script" : "module",
    allowHashBang: true,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    allowImportExportEverywhere: true,
  });
  const specs = [];
  visit(ast, (node) => {
    if ((node.type === "ImportDeclaration" || node.type === "ExportAllDeclaration" || node.type === "ExportNamedDeclaration") && node.source) {
      specs.push({ spec: node.source.value, kind: "static" });
    } else if (node.type === "ImportExpression") {
      const value = staticString(node.source);
      if (value !== null) specs.push({ spec: value, kind: "dynamic" });
    } else if (
      node.type === "CallExpression" &&
      node.callee?.type === "Identifier" &&
      node.callee.name === "require" &&
      node.arguments.length === 1
    ) {
      const value = staticString(node.arguments[0]);
      if (value !== null) specs.push({ spec: value, kind: "require" });
    }
  });
  return specs;
}

/** اسم الحزمة من المُعرِّف العاري: "@scope/pkg/x" ← "@scope/pkg" */
function packageName(spec) {
  const parts = spec.split("/");
  return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const packageCache = new Map();
function packageInstalled(name) {
  if (!packageCache.has(name)) packageCache.set(name, fs.existsSync(path.join(ROOT, "node_modules", name)));
  return packageCache.get(name);
}

/**
 * اعتمادات اختيارية تُحمَّل ديناميكياً عند الطلب فقط، مع رسالة واضحة عند غيابها.
 * لا تمنع تحميل أي بلوقن، ولا تُقبل إلا كاستيراد ديناميكي.
 */
const OPTIONAL_PACKAGES = {
  "baileys-caller": "plugins/owner/مكالمة.js — مكالمات صوتية اختيارية",
};

const parseFailures = [];
const missingLocal = [];
const missingPackages = [];
const legacyImports = [];
// أي مكتبة واتساب غير Baileys الرسمي (الـfork السابق أو حزمة شبيهة بالاسم).
// الإضافات الاختيارية الموثّقة أعلاه (مثل baileys-caller للمكالمات) ليست بديلاً للمكتبة.
const forkImports = [];
const isForkPackage = (name) => name !== "@whiskeysockets/baileys" && !OPTIONAL_PACKAGES[name] && (name === "maro" || /baileys/i.test(name));
let edges = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  let specs;
  try {
    specs = collectSpecifiers(file);
  } catch (error) {
    parseFailures.push(`${rel}: ${error.message}`);
    continue;
  }

  for (const { spec, kind } of specs) {
    edges += 1;
    if (spec.startsWith("./") || spec.startsWith("../")) {
      const clean = spec.split("?")[0].split("#")[0];
      const target = path.resolve(path.dirname(file), clean);
      if (/(^|\/)maro-[^/]*$/.test(clean) || /\/maro-locales\//.test(clean)) {
        legacyImports.push(`${rel} → ${spec}`);
      }
      if (!fs.existsSync(target) || fs.statSync(target).isDirectory()) {
        missingLocal.push(`${rel} (${kind}) → ${spec}`);
      }
      continue;
    }
    if (spec.startsWith("file:") || spec.startsWith("data:") || spec.startsWith("/")) continue;
    if (isForkPackage(packageName(spec))) forkImports.push(`${rel} → ${spec}`);
    if (BUILTINS.has(spec) || BUILTINS.has(packageName(spec))) continue;
    if (OPTIONAL_PACKAGES[packageName(spec)] && kind === "dynamic") continue;
    if (!packageInstalled(packageName(spec))) missingPackages.push(`${rel} → ${spec}`);
  }
}

const unexpectedMissing = missingLocal;

assert.equal(parseFailures.length, 0, `تعذّر تحليل ملفات:\n${parseFailures.join("\n")}`);
assert.equal(legacyImports.length, 0, `استيرادات محلية بالأسماء القديمة:\n${legacyImports.join("\n")}`);
assert.equal(unexpectedMissing.length, 0, `استيرادات محلية لملفات غير موجودة:\n${unexpectedMissing.join("\n")}`);
assert.equal(missingPackages.length, 0, `حزم غير مثبّتة:\n${missingPackages.join("\n")}`);
assert.ok(edges > 3000, `عدد الاستيرادات المفحوصة منخفض بشكل مريب: ${edges}`);

// v4 §2: مكتبة واتساب هي Baileys الرسمي المثبّت بإصدار محدّد، ولا يبقى أي استيراد للـfork السابق
const OFFICIAL = "@whiskeysockets/baileys";
const officialPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules", OFFICIAL, "package.json"), "utf8"));
assert.equal(officialPkg.name, OFFICIAL);
assert.equal(officialPkg.version, "7.0.0-rc14", `إصدار Baileys المثبّت ${officialPkg.version}`);
assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).dependencies[OFFICIAL], "7.0.0-rc14");
assert.equal(forkImports.length, 0, `استيرادات متبقية للمكتبة السابقة:\n${forkImports.join("\n")}`);

console.log(`✅ terboo-import-graph: ${files.length} ملف · ${edges} استيراد · 0 مفقود · 0 استيراد محلي قديم`);
process.exit(0);
