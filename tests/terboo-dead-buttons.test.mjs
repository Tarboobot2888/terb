// ═══════════════════════════════════════════════
// 🧪 لا أزرار ميتة (§41): كل زر/صف يبدأ ببادئة أمر يشير لأمر مسجّل فعلاً
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const out = execFileSync(process.execPath, ["tools/terboo-button-audit.mjs"], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env } });
const summary = out.split("\n").find((line) => line.startsWith("🔘")) || "";
const match = summary.match(/buttons (\d+) · distinct commands (\d+) · dead (\d+)/);
assert.ok(match, `مخرجات غير متوقعة: ${out.slice(-400)}`);
assert.ok(Number(match[1]) > 50, "الأداة وجدت أزراراً فعلاً");
assert.equal(Number(match[3]), 0, `أزرار ميتة:\n${out.split("\n").filter((l) => l.includes("✗")).join("\n")}`);
console.log(`✅ terboo-dead-buttons: ${match[1]} زر · ${match[2]} أمر · 0 ميت`);
process.exit(0);
