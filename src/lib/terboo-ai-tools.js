// ═══════════════════════════════════════════════
// 🛠️ Terboo Safe File Tools — أدوات الملفات الآمنة
// ───────────────────────────────────────────────
// أدوات يستخدمها المالك فقط عبر لوحة التحكّم الطبيعية (§11، §12).
//
// المسموح:
//   list · search · read · inspect · syntax · diff · plan · approve
//   apply(patch/write) · rename · move · backup · rollback · test · diagnostics
//
// الممنوع منعاً باتاً (مفروض بالكود لا بالنية):
//   ✗ أوامر نظام حرّة (arbitrary shell)      ✗ eval أو Function ديناميكية
//   ✗ تشغيل أوامر مجهولة                     ✗ الوصول إلى credentials
//   ✗ قراءة الأسرار أو تسريب مفاتيح API      ✗ الوصول إلى session/auth
//   ✗ تعديل ملفات حسّاسة بلا حماية            ✗ تعديل أي مفتاح داخل config.js
//
// تسلسل التعديل الإجباري:
//   Plan → Diff → Approval → Backup → Apply → Test → Verify
// أي فشل في Test/Verify يُرجع الملف تلقائياً من النسخة الاحتياطية.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { redact } from "./terboo-ai-memory.js";

const ROOT = process.cwd();
const BACKUP_DIR = path.join(ROOT, "temp", "terboo-backups");
const MAX_READ_BYTES = 200000;
const MAX_WRITE_BYTES = 400000;
const APPROVAL_TTL_MS = 10 * 60 * 1000;
const EXEC_TIMEOUT_MS = 120000;

/** مجلدات وملفات لا تُقرأ ولا تُكتب إطلاقاً — أسرار وجلسات وبيانات مستخدمين */
const FORBIDDEN = [
  /^session(\/|$)/i,
  /^database(\/|$)/i,
  /^node_modules(\/|$)/i,
  /^\.git(\/|$)/i,
  /^temp(\/|$)/i,
  /^tmp(\/|$)/i,
  /^downloads(\/|$)/i,
  /(^|\/)\.env/i,
  /(^|\/)creds\.json$/i,
  /(^|\/)auth[^/]*\.json$/i,
  /(^|\/)app-state[^/]*\.json$/i,
  /(^|\/)pre-key[^/]*\.json$/i,
  /(^|\/)sender-key[^/]*\.json$/i,
  /(^|\/)session-[^/]*\.json$/i,
  /\.(pem|key|p12|pfx|keystore)$/i,
];

/** ملفات تُقرأ لكن لا تُكتب أبداً من الذكاء الاصطناعي */
const READ_ONLY = [
  /^config\.js$/i,          // يحوي مفاتيح API — لا تُمس نهائياً
  /^package-lock\.json$/i,
];

/** امتدادات يُسمح بكتابتها */
const WRITABLE_EXT = new Set([".js", ".mjs", ".cjs", ".json", ".md", ".txt"]);

// ═══════════════════════════════════════════════
// صندوق المسارات
// ═══════════════════════════════════════════════

/**
 * يحوّل مساراً نسبياً إلى مسار مطلق داخل المشروع، أو يرمي خطأ.
 * يمنع الخروج من جذر المشروع والوصول للمسارات المحظورة.
 */
function resolveSafe(relative, { write = false } = {}) {
  const input = String(relative || "").trim();
  if (!input) throw new Error("المسار مطلوب");
  if (input.includes("\0")) throw new Error("مسار غير صالح");
  // المسار المطلق مرفوض كما هو — لا يُقصّ ليصير نسبياً
  if (path.isAbsolute(input) || /^[A-Za-z]:[\\/]/.test(input)) {
    throw new Error("ممنوع استعمال مسار مطلق");
  }
  // نزيل "./" البادئة فقط — لا نجرّد النقطة من الملفات المخفية
  // (".env" يجب أن يبقى ".env" حتى تلتقطه قائمة المنع).
  const raw = input.replace(/^(?:\.\/)+/, "");
  if (!raw) throw new Error("المسار مطلوب");

  const full = path.resolve(ROOT, raw);
  const rel = path.relative(ROOT, full).split(path.sep).join("/");

  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("ممنوع الخروج من مجلّد المشروع");
  }
  for (const pattern of FORBIDDEN) {
    if (pattern.test(rel)) throw new Error(`مسار محمي لا يُقرأ ولا يُكتب: ${rel}`);
  }
  if (write) {
    for (const pattern of READ_ONLY) {
      if (pattern.test(rel)) throw new Error(`ملف للقراءة فقط: ${rel}`);
    }
    if (!WRITABLE_EXT.has(path.extname(rel).toLowerCase())) {
      throw new Error(`امتداد غير مسموح بالكتابة: ${path.extname(rel) || "(بلا امتداد)"}`);
    }
  }
  return { full, rel };
}

/** هل هذا المسار مسموح؟ (بلا رمي خطأ — للفحص والاختبارات) */
function isAllowed(relative, options = {}) {
  try {
    resolveSafe(relative, options);
    return true;
  } catch (error) { noteFailure("ai-tools", error, {where: "src/lib/terboo-ai-tools.js:107",stage: "resolveSafe"}); return false; }
}

// ═══════════════════════════════════════════════
// أدوات القراءة
// ═══════════════════════════════════════════════

const SKIP_WALK = new Set(["node_modules", ".git", "session", "database", "temp", "tmp", "downloads"]);

/** سرد محتوى مجلّد داخل المشروع */
function list(relative = ".") {
  const { full, rel } = resolveSafe(relative || ".");
  const stat = fs.statSync(full);
  if (!stat.isDirectory()) throw new Error(`ليس مجلّداً: ${rel}`);
  return fs.readdirSync(full, { withFileTypes: true })
    .filter((entry) => !SKIP_WALK.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "dir" : "file",
      path: rel === "." ? entry.name : `${rel}/${entry.name}`,
      size: entry.isFile() ? safeSize(path.join(full, entry.name)) : 0,
    }))
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
}

function safeSize(full) {
  try {
    return fs.statSync(full).size;
  } catch (error) { noteFailure("ai-tools", error, {where: "src/lib/terboo-ai-tools.js:137",stage: "fs.statSync"}); return 0; }
}

function walk(dir, out = [], depth = 0) {
  if (depth > 8) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_WALK.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out, depth + 1);
    else out.push(full);
  }
  return out;
}

/** بحث نصّي داخل ملفات المشروع (لا regex من المستخدم — نص حرفي فقط) */
function search(needle, { dir = ".", ext = "", limit = 40 } = {}) {
  const term = String(needle || "").trim();
  if (term.length < 2) throw new Error("نص البحث قصير جداً");
  const { full } = resolveSafe(dir || ".");
  const results = [];

  for (const file of walk(full)) {
    if (results.length >= limit) break;
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    if (!isAllowed(rel)) continue;
    if (ext && !rel.endsWith(ext)) continue;
    let content;
    try {
      if (fs.statSync(file).size > MAX_READ_BYTES) continue;
      content = readSource(file, rel);
    } catch {
      continue;
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length && results.length < limit; i += 1) {
      if (lines[i].includes(term)) {
        results.push({ path: rel, line: i + 1, text: redact(lines[i].trim()).slice(0, 160) });
      }
    }
  }
  return results;
}

/**
 * config.js يُقرأ للبنية فقط: كتلة APIkey تُحجب قيمها بالكامل قبل أن
 * تغادر هذا الملف (لا تُعرض للمالك في واتساب ولا تُرسل لأي نموذج).
 */
function maskConfigSecrets(content) {
  // أي حقل مفتاح/رمز/كلمة مرور غير فارغ في أي مكان من الملف
  const lines = String(content).split("\n").map((line) =>
    line.replace(/((?:api_?key|capikey|token|secret|password|passwd)["']?\s*:\s*)(["'`])([^"'`]+)\2/gi, `$1"[محجوب]"`));
  const start = lines.findIndex((line) => /^\s*APIkey\s*:\s*\{/.test(line));
  if (start === -1) return lines.join("\n");
  let depth = 0;
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    if (i > start && depth >= 1) {
      lines[i] = lines[i].replace(/(:\s*)(["'`]).*?\2/, `$1"[محجوب]"`).replace(/(:\s*)(?!["'`{\[])([^,\s]+)/, `$1"[محجوب]"`);
    }
    if (depth <= 0 && i > start) break;
  }
  return lines.join("\n");
}

function readSource(full, rel) {
  const content = fs.readFileSync(full, "utf8");
  return rel === "config.js" ? maskConfigSecrets(content) : content;
}

/** قراءة ملف مع تنقيح أي سر قد يظهر فيه */
function read(relative, { from = 1, to = 0 } = {}) {
  const { full, rel } = resolveSafe(relative);
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error(`ليس ملفاً: ${rel}`);
  if (stat.size > MAX_READ_BYTES) throw new Error(`الملف أكبر من الحد المسموح (${stat.size} بايت)`);

  const lines = readSource(full, rel).split("\n");
  const start = Math.max(1, Number(from) || 1);
  const end = to ? Math.min(lines.length, Number(to)) : lines.length;
  const slice = lines.slice(start - 1, end);

  return {
    path: rel,
    from: start,
    to: end,
    total: lines.length,
    content: redact(slice.join("\n")),
  };
}

/** معلومات ملف بلا محتواه */
function inspect(relative) {
  const { full, rel } = resolveSafe(relative);
  const stat = fs.statSync(full);
  const isFile = stat.isFile();
  let lines = 0;
  let exports = [];
  if (isFile && stat.size <= MAX_READ_BYTES && /\.(js|mjs|cjs)$/.test(rel)) {
    const content = fs.readFileSync(full, "utf8");
    lines = content.split("\n").length;
    // تصديرات مباشرة: export function/const/class
    const direct = [...content.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)]
      .map((match) => match[1]);
    // قوائم التصدير: export { a, b as c }
    const listed = [...content.matchAll(/export\s*\{([^}]*)\}/g)]
      .flatMap((match) => match[1].split(","))
      .map((part) => part.split(/\s+as\s+/).pop().trim())
      .filter((name) => /^\w+$/.test(name));
    exports = [...new Set([...direct, ...listed])];
  }
  return {
    path: rel,
    type: isFile ? "file" : "dir",
    size: stat.size,
    modified: stat.mtime.toISOString(),
    lines,
    exports: exports.slice(0, 150),
  };
}

// ═══════════════════════════════════════════════
// الفرق (Diff) — بلا أي تبعية خارجية
// ═══════════════════════════════════════════════

/** فرق سطري مبسّط بصيغة unified */
function diff(before, after, label = "file") {
  const a = String(before).split("\n");
  const b = String(after).split("\n");

  // أطول تسلسل مشترك (LCS) بحدّ أعلى للحماية من الملفات الضخمة
  if (a.length * b.length > 4000000) {
    return `--- ${label}\n+++ ${label}\n@@ ملف كبير: ${a.length} → ${b.length} سطر @@`;
  }

  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const out = [`--- ${label}`, `+++ ${label}`];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push(`-${i + 1}: ${a[i]}`);
      removed += 1;
      i += 1;
    } else {
      out.push(`+${j + 1}: ${b[j]}`);
      added += 1;
      j += 1;
    }
  }
  while (i < a.length) {
    out.push(`-${i + 1}: ${a[i]}`);
    removed += 1;
    i += 1;
  }
  while (j < b.length) {
    out.push(`+${j + 1}: ${b[j]}`);
    added += 1;
    j += 1;
  }

  out.push(`@@ +${added} / -${removed} @@`);
  return redact(out.join("\n"));
}

// ═══════════════════════════════════════════════
// النسخ الاحتياطي والاسترجاع
// ═══════════════════════════════════════════════

function backupPathFor(rel, stamp) {
  return path.join(BACKUP_DIR, stamp, rel);
}

/** نسخة احتياطية قبل أي تعديل — تُعاد هويتها للاسترجاع */
function backup(relative) {
  const { full, rel } = resolveSafe(relative);
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const dest = backupPathFor(rel, stamp);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(full)) fs.copyFileSync(full, dest);
  else fs.writeFileSync(dest, "", "utf8");     // ملف جديد: النسخة الفارغة تعني «احذفه عند الاسترجاع»
  return { id: stamp, path: rel, existed: fs.existsSync(full) };
}

/** استرجاع ملف من نسخة احتياطية */
function rollback(backupId, relative) {
  const { full, rel } = resolveSafe(relative, { write: true });
  const source = backupPathFor(rel, String(backupId));
  if (!fs.existsSync(source)) throw new Error(`لا توجد نسخة احتياطية: ${backupId}`);
  const content = fs.readFileSync(source, "utf8");
  fs.writeFileSync(full, content, "utf8");
  return { restored: rel, bytes: content.length };
}

/** كل النسخ الاحتياطية المتاحة */
function listBackups(limit = 20) {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR)
    .map((id) => {
      const dir = path.join(BACKUP_DIR, id);
      let stat;
      try {
        stat = fs.statSync(dir);
      } catch (error) { noteFailure("ai-tools", error, {where: "src/lib/terboo-ai-tools.js:355",stage: "fs.statSync"}); return null; }
      return { id, at: stat.mtime.toISOString(), files: walkShallow(dir) };
    })
    .filter(Boolean)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}

function walkShallow(dir, prefix = "", out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const next = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walkShallow(path.join(dir, entry.name), next, out);
    else out.push(next);
  }
  return out;
}

// ═══════════════════════════════════════════════
// تشغيل مُقيَّد — لا shell ولا أوامر من المستخدم
// ═══════════════════════════════════════════════

/**
 * يشغّل Node بوسائط ثابتة نبنيها نحن فقط.
 * لا shell (shell:false)، ولا وسيطة تأتي من نص المستخدم.
 */
function runNode(args, { timeout = EXEC_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd: ROOT, timeout, shell: false, maxBuffer: 4_000_000 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          code: error?.code ?? 0,
          stdout: redact(String(stdout || "")).slice(-4000),
          stderr: redact(String(stderr || error?.message || "")).slice(-4000),
        });
      });
  });
}

/** فحص صحّة بناء ملف واحد (node --check) */
async function syntax(relative) {
  const { full, rel } = resolveSafe(relative);
  const result = await runNode(["--check", full], { timeout: 20000 });
  return { path: rel, ok: result.ok, error: result.ok ? "" : result.stderr };
}

/** اختبارات Terboo المسموح تشغيلها — قائمة مغلقة، لا أمر حرّ */
const ALLOWED_TESTS = {
  syntax: "tests/terboo-syntax.test.mjs",
  imports: "tests/terboo-import-graph.test.mjs",
  integrity: "tests/terboo-integrity.test.mjs",
  localization: "tests/terboo-localization.test.mjs",
  onboarding: "tests/terboo-onboarding.test.mjs",
  assistant: "tests/terboo-ai-assistant.test.mjs",
  memory: "tests/terboo-ai-memory.test.mjs",
  interactive: "tests/terboo-interactive.test.mjs",
  kernel: "tests/terboo-ai-core.test.mjs",
  conversation: "tests/terboo-ai-conversation.test.mjs",
  agent: "tests/terboo-ai-agent.test.mjs",
  menus: "tests/terboo-menus.test.mjs",
  autoai: "tests/autoai-behavioral.test.mjs",
  router: "tests/terboo-command-router.test.mjs",
  matrix: "tests/terboo-memory-matrix.test.mjs",
  dispatch: "tests/terboo-ai-dispatch.integration.test.mjs",
};

/** اختيار الاختبار من كلام طبيعي: «اختبر الذاكرة» ← memory */
const TEST_ALIASES = {
  "نحو": "syntax", "صياغه": "syntax", "الصياغه": "syntax", "استيراد": "imports", "الاستيرادات": "imports",
  "سلامه": "integrity", "ترجمه": "localization", "الترجمه": "localization", "تسجيل": "onboarding",
  "مساعد": "assistant", "ذاكره": "memory", "الذاكره": "memory", "ازرار": "interactive", "القوائم": "menus",
  "قوائم": "menus", "النواه": "kernel", "نواه": "kernel", "محادثه": "conversation", "وكيل": "agent", "الوكيل": "agent",
  "موجه": "router", "الموجه": "router", "توجيه": "router", "عزل": "matrix", "مصفوفه": "matrix", "تنفيذ": "dispatch", "الطرد": "dispatch",
};

function resolveTestName(name) {
  const key = String(name || "").trim().toLowerCase()
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
  if (ALLOWED_TESTS[key]) return key;
  if (TEST_ALIASES[key]) return TEST_ALIASES[key];
  return null;
}

/** تشغيل اختبار من القائمة المغلقة فقط */
async function test(name) {
  const resolved = resolveTestName(name);
  const file = resolved ? ALLOWED_TESTS[resolved] : null;
  if (!file) throw new Error(`اختبار غير معروف: ${name}. المتاح: ${Object.keys(ALLOWED_TESTS).join(", ")}`);
  if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`ملف الاختبار غير موجود: ${file}`);
  const result = await runNode([file], { timeout: 300000 });
  return { test: resolved, ok: result.ok, output: (result.stdout || result.stderr).slice(-1500) };
}

/** الفاحص الصارم (§31) — وسائط ثابتة */
async function strictAudit() {
  const result = await runNode(["tools/terboo-audit.mjs", "--strict"], { timeout: 300000 });
  return { ok: result.ok, output: (result.stdout || result.stderr).slice(-1500) };
}

/** مانيفست المشروع (§1 §45) — يُكتب داخل temp فقط */
async function manifest() {
  const out = path.join(ROOT, "temp", "terboo-manifest-latest.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const result = await runNode(["tools/terboo-manifest.mjs", "--out", out], { timeout: 600000 });
  if (!result.ok || !fs.existsSync(out)) return { ok: false, error: result.stderr.slice(-600) };
  try {
    const data = JSON.parse(fs.readFileSync(out, "utf8"));
    return { ok: true, counts: data.counts || {}, file: path.relative(ROOT, out) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

/**
 * نسخة احتياطية كاملة للمشروع (v4 §26 «اعمل backup») عبر أداة النسخ الاحتياطي نفسها
 * (terboo-auto-backup: تستثني node_modules والجلسات والملفات المؤقتة). الملف داخل tmp/.
 */
async function projectBackup() {
  const { createBackup } = await import("./terboo-auto-backup.js");
  const info = await createBackup();
  return { file: path.relative(ROOT, info.path), size: info.size, fileCount: info.fileCount, timestamp: info.timestamp };
}

/** حالة المشروع باختصار — بلا أي بيانات شخصية */
function diagnostics() {
  const counts = { plugins: 0, lib: 0, tests: 0 };
  try {
    counts.plugins = walk(path.join(ROOT, "plugins")).filter((file) => file.endsWith(".js")).length;
  } catch (error) { noteFailure("ai-tools", error, {where: "src/lib/terboo-ai-tools.js:485",stage: "walk"}); }
  try {
    counts.lib = fs.readdirSync(path.join(ROOT, "src", "lib")).filter((file) => file.endsWith(".js")).length;
  } catch (error) { noteFailure("ai-tools", error, {where: "src/lib/terboo-ai-tools.js:488",stage: "fs.readdirSync"}); }
  try {
    counts.tests = fs.readdirSync(path.join(ROOT, "tests")).filter((file) => file.endsWith(".mjs")).length;
  } catch (error) { noteFailure("ai-tools", error, {where: "src/lib/terboo-ai-tools.js:491",stage: "fs.readdirSync"}); }
  const memory = process.memoryUsage();
  return {
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    heapUsedMb: Math.round(memory.heapUsed / 1048576),
    rssMb: Math.round(memory.rss / 1048576),
    files: counts,
    backups: fs.existsSync(BACKUP_DIR) ? fs.readdirSync(BACKUP_DIR).length : 0,
  };
}

// ═══════════════════════════════════════════════
// الكتابة الآمنة وسجل التغييرات
// ═══════════════════════════════════════════════

if (!global.terbooToolHistory) global.terbooToolHistory = [];
const history = global.terbooToolHistory;

function remember(change) {
  history.push({ ...change, at: Date.now() });
  if (history.length > 50) history.shift();
}

/**
 * Backup → Apply → Syntax → Verify → Success أو Rollback تلقائي.
 * لا تُستدعى إلا بعد موافقة صريحة (من apply أو من وكيل حصل على موافقته).
 */
async function writeWithSafety(relative, content, { reason = "" } = {}) {
  const { full, rel } = resolveSafe(relative, { write: true });
  const next = String(content ?? "");
  if (next.length > MAX_WRITE_BYTES) throw new Error("المحتوى الجديد أكبر من الحد المسموح");
  const before = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
  const saved = backup(rel);

  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, next, "utf8");

  const check = /\.(js|mjs|cjs)$/.test(rel) ? await syntax(rel) : { ok: true, error: "" };
  if (!check.ok) {
    rollback(saved.id, rel);
    return { ok: false, path: rel, backup: saved.id, rolledBack: true, error: check.error };
  }
  if (fs.readFileSync(full, "utf8") !== next) {
    rollback(saved.id, rel);
    return { ok: false, path: rel, backup: saved.id, rolledBack: true, error: "فشل التحقّق بعد الكتابة" };
  }

  remember({ kind: "write", path: rel, backup: saved.id, reason: String(reason).slice(0, 200), diff: diff(before, next, rel) });
  return { ok: true, path: rel, backup: saved.id, rolledBack: false, bytes: next.length };
}

/** آخر تغيير طُبِّق (لـ«اعرض اللي اتغير») */
function lastChange() {
  return history.length ? { ...history[history.length - 1] } : null;
}

/** كل التغييرات الأخيرة */
function changeHistory(limit = 10) {
  return history.slice(-limit).reverse().map((entry) => ({ ...entry, diff: undefined }));
}

/** التراجع عن آخر تغيير (لـ«ارجع التعديل») */
function rollbackLast() {
  const change = history.pop();
  if (!change) throw new Error("لا يوجد تعديل سابق للتراجع عنه");
  if (change.kind === "move") {
    const dest = resolveSafe(change.to, { write: true });
    const source = resolveSafe(change.from, { write: true });
    if (fs.existsSync(dest.full) && !fs.existsSync(source.full)) fs.renameSync(dest.full, source.full);
    return { restored: change.from, kind: "move" };
  }
  const result = rollback(change.backup, change.path);
  return { ...result, kind: "write" };
}

/** مقارنة ملفين داخل الصندوق */
function compare(aPath, bPath) {
  const a = read(aPath);
  const b = read(bPath);
  return { a: a.path, b: b.path, diff: diff(a.content, b.content, `${a.path} ↔ ${b.path}`) };
}

/** ملفات المشروع القابلة للبحث بالاسم */
function projectFiles() {
  const out = [];
  for (const dir of ["src", "plugins", "tests", "tools", "case"]) {
    const base = path.join(ROOT, dir);
    if (fs.existsSync(base)) {
      for (const file of walk(base)) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        if (isAllowed(rel)) out.push(rel);
      }
    }
  }
  for (const name of fs.readdirSync(ROOT)) {
    if (/\.(js|mjs|json|md)$/.test(name) && isAllowed(name)) out.push(name);
  }
  return out;
}

/**
 * «افتح handler» ← src/handler.js
 * يحلّ الاسم المختصر إلى مسار حقيقي: تطابق تام ← اسم الملف ← جزء من المسار،
 * مع تفضيل src/ ثم plugins/.
 */
function resolveFileQuery(query) {
  const raw = String(query || "").trim().replace(/^["'`]|["'`]$/g, "");
  if (!raw) return { path: null, candidates: [] };
  if (isAllowed(raw)) {
    try {
      const { full, rel } = resolveSafe(raw);
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return { path: rel, candidates: [rel] };
    } catch (error) { noteFailure("ai-tools", error, {where: "src/lib/terboo-ai-tools.js:604",stage: "resolveSafe"}); }
  }
  const needle = raw.toLowerCase().replace(/\.(js|mjs|cjs)$/, "");
  const files = projectFiles();
  const score = (rel) => {
    const base = path.basename(rel).toLowerCase().replace(/\.(js|mjs|cjs|json|md)$/, "");
    let value = 0;
    if (base === needle || base === `terboo-${needle}`) value += 10;
    else if (base.includes(needle)) value += 5;
    else if (rel.toLowerCase().includes(needle)) value += 2;
    else return 0;
    if (rel.startsWith("src/")) value += 2;
    else if (rel.startsWith("plugins/")) value += 1;
    return value;
  };
  const ranked = files.map((rel) => ({ rel, value: score(rel) })).filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value || a.rel.length - b.rel.length);
  return { path: ranked[0]?.rel || null, candidates: ranked.slice(0, 5).map((x) => x.rel) };
}

/** ملفات يمر عليها كل شيء — تعديلها عالي الخطورة */
const CORE_FILES = /^(index\.js|src\/handler\.js|src\/connection\.js|src\/lib\/terboo-(serialize|database|plugins|ai-core|ai-memory|ai-tools|interactive|command-dispatch)\.js)$/;

/**
 * تقييم المخاطر قبل الموافقة (§17).
 * @returns {{level:"low"|"medium"|"high", reasons:string[]}}
 */
function assessRisk({ path: rel = "", before = "", after = "" } = {}) {
  const reasons = [];
  let level = "low";
  const raise = (to, why) => {
    const rank = { low: 0, medium: 1, high: 2 };
    if (rank[to] > rank[level]) level = to;
    reasons.push(why);
  };
  if (CORE_FILES.test(rel)) raise("high", "ملف نواة يمر عليه كل البوت");
  else if (/^src\//.test(rel)) raise("medium", "ملف مكتبة مشترك");
  else if (/^plugins\/owner\//.test(rel)) raise("medium", "أمر مالك");
  else if (/^package\.json$/.test(rel)) raise("medium", "إعدادات الحزم");
  const oldLines = String(before).split("\n").length;
  const newLines = String(after).split("\n").length;
  if (before && newLines < oldLines * 0.6) raise("high", `حذف ${oldLines - newLines} سطر (${Math.round((1 - newLines / oldLines) * 100)}%)`);
  const exportsOf = (code) => new Set([...String(code).matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)].map((m) => m[1])
    .concat([...String(code).matchAll(/export\s*\{([^}]*)\}/g)].flatMap((m) => m[1].split(",").map((x) => x.split(/\s+as\s+/).pop().trim()).filter(Boolean))));
  const removedExports = [...exportsOf(before)].filter((name) => !exportsOf(after).has(name));
  if (removedExports.length) raise("high", `تصديرات محذوفة: ${removedExports.slice(0, 5).join(", ")}`);
  if (!before) raise("low", "ملف جديد");
  if (!reasons.length) reasons.push("تعديل محدود");
  return { level, reasons };
}

// ═══════════════════════════════════════════════
// Plan → Diff → Approval → Backup → Apply → Test → Verify
// ═══════════════════════════════════════════════

if (!global.terbooToolPlans) global.terbooToolPlans = new Map();
const plans = global.terbooToolPlans;

function purgePlans() {
  const now = Date.now();
  for (const [id, plan] of plans) {
    if (now - plan.createdAt > APPROVAL_TTL_MS) plans.delete(id);
  }
}

/**
 * يقترح تعديلاً بلا تنفيذ: يبني الفرق ويخزّن الخطة بانتظار موافقة المالك.
 * @param {{path:string, content:string, reason?:string, ownerJid:string}} input
 */
function plan({ path: relative, content, reason = "", ownerJid } = {}) {
  purgePlans();
  const { full, rel } = resolveSafe(relative, { write: true });
  const next = String(content ?? "");
  if (next.length > MAX_WRITE_BYTES) throw new Error("المحتوى الجديد أكبر من الحد المسموح");

  const before = fs.existsSync(full) ? fs.readFileSync(full, "utf8") : "";
  if (before === next) throw new Error("لا يوجد أي تغيير");

  const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const entry = {
    id,
    path: rel,
    before,
    after: next,
    reason: String(reason || "").slice(0, 200),
    owner: String(ownerJid || "").split("@")[0],
    createdAt: Date.now(),
    approved: false,
  };
  plans.set(id, entry);

  const risk = assessRisk({ path: rel, before, after: next });
  entry.risk = risk;
  return {
    id,
    path: rel,
    isNew: !fs.existsSync(full),
    reason: entry.reason,
    diff: diff(before, next, rel),
    risk,
    expiresInMinutes: Math.round(APPROVAL_TTL_MS / 60000),
  };
}

/** خطة مخزّنة (بلا محتوى) */
function getPlan(id) {
  purgePlans();
  const entry = plans.get(String(id));
  if (!entry) return null;
  return { id: entry.id, path: entry.path, reason: entry.reason, approved: entry.approved, createdAt: entry.createdAt };
}

/** موافقة المالك — لا يوافق النموذج على نفسه أبداً (§23) */
function approve(id, ownerJid) {
  purgePlans();
  const entry = plans.get(String(id));
  if (!entry) throw new Error("خطة غير موجودة أو انتهت صلاحيتها");
  const owner = String(ownerJid || "").split("@")[0];
  if (!owner || owner !== entry.owner) throw new Error("الموافقة تُقبل من صاحب الطلب فقط");
  entry.approved = true;
  return { id: entry.id, path: entry.path, approved: true };
}

/** إلغاء خطة */
function cancel(id) {
  return plans.delete(String(id));
}

/**
 * تنفيذ خطة موافَق عليها:
 * نسخة احتياطية ← كتابة ← فحص بناء ← تحقّق ← استرجاع تلقائي عند أي فشل.
 */
async function apply(id, ownerJid) {
  purgePlans();
  const entry = plans.get(String(id));
  if (!entry) throw new Error("خطة غير موجودة أو انتهت صلاحيتها");
  if (!entry.approved) throw new Error("الخطة تحتاج موافقة قبل التنفيذ");
  const owner = String(ownerJid || "").split("@")[0];
  if (owner !== entry.owner) throw new Error("التنفيذ من صاحب الطلب فقط");

  const result = await writeWithSafety(entry.path, entry.after, { reason: entry.reason });
  plans.delete(entry.id);
  return result;
}

/** إعادة تسمية/نقل ملف داخل الصندوق مع نسخة احتياطية */
function move(fromPath, toPath) {
  const source = resolveSafe(fromPath, { write: true });
  const dest = resolveSafe(toPath, { write: true });
  if (!fs.existsSync(source.full)) throw new Error(`الملف غير موجود: ${source.rel}`);
  if (fs.existsSync(dest.full)) throw new Error(`الوجهة موجودة بالفعل: ${dest.rel}`);
  const saved = backup(source.rel);
  fs.mkdirSync(path.dirname(dest.full), { recursive: true });
  fs.renameSync(source.full, dest.full);
  remember({ kind: "move", from: source.rel, to: dest.rel, backup: saved.id });
  return { from: source.rel, to: dest.rel, backup: saved.id };
}

/** إعادة تسمية = نقل داخل نفس المجلد أو غيره */
const rename = move;

export {
  ALLOWED_TESTS,
  maskConfigSecrets,
  assessRisk,
  changeHistory,
  compare,
  lastChange,
  manifest,
  projectBackup,
  projectFiles,
  rename,
  resolveFileQuery,
  resolveTestName,
  rollbackLast,
  strictAudit,
  writeWithSafety,
  BACKUP_DIR,
  FORBIDDEN,
  READ_ONLY,
  apply,
  approve,
  backup,
  cancel,
  diagnostics,
  diff,
  getPlan,
  inspect,
  isAllowed,
  list,
  listBackups,
  move,
  plan,
  read,
  resolveSafe,
  rollback,
  search,
  syntax,
  test,
};

export default {
  list, search, read, inspect, syntax, diff, plan, approve, apply, cancel,
  backup, rollback, listBackups, move, rename, test, diagnostics, isAllowed,
  compare, resolveFileQuery, assessRisk, writeWithSafety, lastChange, rollbackLast, manifest, strictAudit, projectBackup,
};
