// ═══════════════════════════════════════════════
// 🧪 Terboo — لا إخفاق صامت (v4 §31)
// ───────────────────────────────────────────────
//   1. مسح كل شجرة الإنتاج (V6): index.js · config.js · case · tools · src · plugins · web/website
//      — لا catch فارغ، ولا catch بتعليق فقط، ولا catch { return null; }،
//      ولا .catch(() => {}) أو .catch(() => null) — في أي ملف (مسارات الإرسال والذكاء والـscrapers وغيرها).
//   2. كل ملف يستدعي noteFailure يستورده (لا ReferenceError داخل catch).
//   3. noteFailure: يسجّل الخطأ والمكان والمرحلة والهدف والبديل، لا يرمي أبداً، يعيد undefined،
//      ويطبع التكرار نفسه مرة واحدة ضمن نافذته.
//   4. مسار إرسال حقيقي (m.react عبر serialize) يفشل ⇒ السلوك كما هو (null) + سجل بالهدف والمرحلة.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".git", "data", "session", "tmp", "temp", "backup", "database", "downloads"]);
const SILENT = [
  ["empty catch", /catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/g],
  ["comment-only catch", /catch\s*(?:\(\s*\w*\s*\))?\s*\{(\s*(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)\s*)+\}/g],
  ["catch returning a constant", /catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*return(\s+(?:null|undefined|false|true|\[\]|\{\}|""|''|0))?\s*;?\s*\}/g],
  [".catch(() => {})", /\.catch\(\s*(?:\(\s*\w*\s*\)|\w+)\s*=>\s*\{\s*\}\s*\)/g],
  [".catch(() => null)", /\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(?:null|undefined|false)\s*\)/g],
];

// ── 1 + 2: المسح ──
const offenders = [];
const missingImport = [];
let files = 0;
let logged = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(m?js|cjs)$/.test(entry.name)) {
      files += 1;
      const rel = path.relative(ROOT, full).split(path.sep).join("/");
      const src = fs.readFileSync(full, "utf8");
      for (const [label, re] of SILENT) {
        for (const match of src.matchAll(re)) offenders.push(`${rel}:${src.slice(0, match.index).split("\n").length} (${label})`);
      }
      if (/\bnoteFailure\(/.test(src)) {
        logged += (src.match(/\bnoteFailure\(/g) || []).length;
        if (!rel.endsWith("terboo-failure-log.js") && !/import\s*\{[^}]*\bnoteFailure\b[^}]*\}\s*from/.test(src)) missingImport.push(rel);
      }
    }
  }
};
for (const dir of ["src", "plugins", "case", "tools", "web", "website"]) if (fs.existsSync(path.join(ROOT, dir))) walk(path.join(ROOT, dir));
// ملفات الجذر نفسها (نقطة الدخول والإعدادات)
for (const file of ["index.js", "config.js"]) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) continue;
  files += 1;
  const src = fs.readFileSync(full, "utf8");
  for (const [label, re] of SILENT) for (const match of src.matchAll(re)) offenders.push(`${file}:${src.slice(0, match.index).split("\n").length} (${label})`);
  if (/\bnoteFailure\(/.test(src) && !/import\s*\{[^}]*\bnoteFailure\b[^}]*\}\s*from/.test(src)) missingImport.push(file);
}
assert.ok(files > 1000, `عدد الملفات الممسوحة منخفض: ${files}`);
assert.deepEqual(offenders, [], `إخفاقات صامتة:\n${offenders.join("\n")}`);
assert.deepEqual(missingImport, [], `noteFailure بلا استيراد:\n${missingImport.join("\n")}`);
assert.ok(logged >= 600, `مواضع التسجيل أقل من المتوقع: ${logged}`);

// ── 3: السلوك ──
const log = await import("../src/lib/terboo-failure-log.js");
log._resetFailures();
const printed = [];
const warn = console.warn;
console.warn = (...args) => printed.push(args.join(" "));
try {
  const result = log.noteFailure("menu-delivery", new Error("boom"), { where: "x.js:1", stage: "send", target: "201@s.whatsapp.net", menu: "main", payload: "interactiveMessage", fallback: "text" });
  assert.equal(result, undefined, "noteFailure يجب أن يعيد undefined (بديل catch فارغ)");
  log.noteFailure("menu-delivery", new Error("boom"), { where: "x.js:1", stage: "send" });
  log.noteFailure("menu-delivery", "نص خطأ خام", { where: "x.js:2" });
  log.noteFailure("scraper", null);
  log.noteFailure("scraper", { toString() { throw new Error("bad"); } });
} finally {
  console.warn = warn;
}
const entries = log.recentFailures(10);
assert.equal(entries.length, 5, "كل إخفاق يُسجَّل في الحلقة");
assert.deepEqual(
  [entries[0].scope, entries[0].message, entries[0].stage, entries[0].target, entries[0].menu, entries[0].payload, entries[0].fallback, entries[0].where],
  ["menu-delivery", "boom", "send", "201@s.whatsapp.net", "main", "interactiveMessage", "text", "x.js:1"],
);
assert.equal(printed.filter((line) => line.includes("boom")).length, 1, "التكرار نفسه طُبع أكثر من مرة");
assert.ok(printed.some((line) => line.includes("نص خطأ خام")));
assert.equal(log.failureCount(), 5);

// ── 4: مسار إرسال حقيقي ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-silent-"));
const { initDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const { serialize } = await import("../src/lib/terboo-serialize.js");
log._resetFailures();
const sock = {
  user: { id: "201000000001:3@s.whatsapp.net", jid: "201000000001@s.whatsapp.net" },
  async sendMessage() { throw new Error("socket closed"); },
};
const chat = "201555000111@s.whatsapp.net";
const m = await serialize(sock, { key: { remoteJid: chat, fromMe: false, id: "SILENT-1" }, message: { conversation: "مرحبا" }, pushName: "x", messageTimestamp: Math.floor(Date.now() / 1000) });
console.warn = () => { };
let reaction;
try {
  reaction = await m.react("✅");
} finally {
  console.warn = warn;
}
assert.equal(reaction, null, "سلوك m.react عند الفشل تغيّر");
const react = log.recentFailures(5).find((entry) => entry.stage === "m.react");
assert.ok(react, "فشل الإرسال لم يُسجَّل");
assert.equal(react.message, "socket closed");
assert.equal(react.target, chat, "الهدف لم يُسجَّل");
assert.equal(react.payload, "reactionMessage");

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (error) { console.warn("تنظيف:", error.message); }
console.log(`✅ terboo-no-silent-catch: ${files} ملف · 0 catch صامت · ${logged} موضع تسجيل · السجل والتسجيل والإرسال الحقيقي`);
process.exit(0);
