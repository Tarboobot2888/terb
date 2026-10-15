#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 📦 حزمة إصدار/تحديث Bot Terboo — كل ملفات git كما هي (بما فيها ملفات عرض الكود الخمسة بلا تعديل)
// ───────────────────────────────────────────────
//   node tools/terboo-package.mjs --name Bot-Terboo-V6 --out <dir> [--readme <file>] [--max-mb 27] [--exclude config.js]
// أجزاء مستقلة (كل جزء zip كامل يُفك وحده) أصغر من الحد · يتحقق بعد البناء أن كل ملف متتبَّع موجود
// في جزء واحد بالضبط وأن ملفات عرض الكود الخمسة مطابقة للمستودع بايتاً ببايت.
// ═══════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import AdmZip from "adm-zip";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const NAME = opt("name", "Bot-Terboo");
const OUT = path.resolve(opt("out", "."));
const README = opt("readme", "");
const LIMIT = Number(opt("max-mb", "27")) * 1024 * 1024;
// ملفات تُستبعد صراحةً من الحزمة (config.js يحمل مفاتيح حقيقية — تُشحن config.example.js بدلاً منه)
const EXCLUDE = new Set(String(opt("exclude", "")).split(",").map((x) => x.trim()).filter(Boolean));
// ملفات تُضاف صراحةً وإن لم تكن متتبَّعة في git (مثل config.js الحيّ عند طلب المالك
// حزمة جاهزة للتشغيل). كل مسار هنا يُسجَّل في المخرجات حتى لا تُشحن أسرار بالخطأ.
const INCLUDE = String(opt("include", "")).split(",").map((x) => x.trim()).filter(Boolean);
for (const f of INCLUDE) {
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) throw new Error(`--include: not a file: ${f}`);
}

/** ملفات عرض الكود: تُشحن دائماً كما هي في المستودع (لا تُستبعد ولا تُعدَّل) */
const CODE_DISPLAY = [
  "src/lib/terboo-rich-response.js",
  "src/lib/terboo-code-renderer.js",
  "src/lib/terboo-code-card.js",
  "plugins/owner/بطاقة_الكود.js",
  "plugins/owner/كشف_الكود.js",
];

const tracked = execFileSync("git", ["ls-files", "-z"]).toString("utf8").split("\0").filter((f) => f && !EXCLUDE.has(f) && fs.existsSync(f) && fs.statSync(f).isFile());
const files = [...new Set([...tracked, ...INCLUDE.filter((f) => !EXCLUDE.has(f))])].sort();
for (const f of CODE_DISPLAY) if (!files.includes(f)) throw new Error(`missing from git: ${f}`);

// تخطيط الأجزاء بالحجم المضغوط الفعلي لكل ملف (+ ترويسات)
const plan = [[]];
let used = 0;
for (const file of files) {
  const size = zlib.deflateRawSync(fs.readFileSync(file), { level: 9 }).length + 200 + Buffer.byteLength(file) * 2;
  if (used + size > LIMIT && plan.at(-1).length) {
    plan.push([]);
    used = 0;
  }
  plan.at(-1).push(file);
  used += size;
}

fs.mkdirSync(OUT, { recursive: true });
const parts = [];
plan.forEach((group, index) => {
  const zip = new AdmZip();
  if (README) zip.addLocalFile(README, NAME, "اقرأني.txt");
  for (const file of group) zip.addLocalFile(file, path.posix.join(NAME, path.posix.dirname(file)), path.posix.basename(file));
  const target = path.join(OUT, plan.length > 1 ? `${NAME}-Part${index + 1}.zip` : `${NAME}.zip`);
  zip.writeZip(target);
  parts.push(target);
});

// تحقق: كل ملف مرة واحدة · الحجم تحت الحد · ملفات عرض الكود مطابقة
const seen = new Map();
for (const part of parts) {
  if (fs.statSync(part).size > LIMIT + 1024 * 1024) throw new Error(`part too large: ${part}`);
  for (const entry of new AdmZip(part).getEntries()) {
    if (entry.isDirectory) continue;
    const rel = entry.entryName.slice(NAME.length + 1);
    if (rel === "اقرأني.txt") continue;
    seen.set(rel, (seen.get(rel) || 0) + 1);
    if (CODE_DISPLAY.includes(rel) && !entry.getData().equals(fs.readFileSync(rel))) throw new Error(`code-display file differs: ${rel}`);
  }
}
const missing = files.filter((f) => seen.get(f) !== 1);
if (missing.length) throw new Error(`files missing or duplicated: ${missing.slice(0, 5).join(", ")}`);

for (const part of parts) console.log(`📦 ${path.basename(part)} · ${(fs.statSync(part).size / 1048576).toFixed(2)} MB`);
console.log(`✅ ${files.length} files · code-display files included unchanged: ${CODE_DISPLAY.length}/5`);
if (INCLUDE.length) console.log(`⚠️  ملفات غير متتبَّعة شُحنت صراحةً: ${INCLUDE.join(" · ")}`);
if (EXCLUDE.size) console.log(`🚫 مستبعدة: ${[...EXCLUDE].join(" · ")}`);
