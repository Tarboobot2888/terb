// اختبار الصحة النحوية لكل ملفات المشروع (§42)
//
// لا يكتفي بقائمة ملفات مختارة: يفحص كل ملف .js و .mjs و .cjs داخل
// src و plugins و tests و tools و case و الجذر، بـ `node --check` الحقيقي،
// ويشترط صفر أخطاء.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "plugins", "tests", "tools", "case"];
const SKIP = new Set(["node_modules", ".git", "session", "temp", "tmp", "downloads"]);
const EXT = /\.(js|mjs|cjs)$/;

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

assert.ok(files.length > 1000, `عدد الملفات المفحوصة منخفض بشكل مريب: ${files.length}`);

function check(file) {
  return new Promise((resolve) => {
    execFile(process.execPath, ["--check", file], { timeout: 30000, shell: false }, (error, _out, stderr) => {
      resolve(error ? { file, error: String(stderr || error.message).split("\n").slice(0, 4).join("\n") } : null);
    });
  });
}

// تشغيل متوازٍ محدود بعدد الأنوية
const concurrency = Math.max(2, Math.min(8, os.cpus().length));
const failures = [];
let cursor = 0;
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (cursor < files.length) {
    const file = files[cursor++];
    const result = await check(file);
    if (result) failures.push(result);
  }
}));

assert.equal(
  failures.length,
  0,
  `أخطاء نحوية (${failures.length}):\n${failures.map((f) => `• ${path.relative(ROOT, f.file)}\n  ${f.error}`).join("\n")}`,
);

console.log(`✅ terboo-syntax: ${files.length} ملف · 0 أخطاء نحوية`);
process.exit(0);
