// اختبار تكامل حقيقي للـAPI: خادم يستمع فعلاً على منفذ، ودورة دخول كاملة،
// ثم إثبات الصلاحيات و IDOR و CSRF والحدود وترويسات الأمان ومنع تزوير الدور.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

// ── إعداد معزول: قاعدة بيانات مؤقتة ومخزن موقع مؤقت ومنفذ عالٍ ──
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-web-it-"));
const config = (await import("../config.js")).default;
const PORT = 31700 + Math.floor(Math.random() * 400);

config.website = {
  ...(config.website || {}),
  enabled: true,
  host: "127.0.0.1",
  port: PORT,
  // تطوير محلي: HTTP صريح ⇒ الكوكي بلا Secure، وlocalhost أصل مسموح
  tlsMode: "disabled",
  publicBaseUrl: `http://127.0.0.1:${PORT}`,
  domain: "",
  trustProxy: false,
  session: { ...(config.website?.session || {}), cookieName: "terboo_session", idleMinutes: 60, absoluteHours: 24, maxPerUser: 5, sameSite: "Lax" },
  limits: {
    ...(config.website?.limits || {}),
    jsonBodyBytes: 64 * 1024,
    uploadBytes: 2 * 1024 * 1024,
    requestsPerMinute: 2000,
    otp: { codeTtlSeconds: 300, maxAttemptsPerChallenge: 5, resendCooldownSeconds: 1, perPhonePerHour: 100, perIpPerHour: 500, globalPerHour: 5000 },
  },
};

const { initDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(path.join(tempRoot, "db"));

// السجل الحقيقي: الموقع يُستضاف داخل عملية البوت بعد تحميل الإضافات،
// فالاختبار يحمّلها كما يفعل index.js حتى تُفحص كتالوجات حقيقية لا فارغة.
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
const loadedPlugins = await loadPlugins(path.join(process.cwd(), "plugins"));
assert.ok(loadedPlugins > 800, `تحميل الإضافات غير منطقي: ${loadedPlugins}`);

// مخزن الموقع في مجلد مؤقت (لا data/web الحقيقي)
const store = await import("../src/web/store/web-store.js");
store.initWebStore(path.join(tempRoot, "web"));

// مقبس واتساب مزيّف: يلتقط الرمز المُرسل (الاختبار وحده)
const sentMessages = [];
const otp = await import("../src/web/services/otp-service.js");
otp.setSocketProvider(() => ({
  user: { id: "100000@s.whatsapp.net" },
  onWhatsApp: async () => [{ exists: true }],
  sendMessage: async (to, content) => {
    sentMessages.push({ to, text: content.text || "" });
    return { key: { id: `m${sentMessages.length}` } };
  },
}));

// تنصيب البوت الفرعي: نحقن نواة وهمية ومقبساً وهمياً (بلا Baileys حقيقي)
const provision = await import("../src/web/services/subbot-provision.js");
provision.setSocketProvider(() => ({ user: { id: "100000@s.whatsapp.net" } }));
let provLive = null;
provision.setManagerProvider(() => ({
  isJadibotActive: () => false,
  getJadibotStatus: () => provLive,
  startJadibot: async (sock, m, userJid, usePairing) => {
    if (!usePairing || m.chat !== null) throw new Error("web adapter must request pairing without a chat");
    return { sock: {}, pairingCode: "WXYZ-7788" };
  },
  stopJadibot: async () => true,
}));

// التنزيلات والبحث: نحقن مُشغّل الأدوات (بلا شبكة خارجية في الاختبار)
const downloadService = await import("../src/web/services/download-service.js");
const searchService = await import("../src/web/services/search-service.js");
downloadService._setToolRunner(async ({ toolId }) => (toolId === "tiktok"
  ? { ok: false, error: "scraper_failed", items: [], latencyMs: 4 }
  : { ok: true, error: "", title: "clip", items: [{ type: "video", url: "https://cdn.example/v.mp4", external: true, note: "", thumbnail: false }], latencyMs: 9 }));
searchService._setToolRunner(async ({ input }) => ({
  ok: true, error: "", latencyMs: 6, text: "",
  items: [{ title: `نتيجة ${input.query}`, url: "https://ok.example/a", note: "مقتطف" }],
}));

// الخادم: نبنيه مباشرة حتى نستعمل مخزن مؤقت بدل data/web
const { createWebServer } = await import("../src/web/http/server.js");
const { buildRouter } = await import("../src/web/http/routes/index.js");
const runtime = { listening: false };
const server = createWebServer({ router: buildRouter(runtime), staticRoot: "" });
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, "127.0.0.1", resolve);
});
runtime.listening = true;

const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = BASE;

/** عميل HTTP يحفظ الكوكي ويرسل الترويسات التي تتوقعها الخدمة */
function client() {
  const jar = new Map();
  let csrf = "";
  return {
    get csrf() { return csrf; },
    setCsrf(value) { csrf = value; },
    cookieHeader() { return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; "); },
    async call(method, routePath, { body = null, headers = {}, origin = ORIGIN, raw = null, fetchSite = "same-origin" } = {}) {
      const init = { method, headers: { ...headers } };
      if (origin) init.headers.Origin = origin;
      if (fetchSite) init.headers["Sec-Fetch-Site"] = fetchSite;
      if (jar.size) init.headers.Cookie = this.cookieHeader();
      if (csrf && !["GET", "HEAD"].includes(method)) init.headers["X-CSRF-Token"] = csrf;
      const bodyAllowed = !["GET", "HEAD"].includes(method);
      if (raw && bodyAllowed) { init.body = raw; init.headers["Content-Type"] = init.headers["Content-Type"] || "application/octet-stream"; }
      else if (body !== null && bodyAllowed) { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }

      const response = await fetch(`${BASE}/api/v1${routePath}`, init);
      for (const cookie of response.headers.getSetCookie?.() || []) {
        const [pair] = cookie.split(";");
        const index = pair.indexOf("=");
        const name = pair.slice(0, index).trim();
        const value = pair.slice(index + 1).trim();
        if (value) jar.set(name, value); else jar.delete(name);
      }
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch { json = null; }
      return { status: response.status, headers: response.headers, body: json, text };
    },
  };
}

const alice = client();
const bob = client();

// ═══ ① المسارات العامة ═══
let res = await alice.call("GET", "/health/live");
assert.equal(res.status, 200);
assert.equal(res.body.status, "live");

res = await alice.call("GET", "/health/ready");
assert.equal(res.status, 200, "جاهز بعد فتح المنفذ وتهيئة المخزن");
assert.equal(res.body.listening, true);

res = await alice.call("GET", "/public/capabilities");
assert.equal(res.status, 200);
assert.ok(!JSON.stringify(res.body).includes("GeminiAPI"), "القدرات العامة لا تنشر أسماء المزوّدات");

// ترويسات الأمان على كل رد
assert.equal(res.headers.get("x-content-type-options"), "nosniff");
assert.equal(res.headers.get("x-frame-options"), "DENY");
assert.ok(res.headers.get("content-security-policy").includes("default-src 'self'"));
assert.equal(res.headers.get("referrer-policy"), "no-referrer");
assert.ok(res.headers.get("x-request-id"), "كل رد يحمل معرّف طلب");

// ═══ ② بلا جلسة: كل شيء محمي ═══
for (const [method, route] of [["GET", "/me"], ["GET", "/catalog/tools"], ["GET", "/owner/overview"], ["GET", "/me/tasks"], ["GET", "/games"]]) {
  const guard = await alice.call(method, route);
  assert.equal(guard.status, 401, `${route} يجب أن يطلب مصادقة`);
  assert.equal(guard.body.error.code, "UNAUTHENTICATED");
}

// ═══ ③ فحص المصدر على كل ما يغيّر حالة (حتى قبل الجلسة) ═══
res = await alice.call("POST", "/auth/otp/request", { body: { phone: "+201112223334" }, origin: "https://evil.example", fetchSite: "cross-site" });
assert.equal(res.status, 403);
assert.equal(res.body.error.code, "CSRF_FAILED", "أصل أجنبي لا يطلق طلب رمز");

// ═══ ④ رقم غير صالح ═══
res = await alice.call("POST", "/auth/otp/request", { body: { phone: "abc" } });
assert.equal(res.status, 400);
assert.equal(res.body.error.code, "INVALID_INPUT");
assert.equal(res.body.error.details.field, "phone");

// ═══ ⑤ دورة دخول كاملة ═══
sentMessages.length = 0;
res = await alice.call("POST", "/auth/otp/request", { body: { phone: "+201112223334", lang: "ar" } });
assert.equal(res.status, 200);
const challengeId = res.body.challengeId;
assert.ok(challengeId);
assert.equal(sentMessages.length, 1, "رسالة واحدة");
const code = (sentMessages[0].text.match(/\*(\d{6})\*/) || [])[1];
assert.ok(code);
assert.ok(!res.text.includes(code), "رد الـAPI لا يحمل الرمز");

// رمز خاطئ
res = await alice.call("POST", "/auth/otp/verify", { body: { challengeId, code: "000000" } });
assert.equal(res.status, 400);
assert.ok(!res.text.includes(code));

// رمز صحيح ⇒ كوكي HttpOnly + رمز CSRF
res = await alice.call("POST", "/auth/otp/verify", { body: { challengeId, code } });
assert.equal(res.status, 200, `verify failed: ${res.text}`);
assert.ok(res.body.csrfToken);
alice.setCsrf(res.body.csrfToken);
const setCookie = (res.headers.getSetCookie?.() || []).join(" ");
assert.ok(/HttpOnly/i.test(setCookie), "كوكي الجلسة HttpOnly");
assert.ok(/SameSite=Lax/i.test(setCookie));
assert.ok(!/Secure/i.test(setCookie), "tlsMode=disabled ⇒ بلا Secure (لا يُكذَب على المتصفح)");
assert.ok(!setCookie.includes(code));

// الجلسة تعمل
res = await alice.call("GET", "/me");
assert.equal(res.status, 200);
assert.ok(res.body.profile.accountRef && res.body.profile.accountRef.length >= 16, "مرجع حساب معتم");
assert.ok(!res.body.profile.canonical, "الهوية القانونية لا تُرسل للمتصفح");
assert.equal(res.body.profile.role, "user");
assert.match(res.body.profile.phoneMasked, /^•+3334$/, "الرقم مُقنَّع");
assert.ok(!res.text.includes("201112223334"), "الرقم الكامل لا يُعاد في الملف");

// ═══ ⑥ CSRF: طلب بجلسة صحيحة وبلا رمز ⇒ مرفوض ═══
const noCsrf = client();
const cookieValue = alice.cookieHeader();
res = await fetch(`${BASE}/api/v1/me/preferences`, {
  method: "PATCH",
  headers: { Cookie: cookieValue, Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json" },
  body: JSON.stringify({ language: "en" }),
});
assert.equal(res.status, 403, "جلسة صحيحة بلا رمز CSRF مرفوضة");
assert.equal((await res.json()).error.code, "CSRF_FAILED");

// مع الرمز ⇒ مقبول
res = await alice.call("PATCH", "/me/preferences", { body: { language: "en" } });
assert.equal(res.status, 200);
assert.deepEqual(res.body.updated, ["language"]);

// حقل غير مسموح لا يُكتب (منع mass assignment)
res = await alice.call("PATCH", "/me/preferences", { body: { isPremium: true, level: 99, koin: 1e9, role: "owner" } });
assert.equal(res.status, 400, "لا حقل مسموح ⇒ رفض");
res = await alice.call("GET", "/me");
assert.equal(res.body.profile.role, "user", "الدور لم يتغيّر");
assert.equal(res.body.profile.isPremium, false);

// ═══ ⑦ منع تزوير الدور في الجسم ═══
for (const forged of [{ isOwner: true }, { role: "owner" }, { userId: "pn:999" }, { canonical: "pn:999" }, { jid: "999@s.whatsapp.net" }]) {
  const attempt = await alice.call("GET", "/owner/overview", { headers: { "X-Forged": JSON.stringify(forged) } });
  assert.equal(attempt.status, 403, "مستخدم عادي لا يصل لوحة المالك");
  assert.equal(attempt.body.error.code, "OWNER_ONLY");
}
res = await alice.call("POST", "/owner/domain", { body: { domain: "evil.example", confirm: true, isOwner: true, role: "owner" } });
assert.equal(res.status, 403);
assert.equal(res.body.error.code, "OWNER_ONLY");

// ═══ ⑧ مستخدم ثانٍ + IDOR ═══
sentMessages.length = 0;
res = await bob.call("POST", "/auth/otp/request", { body: { phone: "+201998887776" } });
const bobChallenge = res.body.challengeId;
const bobCode = (sentMessages[0].text.match(/\*(\d{6})\*/) || [])[1];
res = await bob.call("POST", "/auth/otp/verify", { body: { challengeId: bobChallenge, code: bobCode } });
assert.equal(res.status, 200);
bob.setCsrf(res.body.csrfToken);

// محادثة لأليس
res = await alice.call("POST", "/ai/conversations", { body: { title: "خطة أليس" } });
assert.equal(res.status, 201);
const aliceConversation = res.body.id;

// بوب لا يراها ولا يقرؤها ولا يحذفها
res = await bob.call("GET", "/ai/conversations");
assert.equal(res.status, 200);
assert.equal(res.body.conversations.length, 0, "بوب لا يرى محادثات أليس");
for (const [method, route] of [["GET", `/ai/conversations/${aliceConversation}`], ["DELETE", `/ai/conversations/${aliceConversation}`], ["PATCH", `/ai/conversations/${aliceConversation}`]]) {
  const attempt = await bob.call(method, route, { body: { title: "x" } });
  assert.equal(attempt.status, 404, `${method} ${route} يجب أن يكون 404 لغير المالك`);
}
// أليس تراها
res = await alice.call("GET", `/ai/conversations/${aliceConversation}`);
assert.equal(res.status, 200);
assert.equal(res.body.conversation.title, "خطة أليس");

// ═══ ⑨ الرفع و IDOR على الملفات ═══
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082", "hex");
res = await alice.call("POST", "/media/uploads", { raw: png, headers: { "X-File-Name": "a.png" } });
assert.equal(res.status, 201, `upload failed: ${res.text}`);
const fileId = res.body.file.id;
assert.equal(res.body.file.kind, "image");
assert.ok(!res.text.includes(tempRoot), "مسار التخزين لا يُعاد");
assert.ok(!res.text.includes("data/web-uploads"));

// ملف تنفيذي ينتحل صورة ⇒ مرفوض
const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]), Buffer.alloc(64)]);
res = await alice.call("POST", "/media/uploads", { raw: elf, headers: { "X-File-Name": "safe.png" } });
assert.equal(res.status, 400);
assert.equal(res.body.error.details.reason, "executable");

// بوب لا ينزّل ملف أليس
res = await bob.call("GET", `/artifacts/${fileId}`);
assert.equal(res.status, 404, "تنزيل ملف غيره ⇒ 404");
res = await bob.call("DELETE", `/artifacts/${fileId}`);
assert.equal(res.status, 404);

// أليس تنزّله كمرفق
res = await fetch(`${BASE}/api/v1/artifacts/${fileId}`, { headers: { Cookie: alice.cookieHeader() } });
assert.equal(res.status, 200);
assert.match(res.headers.get("content-disposition") || "", /^attachment;/, "التنزيل دائماً attachment");
assert.equal(res.headers.get("x-content-type-options"), "nosniff");
assert.equal(res.headers.get("cache-control"), "private, no-store");

// ═══ ⑩ SSRF عبر مدخل أداة ═══
for (const badUrl of ["http://127.0.0.1:1/", "http://169.254.169.254/latest/meta-data/", "http://localhost/", "file:///etc/passwd", "http://10.0.0.1/"]) {
  const attempt = await alice.call("POST", "/tools/scraper:tiktok/run", { body: { input: { url: badUrl } } });
  assert.ok([400, 404].includes(attempt.status), `${badUrl} يجب أن يُرفض (كان ${attempt.status})`);
  if (attempt.status === 400) assert.equal(attempt.body.error.code, "INVALID_INPUT");
}

// ═══ ⑪ حدود الجسم و JSON ═══
res = await alice.call("POST", "/ai/conversations", { raw: Buffer.alloc(128 * 1024, 0x61), headers: { "Content-Type": "application/json" } });
assert.ok([400, 413].includes(res.status), "جسم أكبر من الحد يُرفض");
res = await fetch(`${BASE}/api/v1/ai/conversations`, {
  method: "POST",
  headers: { Cookie: alice.cookieHeader(), Origin: ORIGIN, "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", "X-CSRF-Token": alice.csrf },
  body: "{not json",
});
assert.equal(res.status, 400);
assert.equal((await res.json()).error.code, "MALFORMED_JSON");

// ═══ ⑫ مسار مجهول وطريقة غير مسموحة ═══
res = await alice.call("GET", "/does-not-exist");
assert.equal(res.status, 404);
res = await alice.call("DELETE", "/me");
assert.equal(res.status, 405);
assert.equal(res.body.error.code, "METHOD_NOT_ALLOWED");

// ═══ ⑬ لا stack trace ولا مسار ملف في أي خطأ ═══
for (const probe of ["/me", "/does-not-exist", `/ai/conversations/${aliceConversation}`]) {
  const out = await bob.call("GET", probe);
  assert.ok(!/\/home\/|at .*\(.*:\d+:\d+\)|node_modules/.test(out.text), `تسريب داخلي في ${probe}: ${out.text.slice(0, 120)}`);
}

// ═══ ⑭ المهام: الملكية ═══
res = await alice.call("GET", "/me/tasks");
assert.equal(res.status, 200);
assert.ok(Array.isArray(res.body.tasks));
res = await bob.call("GET", "/me/tasks/not-a-real-task");
assert.equal(res.status, 404);

// ═══ ⑮ السجل: أوامر واتساب تُعلَن غير قابلة للتشغيل ═══
res = await alice.call("GET", "/catalog/commands?limit=5");
assert.equal(res.status, 200);
assert.ok(res.body.total > 500, `عدد الأوامر غير منطقي: ${res.body.total}`);
for (const command of res.body.commands) {
  assert.equal(command.webRunnable, false);
  assert.equal(command.channel, "whatsapp");
  assert.ok(command.unavailableReason);
}
// أدوات المالك لا تظهر لمستخدم عادي
res = await alice.call("GET", "/catalog/tools");
assert.equal(res.status, 200);
assert.equal(res.body.tools.filter((t) => t.permission === "owner").length, 0, "أدوات المالك مخفية عن المستخدم العادي");

// ═══ ⑯ الخروج يُبطل الجلسة فوراً ═══
res = await alice.call("POST", "/auth/logout");
assert.equal(res.status, 200);
res = await alice.call("GET", "/me");
assert.equal(res.status, 401, "الجلسة بعد الخروج غير صالحة");

// ═══ ⑰ البوتات الفرعية: تنصيب آمن من الويب (نفس نواة المدير) ═══
res = await bob.call("GET", "/subbots");
assert.equal(res.status, 200);
assert.equal(res.body.pairing.availableInWeb, true);
assert.equal(res.body.pairing.label, "TARBOOV6");
// بلا تأكيد صريح ⇒ 409
res = await bob.call("POST", "/subbots/pair", { body: {} });
assert.equal(res.status, 409, "التنصيب يحتاج تأكيداً صريحاً");
assert.equal(res.body.error.code, "NEEDS_CONFIRMATION");
// مع تأكيد ⇒ 201 code-ready، الرمز الحقيقي للطالب، الوسم TARBOOV6
res = await bob.call("POST", "/subbots/pair", { body: { confirm: true } });
assert.equal(res.status, 201);
assert.equal(res.body.state, "code-ready");
assert.equal(res.body.label, "TARBOOV6");
assert.equal(res.body.code, "WXYZ-7788", "الرمز الحقيقي يصل الطالب الموثَّق");
assert.equal(res.body.copyCode, "WXYZ7788");
const pairRequestId = res.body.requestId;
// الاستعلام يُعيد الحالة للمالك ما دام الرمز طازجاً
res = await bob.call("GET", `/subbots/pair/${pairRequestId}`);
assert.equal(res.status, 200);
assert.equal(res.body.code, "WXYZ-7788");
// معرّف مجهول ⇒ 404 (لا كشف وجود طلب)
res = await bob.call("GET", "/subbots/pair/deadbeefdeadbeefdead");
assert.equal(res.status, 404);
// فتح الاتصال ⇒ connected والرمز يُمحى من الرد
provLive = { connectionReady: true, channelFollow: "pending" };
res = await bob.call("GET", `/subbots/pair/${pairRequestId}`);
assert.equal(res.status, 200);
assert.equal(res.body.state, "following-channel");
assert.equal(res.body.code, undefined, "لا رمز بعد فتح الاتصال");
provLive = null;

// ═══ ⑰-ب التنزيلات والبحث عبر HTTP حقيقي ═══
// المنصات مشتقّة من السجل الحقيقي
res = await bob.call("GET", "/downloads/platforms");
assert.equal(res.status, 200);
assert.ok(res.body.platforms.length >= 10, "منصات التنزيل من السجل");
assert.ok(res.body.platforms.every((row) => row.scrapers.length > 0), "كل منصة لها أداة");

// فحص رابط: منصة معروفة
res = await bob.call("POST", "/downloads/resolve", { body: { url: "https://www.tiktok.com/@a/video/1" } });
assert.equal(res.status, 200);
assert.equal(res.body.target.platform, "tiktok");
assert.equal(res.body.target.supported, true);

// مضيف غير مدعوم ⇒ سبب صريح لا محاولة
res = await bob.call("POST", "/downloads/resolve", { body: { url: "https://example.com/x" } });
assert.equal(res.status, 200);
assert.equal(res.body.target.supported, false);
assert.equal(res.body.target.reason, "unsupported-host");

// حماية SSRF على مستوى الـHTTP: loopback وميتاداتا وfile:// كلها مرفوضة
for (const bad of ["http://127.0.0.1/x", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"]) {
  res = await bob.call("POST", "/downloads/resolve", { body: { url: bad } });
  assert.equal(res.status, 400, `رابط خطر لم يُرفض: ${bad}`);
  assert.equal(res.body.error.code, "INVALID_INPUT");
}

// مهمة تنزيل حقيقية: 202 ثم متابعة حتى النتيجة الكاملة
res = await bob.call("POST", "/downloads/jobs", { body: { url: "https://www.tiktok.com/@a/video/1" } });
assert.equal(res.status, 202);
assert.ok(res.body.taskId, "معرّف مهمة");
assert.ok(res.body.poll.startsWith("/api/v1/downloads/jobs/"), "التتابع على مسار التنزيلات");
const downloadTaskId = res.body.taskId;
let jobBody = null;
for (let attempt = 0; attempt < 80; attempt += 1) {
  res = await bob.call("GET", `/downloads/jobs/${encodeURIComponent(downloadTaskId)}`);
  assert.equal(res.status, 200);
  jobBody = res.body;
  if (["completed", "failed", "cancelled", "expired"].includes(jobBody.task.status)) break;
  await new Promise((resolve) => setTimeout(resolve, 60));
}
assert.equal(jobBody.task.status, "completed", "المهمة اكتملت");
assert.equal(jobBody.outcome.ok, true, "النتيجة الكاملة متاحة لمالكها");
assert.equal(jobBody.outcome.result.items.length, 1);
assert.deepEqual(jobBody.outcome.tried.map((row) => row.ok), [false, true], "البديل جُرّب بعد فشل المتخصّصة");

// تاريخ التنزيلات من الطابور نفسه
res = await bob.call("GET", "/downloads/history");
assert.equal(res.status, 200);
assert.ok(res.body.downloads.some((row) => row.id === downloadTaskId), "المهمة في التاريخ");

// مصادر البحث حقيقية، والبحث يعيد بطاقات منقّحة
res = await bob.call("GET", "/search/sources");
assert.equal(res.status, 200);
assert.ok(res.body.sources.length > 0, "مصادر بحث من السجل");
res = await bob.call("POST", "/search", { body: { query: "قطط" } });
assert.equal(res.status, 200);
assert.equal(res.body.ok, true);
assert.equal(res.body.results.length, 1);
assert.equal(res.body.results[0].domain, "ok.example", "النطاق من الرابط");
assert.equal(res.body.results[0].external, true);
// مصدر مجهول ⇒ 404 · استعلام فارغ ⇒ 400
res = await bob.call("POST", "/search", { body: { query: "x", source: "no-such" } });
assert.equal(res.status, 404);
res = await bob.call("POST", "/search", { body: { query: "   " } });
assert.equal(res.status, 400);

// زائر بلا جلسة لا يصل أي مسار من الجديد
const stranger = client();
for (const [method, routePath] of [["GET", "/downloads/platforms"], ["POST", "/downloads/resolve"], ["GET", "/search/sources"], ["POST", "/search"], ["GET", "/subbots"]]) {
  res = await stranger.call(method, routePath, { body: method === "POST" ? {} : null });
  assert.equal(res.status, 401, `مسار مكشوف بلا جلسة: ${method} ${routePath}`);
}

// ═══ ⑱ الحظر يسري على جلسة قائمة ═══
const { getDatabase } = await import("../src/lib/terboo-database.js");
const db = getDatabase();
db.setting("bannedUsers", ["201998887776"]);
res = await bob.call("GET", "/me");
assert.equal(res.status, 403, "المحظور لا يُخدَم بجلسة سابقة");
assert.equal(res.body.error.code, "ACCOUNT_BANNED");
db.setting("bannedUsers", []);

await new Promise((resolve) => server.close(resolve));
// المجلد المؤقت يُترك للنظام: خطّافات flush على process.exit في محرّك قاعدة
// البيانات ومخزن الموقع تكتب بعد نهاية السكربت، وحذفه هنا يُنتج ضجيج ENOENT.
store.flushWebStore();

console.log("✅ web-api-integration: خادم حقيقي · دخول كامل بالرمز · ترويسات أمان · CSRF وفحص المصدر · منع تزوير الدور · IDOR على المحادثات والملفات والمهام · SSRF · حدود الجسم · لا تسريب مسار أو رمز · أوامر واتساب معلَنة غير قابلة للتشغيل · تنصيب بوت فرعي · تنزيلات بمهمة حقيقية وبديل · بحث ببطاقات منقّحة · الحظر فوري");
process.exit(0);
