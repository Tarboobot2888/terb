// لوحة تحكّم الموقع للمالك (.موقع): كل زر يعود إلى أمر يفحص الملكية ·
// لا رمز اقتران ولا مفتاح ولا مسار جلسة ولا رقم كامل في أي مخرج ·
// الأفعال الحسّاسة تحتاج تأكيداً ويمنعها قفل من التزامن ·
// رابط الموقع من المصدر المركزي ولا يكون رابط قناة واتساب.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const ROOT = process.cwd();
const FILE = path.join(ROOT, "plugins/owner/موقع.js");
const source = fs.readFileSync(FILE, "utf8");
const plugin = await import("../plugins/owner/موقع.js");

// ── 1. الأمر للمالك وحده ──────────────────────────────────
assert.equal(plugin.config.isOwner, true, "لوحة الموقع للمالك وحده");
assert.equal(plugin.config.category, "owner");
assert.equal(plugin.config.isEnabled, true);
assert.equal(typeof plugin.handler, "function");

// ── 2. كل زر/صف يعود إلى أمر هذا البلوقن نفسه ─────────────
// الأزرار تُبنى بـCMD(...) من اسم البلوقن، فلا مسار تنفيذ يتخطّى فحص الصلاحية.
assert.ok(/const CMD = \(\.\.\.parts\) =>/.test(source), "معرّفات الأزرار تُبنى من اسم البلوقن");
assert.ok(!/button\.quickReply\(\s*"/.test(source), "لا معرّف زر كنصّ ثابت");
// لا زر ينادي أمراً آخر غير .موقع
for (const match of source.matchAll(/button\.quickReply\(([^,]+),/g)) {
  assert.ok(/CMD\(/.test(match[1]), `زر لا يبني أمره من CMD: ${match[1].trim().slice(0, 40)}`);
}

// ── 3. الأفعال الحسّاسة: تأكيد + قفل ضد التزامن ───────────
assert.ok(/const CONFIRM = new Set\(/.test(source), "قائمة صيغ التأكيد موجودة");
assert.ok(/if \(!isConfirmed\(rest\)\)/.test(source), "الفعل الحسّاس يطلب تأكيداً قبل التنفيذ");
assert.ok(/function acquire\(/.test(source) && /function release\(/.test(source), "قفل عملية واحدة موجود");
assert.ok(/const gate = acquire\(sub\);/.test(source), "القفل يُطلب قبل التنفيذ");
assert.ok(/} finally {\s*\n\s*release\(\);/.test(source), "القفل يُحرَّر دائماً");
// الإيقاف والتشغيل وإعادة التشغيل كلها تحت نفس البوابة
const gated = source.slice(source.indexOf('if (sub === "enable" || sub === "disable" || sub === "restart")'));
assert.ok(gated.length > 200, "الأفعال الثلاثة في مسار واحد مُحكَم");
for (const call of ["stopWebServer", "startWebServer"]) {
  const index = source.indexOf(call);
  assert.ok(index > source.indexOf("const gate = acquire(sub);"), `${call} يُنفَّذ بعد القفل لا قبله`);
}

// ── 4. لا سرّ في أي مخرج من اللوحة ────────────────────────
// رمز الاقتران: اللوحة تعرض الوسم لا الرمز
assert.ok(/INSTALL_LABEL = "TARBOOV6"/.test(source), "وسم التنصيب معرَّف");
assert.ok(!/pairingCode|requestPairingCode|copyCode/.test(source), "لا رمز اقتران في لوحة المالك");
// المعامل الثاني لـbutton.copy هو ما يُنسَخ فعلاً: يجب أن يكون الوسم لا سرّاً
assert.ok(/button\.copy\([\s\S]*?,\s*INSTALL_LABEL\s*\)/.test(source), "زر النسخ ينسخ الوسم لا سرّاً");
// مفتاح OpenClaw: يُعرض «موجود/غائب» فقط
assert.ok(/engine\.hasToken \? "موجود" : "غائب"/.test(source), "مفتاح الخدمة يُعرض كوجود فقط");
assert.ok(!/openclawToken|\.token\b/.test(source), "لا قراءة للمفتاح نفسه في اللوحة");
// مسارات الجلسات والأرقام
assert.ok(!/credsPath|JADIBOT_AUTH_FOLDER|getJadibotAuthPath/.test(source), "لا مسار جلسة في اللوحة");
assert.ok(/maskPhone\(/.test(source), "مرجع البوت الفرعي مُقنَّع");

// ── 5. الرابط من المصدر المركزي ولا يكون رابط قناة ────────
assert.ok(/brand\.websiteUrl\(\)/.test(source), "الرابط من باني الروابط المركزي");
assert.ok(!/saluran|whatsapp\.com\/channel|channelUrl/.test(source), "لا رابط قناة واتساب كعنوان للموقع");
// زر الموقع مشروط بوجود رابط صالح
assert.ok(/\.\.\.\(link \? \[button\.url\(/.test(source), "زر الموقع مشروط بوجود رابط");

// ── 6. الحالة المعروضة حقيقية لا مُفترضة ─────────────────
assert.ok(/web\.webStatus\(\)/.test(source), "حالة الموقع من الخدمة الحقيقية");
assert.ok(/openclawStatus\(\)/.test(source) && /service\.status\(/.test(source), "صحة OpenClaw من الجسر الحقيقي");
assert.ok(/getAllJadibotSessions\(\)/.test(source) && /getJadibotStatus\(/.test(source), "البوتات الفرعية من المدير الحقيقي");
assert.ok(/MAX_JADIBOT_COUNT/.test(source), "الحد الأقصى من المدير لا رقم مكتوب");
// الحد الأقصى مُصدَّر فعلاً من المدير (وإلا عُرض رقم احتياطي صامت)
const manager = await import("../src/lib/terboo-jadibot-manager.js");
assert.equal(typeof manager.MAX_JADIBOT_COUNT, "number", "المدير يُصدّر الحد الأقصى");
assert.ok(manager.MAX_JADIBOT_COUNT > 0);

// ── 7. الشهادة: تقرير لا وعد بإصدار ──────────────────────
// لا نداء يُصدر شهادة (issueTls في domain-service يرفض أصلاً)، ولا تنفيذ عميل ACME
assert.ok(!/issueTls\s*\(/.test(source), "اللوحة لا تنادي إصدار شهادة");
assert.ok(!/certbot\s+(certonly|renew)|acme\.sh/i.test(source), "اللوحة لا تشغّل عميل ACME");
assert.ok(/domainService\.tlsStatus\(\)/.test(source), "حالة TLS من الخدمة");
// وتقول الحقيقة صراحةً: الإصدار خارج البوت
assert.ok(/خارج البوت/.test(source), "اللوحة تصرّح أن الإصدار يتمّ خارج البوت");

// ── 8. لا تنفيذ نظام ولا كتابة إعداد من محادثة ───────────
assert.ok(!/child_process|execSync|execFile|spawn\(/.test(source), "لا تنفيذ أوامر نظام من لوحة المالك");
assert.ok(!/writeFileSync|fs\.write/.test(source), "لوحة المالك لا تكتب ملفات إعداد");

// ── 9. الأوامر الفرعية الجديدة معلَنة في الاستخدام ───────
for (const word of ["لوحة", "openclaw", "بوتات", "اعادة"]) {
  assert.ok(plugin.config.usage.includes(word), `الاستخدام لا يذكر: ${word}`);
}

// ── 10. اللوحة تُسلَّم بطبقة التسليم الموحّدة مع بديل نصّي ──
assert.ok(/deliverMenu\(sock, m, \{/.test(source), "اللوحة تمرّ على طبقة التسليم الموحّدة");
assert.ok(/fallbackText:/.test(source), "بديل نصّي حين ترفض الأزرار");
assert.ok(/menuId: "owner-website"/.test(source), "معرّف قائمة واضح للسجل");

console.log("✅ owner-website-panel: للمالك وحده · كل زر يعود لأمر يفحص الملكية · تأكيد وقفل للأفعال الحسّاسة · لا رمز اقتران ولا مفتاح ولا مسار جلسة · رابط مركزي لا قناة · حالة حقيقية من الخدمات");
// استيراد البلوقن يسحب قاعدة البيانات وطبقاتها (مؤقّتات كتابة مؤجَّلة)، فننهي
// العملية صراحةً كما تفعل بقية اختبارات البلوقنات بدل انتظار تفريغ الحلقة.
process.exit(0);
