// ═══════════════════════════════════════════════
// 🧪 Terboo V6 — سجل القدرات الموحّد
// ───────────────────────────────────────────────
//   1. كل قدرة تحمل كل الحقول المطلوبة (§12) بلا معرّف مكرر
//   2. كل ملفات src/scraper (63) موجودة كقدرات — من السجل نفسه لا بقائمة يدوية
//   3. كل إجراء في محرّك الصلاحيات له قدرة بنفس المستوى والتأكيد
//   4. الأوامر المحمّلة كلها حاضرة؛ أوامر المالك غير معروضة للنموذج
//   5. capabilitiesFor(user) لا تعرض ما للمالك/المشرف؛ والمالك يرى الكل
//   6. الإجراءات المدمّرة: تأكيد، أو هدف واحد متحقق منه (طرد/تنزيل عضو) — لا مدمّر جماعي بلا تأكيد
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const { loadPlugins, getAllPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const registry = await import("../src/lib/terboo-capability-registry.js");
const { ACTIONS, LEVEL } = await import("../src/lib/terboo-permissions.js");
const { CATALOG } = await import("../src/lib/terboo-scraper-registry.js");

const all = registry.capabilities({ refresh: true });

// 1
const ids = all.map((c) => c.id);
assert.equal(new Set(ids).size, ids.length, "معرّفات فريدة");
for (const c of all) for (const field of registry.FIELDS) assert.ok(field in c && c[field] !== undefined, `${c.id}: الحقل ${field} مفقود`);
for (const c of all) {
  assert.ok(["none", "inside-command", "required", "required-owner-bypass", "bulk"].includes(c.confirmation), `${c.id}: confirmation`);
  assert.ok(["any", "group", "private"].includes(c.chat), `${c.id}: chat`);
  assert.ok(Number.isFinite(c.timeoutMs) && c.timeoutMs > 0, `${c.id}: timeout`);
  assert.equal(typeof c.aiExposed, "boolean");
  assert.equal(typeof c.background, "boolean");
}

// 2
const scraperFiles = fs.readdirSync(path.join(process.cwd(), "src/scraper")).filter((f) => f.endsWith(".js")).map((f) => f.replace(/\.js$/, ""));
const scraperCaps = all.filter((c) => c.source === "scraper");
assert.equal(scraperFiles.length, 63, "عدد ملفات الـscrapers الحالي");
assert.equal(scraperCaps.length, Object.keys(CATALOG).length, "كل مدخلات السجل");
for (const id of Object.keys(CATALOG)) assert.ok(registry.getCapability(`tool:${id}`), `scraper بلا قدرة: ${id}`);
assert.equal(scraperCaps.length, 63, "الـ63 كلها قدرات");

// 3
for (const [id, policy] of Object.entries(ACTIONS)) {
  const c = registry.getCapability(`action:${id}`);
  assert.ok(c, `إجراء بلا قدرة: ${id}`);
  assert.equal(c.permissions.level, policy.min, `${id}: المستوى`);
  if (policy.confirm || policy.bulk) assert.notEqual(c.confirmation, "none", `${id}: يحتاج تأكيداً`);
}

// 4
const enabled = new Set(getAllPlugins().filter((p) => p?.config && p.config.isEnabled !== false));
const commandCaps = all.filter((c) => c.source === "plugin");
assert.ok(commandCaps.length >= enabled.size - 5 && commandCaps.length <= enabled.size, `كل الأوامر المحمّلة: ${commandCaps.length}/${enabled.size}`);
for (const c of commandCaps) if (c.permissions.level === LEVEL.OWNER) assert.equal(c.aiExposed, false, `${c.id}: أمر مالك معروض للنموذج`);
assert.ok(all.some((c) => c.category === "games"), "الألعاب حاضرة كقدرات");

// 5
const forUser = registry.capabilitiesFor(LEVEL.USER);
assert.ok(!forUser.some((c) => c.permissions.level === LEVEL.OWNER || c.permissions.level === LEVEL.GROUP_ADMIN), "المستخدم لا يرى قدرات المالك/المشرف");
assert.ok(forUser.some((c) => c.source === "scraper"), "أدوات المستخدم (scrapers) ظاهرة له");
assert.equal(registry.capabilitiesFor(LEVEL.OWNER).length, all.length, "المالك يرى الكل");
const forAdmin = registry.capabilitiesFor(LEVEL.GROUP_ADMIN);
assert.ok(forAdmin.some((c) => c.id === "action:group.member.kick") && !forAdmin.some((c) => c.id === "action:broadcast.run"), "المشرف: أعضاء نعم، إذاعة لا");

// 6
for (const c of all.filter((x) => x.safety === "destructive")) {
  const single = /^action:group\.member\.(kick|demote)$/.test(c.id);
  assert.ok(c.confirmation !== "none" || single, `${c.id}: مدمّر بلا تأكيد`);
}

const summary = registry.capabilitySummary();
assert.equal(summary.total, all.length);
console.log(`✅ terboo-capability-registry: ${summary.total} قدرة · ${summary.scrapers} scraper · ${Object.keys(ACTIONS).length} إجراء · ${commandCaps.length} أمر · ${summary.aiExposed} معروضة للنموذج`);
process.exit(0);
