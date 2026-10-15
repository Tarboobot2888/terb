#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🧩 config.example.js — قالب إعدادات بلا أسرار من config.js نفسه
// ───────────────────────────────────────────────
//   node tools/terboo-config-example.mjs            ← يولّد ويكتب
//   node tools/terboo-config-example.mjs --check    ← يتحقق بلا كتابة (للاختبارات)
// نفس البنية والتعليقات والقيم العامة؛ تُفرَّغ: مفاتيح APIkey · الأسرار · الجلسات · أرقام المالك
// · أرقام المالك والجلسة · البريد ورابط واتساب الشخصي · أي token/apikey/capikey/masterKey/encryptionKey.
// ثم تحقق: لا قيمة سرية حقيقية من config.js المحمّل تظهر في الناتج (وإلا يفشل ولا يكتب).
// لا يطبع أي قيمة سرية.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const CHECK = process.argv.includes("--check");
const source = fs.readFileSync(path.join(ROOT, "config.js"), "utf8");
const config = (await import(path.join(ROOT, "config.js"))).default;

/** يفرّغ قيمة نصية لمفتاح داخل سطر: key: "…" ⇒ key: "<بديل>" */
function blankKey(text, key, replacement = "") {
  const re = new RegExp(`(\\b${key}\\s*:\\s*)(["'\`])(?:(?!\\2).)*\\2`, "g");
  return text.replace(re, (_, head, quote) => `${head}${quote}${replacement}${quote}`);
}

/** يفرّغ كل القيم النصية داخل كتلة كائن تبدأ بـ «name: {» حتى قوسها المغلق */
function blankBlock(text, name) {
  const start = text.search(new RegExp(`\\n\\s*${name}\\s*:\\s*\\{`));
  if (start === -1) return text;
  let depth = 0;
  let end = start;
  for (let i = text.indexOf("{", start); i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}" && --depth === 0) { end = i; break; }
  }
  // القيمة المباشرة (key: "…") والقيمة الاحتياطية بعد متغير البيئة (key: process.env.X || "…")
  const block = text.slice(start, end).replace(/((?::|\|\|)\s*)(["'`])(?:(?!\2).)*\2/g, (_, head, quote) => `${head}${quote}${quote}`);
  return text.slice(0, start) + block + text.slice(end);
}

let out = source;
out = blankBlock(out, "APIkey");
out = blankBlock(out, "webSessions");
// كتلة الأسرار الموحّدة: كل قيمة فيها سر بالتعريف، فتُفرَّغ كلها بلا استثناء
out = blankBlock(out, "secrets");
for (const key of ["apiKey", "apiPassword", "apikey", "capikey", "token", "masterKey", "encryptionKey", "geminiApiKey"]) out = blankKey(out, key);
out = blankKey(out, "pairingNumber");
out = blankKey(out, "gmail");
out = blankKey(out, "whatsapp");
// أرقام المالك ⇒ مثال واضح غير حقيقي
out = out.replace(/(\bnumber\s*:\s*\[)[^\]]*(\])/, `$1"20XXXXXXXXXX"$2`);

const header = [
  "// ═══════════════════════════════════════════════",
  "// 🧩 config.example.js — قالب بلا أسرار (مولَّد بـ tools/terboo-config-example.mjs)",
  "// انسخه إلى config.js ثم ضع أرقامك ومفاتيحك. لا ترفع config.js الحقيقي إلى مستودع عام أبداً.",
  "// ═══════════════════════════════════════════════",
  "",
].join("\n");
// الترويسة تُكتب مرة واحدة: إعادة التوليد من config.js يحمل ترويسة مولَّدة سابقاً
// (نسخة عن القالب) كانت تُضيف ترويسة ثانية فوقها.
const HEADER_RE = /^\/\/ ═+\n\/\/ 🧩 config\.example\.js[^\n]*\n\/\/ انسخه[^\n]*\n\/\/ ═+\n\n?/;
while (HEADER_RE.test(out)) out = out.replace(HEADER_RE, "");
out = header + out;

// ── التحقق: لا سر حقيقي في الناتج ──
const secrets = [];
const push = (name, value) => { if (typeof value === "string" && value.trim().length >= 6) secrets.push([name, value.trim()]); };
for (const [name, value] of Object.entries(config.APIkey || {})) push(`APIkey.${name}`, value);
push("security.masterKey", config.security?.masterKey);
push("geminiApiKey", config.geminiApiKey);
for (const [name, value] of Object.entries(config.webSessions || {})) push(`webSessions.${name}`, value);
for (const number of config.owner?.number || []) push("owner.number", String(number));
push("session.pairingNumber", config.session?.pairingNumber);
push("socialLinks.gmail", config.socialLinks?.gmail);
// كل قيمة في كتلة الأسرار: بلا هذا كان توكن Cloudflare يمر إلى القالب و«0 تسرّب» تُطبع
for (const [name, value] of Object.entries(config.secrets || {})) push(`secrets.${name}`, value);
// أسماء المفاتيح فقط عند التسرّب — القيم لا تُطبع
const leaked = secrets.filter(([, value]) => out.includes(value)).map(([name]) => name);
if (leaked.length) {
  console.error(`❌ قيم سرية ما زالت في القالب — لم يُكتب شيء: ${leaked.join(", ")}`);
  process.exit(1);
}

const file = path.join(ROOT, "config.example.js");
if (CHECK) {
  const current = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
  if (current !== out) {
    console.error("❌ config.example.js لا يطابق المولَّد من config.js — شغّل node tools/terboo-config-example.mjs");
    process.exit(1);
  }
  console.log(`✅ config.example.js مطابق · ${secrets.length} قيمة حساسة فُحصت · 0 تسرّب`);
  process.exit(0);
}
fs.writeFileSync(file, out);
execFileSync(process.execPath, ["--check", file], { stdio: "ignore" });
console.log(`✅ config.example.js: ${secrets.length} قيمة حساسة فُحصت · 0 تسرّب · صياغة سليمة`);
process.exit(0);
