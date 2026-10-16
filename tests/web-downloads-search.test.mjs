// اختبار مركز التنزيلات ومركز البحث: كل ما يُعرض مشتقّ من السجل الحقيقي،
// لا منصات مختلقة ولا نتائج وهمية، حماية SSRF قبل أي استعمال، سلسلة بدائل
// تتوقف عند أول ناتج حقيقي، وتعقيم نصّ غير موثوق بلا تنفيذ HTML.

import assert from "node:assert/strict";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const { CATALOG, isOpen } = await import("../src/lib/terboo-scraper-registry.js");
const { getTool } = await import("../src/lib/terboo-tool-registry.js");
const dl = await import("../src/web/services/download-service.js");
const se = await import("../src/web/services/search-service.js");

const principal = { canonical: "pn:201000000009", isOwner: false, isPremium: false, isBanned: false };

// ── 1. كتالوج المنصات مشتقّ من السجل وحده ──────────────────
const registryPlatforms = new Set();
for (const entry of Object.values(CATALOG)) {
  if (entry.kind === "download") for (const p of entry.platforms || []) registryPlatforms.add(p);
}
const catalog = dl.platformCatalog();
assert.ok(catalog.length > 0, "لا منصات تنزيل");
for (const row of catalog) {
  assert.ok(registryPlatforms.has(row.platform), `منصة غير موجودة في السجل: ${row.platform}`);
  assert.ok(row.scrapers.length > 0, `منصة بلا أداة: ${row.platform}`);
  for (const id of row.scrapers) {
    assert.equal(CATALOG[id]?.kind, "download", `أداة ليست تنزيلاً: ${id}`);
  }
}
assert.equal(catalog.length, registryPlatforms.size, "عدد المنصات يطابق السجل بلا زيادة");

// ── 2. ترتيب السلسلة: المتخصّصة قبل الشاملة ────────────────
const tiktokChain = dl.scrapersForPlatform("tiktok").map((row) => row.id);
assert.ok(tiktokChain.includes("tiktok") && tiktokChain.includes("aio"));
assert.ok(
  tiktokChain.indexOf("tiktok") < tiktokChain.indexOf("aio"),
  "الأداة المتخصّصة تُجرَّب قبل الشاملة",
);

// ── 3. فحص الرابط: منصة معروفة · مضيف غير مدعوم · حماية SSRF ──
const t1 = dl.resolveTarget("https://www.tiktok.com/@user/video/123");
assert.equal(t1.platform, "tiktok");
assert.equal(t1.supported, true);
assert.equal(t1.reason, "");

const t2 = dl.resolveTarget("https://example.com/whatever");
assert.equal(t2.platform, "");
assert.equal(t2.supported, false);
assert.equal(t2.reason, "unsupported-host", "مضيف غير مدعوم يُعلَن بسبب صريح");

for (const blocked of [
  "http://127.0.0.1/x",
  "http://localhost/x",
  "http://169.254.169.254/latest/meta-data",
  "http://10.0.0.5/x",
  "file:///etc/passwd",
  "https://user:pass@tiktok.com/x",
]) {
  assert.throws(
    () => dl.resolveTarget(blocked),
    (error) => error.code === "INVALID_INPUT",
    `رابط خطر لم يُرفض: ${blocked}`,
  );
}

// اسم مضيف لا يُنتج منصة غير مسجّلة أبداً
for (const host of ["tiktok.com", "youtu.be", "pin.it", "nope.invalid"]) {
  const platform = dl.platformOfHost(host);
  if (platform) assert.ok(registryPlatforms.has(platform), `منصة مُختلقة من مضيف: ${host}`);
}

// ── 4. سلسلة البدائل تتوقف عند أول ناتج حقيقي ───────────────
const calls = [];
dl._setToolRunner(async ({ toolId }) => {
  calls.push(toolId);
  // الأداة المتخصّصة تفشل، الشاملة تنجح
  if (toolId === "tiktok") return { ok: false, error: "scraper_failed", items: [], latencyMs: 5 };
  return { ok: true, error: "", items: [{ type: "video", url: "https://cdn.example/v.mp4", external: true }], latencyMs: 7 };
});
const chained = await dl.fetchWithChain({ principal, target: t1 });
assert.deepEqual(calls, ["tiktok", "aio"], "تُجرَّب المتخصّصة ثم الشاملة");
assert.equal(chained.ok, true);
assert.equal(chained.tried.length, 2);
assert.equal(chained.tried[0].ok, false);
assert.equal(chained.tried[1].ok, true);

// فشل الكل ⇒ فشل صريح لا نجاح مزيّف
calls.length = 0;
dl._setToolRunner(async ({ toolId }) => { calls.push(toolId); return { ok: false, error: "down", items: [], latencyMs: 1 }; });
const allFailed = await dl.fetchWithChain({ principal, target: t1 });
assert.equal(allFailed.ok, false, "فشل الكل لا يُقدَّم نجاحاً");
assert.ok(allFailed.tried.every((row) => row.ok === false));

// أداة لا تخدم هذه المنصة ⇒ رفض صريح
await assert.rejects(
  () => dl.fetchWithChain({ principal, target: t1, scraperId: "spotify" }),
  (error) => error.code === "INVALID_INPUT" && error.details?.reason === "scraper-not-for-platform",
);
// مضيف غير مدعوم ⇒ لا محاولة عمياء
await assert.rejects(
  () => dl.fetchWithChain({ principal, target: t2 }),
  (error) => error.code === "INVALID_INPUT",
);
dl._setToolRunner(null);

// ── 4b. نتيجة المهمة الكاملة تُقرأ بملكية، ولا تُعاد لغير مالكها ──
// الطابور يحفظ ملخّصاً نصّياً فقط، فالنتيجة الكاملة تبقى في الخدمة مع مالكها.
dl._resetOutcomes();
dl._setToolRunner(async () => ({ ok: true, error: "", items: [{ type: "video", url: "https://cdn.example/v.mp4", external: true }], latencyMs: 3 }));
const job = dl.startDownloadJob({ principal, target: t1 });
assert.ok(job.taskId, "المهمة تحمل معرّفاً");
assert.ok(job.poll.startsWith("/api/v1/downloads/jobs/"), "التتابع على مسار التنزيلات لا الطابور");
// ننتظر انتهاء التنفيذ الفعلي على الطابور
for (let i = 0; i < 60; i += 1) {
  const probe = dl.jobOutcome(principal, job.taskId);
  if (["completed", "failed", "cancelled", "expired"].includes(probe.task.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 50));
}
const finished = dl.jobOutcome(principal, job.taskId);
assert.equal(finished.task.status, "completed", "المهمة اكتملت");
assert.equal(finished.outcome?.ok, true, "النتيجة الكاملة متاحة لمالكها");
assert.equal(finished.outcome?.result?.items?.length, 1);
// مستخدم آخر ⇒ 404 على المهمة نفسها (لا كشف ولا نتيجة)
const other = { canonical: "pn:201000000008", isOwner: false, isPremium: false, isBanned: false };
assert.throws(
  () => dl.jobOutcome(other, job.taskId),
  (error) => error.code === "NOT_FOUND",
  "نتيجة مهمة لا تُقرأ بهوية أخرى",
);
dl._setToolRunner(null);

// ── 5. مصادر البحث من السجل وحده، والافتراضي أولاً ──────────
const sources = se.searchSources();
assert.ok(sources.length > 0);
for (const row of sources) {
  assert.equal(CATALOG[row.id]?.kind, "search", `مصدر ليس بحثاً: ${row.id}`);
  assert.equal(row.available, !isOpen(row.id), "التوفّر من حالة القاطع الحقيقية");
}
if (sources.some((row) => row.id === se.DEFAULT_SOURCE)) {
  assert.equal(sources[0].id, se.DEFAULT_SOURCE, "المصدر الافتراضي أولاً");
}
// مخطّط الإدخال الحقيقي لأداة البحث يستعمل query
assert.ok(getTool(sources[0].id)?.input?.properties?.query, "أداة البحث تقبل query");

// ── 6. بطاقات النتائج: رابط حقيقي فقط · نطاق من الرابط · تعقيم ──
const cards = se.toCards([
  { title: "أول", url: "https://www.Example.com/a", note: "مقتطف" },
  { title: "مكرر", url: "https://www.Example.com/a", note: "x" },
  { title: "بلا رابط", url: "", note: "y" },
  { title: "خطر", url: "javascript:alert(1)", note: "z" },
  { title: "", url: "https://sub.site.org/b", note: "" },
]);
assert.equal(cards.length, 2, "تُهمَل المكرّرات وما لا يحمل رابط http(s)");
assert.equal(cards[0].domain, "example.com", "النطاق من الرابط لا من النص");
assert.equal(cards[0].snippet, "مقتطف");
assert.equal(cards[0].external, true);
assert.equal(cards[1].title, "sub.site.org", "بلا عنوان ⇒ يُعرض النطاق لا نص مُختلق");
assert.ok(!cards.some((card) => /^javascript:/i.test(card.url)), "لا مخطّط خطر في النتائج");

// تعقيم محارف التحكّم/الاتجاه
const dirty = se.plain(`a\u0000b‎c d   e`, 100);
assert.equal(dirty, "a b c d e", "محارف التحكّم والاتجاه تُستبدل بمسافة");
assert.equal(se.domainOf("not a url"), "");

// ── 7. البحث: لا نتائج ⇒ سبب صريح، ولا نجاح بقائمة فارغة ─────
se._setToolRunner(async () => ({ ok: true, error: "", items: [], text: "", latencyMs: 3 }));
let found = await se.search({ principal, query: "  شيء  " });
assert.equal(found.query, "شيء", "الاستعلام مُعقَّم");
assert.equal(found.ok, false, "قائمة فارغة ليست نجاحاً");
assert.equal(found.reason, "no-results");

se._setToolRunner(async () => ({ ok: false, error: "provider_down", items: [], text: "", latencyMs: 2 }));
found = await se.search({ principal, query: "x" });
assert.equal(found.ok, false);
assert.equal(found.reason, "provider_down", "سبب الفشل الحقيقي يُعاد");

se._setToolRunner(async ({ toolId, input }) => {
  assert.equal(input.query, "قطط");
  return { ok: true, error: "", items: [{ title: "T", url: "https://ok.example/p", note: "s" }], text: "", latencyMs: 4, id: toolId };
});
found = await se.search({ principal, query: "قطط" });
assert.equal(found.ok, true);
assert.equal(found.results.length, 1);
assert.equal(found.source, se.searchSources()[0].id);

// استعلام فارغ ⇒ رفض؛ مصدر مجهول ⇒ 404
await assert.rejects(() => se.search({ principal, query: "   " }), (e) => e.code === "INVALID_INPUT");
await assert.rejects(() => se.search({ principal, query: "x", source: "no-such-source" }), (e) => e.code === "NOT_FOUND");
se._setToolRunner(null);

console.log(`✅ web-downloads-search: ${catalog.length} منصة حقيقية · ترتيب البدائل · حماية SSRF · ${sources.length} مصدر بحث · تعقيم النصّ · لا نجاح مزيّف`);
