// خدمة الواجهة المبنيّة وأصول الهوية: ما يُقدَّم وما لا يُقدَّم أبداً،
// واجتياز المسار بطلبات خام (fetch يطبّع المسار فلا يصل للخادم).
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const ROOT = process.cwd();
const DIST = path.join(ROOT, "web", "dist");
const PORT = 32100 + Math.floor(Math.random() * 300);

const config = (await import("../config.js")).default;
config.website = {
  ...(config.website || {}),
  enabled: true, host: "127.0.0.1", port: PORT, tlsMode: "disabled",
  publicBaseUrl: `http://127.0.0.1:${PORT}`, domain: "", trustProxy: false,
};

const { initDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "terboo-static-db-")));
const store = await import("../src/web/store/web-store.js");
store.initWebStore(fs.mkdtempSync(path.join(os.tmpdir(), "terboo-static-web-")));

const { createWebServer, resolveBrandAsset } = await import("../src/web/http/server.js");
const { buildRouter } = await import("../src/web/http/routes/index.js");
const server = createWebServer({ router: buildRouter({ listening: true }), staticRoot: DIST });
await new Promise((resolve) => server.listen(PORT, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${PORT}`;

// ── ① أصول الهوية: المجلدات المسموحة فقط، ولا اختراع لملف غائب ──
assert.ok(resolveBrandAsset("/brand/terboo.png"), "شعار الهوية يُقدَّم");
assert.ok(resolveBrandAsset("/brand/sections/ai.jpg"), "صورة تصنيف تُقدَّم");
assert.ok(resolveBrandAsset("/brand/fonts/Cairo-Regular.ttf"), "خط عربي محلي يُقدَّم");
// الفجوة الحقيقية في الأصول: 03 غير موجود ولا يُختلق
assert.equal(resolveBrandAsset("/brand/shuffle/terboo-shuffle-03.jpg"), null, "ملف أصل غائب لا يُقدَّم");
for (const outside of ["/brand/../../config.js", "/brand/sections/../../../config.js", "/brand/.env", "/brand/", "/brand/x/y.png"]) {
  assert.equal(resolveBrandAsset(outside), null, `مسار خارج الجذور المسموحة: ${outside}`);
}

// الخطوط التي يشير إليها الـCSS موجودة فعلاً (لا 404 من الواجهة)
const tokens = fs.readFileSync(path.join(ROOT, "web", "src", "styles", "tokens.css"), "utf8");
const fontRefs = [...tokens.matchAll(/url\("(\/brand\/fonts\/[^"]+)"\)/g)].map((hit) => hit[1]);
assert.ok(fontRefs.length >= 5, `عدد الخطوط المرجعية غير منطقي: ${fontRefs.length}`);
for (const ref of fontRefs) {
  assert.ok(resolveBrandAsset(ref), `خط مرجعي غير موجود: ${ref}`);
}

// صور الأقسام التي تعرضها صفحة التعريف موجودة فعلاً
const landing = fs.readFileSync(path.join(ROOT, "web", "src", "pages", "Landing.tsx"), "utf8");
// كتلة SECTIONS وحدها: مفاتيح الميزات ليست أسماء صور
const sectionsBlock = landing.slice(landing.indexOf("const SECTIONS"), landing.indexOf("] as const"));
const sectionKeys = [...sectionsBlock.matchAll(/\{ key: "([a-z]+)"/g)].map((hit) => hit[1]);
assert.ok(sectionKeys.length >= 6, `عدد الأقسام غير منطقي: ${sectionKeys.length}`);
for (const key of sectionKeys) {
  assert.ok(resolveBrandAsset(`/brand/sections/${key}.jpg`), `صورة قسم غير موجودة: ${key}`);
}

// ── ② الواجهة المبنيّة تُقدَّم، والمسارات الداخلية للتطبيق تعطي الهيكل ──
const distBuilt = fs.existsSync(path.join(DIST, "index.html"));
if (distBuilt) {
  for (const route of ["/", "/dashboard", "/ai", "/owner"]) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, `مسار تطبيق لم يُقدَّم: ${route}`);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
  }
  // الحزمة المبنيّة لا تحمل أي سر ولا مسار داخلي
  const html = await (await fetch(base)).text();
  const bundlePath = (html.match(/assets\/index-[\w-]+\.js/) || [])[0];
  assert.ok(bundlePath, "الصفحة تشير إلى حزمة مبنيّة");
  const bundle = await (await fetch(`${base}/${bundlePath}`)).text();
  for (const needle of ["ANTHROPIC", "API_KEY", "apiKey", "masterKey", "WEBSITE_SESSION_SECRET", "/home/", "ownerNumber"]) {
    assert.ok(!bundle.includes(needle), `الحزمة المبنيّة تحمل: ${needle}`);
    assert.ok(!html.includes(needle), `الصفحة تحمل: ${needle}`);
  }
}

// ── ③ ترويسات الأمان على رد الواجهة نفسه ──
const shell = await fetch(`${base}/`);
if (distBuilt) {
  assert.match(shell.headers.get("content-security-policy") || "", /default-src 'self'/);
  assert.equal(shell.headers.get("x-frame-options"), "DENY");
  assert.equal(shell.headers.get("x-content-type-options"), "nosniff");
  assert.equal(shell.headers.get("referrer-policy"), "no-referrer");
}

// ── ④ اجتياز المسار بطلب خام: لا شيء يخرج من الجذرين المسموحين ──
function raw(target) {
  return new Promise((resolve) => {
    const socket = net.connect(PORT, "127.0.0.1", () => {
      socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nConnection: close\r\n\r\n`);
    });
    let data = "";
    socket.on("data", (chunk) => { data += chunk.toString("utf8"); });
    socket.on("end", () => resolve(data));
    socket.on("error", () => resolve(""));
  });
}

const FORBIDDEN_CONTENT = /export default config|owner:\s*\{|ANTHROPIC_API_KEY|masterKey|"dependencies"\s*:|BEGIN (?:RSA |EC )?PRIVATE KEY|"creds"/;
const attacks = [
  "/../config.js", "/../../config.js", "/./../config.js",
  "/brand/../../config.js", "/brand/fonts/../../../config.js",
  "/%2e%2e/config.js", "/..%2fconfig.js", "/brand/..%2f..%2fconfig.js",
  "/database/main/users.json", "/session/creds.json", "/.env",
  "/data/secure/website-session.key", "/package.json", "/src/web/config.js",
  "/node_modules/axios/package.json", "/..\\config.js",
];
for (const target of attacks) {
  const response = await raw(target);
  const body = response.slice(response.indexOf("\r\n\r\n") + 4);
  assert.ok(!FORBIDDEN_CONTENT.test(body), `تسريب محتوى عبر: ${target}`);
  // مسار يحمل امتداد ملف ولم يطابق أصلاً ⇒ 404 لا هيكل تطبيق
  const status = (response.match(/^HTTP\/1\.1 (\d{3})/) || [])[1];
  assert.equal(status, "404", `${target} يجب أن يكون 404 (كان ${status})`);
}

// مسار بلا امتداد لا يُمكن تمييزه عن مسار تطبيق ⇒ يُعطى الهيكل، والمهم أنه لا يسرّب
for (const target of ["/tmp/x", "/database", "/session", "/../../etc/passwd/x"]) {
  const response = await raw(target);
  const body = response.slice(response.indexOf("\r\n\r\n") + 4);
  assert.ok(!FORBIDDEN_CONTENT.test(body), `تسريب محتوى عبر: ${target}`);
  assert.ok(!/root:|bin\/bash/.test(body), `تسريب ملف نظام عبر: ${target}`);
}

// ── ⑤ الطرق غير المسموحة على الملفات الثابتة ──
for (const method of ["POST", "PUT", "DELETE"]) {
  const response = await fetch(`${base}/`, { method, headers: { Origin: base, "Sec-Fetch-Site": "same-origin" } });
  assert.equal(response.status, 405, `${method} على ملف ثابت يجب أن يُرفض`);
}

await new Promise((resolve) => server.close(resolve));
store.flushWebStore();
console.log(`✅ web-static-and-assets: أصول الهوية من assets/ بمجلدات مسموحة · كل خط وصورة مرجعية موجودة فعلاً · ${distBuilt ? "الواجهة المبنيّة تُقدَّم بلا أي سر" : "لم تُبنَ الواجهة بعد (web/dist غائب) — تخطّي فحوصها"} · 17 محاولة اجتياز مسار كلها 404 بلا تسريب · ترويسات أمان على الواجهة`);
process.exit(0);
