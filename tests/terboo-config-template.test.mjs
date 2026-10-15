// ═══════════════════════════════════════════════
// 🧩 قالب الإعداد — لا سرّ واحد من config.js يصل config.example.js
// ───────────────────────────────────────────────
// وُجد تسرّب فعلي: كتلة `config.secrets` الجديدة كانت تُنسخ حرفياً إلى القالب،
// ومُدقّق المولّد لم يكن يفحصها فأعلن «0 تسرّب» والتوكن داخله. هذا الاختبار
// يفحص الملف المشحون نفسه، لا المولّد وحده:
//   1. كل قيمة نصية ذات معنى في config.js (أي عمق) غائبة عن القالب.
//   2. كتلة secrets في القالب كلها قيم فارغة.
//   3. القالب محمَّل فعلاً (صياغة سليمة) وبنيته تطابق config.js مفتاحاً بمفتاح.
//   4. `--check` في المولّد يتحقق ولا يكتب.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const ROOT = process.cwd();
const TEMPLATE = path.join(ROOT, "config.example.js");
const template = fs.readFileSync(TEMPLATE, "utf8");
const live = (await import(path.join(ROOT, "config.js"))).default;

/** قيم عامة غير سرية تظهر في القالب بطبيعتها (أوضاع · صيغ · أمثلة) */
const PUBLIC = new Set(["set-password", "private-once", "json", "All IP addresses", "20XXXXXXXXXX",
  "https://vps.example.com:4083", "production", "development",
  // عناوين خدمات عامة معروفة: ليست سراً، ووجودها في القالب مقصود
  "https://api.telegram.org"]);

/** كل قيمة نصية في الشجرة بطول ذي معنى */
function strings(value, acc = new Set()) {
  if (typeof value === "string") {
    const text = value.trim();
    if (text.length >= 10 && !PUBLIC.has(text)) acc.add(text);
  } else if (Array.isArray(value)) value.forEach((v) => strings(v, acc));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => strings(v, acc));
  return acc;
}

// ── 1. لا قيمة من الكتل السرية في القالب ──────────────────────────
const SECRET_SECTIONS = ["secrets", "APIkey", "webSessions", "security"];
const secretValues = new Set();
for (const section of SECRET_SECTIONS) strings(live[section], secretValues);
for (const extra of [live.session?.pairingNumber, live.socialLinks?.gmail, live.socialLinks?.whatsapp, live.geminiApiKey, ...(live.owner?.number || [])]) {
  strings(extra, secretValues);
}
const leaked = [...secretValues].filter((value) => template.includes(value));
// لا نطبع القيمة أبداً — الطول والموضع يكفيان للتشخيص
assert.equal(leaked.length, 0, `قيم سرية في القالب: ${leaked.map((v) => `طول ${v.length} عند سطر ${template.slice(0, template.indexOf(v)).split("\n").length}`).join(" · ")}`);
assert.ok(secretValues.size >= 1, "لم تُجمع أي قيمة للفحص — المرجع فارغ، فالاختبار بلا معنى");

// ── 2. كتلة secrets في القالب فارغة بالكامل ───────────────────────
const block = template.match(/\n\s*secrets\s*:\s*\{([\s\S]*?)\n\s*\},/);
assert.ok(block, "كتلة secrets غير موجودة في القالب");
const filled = [...block[1].matchAll(/^\s*([A-Z0-9_]+)\s*:\s*"([^"]*)"/gm)].filter(([, , value]) => value.trim());
assert.equal(filled.length, 0, `مفاتيح غير فارغة في قالب secrets: ${filled.map(([, name]) => name).join(", ")}`);
const names = [...block[1].matchAll(/^\s*([A-Z0-9_]+)\s*:/gm)].map(([, name]) => name);
assert.deepEqual(names, Object.keys(live.secrets || {}), "مفاتيح secrets في القالب لا تطابق config.js");

// ── 3. القالب يُحمَّل وبنيته تطابق المرجع ─────────────────────────
execFileSync(process.execPath, ["--check", TEMPLATE], { stdio: "ignore" });
assert.equal(template.match(/🧩 config\.example\.js/g).length, 1, "ترويسة القالب مكرَّرة");
const shape = (obj, prefix = "", acc = []) => {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) shape(v, key, acc);
    else acc.push(key);
  }
  return acc;
};
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-cfg-template-"));
try {
  // نسخة بمسارات استيراد مطلقة: تُحمَّل خارج الجذر بلا كتابة ملف داخل المشروع
  const copy = path.join(sandbox, "config.js");
  const absolute = template.replace(/(\bfrom\s+")\.\/([^"]+)(")/g, (_, head, rel, tail) => `${head}${path.join(ROOT, rel)}${tail}`);
  assert.ok(!/from\s+"\.\//.test(absolute), "بقي استيراد نسبي في النسخة");
  fs.writeFileSync(copy, absolute);
  const sample = (await import(`${copy}?t=${Date.now()}`)).default;
  const missing = shape(live).filter((k) => !shape(sample).includes(k));
  assert.deepEqual(missing, [], `مفاتيح في config.js غائبة عن القالب: ${missing.slice(0, 5).join(", ")}`);
} finally {
  fs.rmSync(sandbox, { recursive: true, force: true });
}

// ── 4. --check يتحقق ولا يكتب ─────────────────────────────────────
const before = fs.statSync(TEMPLATE).mtimeMs;
execFileSync(process.execPath, ["tools/terboo-config-example.mjs", "--check"], { cwd: ROOT, stdio: "pipe" });
assert.equal(fs.statSync(TEMPLATE).mtimeMs, before, "--check كتب الملف");

console.log(`✅ terboo-config-template: ${secretValues.size} قيمة سرية فُحصت · 0 تسرّب · قالب secrets فارغ (${names.length} مفتاحاً) · البنية مطابقة · --check لا يكتب`);
process.exit(0);
