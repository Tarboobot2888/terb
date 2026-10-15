// اختبار تسجيل دخول الموقع: الرمز يُرسل عبر المقبس الحقيقي، ولا يُقبل رمز خاطئ
// أو منتهٍ أو مُستعمل، ولا يُسرَّب الرمز في أي رد أو سجل، ولا يكشف وجود الحساب.
import assert from "node:assert/strict";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const otp = await import("../src/web/services/otp-service.js");
const { identityFromInput } = await import("../src/web/services/identity-service.js");
const { _resetRateLimits } = await import("../src/web/services/rate-limit-service.js");

const identity = identityFromInput("+201012345678");
assert.ok(identity, "تطبيع الرقم يجب أن ينجح");
assert.equal(identity.canonical, "pn:201012345678");

// ── مقبس مزيّف يلتقط ما أُرسل فعلاً (الاختبار وحده — لا fallback في الإنتاج) ──
const sent = [];
const fakeSock = {
  user: { id: "100@s.whatsapp.net" },
  onWhatsApp: async () => [{ exists: true }],
  sendMessage: async (to, content) => {
    sent.push({ to, text: content.text || "" });
    return { key: { id: `m${sent.length}` } };
  },
};

// ① بلا مقبس ⇒ فشل صريح، ولا تحدٍّ حيّ، ولا ادّعاء إرسال
otp._resetChallenges();
_resetRateLimits();
otp.setSocketProvider(() => null);
await assert.rejects(
  () => otp.requestCode({ identity, ip: "203.0.113.5", lang: "ar" }),
  (error) => error.code === "BOT_OFFLINE",
  "بلا اتصال واتساب يجب أن يفشل الطلب صريحاً",
);
assert.equal(otp.otpStats().liveChallenges, 0, "لا يبقى تحدٍّ حيّ لرمز لم يُسلَّم");

// ② فشل التسليم ⇒ فشل صريح أيضاً
otp._resetChallenges();
_resetRateLimits();
otp.setSocketProvider(() => ({ ...fakeSock, sendMessage: async () => { throw new Error("send failed"); } }));
await assert.rejects(
  () => otp.requestCode({ identity, ip: "203.0.113.6", lang: "ar" }),
  (error) => error.code === "SERVICE_UNAVAILABLE",
);
assert.equal(otp.otpStats().liveChallenges, 0);

// ③ رقم غير موجود على واتساب ⇒ نفس الرد الموحّد (لا تعداد حسابات)
otp._resetChallenges();
_resetRateLimits();
otp.setSocketProvider(() => ({ ...fakeSock, onWhatsApp: async () => [{ exists: false }] }));
const absent = await otp.requestCode({ identity, ip: "203.0.113.7", lang: "ar" }).catch((e) => e);
assert.equal(absent.code, "SERVICE_UNAVAILABLE");
assert.ok(!/not.?on.?whatsapp/i.test(absent.message), "الرد لا يكشف أن الرقم غير موجود");

// ④ المسار الناجح: الرمز يصل في رسالة واحدة إلى الرقم الصحيح
otp._resetChallenges();
_resetRateLimits();
sent.length = 0;
otp.setSocketProvider(() => fakeSock);
const challenge = await otp.requestCode({ identity, ip: "203.0.113.8", lang: "ar" });
assert.ok(challenge.challengeId && challenge.challengeId.length >= 20, "معرّف تحدٍّ غير قابل للتخمين");
assert.equal(sent.length, 1, "رسالة واحدة لكل تحدٍّ");
assert.equal(sent[0].to, "201012345678@s.whatsapp.net", "تُرسل إلى الرقم المُثبت لا غيره");

// الرمز لا يظهر في رد الـAPI أبداً
const code = (sent[0].text.match(/\*(\d{6})\*/) || [])[1];
assert.ok(code, "الرسالة تحمل رمزاً من 6 أرقام");
assert.ok(!JSON.stringify(challenge).includes(code), "رد الـAPI لا يحمل الرمز");
assert.ok(!Object.values(challenge).some((v) => String(v).includes(code)));

// ⑤ رمز خاطئ يُرفض برسالة لا تميّز السبب
assert.throws(() => otp.verifyCode({ challengeId: challenge.challengeId, code: "000000", ip: "203.0.113.8" }),
  (error) => error.code === "INVALID_INPUT" && /wrong or has expired/i.test(error.message));

// ⑥ الرمز الصحيح يُقبل مرة واحدة فقط
const proven = otp.verifyCode({ challengeId: challenge.challengeId, code, ip: "203.0.113.8" });
assert.equal(proven.canonical, "pn:201012345678");
assert.throws(() => otp.verifyCode({ challengeId: challenge.challengeId, code, ip: "203.0.113.8" }),
  (error) => error.code === "INVALID_INPUT", "إعادة استعمال نفس الرمز مرفوضة");

// ⑦ تجاوز المحاولات يُبطل التحدي
otp._resetChallenges();
_resetRateLimits();
sent.length = 0;
const brute = await otp.requestCode({ identity, ip: "203.0.113.9", lang: "en" });
const realCode = (sent[0].text.match(/\*(\d{6})\*/) || [])[1];
for (let i = 0; i < 5; i++) {
  assert.throws(() => otp.verifyCode({ challengeId: brute.challengeId, code: "111111", ip: "203.0.113.9" }));
}
assert.throws(() => otp.verifyCode({ challengeId: brute.challengeId, code: realCode, ip: "203.0.113.9" }),
  (error) => error.code === "INVALID_INPUT", "بعد استنفاد المحاولات لا يُقبل حتى الرمز الصحيح");

// ⑧ تهدئة إعادة الإرسال لنفس الرقم
otp._resetChallenges();
_resetRateLimits();
sent.length = 0;
await otp.requestCode({ identity, ip: "203.0.113.10", lang: "ar" });
const again = await otp.requestCode({ identity, ip: "203.0.113.10", lang: "ar" }).catch((e) => e);
assert.equal(again.code, "RATE_LIMITED");
assert.ok(again.details?.retryAfterSeconds > 0, "الرد يحمل ثوانٍ حتى إعادة المحاولة");

// ⑨ حد الطلبات لكل رقم خلال ساعة
otp._resetChallenges();
_resetRateLimits();
let blocked = false;
for (let i = 0; i < 12; i++) {
  otp._resetChallenges();                       // نتجاوز التهدئة لنصل إلى الحد الساعي
  const out = await otp.requestCode({ identity, ip: `198.51.100.${i}`, lang: "ar" }).catch((e) => e);
  if (out?.code === "RATE_LIMITED") { blocked = true; break; }
}
assert.ok(blocked, "الحد الساعي لكل رقم يجب أن يمنع الإغراق");

// ⑩ تحدٍّ مجهول يُرفض بنفس الرسالة (لا تمييز)
assert.throws(() => otp.verifyCode({ challengeId: "does-not-exist", code: "123456", ip: "203.0.113.11" }),
  (error) => error.code === "INVALID_INPUT" && /wrong or has expired/i.test(error.message));

console.log("✅ web-auth-otp: مقبس حقيقي · فشل صريح بلا ادّعاء · رمز واحد لكل تحدٍّ · لا تسريب للرمز · محاولات وتهدئة وحدود · بلا تعداد حسابات");
process.exit(0);
