#!/usr/bin/env node
// مشغّل الاختبارات المحلية (§41)
//
// يشغّل كل ملف tests/*.test.mjs واحداً واحداً (بلا shell، بوسائط ثابتة)،
// ويشترط رمز خروج 0 لكل ملف. لا قائمة يدوية قد تُسقط اختباراً جديداً بصمت.
// المستثنى الوحيد: اختبارات «live» التي تتصل بمزوّدات حقيقية عبر الشبكة
// وتُشغَّل بـ npm run test:live.
//
//   node tools/terboo-run-tests.mjs            ← كل الاختبارات المحلية
//   node tools/terboo-run-tests.mjs --list     ← القائمة فقط
//   node tools/terboo-run-tests.mjs --only arcade --json out.json
//        ← فلتر بالاسم + نتيجة آلية (passed/failed/skipped لكل ملف) للتقارير المولّدة

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const TESTS = path.join(ROOT, "tests");

/** اختبارات تحتاج شبكة ومفاتيح مزوّدات حقيقية — مكانها test:live */
const LIVE = new Set([
  "ai-provider-smoke.test.mjs",
  "local-image-enhancement.test.mjs",
  "terboo-code-review.live.test.mjs",
]);

/** تُشغَّل أولاً لأنها تفحص سلامة المشروع كله */
const FIRST = ["terboo-syntax.test.mjs", "terboo-import-graph.test.mjs"];

const argValue = (flag) => (process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : null);
const ONLY = argValue("--only");
const JSON_OUT = argValue("--json");

const files = fs.readdirSync(TESTS)
  .filter((name) => name.endsWith(".test.mjs") && !LIVE.has(name) && (!ONLY || name.includes(ONLY)))
  .sort((a, b) => (FIRST.indexOf(b) - FIRST.indexOf(a)) || a.localeCompare(b));

if (process.argv.includes("--list")) {
  console.log(files.join("\n"));
  process.exit(0);
}

// ذاكرة ربط LID لكل تشغيل في مجلد مؤقت: الاختبارات لا تكتب في database/ الخاص بالمشروع
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-tests-"));
const ENV = {
  ...process.env,
  TERBOO_LID_CACHE_PATH: path.join(SANDBOX, "lid-cache.json"),
  TERBOO_TASKS_PATH: path.join(SANDBOX, "tasks.json"),
  // سجل الوكيل وحالته ونسخ المراجعة الاحتياطية: حالة تشغيل لا تُكتب في data/ ولا backup/
  TERBOO_AGENT_STATE_DIR: path.join(SANDBOX, "autoai"),
  TERBOO_REVIEW_BACKUP_DIR: path.join(SANDBOX, "ai-review"),
  // بيانات لغات OCR تُعاد بين التشغيلات خارج المشروع
  TERBOO_OCR_CACHE: process.env.TERBOO_OCR_CACHE || path.join(os.tmpdir(), "terboo-ocr-cache"),
};

function run(file) {
  return new Promise((resolve) => {
    const started = Date.now();
    execFile(process.execPath, [path.join("tests", file)], { cwd: ROOT, shell: false, timeout: 600_000, maxBuffer: 32 * 1024 * 1024, env: ENV },
      (error, stdout, stderr) => resolve({ file, ok: !error, code: error?.code ?? 0, ms: Date.now() - started, stdout: String(stdout), stderr: String(stderr) }));
  });
}

/**
 * حالة الملف الواحد: PASS · FAIL · BLOCKED.
 * BLOCKED = شُغّل وخرج بـ0 لكنه أعلن تخطّياً («⏭️») لانعدام شرط بيئي (متصفح · مفتاح).
 * لا يُحتسب ناجحاً: اختبار لم يفحص شيئاً ليس اختباراً ناجحاً (§19).
 */
function stateOf(result) {
  if (!result.ok) return "FAIL";
  const out = `${result.stdout}\n${result.stderr}`;
  const skipped = /^\s*⏭/m.test(out);
  const asserted = /^✅/m.test(out);
  return skipped && !asserted ? "BLOCKED" : "PASS";
}

const failed = [];
const blocked = [];
const report = [];
for (const file of files) {
  const result = await run(file);
  const state = stateOf(result);
  const skipLine = (`${result.stdout}\n${result.stderr}`.match(/^\s*⏭.*$/m) || [""])[0].trim();
  report.push({
    file,
    state,
    ok: state === "PASS",
    ms: result.ms,
    summary: (result.stdout.match(/^✅.*$/m) || [""])[0].slice(0, 400),
    reason: state === "BLOCKED" ? skipLine.slice(0, 300) : "",
  });
  const seconds = (result.ms / 1000).toFixed(1);
  if (state === "BLOCKED") {
    blocked.push({ file, reason: skipLine });
    console.log(`  ⏭ ${file} (${seconds}s) — BLOCKED: ${skipLine.replace(/^⏭️?\s*/, "").slice(0, 90)}`);
  } else if (result.ok) {
    console.log(`  ✓ ${file} (${seconds}s)`);
  } else {
    failed.push(result);
    console.log(`  ✗ ${file} (${seconds}s) — exit ${result.code}`);
    const tail = `${result.stdout}\n${result.stderr}`.split("\n").filter((line) => line.trim() && !/^\[ ?(INFO|OK|WARN|LOG)/.test(line)).slice(-8);
    for (const line of tail) console.log(`      ${line}`);
  }
}

fs.rmSync(SANDBOX, { recursive: true, force: true });
// السطر صريح: الناجح · الفاشل · live غير المُشغَّل — لا خلط بين «فشل» و«لم يُشغَّل»
const skippedLive = ONLY ? [...LIVE].filter((name) => name.includes(ONLY)).length : LIVE.size;
const passedCount = report.filter((r) => r.state === "PASS").length;
console.log(`\n${passedCount}/${files.length} اختبار محلي نجح · ${failed.length} فشل · ${blocked.length} مُعطَّل بالبيئة (BLOCKED)${skippedLive ? ` · ${skippedLive} اختبار live لم يُشغَّل (npm run test:live)` : ""}`);
for (const b of blocked) console.log(`   ⏭ ${b.file}: ${b.reason.replace(/^⏭️?\s*/, "")}`);
if (JSON_OUT) {
  fs.writeFileSync(JSON_OUT, JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, total: files.length, passed: passedCount, failed: failed.length, blocked: blocked.length, notRun: skippedLive, skipped: skippedLive, results: report }, null, 2));
}
process.exit(failed.length ? 1 : 0);
