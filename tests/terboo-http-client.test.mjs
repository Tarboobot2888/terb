// ═══════════════════════════════════════════════
// 🧪 Terboo HTTP Client — خادم محلي حقيقي
// ───────────────────────────────────────────────
// مهلة · إلغاء · إعادة محاولة للقراءة فقط (POST لا يُعاد) · قاطع دائرة · حد حجم · JSON تالف
// · نوع محتوى خاطئ · لا مفاتيح في الأخطاء · طبقة axios (مهلة افتراضية · قاطع · رسائل بلا أسرار)
// · f() القديمة بنفس سلوكها (null عند الفشل).
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import http from "node:http";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const SECRET = "SuperSecretKey123456";
const { registerSecret } = await import("../src/lib/terboo-secrets.js");
registerSecret(SECRET);
const client = await import("../src/lib/terboo-http-client.js");
const { f } = await import("../src/lib/terboo-http.js");

const hits = {};
let flaky = 0;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  hits[url.pathname] = (hits[url.pathname] || 0) + 1;
  const json = (obj, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
  switch (url.pathname) {
    case "/ok": return json({ ok: true });
    case "/slow": return setTimeout(() => json({ late: true }), 3000).unref();
    case "/flaky": flaky += 1; return flaky < 3 ? json({ e: 1 }, 503) : json({ recovered: true });
    case "/post503": return json({ e: 1 }, 503);
    case "/big": res.writeHead(200, { "content-type": "application/octet-stream" }); return res.end(Buffer.alloc(4096, 1));
    case "/badjson": res.writeHead(200, { "content-type": "application/json" }); return res.end("{not json");
    case "/html": res.writeHead(200, { "content-type": "text/html" }); return res.end("<html>login</html>");
    case "/down": return json({ e: 1 }, 500);
    default: return json({ e: "nf" }, 404);
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const results = [];

let r = await client.httpRequest({ url: `${base}/ok`, expect: "json" });
assert.equal(r.ok, true);
assert.deepEqual(r.data, { ok: true });
results.push("json");

r = await client.httpRequest({ url: `${base}/slow`, timeoutMs: 1000, retries: 0 });
assert.equal(r.ok, false);
assert.equal(r.error.code, "TIMEOUT");
results.push("timeout");

const controller = new AbortController();
setTimeout(() => controller.abort(), 200).unref();
r = await client.httpRequest({ url: `${base}/slow`, signal: controller.signal, retries: 0 });
assert.equal(r.error.code, "ABORTED", "إلغاء المستخدم يصل للطلب");
results.push("abort");

r = await client.httpRequest({ url: `${base}/flaky`, expect: "json", retries: 3 });
assert.equal(r.ok, true, "قراءة عابرة الفشل تُعاد وتنجح");
assert.equal(r.attempts, 3);
results.push("read-retry");

r = await client.httpRequest({ url: `${base}/post503`, method: "POST", body: { a: 1 }, retries: 3 });
assert.equal(r.ok, false);
assert.equal(hits["/post503"], 1, "POST لا يُعاد أبداً (لا عملية مكررة)");
results.push("no-write-retry");

r = await client.httpRequest({ url: `${base}/big`, responseType: "buffer", maxBytes: 1024 });
assert.equal(r.error.code, "TOO_LARGE");
results.push("size-limit");

r = await client.httpRequest({ url: `${base}/badjson`, responseType: "json" });
assert.equal(r.error.code, "BAD_JSON");
r = await client.httpRequest({ url: `${base}/html`, expect: "json" });
assert.equal(r.error.code, "BAD_CONTENT_TYPE", "صفحة HTML بدل JSON ⇒ خطأ صريح لا بيانات وهمية");
results.push("schema");

r = await client.httpRequest({ url: `${base}/nf?apikey=${SECRET}&q=1`, retries: 0 });
assert.equal(r.error.code, "HTTP_404");
assert.ok(!r.error.message.includes(SECRET), "المفتاح لا يظهر في رسالة الخطأ");
results.push("redaction");

for (let i = 0; i < client.CIRCUIT.threshold; i += 1) await client.httpRequest({ url: `${base}/down`, retries: 0 });
r = await client.httpRequest({ url: `${base}/ok`, retries: 0 });
assert.equal(r.error.code, "CIRCUIT_OPEN", "فشل متتالٍ ⇒ رفض فوري بدل الانتظار");
assert.equal(client.circuitState(`127.0.0.1:${server.address().port}`).state, "open");
client._resetHttpClient();
results.push("circuit");

// f() القديمة: نفس السلوك
assert.deepEqual(await f(`${base}/ok`), { ok: true });
assert.equal(await f(`${base}/nf`), null, "فشل ⇒ null كما كانت");
const ab = await f(`${base}/big`, "arrayBuffer");
assert.ok(ab instanceof ArrayBuffer && ab.byteLength === 4096);
results.push("legacy-f");

// طبقة axios: مهلة افتراضية · رسائل بلا أسرار · قاطع
const axios = (await import("axios")).default;
assert.equal(axios.defaults.timeout, 0, "axios بلا مهلة افتراضياً قبل الطبقة");
assert.equal(client.installAxiosDefaults(axios), true);
assert.equal(axios.defaults.timeout, 120_000);
const error = await axios.get(`${base}/nf?apikey=${SECRET}`).catch((e) => e);
assert.ok(!String(error.config.url).includes(SECRET), "رابط الطلب داخل الخطأ بلا المفتاح");
assert.ok(!String(error.message).includes(SECRET));
for (let i = 0; i < client.CIRCUIT.threshold; i += 1) await axios.get(`${base}/down`).catch(() => null);
const blocked = await axios.get(`${base}/ok`).catch((e) => e);
assert.equal(blocked.code, "CIRCUIT_OPEN");
results.push("axios-layer");

server.close();
console.log(`✅ terboo-http-client: ${results.join(" · ")}`);
process.exit(0);
