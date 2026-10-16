#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🔘 تدقيق الأزرار الميتة (§41) — كل زر يشير لأمر موجود فعلاً
// ───────────────────────────────────────────────
//   node tools/terboo-button-audit.mjs [--json]
// يستخرج من plugins/ و src/ كل معرّف زر/صف يبدأ ببادئة أمر («.cmd» · «${m.prefix}cmd» · «${prefix}cmd»)
// من حقول buttonId · id · rowId · selectedId (نصاً أو داخل JSON) ثم يتحقق بعد تحميل كل البلوقنات أن الأمر
// مسجّل (اسم أو مرادف). المعرّفات الداخلية (terboo_*) تُطابَق مع INTERNAL_IDS. النتيجة: قائمة الميتة بموضعها.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const asJson = process.argv.includes("--json");

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

/** حقل معرّف زر بقيمة نصية/قالب (أو داخل JSON مهرّب) */
const FIELD = /(?:\\?["']?(?:buttonId|rowId|selectedId|id)\\?["']?)\s*:\s*\\?(["'`])((?:(?!\1).){1,160})\\?\1/g;
const PREFIX = /^(?:\$\{\s*(?:m\.|ctx\.|options\.)?(?:prefix|usedPrefix|p)\s*(?:\|\|\s*['"][^'"]*['"])?\s*\}|[.!#/])/;

function extract(file) {
  const text = fs.readFileSync(file, "utf8");
  const rows = [];
  for (const match of text.matchAll(FIELD)) {
    const value = match[2].trim();
    const prefix = value.match(PREFIX);
    if (!prefix) continue;
    const command = value.slice(prefix[0].length).trim().split(/\s+/)[0] || "";
    // اسم أمر ديناميكي بالكامل (${cmd}) لا يُحكم عليه ثابتاً
    if (!command || /^\$\{/.test(command) || /[`'"]/.test(command)) continue;
    const line = text.slice(0, match.index).split("\n").length;
    rows.push({ file: path.relative(ROOT, file), line, command: command.replace(/\$\{[^}]*\}$/, ""), value: value.slice(0, 80) });
  }
  return rows;
}

const files = [...walk(path.join(ROOT, "plugins")), ...walk(path.join(ROOT, "src"))];
const found = files.flatMap(extract).filter((row) => row.command);

process.env.TERBOO_QUIET_LOAD ??= "1";
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(ROOT, "plugins"));
const dead = found.filter((row) => !getPlugin(row.command.toLowerCase()) && !getPlugin(row.command));

const report = { generatedAt: new Date().toISOString(), buttons: found.length, commands: new Set(found.map((r) => r.command)).size, dead };
if (asJson) fs.writeFileSync(path.join(ROOT, "docs", "terboo-button-audit.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(`🔘 buttons ${report.buttons} · distinct commands ${report.commands} · dead ${dead.length}`);
for (const row of dead) console.log(`  ✗ ${row.file}:${row.line} → ${row.command}  (${row.value})`);
process.exit(0);
