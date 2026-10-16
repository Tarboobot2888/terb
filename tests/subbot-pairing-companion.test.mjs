// ═══════════════════════════════════════════════════════════
// اقتران البوت الفرعي بالرمز — توقيع المتصفّح
// ───────────────────────────────────────────────────────────
// العطل الذي يحرسه هذا الاختبار: الرمز يصدر ويُعرض، لكن واتساب
// لا يُكمل الربط فلا يُنشَأ بوت فرعي.
//
// السبب الحقيقي: Baileys يُرسل getCompanionPlatformId(browser) داخل
// عقدة companion_platform_id من طلب link_code_companion_reg، وجدول
// BROWSER_TO_COMPANION_WEB_CLIENT حسّاس لحالة الأحرف. كان المقبس
// الفرعي يستعمل ["Mac OS","safari",…] فيسقط إلى OTHER_WEB_CLIENT (9)
// بينما المقبس الرئيسي — الذي يقترن بنجاح — يستعمل "Chrome" ⇒ 1.
//
// يُنفَّذ على دالة Baileys الحقيقية (لا نسخة منها) وعلى المصدر الفعلي
// للمقبسين، بلا شبكة ولا مقبس حيّ.
// ═══════════════════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getCompanionPlatformId } from "@whiskeysockets/baileys";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/** يقرأ وسيط browser الحرفي من مصدر المقبس */
function browserOf(rel) {
  const source = read(rel);
  const match = source.match(/^\s*browser:\s*\[([^\]]+)\]/m);
  assert.ok(match, `لا يوجد وسيط browser في ${rel}`);
  const parts = [...match[1].matchAll(/"([^"]*)"/g)].map((row) => row[1]);
  assert.equal(parts.length, 3, `وسيط browser في ${rel} ليس ثلاثيّاً: ${match[1]}`);
  return parts;
}

const MAIN = "src/connection.js";
const CHILD = "src/lib/terboo-jadibot-manager.js";
const mainBrowser = browserOf(MAIN);
const childBrowser = browserOf(CHILD);

// ── 1. جدول Baileys حسّاس لحالة الأحرف فعلاً (إثبات السبب لا افتراضه) ──
const OTHER_WEB_CLIENT = "9";
assert.equal(
  getCompanionPlatformId(["Mac OS", "safari", "140.4.1"]),
  OTHER_WEB_CLIENT,
  "تغيّر سلوك Baileys: لم تعد حالة الأحرف تُسقط التوقيع إلى OTHER_WEB_CLIENT",
);
assert.notEqual(getCompanionPlatformId(["Mac OS", "Safari", "140.4.1"]), OTHER_WEB_CLIENT);

// ── 2. المقبس الفرعي يُنتج نوع عميل معروف ──────────────────
const childId = getCompanionPlatformId(childBrowser);
assert.notEqual(
  childId, OTHER_WEB_CLIENT,
  `توقيع المقبس الفرعي ${JSON.stringify(childBrowser)} يسقط إلى OTHER_WEB_CLIENT فلا يُكمل واتساب الربط`,
);
assert.notEqual(childId, "0", "توقيع المقبس الفرعي مجهول (UNKNOWN)");

// ── 3. وهو نفس توقيع المقبس الرئيسي الذي يقترن بنجاح ───────
const mainId = getCompanionPlatformId(mainBrowser);
assert.deepEqual(
  childBrowser, mainBrowser,
  `توقيع المقبس الفرعي يخالف الرئيسي: ${JSON.stringify(childBrowser)} ≠ ${JSON.stringify(mainBrowser)}`,
);
assert.equal(childId, mainId);

// ── 4. المقبس الفرعي يطلب الرمز عبر الواجهة الحقيقية ───────
const childSource = read(CHILD);
assert.ok(
  /requestPairingCode\s*\(/.test(childSource),
  "المقبس الفرعي لا يستعمل requestPairingCode الحقيقية",
);
// ولا يُسجَّل الرمز في السجلّات
assert.ok(
  !/console\.\w+\([^)]*pairingCode/i.test(childSource),
  "رمز الاقتران يُسرَّب إلى السجلّات",
);

// ── 5. لا رمز لمعرّف ليس رقم هاتف ─────────────────────────
// requestPairingCode(id) يأخذ الجزء المحلّي من الـjid كرقم هاتف. فحص الـjid
// القديم يقبل أي جزء محلّي ما دام النطاق s.whatsapp.net، فمعرّف LID محوَّل
// أو جزء غير رقمي يُصدر رمزاً لرقم لا وجود له: شكله سليم ولا يكتمل ربطه.
const { startJadibot } = await import(path.join(ROOT, CHILD));
const stubSock = { user: { id: "999999999999:1@s.whatsapp.net" } };
const NOT_A_PHONE = /تعذّر التعرّف على رقم هاتفك/;
for (const bad of ["abc@s.whatsapp.net", "0@s.whatsapp.net", "12345@s.whatsapp.net", "9@s.whatsapp.net"]) {
  await assert.rejects(
    () => startJadibot(stubSock, { chat: null, sender: bad }, bad, true, false),
    (error) => {
      assert.match(error.message, NOT_A_PHONE, `رسالة غير واضحة لـ${bad}: ${error.message}`);
      return true;
    },
    `قُبل معرّف ليس رقم هاتف: ${bad}`,
  );
}
// ومعرّف LID يُرفض قبل ذلك أصلاً (فحص النطاق القائم)
await assert.rejects(
  () => startJadibot(stubSock, { chat: null, sender: "123456789012345@lid" }, "123456789012345@lid", true, false),
  /معرف مستخدم غير صالح/,
);
// والحارس لا يُفرط: أرقام حقيقية تمرّ منه. يُختبر بنمطه المأخوذ من المصدر
// نفسه، لأن استدعاء startJadibot برقم صحيح يفتح مقبساً حقيقياً إلى واتساب.
const guard = childSource.match(/if \(!(\/\^.+?\/)\.test\(id\)\)/);
assert.ok(guard, "حارس الرقم غير موجود في المصدر");
const guardPattern = new RegExp(guard[1].slice(1, -1));
for (const good of ["201225655220", "12025550123", "447911123456", "6281234567890"]) {
  assert.ok(guardPattern.test(good), `الحارس يرفض رقماً صحيحاً: ${good}`);
}
for (const bad of ["abc", "0123456789", "", "12345", "1".repeat(19)]) {
  assert.ok(!guardPattern.test(bad), `الحارس يقبل ما ليس رقماً: ${bad}`);
}

console.log(
  `✅ subbot-pairing-companion: توقيع المقبس الفرعي ${JSON.stringify(childBrowser)} ⇒ companion_platform_id=${childId} (مطابق للرئيسي)`,
);

// استيراد المدير يُسجّل مؤقّتات ومستمعين على مستوى الوحدة؛ الاختبار انتهى فعلاً
process.exit(0);
