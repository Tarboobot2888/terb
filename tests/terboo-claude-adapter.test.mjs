// ═══════════════════════════════════════════════
// 🧪 Terboo Claude Adapter (§62 §64 §90)
// ───────────────────────────────────────────────
// المحوّل الحقيقي (@anthropic-ai/sdk الرسمي) ضد خادم HTTP محلي يحاكي Messages API —
// لا مفتاح حقيقي ولا شبكة. يتحقق من شكل الطلب الفعلي على السلك:
//   1. النموذج الافتراضي claude-opus-5-5 · رأس anthropic-beta للـserver-side fallback
//      · fallbacks:"default" · output_config.effort · system · المفتاح في الرأس لا في الجسم.
//   2. صورة ⇒ كتلة image base64 JPEG بأقصى ضلع ‎1568 قبل النص.
//   3. stop_reason=refusal ⇒ خطأ PROVIDER_REFUSAL (حتى ينتقل الموجّه لمزوّد بديل).
//   4. ask() بصورة بلا مزوّدات محقونة ⇒ مسار الرؤية يبدأ بـClaude ويستلم الصورة فعلاً.
//   5. المفتاح من config.APIkey.anthropic · بلا مفتاح ⇒ Claude غير مسجّل أصلاً.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import http from "node:http";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const requests = [];
let mode = "ok";
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    const refusal = mode === "refusal";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: `msg_${requests.length}`, type: "message", role: "assistant", model: body.model,
      content: refusal ? [] : [{ type: "text", text: "أهلاً، أنا Terboo." }],
      stop_reason: refusal ? "refusal" : "end_turn",
      ...(refusal ? { stop_details: { type: "refusal", category: "cyber" } } : {}),
      usage: { input_tokens: 12, output_tokens: 7 },
    }));
  });
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
process.env.ANTHROPIC_API_KEY = "test-key-not-real";
process.env.NO_PROXY = [process.env.NO_PROXY, "127.0.0.1", "localhost"].filter(Boolean).join(",");
process.env.no_proxy = process.env.NO_PROXY;
delete process.env.ANTHROPIC_MODEL;
delete process.env.ANTHROPIC_EFFORT;

const providers = await import("../src/lib/terboo-ai-providers.js");
const sharp = (await import("sharp")).default;
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("request-shape", async () => {
  const out = await providers.claudeChat({
    message: "مين أنت؟", instruction: "You are Terboo.",
    history: [{ role: "assistant", content: "orphan" }, { role: "user", content: "سلام" }, { role: "assistant", content: "وعليكم السلام" }],
  });
  assert.equal(out.text, "أهلاً، أنا Terboo.");
  const req = requests.at(-1);
  assert.equal(req.method, "POST");
  assert.match(req.url, /^\/v1\/messages\?beta=true$/);
  assert.equal(req.body.model, "claude-opus-5-5");
  assert.equal(req.body.fallbacks, "default");
  assert.equal(req.body.output_config?.effort, "low");
  assert.equal(req.body.system, "You are Terboo.");
  assert.ok(req.body.max_tokens >= 1024);
  assert.match(String(req.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.equal(req.headers["x-api-key"], "test-key-not-real");
  assert.ok(!JSON.stringify(req.body).includes("test-key-not-real"), "المفتاح تسرّب لجسم الطلب");
  assert.ok(!("betas" in req.body), "betas أُرسلت في الجسم بدل الرأس");
  // التاريخ يبدأ بالمستخدم والرسالة الأخيرة هي الحالية
  assert.equal(req.body.messages[0].role, "user");
  assert.equal(req.body.messages.at(-1).content.at(-1).text, "مين أنت؟");
});

await check("image-block", async () => {
  const png = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#123456" } }).png().toBuffer();
  await providers.claudeChat({ message: "صف الصورة", imageBuffer: png });
  const content = requests.at(-1).body.messages.at(-1).content;
  assert.equal(content[0].type, "image", "الصورة ليست قبل النص");
  assert.equal(content[0].source.type, "base64");
  assert.equal(content[0].source.media_type, "image/jpeg");
  const jpeg = Buffer.from(content[0].source.data, "base64");
  const meta = await sharp(jpeg).metadata();
  assert.equal(meta.format, "jpeg");
  assert.ok(Math.max(meta.width, meta.height) <= 1568, `ضلع ${meta.width}x${meta.height}`);
  assert.ok(jpeg.length <= 5 * 1024 * 1024);
  assert.equal(content[1].type, "text");
});

await check("refusal", async () => {
  mode = "refusal";
  await assert.rejects(() => providers.claudeChat({ message: "x" }), (error) => error.code === "PROVIDER_REFUSAL" && /cyber/.test(error.message));
  mode = "ok";
});

await check("vision-route-uses-claude", async () => {
  const loaded = await providers.loadProviders(true);
  assert.ok(loaded.Claude, "Claude غير مسجّل رغم وجود المفتاح");
  const before = requests.length;
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff0000" } }).png().toBuffer();
  const answer = await providers.ask({ message: "ايه في الصورة؟", instruction: "Describe.", history: [], language: "ar", imageBuffer: png, hasImage: true }, null, { budgetMs: 8000 });
  assert.equal(answer?.provider, "Claude", `المزوّد: ${answer?.provider}`);
  assert.equal(requests.length, before + 1);
  assert.equal(requests.at(-1).body.messages.at(-1).content[0].type, "image");
});

await check("key-from-config", async () => {
  // المفتاح مع بقية مفاتيح API في config.js؛ البيئة تتجاوزه فقط إن ضُبطت
  const config = (await import("../config.js")).default;
  delete process.env.ANTHROPIC_API_KEY;
  config.APIkey.anthropic = "cfg-key-not-real";
  const loaded = await providers.loadProviders(true);
  assert.ok(loaded.Claude, "Claude غير مسجّل رغم وجود المفتاح في config.js");
  await providers.claudeChat({ message: "x" });
  assert.equal(requests.at(-1).headers["x-api-key"], "cfg-key-not-real");
  config.APIkey.anthropic = "";
});

await check("no-key-no-claude", async () => {
  delete process.env.ANTHROPIC_API_KEY;
  const loaded = await providers.loadProviders(true);
  assert.equal(loaded.Claude, undefined, "Claude مسجّل بلا مفتاح");
  await assert.rejects(() => providers.claudeChat({ message: "x" }));
});

server.close();
console.log(`✅ terboo-claude-adapter: ${results.join(" · ")}`);
process.exit(0);
