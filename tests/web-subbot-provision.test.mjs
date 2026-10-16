// اختبار تنصيب البوت الفرعي (الويب): نواة واحدة، تسليم آمن، لا تسريب للرمز.
// يغطّي: دورة الحياة والحالات، ملكية الطلب (requestId وحده لا يكفي)،
// idempotency ضد النقر المزدوج، التهدئة، انتهاء نافذة الرمز، الإلغاء،
// محو الرمز بعد الاتصال، وأن الرمز الحقيقي يأتي من requestPairingCode عبر
// مقبس وهمي (بلا Baileys حقيقي ولا حساب حقيقي)، وأن المدير لا يسجّل أي رمز.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const prov = await import("../src/web/services/subbot-provision.js");
const { _resetRateLimits } = await import("../src/web/services/rate-limit-service.js");

const A = { canonical: "pn:201000000001" };
const B = { canonical: "pn:201000000002" };

// مقبس رئيسي وهمي (رقم بوت مختلف عن الأهداف)
prov.setSocketProvider(() => ({ user: { id: "999000000000@s.whatsapp.net" } }));

// مدير وهمي: يحاكي childSock.requestPairingCode عبر startJadibot، ويكشف الحالة الحيّة
let pairingCalls = 0;
let liveStatus = null;     // ما يعيده getJadibotStatus
let active = false;        // isJadibotActive
let stopCalls = 0;
let nextCode = "ABCD-1234";
const fakeManager = {
  isJadibotActive: () => active,
  getJadibotStatus: () => liveStatus,
  startJadibot: async (sock, m, userJid, usePairing) => {
    pairingCalls++;
    assert.equal(usePairing, true, "الويب يطلب اقتراناً");
    assert.equal(m.chat, null, "لا محادثة واتساب في مسار الويب");
    // في الإنتاج هذا هو ناتج childSock.requestPairingCode المنسَّق
    return { sock: {}, pairingCode: nextCode };
  },
  stopJadibot: async () => { stopCalls++; return true; },
};
prov.setManagerProvider(() => fakeManager);

function fresh() {
  prov._reset();
  _resetRateLimits();
  prov._setTimings({ codeTtlMs: 150_000, cooldownMs: 60_000 });
  pairingCalls = 0; liveStatus = null; active = false; stopCalls = 0; nextCode = "ABCD-1234";
}

// ── 1. بدء التنصيب ⇒ code-ready، الرمز الحقيقي معاد، الوسم TARBOOV6 ──
fresh();
let r = await prov.startProvision({ principal: A, sessionId: "sessA", ip: "1.1.1.1" });
assert.equal(r.state, "code-ready");
assert.equal(r.label, "TARBOOV6", "TARBOOV6 وسم فقط");
assert.equal(r.code, "ABCD-1234", "الرمز الحقيقي من requestPairingCode");
assert.equal(r.copyCode, "ABCD1234", "رمز النسخ بلا شرطات");
assert.ok(r.expiresInSeconds > 0 && r.expiresInSeconds <= 150);
assert.ok(/•/.test(r.maskedTarget) && /0001$/.test(r.maskedTarget), "الهدف مُقنَّع لآخر أربعة");
assert.equal(pairingCalls, 1);
const reqId = r.requestId;
assert.ok(reqId && reqId.length >= 20, "معرّف طلب عشوائي كافٍ");

// ── 2. الملكية: مستخدم آخر لا يقرأ طلب غيره حتى بمعرفة requestId ⇒ 404 ──
await assert.rejects(
  () => prov.getProvision({ principal: B, sessionId: "sessB", requestId: reqId }),
  (e) => e.code === "NOT_FOUND",
  "طلب A لا يُقرأ بهوية B",
);
// معرّف مجهول ⇒ 404
await assert.rejects(
  () => prov.getProvision({ principal: A, sessionId: "sessA", requestId: "deadbeef" }),
  (e) => e.code === "NOT_FOUND",
);
// جلسة مختلفة لنفس الحساب ⇒ 404 (ربط بالجلسة)
await assert.rejects(
  () => prov.getProvision({ principal: A, sessionId: "other", requestId: reqId }),
  (e) => e.code === "NOT_FOUND",
);

// ── 3. المالك الصحيح يرى الرمز ما دام طازجاً ──
r = await prov.getProvision({ principal: A, sessionId: "sessA", requestId: reqId });
assert.equal(r.state, "code-ready");
assert.equal(r.code, "ABCD-1234");

// ── 4. idempotency: نقر مزدوج ⇒ نفس الطلب ونفس الرمز، بلا مقبس ثانٍ ──
const r2 = await prov.startProvision({ principal: A, sessionId: "sessA", ip: "1.1.1.1" });
assert.equal(r2.requestId, reqId, "نفس الطلب للنقر المزدوج");
assert.equal(pairingCalls, 1, "لا اقتران جديد عند النقر المزدوج");

// ── 5. تقدّم الحالة: اتصال مفتوح ⇒ connected (والرمز يُمحى)، ثم ready بعد المتابعة ──
liveStatus = { connectionReady: true, followedChannel: false };
r = await prov.getProvision({ principal: A, sessionId: "sessA", requestId: reqId });
assert.equal(r.state, "connected");
assert.equal(r.code, undefined, "الرمز يُمحى بعد فتح الاتصال");
liveStatus = { connectionReady: true, followedChannel: true };
r = await prov.getProvision({ principal: A, sessionId: "sessA", requestId: reqId });
assert.equal(r.state, "ready", "ready فقط بعد اتصال socket حقيقي + متابعة القناة");
assert.equal(r.code, undefined);

// ── 6. انتهاء نافذة الرمز بلا اتصال ⇒ expired، بلا رمز ──
fresh();
prov._setTimings({ codeTtlMs: -1000 });
r = await prov.startProvision({ principal: A, sessionId: "sessA", ip: "1.1.1.1" });
// الرمز قد يُعرض لحظة الإنشاء؛ بعد الاستعلام والنافذة صفر ⇒ expired
r = await prov.getProvision({ principal: A, sessionId: "sessA", requestId: r.requestId });
assert.equal(r.state, "expired");
assert.equal(r.code, undefined);

// ── 7. الإلغاء ⇒ cancelled، الرمز مُمحى، وتُنظَّف الجلسة إن لم تتصل ──
fresh();
r = await prov.startProvision({ principal: A, sessionId: "sessA", ip: "1.1.1.1" });
const cancelId = r.requestId;
const c = await prov.cancelProvision({ principal: A, sessionId: "sessA", requestId: cancelId });
assert.equal(c.state, "cancelled");
assert.equal(c.code, undefined);
assert.equal(stopCalls, 1, "اقتران غير مكتمل يُوقَف عند الإلغاء");

// ── 8. التهدئة: بعد حالة نهائية، بدء فوري لنفس الحساب ⇒ 429 ──
await assert.rejects(
  () => prov.startProvision({ principal: A, sessionId: "sessA", ip: "1.1.1.1" }),
  (e) => e.code === "RATE_LIMITED",
  "تهدئة لكل حساب بين طلبين",
);

// ── 9. جلسة حيّة بالفعل ⇒ تأكيد مطلوب بدل إنشاء ثانية ──
fresh();
active = true;
await assert.rejects(
  () => prov.startProvision({ principal: A, sessionId: "sessA", ip: "1.1.1.1" }),
  (e) => e.code === "NEEDS_CONFIRMATION" && e.details?.reason === "already-active",
);

// ── 10. بوت غير متصل ⇒ BOT_OFFLINE صريح ──
fresh();
prov.setSocketProvider(() => null);
await assert.rejects(
  () => prov.startProvision({ principal: A, sessionId: "sessA", ip: "1.1.1.1" }),
  (e) => e.code === "BOT_OFFLINE",
);
prov.setSocketProvider(() => ({ user: { id: "999000000000@s.whatsapp.net" } }));

// ── 11. حساب بلا رقم موثَّق ⇒ INVALID_INPUT ──
fresh();
await assert.rejects(
  () => prov.startProvision({ principal: { canonical: "lid:12345" }, sessionId: "x", ip: "1.1.1.1" }),
  (e) => e.code === "INVALID_INPUT" && e.details?.reason === "no-confirmed-phone",
);

// ── 12. المدير لا يسجّل أي كود اقتران (فحص المصدر — تسريب اللوق المحذوف) ──
const mgrSrc = fs.readFileSync(path.join(process.cwd(), "src/lib/terboo-jadibot-manager.js"), "utf8");
const loggerLines = mgrSrc.split("\n").filter((l) => /logger\.(info|warn|error|debug|success)\(/.test(l));
for (const line of loggerLines) {
  assert.ok(!/\$\{\s*pairingCode\s*\}/.test(line), `سطر لوق يطبع كود الاقتران: ${line.trim().slice(0, 80)}`);
}
assert.ok(mgrSrc.includes("جاهز للتسليم الآمن"), "لوق بديل آمن بلا كود موجود");
// المدير يعيد pairingCode ويكشف حقول الحالة الجديدة
assert.ok(/return\s*\{\s*sock:\s*childSock,\s*pairingCode\s*\}/.test(mgrSrc), "startJadibot يعيد pairingCode");
assert.ok(mgrSrc.includes("followedChannel") && mgrSrc.includes("connectionReady"), "getJadibotStatus يكشف حالة الاتصال/المتابعة");
assert.ok(mgrSrc.includes("newsletterFollow"), "متابعة القناة عند الاتصال");

console.log("✅ web-subbot-provision: نواة واحدة · رمز حقيقي من requestPairingCode · لا تسريب للرمز · ملكية في كل poll · idempotency · تهدئة · انتهاء · إلغاء · محو بعد الاتصال · TARBOOV6 وسم فقط");
