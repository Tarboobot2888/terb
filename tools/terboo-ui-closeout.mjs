#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🧾 V6 §28 — تقرير إغلاق ترحيل الواجهة (مولَّد، لا مكتوب يدوياً)
// ───────────────────────────────────────────────
//   node tools/terboo-ui-closeout.mjs [--base aee0195]
// يقارن قائمة الإضافات التي كانت تبني حمولات تفاعلية مباشرة عند خط الأساس (من docs/inventory في git)
// بالحالة الحالية (tools/terboo-inventory.mjs)، ويسرد ملفات النواة التي تلمس Baileys منخفض المستوى
// مع سبب كل منها. يكتب docs/TERBOO_V6_UI_MIGRATION_CLOSEOUT.md.
// ═══════════════════════════════════════════════

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "aee0195";
const OUT = "docs/TERBOO_V6_UI_MIGRATION_CLOSEOUT.md";

const before = JSON.parse(execFileSync("git", ["show", `${BASE}:docs/inventory/after/summary.json`], { cwd: ROOT }).toString()).directInteractivePlugins;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-ui-closeout-"));
execFileSync(process.execPath, ["tools/terboo-inventory.mjs", "--out", path.relative(ROOT, tmp)], { cwd: ROOT, stdio: "ignore" });
const now = JSON.parse(fs.readFileSync(path.join(tmp, "summary.json"), "utf8")).directInteractivePlugins;
fs.rmSync(tmp, { recursive: true, force: true });

/** استثناءات الإضافات: ليست بناء حمولة أصلاً (كشف نصي يطابق أسماء الأنواع) */
const PLUGIN_EXCEPTIONS = {
  "plugins/group/منع_البوتات.js": "كاشف بوتات: يقرأ أنواع الرسائل الواردة (buttonsMessage/listMessage…) لتقدير أن المرسل بوت — لا يبني أي حمولة",
  "plugins/owner/حفظ.js": "متغير نصي اسمه listMessage وفحص نوع imageMessage للوسيط المقتبس — لا يبني أي حمولة تفاعلية",
};

const LOW_LEVEL = /generateWAMessageFromContent|relayMessage\(|prepareWAMessageMedia/g;
const CORE_REASONS = {
  "src/lib/terboo-menu-delivery.js": "طبقة التسليم الموحّدة (compatibility layer الوحيدة لواجهات البلوقنات): طبقات Native Flow ← صورة ← Carousel ← نص، تحقق قبل الإرسال، سجل كل مرحلة، بديل عند الرفض",
  "src/lib/terboo-interactive-builder.js": "البنّاء المركزي للحمولات (أزرار · رؤوس · Native Flow · Carousel · تحويل الأشكال القديمة)",
  "src/lib/terboo-wa-compat.js": "توافق Baileys الرسمي rc14: عقدة biz للرسائل التفاعلية وتوقيعات المكتبة السابقة — على حدود المقبس",
  "src/lib/terboo-socket.js": "مقبس البوت: دوال إرسال عامة (sendMessage المساعدة) تُستعمل من النواة",
  "src/lib/terboo-serialize.js": "m.reply ومساعدات الرسالة المسلسلة (نص/وسائط/بطاقات النواة) — نواة لا بلوقن",
  "src/handler.js": "إعادة كتابة الرسائل التفاعلية الواردة وتمرير الأزرار (تحليل لا بناء واجهة) ورسائل النظام",
  "src/lib/terboo-onboarding.js": "بطاقة اللغة: تمر أولاً عبر sendCard، والطبقات منخفضة المستوى هي بديل احتياطي للأجهزة القديمة فقط",
  "src/lib/terboo-group-protection.js": "حماية المجموعة: إعادة توجيه/نسخ رسالة محذوفة كما هي (ليست واجهة أزرار)",
  "src/lib/terboo-auto-download.js": "ألبوم الوسائط المحمّلة (albumMessage + messageAssociation) — ليس واجهة أزرار",
  "src/lib/terboo-transport.js": "نقل الرسائل وإعادة المحاولة على حدود المقبس",
  "src/lib/terboo-builder.js": "مكتبة بناء الرسائل القديمة المستعملة من النواة (Wrapper فوق البنّاء)",
  "src/lib/terboo-code-renderer.js": "عرض الكود sendRichCode — ملف محمي لا يُعدَّل (قاعدة المالك)",
  "src/lib/terboo-rich-response.js": "عرض الكود richResponse — ملف محمي لا يُعدَّل (قاعدة المالك)",
  "src/lib/terboo-latex.js": "صور المعادلات (وسيط) — ليس واجهة أزرار",
  "src/lib/terboo-message.js": "مساعد رسالة قديم (غير مستورد من نقاط الدخول — انظر الفحص الجنائي)",
  "src/lib/terboo-wa-capabilities.js": "سجل قدرات واتساب: مرجع نصي لأسماء الحمولات (توثيق/تحقق) لا إرسال",
};

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) walk(rel, out);
    else if (entry.name.endsWith(".js")) out.push(rel);
  }
  return out;
}
const core = walk("src")
  .map((file) => ({ file, count: (fs.readFileSync(path.join(ROOT, file), "utf8").match(LOW_LEVEL) || []).length }))
  .filter((row) => row.count > 0)
  .sort((a, b) => b.count - a.count);

const migrated = before.filter((file) => !now.includes(file));
const remaining = now.filter((file) => !PLUGIN_EXCEPTIONS[file]);
const tests = [
  "tests/terboo-menu-delivery.test.mjs", "tests/terboo-interactive.test.mjs", "tests/terboo-interactive-compat.test.mjs",
  "tests/terboo-menus.test.mjs", "tests/terboo-smart-buttons.test.mjs", "tests/terboo-dead-buttons.test.mjs",
  "tests/terboo-transport.test.mjs", "tests/terboo-ui-intents.test.mjs",
].filter((file) => fs.existsSync(path.join(ROOT, file)));

const md = [
  "# 🧩 Bot Terboo V6 — إغلاق ترحيل الواجهة الموحّدة (§28)",
  "",
  `> مولَّد بـ \`node tools/terboo-ui-closeout.mjs\` · خط الأساس \`${BASE}\` · ${new Date().toISOString()}`,
  "",
  "## القاعدة",
  "",
  "- البلوقن يعلن **نية** فقط: `sendCard` (أزرار · روابط · نسخ · قائمة اختيار · صورة/فيديو/مستند رأس · بطاقة مصغّرة · منشن · تسليم لدردشة أخرى) أو `sendCarousel` (بطاقات نتائج) أو `sendMenu` (قوائم السجل المركزي).",
  "- البناء في `terboo-interactive-builder`، والتسليم بطبقاته وبدائله وسجله في `terboo-menu-delivery` — طبقة التوافق الوحيدة الموثّقة لواجهات البلوقنات.",
  "- كل بديل نصي يحمل كل اختيار قابل للكتابة (الأزرار وصفوف القوائم والروابط) فلا يضيع خيار إن رفض الجهاز الأزرار.",
  "",
  `## الإضافات التي كانت تبني حمولات مباشرة: ${before.length}`,
  "",
  `### رُحّلت (${migrated.length})`,
  "",
  ...migrated.map((file) => `- \`${file}\``),
  "",
  `### استثناءات (${now.length - remaining.length}) — ليست بناء حمولة`,
  "",
  ...Object.entries(PLUGIN_EXCEPTIONS).filter(([file]) => now.includes(file)).map(([file, why]) => `- \`${file}\` — ${why}`),
  "",
  `### متبقٍ بلا سبب: ${remaining.length}`,
  "",
  ...(remaining.length ? remaining.map((file) => `- \`${file}\``) : ["- لا يوجد."]),
  "",
  "## ملفات النواة التي تلمس Baileys منخفض المستوى",
  "",
  "| الملف | المواضع | السبب |",
  "|---|---|---|",
  ...core.map((row) => `| \`${row.file}\` | ${row.count} | ${CORE_REASONS[row.file] || "⚠️ بلا سبب موثّق"} |`),
  "",
  "## ما تغيّر سلوكياً عند الترحيل",
  "",
  "- `plugins/main/ping2.js`: كان يرسل رسالتين بأزرار وهمية (رقم اتصال مثالي، عرض محدود برابط google.com، نص متبقٍ غير مترجم) ⇒ بطاقة واحدة بزرّي «تحديث» و«القائمة» فقط.",
  "- `plugins/search/دارك_ويب.js`: أزرار رد كانت ترسل الرابط كنص ⇒ أزرار فتح حقيقية (cta_url).",
  "- `plugins/pushkontak/دفع_جهات_الاتصال.js`: إعدادات Native Flow وهمية (tap_target بنطاق shop.example.com ونص عشوائي، limited_time_offer) أزيلت؛ الأزرار والقوائم نفسها باقية.",
  "- `plugins/user/profile.js`: أزرار قائمة «profile» من السجل المركزي عبر `sendMenu` (كانت تُبنى يدوياً من نفس السجل).",
  "- `plugins/panel/انشاء_خادم.js`: بيانات الدخول تُسلَّم بنفس البطاقة في خاص المستلم عبر `sendCard({ to })`.",
  "- سياق «معاد توجيهه من القناة» الزخرفي داخل بعض البطاقات لم يعد يُضاف يدوياً من البلوقن.",
  "",
  "## الاختبارات",
  "",
  ...tests.map((file) => `- \`${file}\``),
  "",
].join("\n");

fs.writeFileSync(path.join(ROOT, OUT), md);
console.log(`✅ ${OUT}: ${migrated.length} رُحّلت · ${now.length - remaining.length} استثناء · ${remaining.length} متبقٍ · ${core.length} ملف نواة`);
if (remaining.length) process.exitCode = 1;
