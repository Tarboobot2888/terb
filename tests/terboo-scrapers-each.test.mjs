// ═══════════════════════════════════════════════
// 🧪 Terboo — كل scraper واحداً واحداً (v4 §12–§16 · §41) — بلا شبكة
// ───────────────────────────────────────────────
// لكل ملف في src/scraper (63) عشرة فحوص حقيقية على الكود نفسه:
//   import · export (نقطة الاستدعاء موجودة فعلاً) · registry (وصف v4 كامل) · input validation
//   · network behavior (خطأ شبكة ⇒ فشل مسجَّل بلا استثناء، والبديل مرة واحدة) · timeout
//   · retry (لا إعادة لنفس الأداة، استدعاءان كحد أقصى) · result normalization · AI invocation
//   · media result (الإرسال بالنوع الصحيح).
// الشبكة الحقيقية لكل خدمة خارجية في: node tools/terboo-scraper-live.mjs (PASS/SKIPPED_EXTERNAL/FAIL).
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-each-"));
const { initDatabase } = await import("../src/lib/terboo-database.js");
const db = await initDatabase(tmp);
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const R = await import("../src/lib/terboo-scraper-registry.js");
const core = await import("../src/lib/terboo-ai-core.js");
const tools = await import("../src/lib/terboo-ai-tools.js");
const { parseOwnerIntent } = await import("../src/lib/terboo-ai-owner.js");

const ROOT = process.cwd();
const PNG = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#145aa0" } }).png().toBuffer();
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(16)]);
const ZIP = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(32)]);
const PROVIDER_SOURCES = ["src/lib/terboo-ai-providers.js", "src/lib/terboo-auto-ai.js"].map((file) => fs.readFileSync(path.join(ROOT, file), "utf8")).join("\n");

// ── وحدات وهمية بنفس شكل أي scraper (دالة · default.method · new Class().method) ──
const STOP = Symbol("stop");
function fakeModule(rawBehave) {
  // رفض لا ينتظره المحوّل (مثل فحص إعداد متزامن) لا يُسقط العملية؛ انتظاره ما زال يرفض
  const behave = (...args) => {
    const result = rawBehave(...args);
    if (result && typeof result.catch === "function") result.catch(() => { });
    return result;
  };
  const fn = function () { return behave(); };
  const node = () => new Proxy(fn, {
    get(_, name) { return name === "then" ? undefined : typeof name === "string" ? node() : undefined; },
    apply() { return behave(); },
    construct() { return new Proxy({}, { get(_, name) { return name === "then" ? undefined : (...args) => behave(args); } }); },
  });
  return new Proxy({}, { get(_, name) { return name === "then" ? undefined : typeof name === "string" ? node() : undefined; } });
}
/** مسجِّل أول الأسماء التي يصل إليها المحوّل ثم يوقفه قبل أي شبكة */
function recorder(trail) {
  const stopFn = function () { throw STOP; };
  const level2 = (first) => new Proxy(stopFn, {
    get(_, name) { if (typeof name === "string") trail.push(`${first}.${name}`); return stopFn; },
    construct() { return new Proxy({}, { get(_, name) { trail.push(`${first}#${String(name)}`); return stopFn; } }); },
    apply() { throw STOP; },
  });
  return new Proxy({}, { get(_, name) { if (typeof name === "string") { trail.push(name); return level2(name); } return undefined; } });
}

// مدخل صالح لكل نوع
const SAMPLE_URL = {
  tiktok: "https://vt.tiktok.com/ZSabc123/", instagram: "https://www.instagram.com/reel/Cxyz123/", twitter: "https://x.com/u/status/1790000000000000000",
  youtube: "https://youtu.be/dQw4w9WgXcQ", spotify: "https://open.spotify.com/track/7qiZfU4dY1lWllzX7mPBI3", soundcloud: "https://soundcloud.com/a/t",
  mediafire: "https://www.mediafire.com/file/abc/f.zip/file", terabox: "https://1024terabox.com/s/1abc", douyin: "https://v.douyin.com/abc/",
  dailymotion: "https://www.dailymotion.com/video/x8abcd", likee: "https://likee.video/@u/video/1", rednote: "http://xhslink.com/a/abc",
  pinterest: "https://pin.it/abc", reddit: "https://www.reddit.com/r/pics/comments/abc/t/", sfile: "https://sfile.mobi/abc",
};
function validInput(entry) {
  const url = SAMPLE_URL[entry.platforms[0]] || "https://example.com/x";
  switch (entry.input) {
    case "url": return { url, format: entry.id === "ytdl" ? "mp3" : "" };
    case "url|query": return { url, format: "mp3" };
    case "query": return { query: "terboo test" };
    case "name": return { name: "terboo", query: "terboo" };
    case "prompt": return { prompt: "a cat in space" };
    case "image": return { image: PNG };
    case "image+prompt": return { image: PNG, prompt: "make it blue" };
    case "video": return { video: MP4 };
    case "file": return { file: ZIP, ext: "zip", format: "pdf" };
    default: return {};
  }
}
// نتيجة ناجحة نموذجية بشكل ردود الخدمات الحقيقية لكل نوع مخرج
const SUCCESS = {
  video: () => ({ status: true, data: { title: "clip", play: "https://cdn.terboo.test/v/clip.mp4", cover: "https://cdn.terboo.test/v/cover.jpg" } }),
  audio: () => ({ status: true, result: { title: "song", download: "https://cdn.terboo.test/a/song.mp3" } }),
  image: () => ({ status: true, result: "https://cdn.terboo.test/i/out.png" }),
  media: () => ({ status: true, medias: [{ url: "https://cdn.terboo.test/m/1.mp4" }, { url: "https://cdn.terboo.test/m/2.jpg" }] }),
  file: () => ({ status: true, filename: "f.zip", download: ZIP }),
  list: () => [{ title: "Result one", url: "https://example.org/1", snippet: "first" }, { title: "Result two", url: "https://example.org/2", snippet: "second" }],
  text: () => ({ status: true, result: "نص نتيجة الأداة" }),
};
const EXPECT_TYPE = { video: "video", audio: "audio", image: "image", media: "video", file: "document" };
const networkError = () => Promise.reject(Object.assign(new Error("getaddrinfo ENOTFOUND api.terboo.test"), { code: "ENOTFOUND" }));

const owner = { isOwner: true, isPremium: true, sender: "201225655220@s.whatsapp.net", chat: "201225655220@s.whatsapp.net" };
const rows = [];

for (const entry of R.listScrapers()) {
  const id = entry.id;
  const row = { id };
  const mark = (column, value = "✓") => { row[column] = value; };

  // 1 import + 2 export
  const found = await R.discoverExports(id);
  assert.ok(found.exports.length > 0, `${id}: بلا exports`);
  mark("import");
  const trail = [];
  try { await R.CATALOG[id].call(recorder(trail), { ...validInput(entry), url: validInput(entry).url || "https://example.com/x" }); } catch (error) {
    if (error !== STOP && !/not_configured|requires_command/.test(String(error?.message))) throw new Error(`${id}: المحوّل رمى قبل الشبكة: ${error?.message}`);
  }
  assert.ok(trail.length, `${id}: المحوّل لا يصل لأي export`);
  assert.ok(found.exports.includes(trail[0]), `${id}: يستدعي ${trail[0]} غير المُصدَّر (${found.exports.join(",")})`);
  const method = trail.find((step) => step.startsWith(`${trail[0]}.`) || step.startsWith(`${trail[0]}#`));
  if (method && found.methods[trail[0]]) assert.ok(found.methods[trail[0]].includes(method.split(/[.#]/)[1]), `${id}: ${method} غير موجود`);
  mark("export");

  // 3 registry: وصف v4 كامل
  const described = await R.describeScraper(id);
  for (const field of ["filename", "exports", "purpose", "inputs", "outputs", "category", "platform", "mediaType", "timeout", "retries", "auth", "safety", "permission", "examples"]) {
    assert.ok(described[field] !== undefined && described[field] !== "", `${id}: الحقل ${field} مفقود`);
  }
  assert.equal(described.filename, `${id}.js`);
  assert.ok(fs.existsSync(path.join(ROOT, "src/scraper", described.filename)));
  assert.ok(described.examples.length >= 2, `${id}: أمثلة ناقصة`);
  assert.ok(["public-data", "user-media", "generative", "restricted"].includes(described.safety));
  assert.equal(described.retries, 0);
  assert.ok(described.failover.maxAttempts <= 2, `${id}: أكثر من محاولتين`);
  if (entry.autoSelect && !["chat", "agent"].includes(entry.kind)) {
    // المثال يمر على محلّل النية نفسه: إما هذه الأداة أو يُترك للنموذج — لا أداة أخرى
    for (const example of described.examples) {
      const resolved = R.resolveScraperIntent(example, { hasImage: /image/.test(entry.input), hasVideo: entry.input === "video" });
      assert.ok(!resolved || resolved.id === id, `${id}: المثال «${example}» يذهب إلى ${resolved?.id}`);
    }
  }
  mark("registry");

  // 4 input validation
  const missing = R.validateInput(R.CATALOG[id], {});
  if (entry.input === "none") assert.equal(missing, null);
  else if (entry.input !== "file") assert.ok(missing, `${id}: مدخل فارغ مقبول`);
  assert.equal(R.validateInput(R.CATALOG[id], validInput(entry)), null, `${id}: مدخل صالح مرفوض`);
  if (entry.input === "url" && entry.platforms.length) assert.equal(R.validateInput(R.CATALOG[id], { url: "https://unrelated.example/x" }), "scraper.invalidUrl", `${id}: رابط منصة أخرى مقبول`);
  mark("validation");

  // 5 network behavior + 7 retry
  R._resetForTests();
  const calls = [];
  const netOut = await R.runScraper({ id, input: validInput(entry), m: owner, deliver: false, deps: { load: async (current) => { calls.push(current); return fakeModule(networkError); } } });
  assert.equal(netOut.ok, false, `${id}: خطأ الشبكة اعتُبر نجاحاً`);
  assert.equal(netOut.reason, "failed");
  assert.ok(netOut.attempts.every((attempt) => attempt.ok === false && /ENOTFOUND/.test(attempt.error)), `${id}: الخطأ لم يُسجَّل`);
  assert.ok(calls.length <= 2 && new Set(calls).size === calls.length, `${id}: إعادة لنفس الأداة أو أكثر من استدعاءين: ${calls.join(",")}`);
  assert.equal(R.healthOf(id).failures, 1, `${id}: عدّاد الفشل`);
  mark("network");
  mark("retry", `${calls.length}/${described.failover.maxAttempts}`);

  // 6 timeout
  R._resetForTests();
  const started = Date.now();
  const slow = await R.runScraper({ id, input: validInput(entry), m: owner, deliver: false, deps: { timeoutMs: 40, load: async () => fakeModule(() => new Promise(() => { })) } });
  assert.equal(slow.ok, false);
  assert.match(slow.attempts[0].error, new RegExp(`timeout:${id.replace(/[-.]/g, "\\$&")}:40ms`), `${id}: المهلة لم تُطبَّق`);
  assert.ok(Date.now() - started < 1500, `${id}: الفشل انتظر طويلاً`);
  mark("timeout");

  // 8 result normalization + 10 media result
  R._resetForTests();
  const sent = [];
  const sock = { sendMessage: async (jid, content) => { sent.push(content); return { key: { id: `S${sent.length}` } }; } };
  const m = { ...owner, chat: "201000000001@s.whatsapp.net" };
  const good = await R.runScraper({ id, input: validInput(entry), m, sock, deliver: true, deps: { load: async () => fakeModule(async () => SUCCESS[entry.output]()) } });
  assert.equal(good.ok, true, `${id}: نتيجة ناجحة لم تُفهم: ${good.attempts.map((a) => a.error).join(" | ")}`);
  if (entry.output === "list") assert.equal(good.result.items.length, 2, `${id}: القائمة لم تُوحَّد`);
  else if (entry.output === "text") assert.equal(good.result.text, "نص نتيجة الأداة", `${id}: النص لم يُوحَّد`);
  else assert.equal(good.result.media[0].type, EXPECT_TYPE[entry.output], `${id}: نوع الوسيط ${good.result.media[0].type}`);
  mark("normalize");
  assert.ok(good.deliveries.length >= 1, `${id}: لم يُرسل شيء`);
  const first = sent[0];
  const kind = ["video", "audio", "image", "document", "text"].find((key) => first[key] !== undefined);
  const expectKind = entry.output === "list" || entry.output === "text" ? "text" : EXPECT_TYPE[entry.output];
  assert.equal(kind, expectKind, `${id}: أُرسل كـ ${kind} بدل ${expectKind}`);
  mark("media", kind);

  // 9 AI invocation
  if (["chat", "agent"].includes(entry.kind)) {
    const viaProvider = new RegExp(`scraper/${id}\\.js`).test(PROVIDER_SOURCES);
    const viaPlugin = R.pluginsUsingScraper(id).length > 0;
    // القناة الثالثة: أداة المالك الطبيعية «اختبر سكرابر <id>» تشغّل المحوّل نفسه عبر السجل
    const ownerIntent = parseOwnerIntent(`اختبر سكرابر ${id}`, tools);
    const viaOwner = ownerIntent?.op === "scraperTest" && ownerIntent.id === id;
    assert.ok(viaProvider || viaPlugin || viaOwner, `${id}: غير متاح للذكاء لا عبر المزوّدات ولا بلوقن ولا أداة المالك`);
    if (!viaProvider && !viaPlugin) {
      const ownerRun = await R.runScraper({ id, input: validInput(entry), m: owner, prefer: "adapter", deliver: false, deps: { load: async () => fakeModule(async () => SUCCESS[entry.output]()) } });
      assert.equal(ownerRun.ok, true, `${id}: أداة المالك لم تشغّل المحوّل`);
      const denied = await R.runScraper({ id, input: validInput(entry), m: { isOwner: false }, deliver: false, deps: { load: async () => fakeModule(async () => SUCCESS[entry.output]()) } });
      if (entry.permission === "owner") assert.equal(denied.reason, "permission", `${id}: أداة مالك متاحة لغير المالك`);
    }
    mark("ai", viaProvider ? "provider" : viaPlugin ? "plugin" : "owner-tool");
  } else if (entry.input === "file") {
    assert.ok(R.pluginsUsingScraper(id).length > 0, `${id}: أداة ملفات بلا بلوقن`);
    mark("ai", "plugin");
  } else {
    const used = [];
    const replies = [];
    const msg = {
      key: { id: `AI-${id}`, remoteJid: owner.chat, fromMe: false }, sender: owner.sender, chat: owner.chat, isGroup: false,
      body: "نفّذ المطلوب", pushName: "مالك", type: "conversation", isCommand: false, prefix: ".",
      isOwner: true, isPremium: true, isPartner: false, isAdmin: false, isBotAdmin: true, isBot: false, fromMe: false, isNewsletter: false,
      mentionedJid: [], quoted: null,
      isImage: /image/.test(entry.input), isVideo: entry.input === "video",
      download: async () => (entry.input === "video" ? MP4 : PNG),
      async reply(text) { replies.push(String(text)); return { key: { id: "r" } }; }, async react() { },
    };
    const input = validInput(entry);
    delete input.image; delete input.video;
    const ask = async () => ({ text: JSON.stringify({ decision: "TOOL", tool: id, input, confidence: 0.9 }), provider: "Scripted" });
    const runTool = (request) => { used.push(request.id); return R.runScraper({ ...request, deliver: false, deps: { ...request.deps, dispatch: undefined, load: async () => fakeModule(async () => SUCCESS[entry.output]()) } }); };
    const outcome = await core.runKernel(msg, sock, db, { ask, runTool, rateLimit: false });
    assert.equal(outcome, "answered", `${id}: النواة لم تنفّذ قرار TOOL (${replies.join(" | ").slice(0, 120)})`);
    assert.deepEqual(used, [id], `${id}: النواة استدعت ${used.join(",")}`);
    mark("ai", "kernel");
  }
  rows.push(row);
}

// ── التغطية: عدد الملفات = عدد الأدوات، ولا Unknown Scraper (§13) ──
const audit = await R.auditRegistry();
assert.equal(audit.files, 63, "عدد ملفات src/scraper تغيّر — حدّث السجل");
assert.equal(audit.registered, audit.files);
assert.deepEqual([audit.unregistered, audit.orphaned, audit.loadFailures, audit.entryProblems], [[], [], [], []]);
assert.equal(rows.length, 63, "لم تُفحص كل الأدوات");
assert.equal(await R.describeScraper("لا-يوجد"), null, "أداة مجهولة لها وصف");

// ── لا نجاح مزيّف (§41): فشل مغلّف داخل status:true، أو «نجاح» بلا محتوى، فشلٌ ──
{
  const wrapped = R.normalizeResult({ status: true, raw: { status: false, error: "request blocked" }, model: "gemini" }, { expected: "text" });
  assert.deepEqual([wrapped.ok, wrapped.error], [false, "request blocked"], "فشل مغلّف اعتُبر نجاحاً");
  assert.equal(R.normalizeResult({ status: true, model: "gemini", sessionId: null }, { expected: "text" }).ok, false, "نجاح بلا محتوى");
  assert.equal(R.normalizeResult({ status: true, data: { status: "error", message: "limit" } }, { expected: "media" }).ok, false);
  assert.equal(R.normalizeResult({ name: "Lam", role: "Assassin", lane: "Jungle" }, { expected: "text" }).ok, true, "نتيجة معلومات منظّمة");
  const out = await R.runScraper({ id: "multiAI", input: { prompt: "x" }, m: owner, deliver: false, deps: { load: async () => fakeModule(async () => ({ status: true, raw: { status: false, error: "blocked" } })) } });
  assert.equal(out.ok, false, "runScraper نقل الفشل المغلّف كنجاح");
}

// ── بناء الطلب الحقيقي بلا شبكة: الكود الفعلي لكل scraper يعتمد fetch وحده، مع fetch بديل يتحقق
//    مما يتحقق منه fetch الحقيقي (رابط صالح، رؤوس Latin-1) ثم يرفض كأن الشبكة غير متاحة.
//    هذا ما كشف ترويسة cookie عربية في feeb كانت تُسقط كل نداء قبل الإرسال.
{
  const FETCH_ONLY = ["claudehaiku", "feeb", "gpt5", "hokinfo", "imgdrop", "qwen3", "removebackground", "shinigami", "unlimitedai", "wwchar"];
  const CODE_ERROR = /ByteString|Invalid URL|ERR_INVALID|is not a function|is not defined|is not a constructor|Cannot find module/;
  const realFetch = globalThis.fetch;
  let reached = 0;
  globalThis.fetch = async (input, init = {}) => {
    new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url);
    new Headers(init.headers || {});
    reached += 1;
    throw Object.assign(new Error("stubbed network unavailable"), { code: "ESTUB" });
  };
  try {
    for (const id of FETCH_ONLY) {
      R._resetForTests();
      const before = reached;
      const out = await R.runScraper({ id, input: validInput(R.CATALOG[id]), m: owner, prefer: "adapter", deliver: false });
      const errors = out.attempts.map((attempt) => attempt.error || "").join(" | ");
      assert.equal(out.ok, false, `${id}: شبكة مرفوضة أعطت نجاحاً`);
      assert.ok(!CODE_ERROR.test(errors), `${id}: خطأ في بناء الطلب قبل الشبكة: ${errors}`);
      assert.ok(reached > before, `${id}: الكود لم يصل لطلب الشبكة (${errors})`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
}

// ── §16: قاطع الدائرة والتبريد والبديل ──
R._resetForTests();
const onlyPrimaryFails = async (current) => fakeModule(current === "aio" ? async () => SUCCESS.media() : networkError);
for (let i = 0; i < 3; i += 1) {
  const run = await R.runScraper({ id: "tiktok", input: { url: SAMPLE_URL.tiktok }, deliver: false, deps: { load: onlyPrimaryFails } });
  assert.equal(run.ok, true, "البديل لم يُنقذ الطلب");
  assert.deepEqual(run.attempts.map((a) => [a.id, a.ok]), [["tiktok", false], ["aio", true]]);
}
assert.equal(R.isOpen("tiktok"), true, "القاطع لم يُفتح بعد 3 إخفاقات");
assert.equal(R.isOpen("aio"), false, "البديل الناجح أُغلق");
const skipped = await R.runScraper({ id: "tiktok", input: { url: SAMPLE_URL.tiktok }, deliver: false, deps: { load: onlyPrimaryFails } });
assert.equal(skipped.ok, true, "البديل الصحي لم يُستعمل أثناء التبريد");
assert.equal(skipped.id, "aio");
assert.equal(skipped.attempts[0].skipped, "circuit-open");

const columns = ["import", "export", "registry", "validation", "network", "timeout", "retry", "normalize", "ai", "media"];
console.log(`\n  ${"scraper".padEnd(16)} ${columns.map((c) => c.padEnd(11)).join("")}`);
for (const row of rows) console.log(`  ${row.id.padEnd(16)} ${columns.map((c) => String(row[c] || "—").padEnd(11)).join("")}`);
console.log(`\n✅ terboo-scrapers-each: ${rows.length}/63 scraper × ${columns.length} فحوص · 63 ملفاً = 63 أداة مسجّلة · قاطع دائرة وبديل`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (error) { console.warn("تنظيف:", error.message); }
process.exit(0);
