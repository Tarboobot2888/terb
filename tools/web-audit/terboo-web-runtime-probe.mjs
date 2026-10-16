// ═══════════════════════════════════════════════
// 🧪 Terboo Web Platform — Runtime Registration Probe
// ───────────────────────────────────────────────
// يُثبت الفرق بين «ملف موجود» و«Plugin مسجَّل فعلاً»: يحمّل السجل الحقيقي
// (loadPlugins) مقابل قاعدة بيانات مؤقتة معزولة، ثم يقرأ:
//   • عدد الأوامر والـaliases والتصنيفات المسجّلة فعلاً
//   • كل ملف فشل استيراده وسببه
//   • الأوامر المظلَّلة (اسم واحد يسجّله أكثر من ملف ⇒ الأخير يفوز)
//   • سجل الأدوات والـscrapers والقدرات والنوايا كما هي في الكود الجاري
// لا يفتح أي اتصال واتساب ولا يلمس database/main ولا يرسل أي طلب متعمَّد.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const OUT = path.join(process.cwd(), "docs", "web-platform");
const tempDb = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-probe-db-"));

process.env.NODE_ENV = "test";
process.env.TERBOO_PROBE = "1";

const report = { generatedAt: new Date().toISOString(), tempDatabase: tempDb, steps: {} };

// ── قاعدة بيانات مؤقتة (لا تُلمس database/main) ──
const { initDatabase } = await import("../../src/lib/terboo-database.js");
await initDatabase(tempDb);
report.steps.database = { ok: true, path: tempDb, note: "isolated temp dir, production stores untouched" };

// ── تحميل السجل الحقيقي ─────────────────────────
const { loadPlugins, pluginStore } = await import("../../src/lib/terboo-plugins.js");
const { getPluginLoadFailures } = await import("../../src/lib/terboo-plugin-diagnostics.js");

const t0 = Date.now();
const count = await loadPlugins(path.join(process.cwd(), "plugins"));
const loadMs = Date.now() - t0;

const failures = (getPluginLoadFailures() || []).map((f) => ({
  file: typeof f === "string" ? f : f.file || f.filePath || "",
  error: String(f?.error?.message || f?.message || f?.reason || "").slice(0, 300),
  code: f?.error?.code || f?.code || "",
}));

// الأوامر المظلَّلة: اسم سجّله أكثر من ملف
const fileByCommand = new Map();
for (const [name, plugin] of pluginStore.commands.entries()) {
  fileByCommand.set(name, path.relative(process.cwd(), plugin.filePath || ""));
}
const filesSeen = new Map();
for (const plugin of pluginStore.commands.values()) {
  const rel = path.relative(process.cwd(), plugin.filePath || "");
  filesSeen.set(rel, (filesSeen.get(rel) || 0) + 1);
}

const categories = {};
for (const [cat, list] of pluginStore.categories.entries()) categories[cat] = list.length;

report.steps.plugins = {
  ok: true,
  loadedCount: count,
  registeredCommandKeys: pluginStore.commands.size,
  registeredAliasKeys: pluginStore.aliases.size,
  distinctPluginObjects: new Set(pluginStore.commands.values()).size,
  distinctFiles: filesSeen.size,
  categories,
  categoryCount: Object.keys(categories).length,
  loadMs,
  failureCount: failures.length,
  failures,
};

// ── سجل الأدوات ────────────────────────────────
try {
  const tr = await import("../../src/lib/terboo-tool-registry.js");
  const tools = tr.allTools();
  report.steps.tools = {
    ok: true,
    total: tools.length,
    bySource: tools.reduce((acc, t) => ((acc[t.source] = (acc[t.source] || 0) + 1), acc), {}),
    byCategory: tools.reduce((acc, t) => ((acc[t.category] = (acc[t.category] || 0) + 1), acc), {}),
    ids: tools.map((t) => ({ id: t.id, category: t.category, source: t.source, permission: t.permission || "user", output: t.output || "", timeoutMs: t.timeoutMs || 0 })),
  };
} catch (error) { report.steps.tools = { ok: false, error: String(error.message).slice(0, 300) }; }

// ── سجل الـscrapers ────────────────────────────
try {
  const sr = await import("../../src/lib/terboo-scraper-registry.js");
  const ids = Object.keys(sr.CATALOG || {});
  const physical = fs.readdirSync(path.join(process.cwd(), "src", "scraper")).filter((f) => f.endsWith(".js"));
  report.steps.scrapers = {
    ok: true,
    catalogEntries: ids.length,
    physicalFiles: physical.length,
    // الفرق الحقيقي: ملف موجود بلا تسجيل مركزي، وتسجيل بلا ملف بنفس الاسم
    physicalWithoutCatalogEntry: physical.map((f) => f.replace(/\.js$/, "")).filter((n) => !ids.includes(n)),
    catalogWithoutMatchingFile: ids.filter((id) => !physical.includes(`${id}.js`)),
    entries: ids.map((id) => ({
      id,
      kind: sr.CATALOG[id].kind,
      input: sr.CATALOG[id].input,
      output: sr.CATALOG[id].output,
      permission: sr.CATALOG[id].permission || "user",
      timeoutMs: sr.CATALOG[id].timeoutMs || 0,
      platforms: sr.CATALOG[id].platforms || [],
      fallbacks: sr.CATALOG[id].fallbacks || [],
    })),
  };
} catch (error) { report.steps.scrapers = { ok: false, error: String(error.message).slice(0, 300) }; }

// ── النوايا الفعلية (لا من تقرير قديم) ──────────
try {
  const gate = await import("../../src/lib/terboo-intent-gate.js");
  report.steps.intents = { ok: true, source: "src/lib/terboo-intent-gate.js", intents: gate.INTENTS };
} catch (error) { report.steps.intents = { ok: false, error: String(error.message).slice(0, 300) }; }

// ── مزوّدات الذكاء المهيّأة فعلاً (أسماء فقط) ──
try {
  const p = await import("../../src/lib/terboo-ai-providers.js");
  const map = await p.loadProviders(true);
  report.steps.aiProviders = {
    ok: true,
    configured: Object.keys(map),
    visionCapable: Object.keys(map).filter((n) => p.supportsVision(n)),
    caps: p.PROVIDER_CAPS,
    note: "names only — no key values, no live provider call was made",
  };
} catch (error) { report.steps.aiProviders = { ok: false, error: String(error.message).slice(0, 300) }; }

// ── مصفوفة الصلاحيات الحقيقية ──────────────────
try {
  const perm = await import("../../src/lib/terboo-permissions.js");
  report.steps.permissions = { ok: true, actions: perm.permissionMatrix() };
} catch (error) { report.steps.permissions = { ok: false, error: String(error.message).slice(0, 300) }; }

// ── حدود الوسائط والمستندات الحقيقية ───────────
try {
  const mm = await import("../../src/lib/terboo-multimodal.js");
  const docs = await import("../../src/lib/terboo-documents.js");
  report.steps.mediaLimits = { ok: true, media: mm.MEDIA_LIMITS, documents: docs.DOCUMENT_LIMITS, sttProviders: mm.STT_PROVIDERS ? Object.keys(mm.STT_PROVIDERS) : [] };
} catch (error) { report.steps.mediaLimits = { ok: false, error: String(error.message).slice(0, 300) }; }

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "09_RUNTIME_PROBE.json"), JSON.stringify(report, null, 2) + "\n", "utf8");

console.log("── runtime probe ──");
console.log("plugins loaded     :", report.steps.plugins.loadedCount);
console.log("command keys       :", report.steps.plugins.registeredCommandKeys);
console.log("alias keys         :", report.steps.plugins.registeredAliasKeys);
console.log("distinct files     :", report.steps.plugins.distinctFiles);
console.log("load failures      :", report.steps.plugins.failureCount);
console.log("categories         :", report.steps.plugins.categoryCount);
console.log("tools              :", report.steps.tools.ok ? report.steps.tools.total : "ERR " + report.steps.tools.error);
console.log("scraper catalog    :", report.steps.scrapers.ok ? report.steps.scrapers.catalogEntries + " / files " + report.steps.scrapers.physicalFiles : "ERR");
console.log("ai providers       :", report.steps.aiProviders.ok ? report.steps.aiProviders.configured.join(", ") || "(none configured)" : "ERR " + report.steps.aiProviders.error);
console.log("intents            :", report.steps.intents.ok ? (Array.isArray(report.steps.intents.intents) ? report.steps.intents.intents.join(",") : Object.keys(report.steps.intents.intents).join(",")) : "ERR");
console.log("temp db            :", tempDb);
process.exit(0);
