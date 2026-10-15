// اختبار سجل أدوات الـscraper (§19–§27 §49 §50 §57) — بلا شبكة:
// التغطية الكاملة لمجلد src/scraper، مطابقة كل محوّل لـexport حقيقي، التعرف على المنصات،
// اختيار الأداة من طلب طبيعي بالعربية/الإنجليزية/الإسبانية، توحيد النتائج،
// البلوقن الموجود أولاً، بديل واحد على الأكثر، قاطع الدائرة، الصلاحيات، والإرسال الذكي.

import assert from "node:assert/strict";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const R = await import("../src/lib/terboo-scraper-registry.js");

// ── 1. التغطية (§49 §50): عدد الملفات = عدد المسجّل، وكلها تُحمَّل ولها exports ──
const audit = await R.auditRegistry();
assert.equal(audit.files, audit.registered, `ملفات غير مسجلة: ${audit.unregistered.join(", ")}`);
assert.deepEqual(audit.unregistered, []);
assert.deepEqual(audit.orphaned, []);
assert.deepEqual(audit.loadFailures, []);
assert.deepEqual(audit.entryProblems, []);
assert.ok(audit.files >= 60, `عدد scrapers غير منطقي: ${audit.files}`);

// ── 2. كل محوّل يستدعي export حقيقياً موجوداً (§21) ──
// وحدة وهمية تسجّل أول اسمين يصل إليهما المحوّل ثم توقفه قبل أي شبكة.
const STOP = Symbol("stop");
function recorder(trail) {
  const stopFn = function () { throw STOP; };
  const level2 = (first) => new Proxy(stopFn, {
    get(_, name) { if (typeof name === "string") trail.push(`${first}.${name}`); return stopFn; },
    construct() { return new Proxy({}, { get(_, name) { trail.push(`${first}#${String(name)}`); return stopFn; } }); },
    apply() { throw STOP; },
  });
  return new Proxy({}, { get(_, name) { if (typeof name === "string") { trail.push(name); return level2(name); } return undefined; } });
}
const dummy = { url: "https://example.com/x", query: "q", prompt: "p", name: "n", image: Buffer.from("img"), video: Buffer.from("vid"), file: Buffer.from("f"), format: "mp3" };
for (const [id, entry] of Object.entries(R.CATALOG)) {
  const trail = [];
  try { await entry.call(recorder(trail), dummy); } catch (error) { if (error !== STOP && !/not_configured|requires_command/.test(String(error?.message))) throw error; }
  const found = await R.discoverExports(id);
  assert.ok(trail.length, `المحوّل ${id} لم يصل لأي export`);
  const first = trail[0];
  assert.ok(found.exports.includes(first), `${id}: المحوّل يستدعي ${first} غير الموجود (${found.exports.join(",")})`);
  const second = trail.find((step) => step.startsWith(`${first}.`) || step.startsWith(`${first}#`));
  if (second && found.methods[first]) {
    const method = second.split(/[.#]/)[1];
    assert.ok(found.methods[first].includes(method), `${id}: الدالة ${first}.${method} غير موجودة (${found.methods[first].join(",")})`);
  }
}

// ── 3. كل سجل موصوف بالكامل (§20) ──
const KINDS = new Set(["download", "search", "chat", "image-generate", "image-edit", "image-enhance", "video-enhance", "info", "upload", "convert", "tts", "utility", "fun", "agent"]);
for (const entry of R.listScrapers()) {
  assert.ok(KINDS.has(entry.kind), `${entry.id}: فئة غير معروفة ${entry.kind}`);
  assert.ok(entry.purpose && entry.purpose.length > 10, `${entry.id}: بلا غرض`);
  assert.ok(entry.input && entry.output, `${entry.id}: بلا مدخل/مخرج`);
  assert.ok(entry.timeoutMs >= 5000 && entry.timeoutMs <= 180000, `${entry.id}: مهلة غير منطقية`);
  assert.ok(["public", "premium", "owner"].includes(entry.permission));
  for (const fallback of entry.fallbacks) assert.ok(R.CATALOG[fallback], `${entry.id}: بديل غير موجود ${fallback}`);
}
assert.ok(R.toolListForModel().includes("- tiktok [download|input:url|tiktok]"), "قائمة الأدوات للنموذج ناقصة");
assert.ok(!R.toolListForModel().includes("gpt52"), "أداة مالك داخلية ظهرت للنموذج");

// ── 4. التعرف على المنصة من النطاق ──
const hosts = {
  "https://vt.tiktok.com/ZS123/": "tiktok", "https://www.instagram.com/reel/abc/": "instagram",
  "https://x.com/user/status/1": "twitter", "https://twitter.com/u/status/2": "twitter",
  "https://youtu.be/abc": "youtube", "https://m.youtube.com/watch?v=1": "youtube",
  "https://open.spotify.com/track/1": "spotify", "https://www.mediafire.com/file/x": "mediafire",
  "https://www.reddit.com/r/a/comments/b/": "reddit", "https://pin.it/xyz": "pinterest",
  "https://1024terabox.com/s/1": "terabox", "https://v.douyin.com/abc/": "douyin",
  "https://example.com/tiktok.com": null,
};
for (const [url, platform] of Object.entries(hosts)) assert.equal(R.detectPlatform(url), platform, url);

// ── 5. اختيار الأداة من طلب طبيعي (§22) — بلا نموذج ──
const cases = [
  ["حمل لي الفيديو ده https://vt.tiktok.com/ZS123/", "tiktok"],
  ["نزّل من تيك توك https://www.tiktok.com/@a/video/1", "tiktok"],
  ["download this https://www.instagram.com/reel/abc/", "ig"],
  ["descarga esto https://x.com/u/status/1", "twitter"],
  ["جيب موسيقى من سبوتيفاي https://open.spotify.com/track/1", "spotify"],
  ["https://www.mediafire.com/file/abc/file.zip", "mediafire"],
  ["حمل الصوت https://youtu.be/abc", "ytdl"],
  ["حمل الفيديو https://youtu.be/abc", "youtube"],
  ["https://www.reddit.com/r/a/comments/b/", "reddit"],
  ["https://www.facebook.com/watch?v=1", "aio"],
  ["اعمل صورة لقطة بتلعب كورة", "txt2img2"],
  ["generate an image of a red car", "txt2img2"],
  ["genera una imagen de un gato", "txt2img2"],
  ["شغل اغنية عمرو دياب", "ytdl"],
  ["play shape of you", "ytdl"],
  ["ابحث في تيك توك عن وصفات", "tiktoksearch"],
  ["ابحث عن فيلم انترستلر", "google"],
  ["search wallpaper cyberpunk", "wallpapersearch"],
  ["busca especificaciones samsung s24", "gsmarena"],
  ["اعمل بريد مؤقت", "tempmail"],
];
for (const [text, expected] of cases) {
  const hit = R.resolveScraperIntent(text);
  assert.equal(hit?.id, expected, `«${text}» → ${hit?.id}`);
}
assert.equal(R.resolveScraperIntent("شغل اغنية عمرو دياب").input.query, "اغنية عمرو دياب");
assert.equal(R.resolveScraperIntent("اعمل صورة لقطة بتلعب كورة").input.prompt, "لقطة بتلعب كورة");
assert.equal(R.resolveScraperIntent("حسن الصورة", { hasImage: true })?.id, "hd");
assert.equal(R.resolveScraperIntent("شيل الخلفية", { hasImage: true })?.id, "removebackground");
assert.equal(R.resolveScraperIntent("remove the background", { hasImage: true })?.id, "removebackground");
assert.equal(R.resolveScraperIntent("mejora la imagen", { hasImage: true })?.id, "hd");
assert.equal(R.resolveScraperIntent("ازيك عامل ايه"), null, "محادثة عادية لا تذهب لأداة");
assert.equal(R.resolveScraperIntent("hello how are you"), null);

// ── 6. توحيد النتائج (§24) ──
const douyin = R.normalizeResult({ status: true, title: "t", cover: "https://c.cdn/x.jpg", video: "https://v.cdn/v.mp4", audio: "https://a.cdn/a.mp3" });
assert.ok(douyin.ok);
assert.deepEqual(douyin.media.map((x) => x.type).sort(), ["audio", "video"], "الغلاف لا يُرسل مع الفيديو");
assert.equal(R.normalizeResult({ status: false, error: "boom" }).ok, false);
assert.equal(R.normalizeResult({ status: "eror", msg: "x" }).ok, false);
assert.equal(R.normalizeResult({ error: true, message: "no" }).ok, false);
assert.equal(R.normalizeResult(null).ok, false);
const list = R.normalizeResult({ status: true, result: [{ title: "A", url: "https://a" }, { title: "B", url: "https://b" }] });
assert.equal(list.items.length, 2);
const dataUri = R.normalizeResult({ status: "success", image: `data:image/png;base64,${Buffer.from("PNG").toString("base64")}` });
assert.ok(Buffer.isBuffer(dataUri.media[0].buffer), "data URI يجب أن يتحول إلى Buffer");
assert.equal(R.normalizeResult(Buffer.from([0xff, 0xd8, 0xff])).media[0].type, "image");
assert.equal(R.normalizeResult("https://x.cdn/f.mp4").media[0].type, "video");

// ── 7. البلوقن الموجود أولاً (§26) ──
assert.ok(R.pluginsUsingScraper("tiktok").some((f) => f.endsWith("downloader/تيكتوك.js")));
assert.ok((await R.pluginFor("ytdl", { byQuery: true })).file.endsWith("search/شغل.js"), "التشغيل بالاسم يجب أن يمر بأمر شغل");
const m = { chat: "201000000000@s.whatsapp.net", sender: "201000000000@s.whatsapp.net", key: { id: "X" }, isOwner: false };
const sock = { calls: [], sendMessage: async (jid, content, opts) => { sock.calls.push({ jid, content, opts }); return { key: { id: `SENT${sock.calls.length}` } }; } };
const dispatched = [];
const viaPlugin = await R.runScraper({ id: "tiktok", input: { url: "https://vt.tiktok.com/ZS1/" }, m, sock, deps: { dispatch: async (_m, _s, cmd) => { dispatched.push(cmd); return { ok: true, status: "done" }; } } });
assert.equal(viaPlugin.via, "plugin");
assert.equal(dispatched[0].args, "https://vt.tiktok.com/ZS1/");
const playPlugin = await R.runScraper({ id: "ytdl", input: { query: "عمرو دياب" }, m, sock, deps: { dispatch: async (_m, _s, cmd) => { dispatched.push(cmd); return { ok: true }; } } });
assert.equal(playPlugin.via, "plugin");
assert.equal(dispatched[1].args, "عمرو دياب");

// ── 8. محوّل + بديل واحد على الأكثر (§25) ──
R._resetForTests();
let loads = [];
const fakeLoad = (behaviour) => async (id) => { loads.push(id); return behaviour(id); };
const ok = await R.runScraper({
  id: "tiktok", input: { url: "https://vt.tiktok.com/ZS1/" }, m, sock, prefer: "adapter",
  deps: { load: fakeLoad((id) => (id === "tiktok"
    ? { default: async () => { throw new Error("tiktok down"); } }
    : { aiodl: async () => ({ status: true, video: "https://cdn/v.mp4" }) })) },
});
assert.equal(ok.ok, true);
assert.equal(ok.id, "aio", "البديل يجب أن ينقذ الطلب");
assert.equal(ok.attempts.length, 2);
assert.deepEqual(loads, ["tiktok", "aio"]);
assert.equal(sock.calls.at(-1).content.video.url, "https://cdn/v.mp4");
assert.equal(sock.calls.at(-1).opts.quoted, m, "الرد يجب أن يقتبس رسالة المستخدم");
assert.equal(ok.deliveries[0].target, m.chat);
assert.ok(ok.deliveries[0].messageId, "التسليم يُسجَّل بمفتاح الرسالة الحقيقي");

// فشل الاثنين ⇒ استدعاءان فقط، لا أكثر
loads = [];
const bad = await R.runScraper({ id: "twitter", input: { url: "https://x.com/u/status/1" }, m, sock, prefer: "adapter",
  deps: { load: fakeLoad(() => ({ default: async () => { throw new Error("down"); }, aiodl: async () => { throw new Error("down"); } })) } });
assert.equal(bad.ok, false);
assert.equal(bad.messageKey, "scraper.failed");
assert.ok(loads.length <= 2, `عدد الاستدعاءات ${loads.length} > 2`);

// ── 9. قاطع الدائرة ──
R._resetForTests();
for (let i = 0; i < 3; i++) R.recordOutcome("reddit", false, 10, "down");
assert.equal(R.isOpen("reddit"), true);
loads = [];
const skipped = await R.runScraper({ id: "reddit", input: { url: "https://www.reddit.com/r/a/comments/b/" }, m, sock, prefer: "adapter",
  deps: { load: fakeLoad(() => ({ RedditDL: async () => ({ status: true, url: "https://i.redd.it/x.jpg" }), aiodl: async () => ({ status: true, url: "https://i.redd.it/y.jpg" }) })) } });
assert.ok(!loads.includes("reddit"), "أداة مفتوحة الدائرة يجب ألا تُستدعى");
assert.equal(skipped.id, "aio");
R.recordOutcome("reddit", true, 5);
assert.equal(R.isOpen("reddit"), false);

// ── 10. الصلاحيات والتحقق من المدخل ──
assert.equal((await R.runScraper({ id: "gpt52", input: { prompt: "hi" }, m })).messageKey, "common.ownerOnly");
assert.equal((await R.runScraper({ id: "tiktok", input: { url: "https://youtu.be/x" }, m })).messageKey, "scraper.invalidUrl");
assert.equal((await R.runScraper({ id: "hd", input: {}, m })).messageKey, "scraper.needImage");
assert.equal((await R.runScraper({ id: "google", input: {}, m })).messageKey, "scraper.needQuery");
assert.equal((await R.runScraper({ id: "nope", input: {}, m })).messageKey, "scraper.unknownTool");

// ── 11. قائمة نتائج بحث تُرسل كبطاقة واحدة مترجمة ──
sock.calls = [];
await R.deliverResult(sock, m, list, { lang: "en", query: "cats" });
assert.equal(sock.calls.length, 1);
assert.ok(sock.calls[0].content.text.includes("Results for «cats»"));
assert.ok(sock.calls[0].content.text.includes("https://a"));

// ── 12. أدوات المالك (§27) ──
const report = await R.inspectScraper("tiktok");
assert.ok(report.discovered.exports.includes("default"));
assert.ok(report.plugins.some((p) => p.file.endsWith("downloader/تيكتوك.js")));
const cmp = await R.compareScrapers("tiktok", "aio");
assert.equal(cmp.left.id, "tiktok");
assert.equal(cmp.right.id, "aio");

console.log(`✅ terboo-scraper-registry: ${audit.registered}/${audit.files} scraper مسجّل ومكتشف، ${cases.length} طلباً طبيعياً، بديل واحد، قاطع دائرة، إرسال ذكي`);
process.exit(0);
