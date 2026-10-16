// ═══════════════════════════════════════════════
// 🧪 Terboo Tool Registry (§24 §25 §34 §35 §60)
// ───────────────────────────────────────────────
//   1. سجل واحد: الـ63 scraper كلها + أدوات الوسائط، كل أداة بفئة عليا ومخطط وصلاحية ومهلة ومحاولات.
//   2. Tool Search: الأنسب للطلب والسياق أولاً · أدوات المالك مخفية عن غيره · قائمة النموذج محدودة.
//   3. تعليمات النواة تحمل الأدوات المناسبة فقط (لا الـ63).
//   4. التنفيذ: أداة scraper عبر runScraper نفسه (والاسم الوسائطي يُحال للأداة القائمة) · أداة محلية حقيقية
//      · تحقق المدخل · حد الحجم · المهلة · الإلغاء · نتيجة مطبّعة · صحة مسجّلة.
//   5. اللقطة للتوثيق بلا دوال ولا أسرار.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import crypto from "node:crypto";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const R = await import("../src/lib/terboo-tool-registry.js");
const S = await import("../src/lib/terboo-scraper-registry.js");
const core = await import("../src/lib/terboo-ai-core.js");
const { zipSync, strToU8 } = await import("fflate");
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("one-registry", async () => {
  const scrapers = Object.keys(S.CATALOG);
  assert.equal(scrapers.length, 63, `عدد الـscrapers ${scrapers.length}`);
  for (const id of scrapers) {
    const tool = R.getTool(id);
    assert.ok(tool, `${id} غائب عن السجل الموحّد`);
    assert.ok(R.CATEGORIES.includes(tool.category), `${id}: فئة ${tool.category}`);
    assert.equal(tool.source, "scraper");
    assert.ok(tool.timeoutMs > 0 && tool.maxAttempts >= 1 && tool.permission && tool.input?.properties, `${id}: وصف ناقص`);
  }
  const local = R.allTools({ source: "local" });
  assert.ok(local.length >= 10, "أدوات الوسائط المحلية ناقصة");
  for (const tool of local) assert.ok(tool.maxBytes > 0 || tool.maxChars > 0, `${tool.id}: بلا حد حجم`);
  for (const id of ["image.describe", "image.ocr", "image.edit", "image.generate", "image.upscale", "image.remove_background", "audio.transcribe", "audio.tts", "video.inspect", "video.transcribe", "video.keyframes", "document.extract", "document.summarize", "file.inspect"]) {
    assert.ok(R.getTool(id), `${id} غائب`);
  }
  assert.equal(R.getTool("image.edit").target, "img2img", "اسم وسائطي لا يُحال للأداة القائمة");
  const counts = R.categories();
  for (const category of ["AI", "Downloaders", "Audio", "Image", "Search", "Anime-Games", "Utility"]) assert.ok(counts[category] > 0, `فئة فارغة: ${category}`);
});

await check("tool-search", async () => {
  const top = (q, ctx = {}) => R.searchTools(q, { limit: 3, ...ctx }).map((x) => x.id);
  assert.equal(top("حمل الفيديو ده https://vt.tiktok.com/ZSabc123/")[0], "tiktok");
  assert.equal(top("download https://open.spotify.com/track/abc")[0], "spotify");
  assert.equal(top("ابحث عن ايفون 15 في جوجل", { modelVisibleOnly: true })[0], "google");
  assert.equal(top("معلومات موبايل سامسونج s24")[0], "gsmarena");
  assert.equal(top("عايز ايميل مؤقت")[0], "tempmail");
  assert.ok(top("شيل الخلفية", { hasImage: true }).some((id) => /remove/.test(id)));
  assert.equal(top("فرغ التسجيل", { hasAudio: true })[0], "audio.transcribe");
  assert.equal(top("لخص الملف", { hasDocument: true })[0], "document.summarize");
  // أداة مالك لا تُعرض لغير المالك
  assert.ok(!R.searchTools("manus agent وكيل", { limit: 20 }).some((x) => x.id === "manus-agent"));
  assert.ok(R.searchTools("manus agent وكيل", { limit: 20, isOwner: true }).some((x) => x.id === "manus-agent"));
  // قائمة النموذج: محدودة، بلا أدوات محادثة/وكيل/أسماء وسائطية
  const list = R.toolsForModel("حمل الفيديو ده https://www.tiktok.com/@u/video/7300000000000000001", { limit: 10 }).split("\n").filter(Boolean);
  assert.ok(list.length > 0 && list.length <= 10, `أسطر ${list.length}`);
  assert.match(list[0], /^- tiktok \[download\|input:url\|tiktok\]/);
  assert.ok(!list.some((line) => /^- (gpt52|gemini|manus-agent|image\.)/.test(line)));
});

await check("kernel-instruction-limited", async () => {
  const instruction = core.buildInstruction({ pkg: { request: "حمل الفيديو ده https://vt.tiktok.com/ZSabc123/", language: "ar", chat: { isGroup: false } }, candidates: [], prefix: "." });
  const toolLines = instruction.split("\n").filter((line) => /^- [\w.-]+ \[[\w-]+\|input:/.test(line));
  assert.ok(toolLines.length > 0 && toolLines.length <= 10, `أدوات في التعليمات: ${toolLines.length}`);
  assert.ok(toolLines.some((line) => line.startsWith("- tiktok [")));
  assert.ok(!toolLines.some((line) => line.startsWith("- dafont [")), "أداة غير ذات صلة عُرضت للنموذج");
  const chat = core.buildInstruction({ pkg: { request: "ازيك عامل ايه", language: "ar", chat: { isGroup: false } }, candidates: [], prefix: "." });
  assert.ok(!/^- tiktok \[/m.test(chat), "محادثة عادية حملت قائمة أدوات");
});

const fakeModule = (fn) => new Proxy({}, { get: (_, key) => (key === "then" ? undefined : fn) });
const PNG_URL = "https://cdn.example.com/out.png";

await check("run-scraper-tool", async () => {
  const load = async () => fakeModule(async () => ({ status: true, result: { url: PNG_URL } }));
  const out = await R.runTool({ id: "image.remove_background", input: { image: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) }, deliver: false, deps: { load } });
  assert.equal(out.ok, true, out.error);
  assert.equal(out.id, "image.remove_background");
  assert.equal(out.source, "scraper");
  assert.equal(out.data.servedBy, "removebackground", "الاسم الوسائطي لم يُنفَّذ عبر الأداة القائمة");
  assert.equal(out.kind, "media");
  assert.equal(out.items[0].url, PNG_URL);
  // مدخل ناقص ⇒ تحقق runScraper نفسه
  const bad = await R.runTool({ id: "tiktok", input: {}, deliver: false, deps: { load } });
  assert.equal(bad.ok, false);
  assert.equal(bad.error, "invalid-input");
  const unknown = await R.runTool({ id: "no-such-tool" });
  assert.equal(unknown.error, "unknown-tool");
});

await check("run-local-tools", async () => {
  const docx = Buffer.from(zipSync({ "word/document.xml": strToU8(`<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Terboo registry check</w:t></w:r></w:p></w:body></w:document>`) }));
  const inspected = await R.runTool({ id: "file.inspect", input: { file: docx, fileName: "a.docx" } });
  assert.equal(inspected.ok, true);
  assert.equal(inspected.data.sha256, crypto.createHash("sha256").update(docx).digest("hex"));
  assert.equal(inspected.data.bytes, docx.length);
  const extracted = await R.runTool({ id: "document.extract", input: { file: docx, fileName: "a.docx" } });
  assert.equal(extracted.ok, true, extracted.error);
  assert.match(extracted.text, /Terboo registry check/);
  // مُعدّ للنموذج بلا نموذج محقون: تمثيل «بيانات غير موثوقة»
  const prepared = await R.runTool({ id: "document.summarize", input: { file: docx, fileName: "a.docx", question: "what is it?" } });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.data.preparedForModel, true);
  assert.match(prepared.text, /Terboo registry check/);
  // تحقق المدخل وحد الحجم
  const missing = await R.runTool({ id: "image.ocr", input: {} });
  assert.equal(missing.error, "invalid-input:missing:image");
  const huge = await R.runTool({ id: "image.ocr", input: { image: Buffer.alloc(17 * 1024 * 1024, 1) } });
  assert.equal(huge.error, "invalid-input:too-large:image");
  const long = await R.runTool({ id: "audio.tts", input: { text: "x".repeat(1300) } });
  assert.equal(long.error, "invalid-input:too-long:text");
  // المهلة والإلغاء
  const slow = await R.runTool({ id: "video.inspect", input: { video: Buffer.alloc(1024, 7) }, deps: { timeoutMs: 1 } });
  assert.equal(slow.ok, false);
  assert.match(slow.error, /timeout|Invalid|ffprobe|ffmpeg|moov|data/i);
  const controller = new AbortController();
  controller.abort();
  const cancelled = await R.runTool({ id: "file.inspect", input: { file: docx }, signal: controller.signal });
  assert.equal(cancelled.error, "cancelled");
  // الصحة
  const health = R.healthOfTool("document.extract");
  assert.ok(health.calls >= 1 && health.lastLatencyMs !== null);
  assert.ok(R.healthOfTool("tiktok") && "open" in R.healthOfTool("tiktok"));
});

await check("snapshot-clean", async () => {
  const snapshot = R.registrySnapshot();
  const json = JSON.stringify(snapshot);
  assert.equal(snapshot.total, R.allTools().length);
  assert.equal(snapshot.scrapers, 63);
  assert.ok(!/"call"|function|=>/.test(json), "اللقطة تحمل دوال");
  assert.ok(!/apikey["']?\s*:\s*"[^"]{8,}/i.test(json), "اللقطة تحمل مفاتيح");
});

console.log(`✅ terboo-tool-registry: ${results.join(" · ")}`);
process.exit(0);
