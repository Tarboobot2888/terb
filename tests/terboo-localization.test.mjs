// اختبار منظومة الترجمة والتصميم والخطوط في Bot Terboo
// يغطي: اكتمال المفاتيح بين اللغات، عدم تسرّب لغة داخل أخرى،
// الزخارف المستقلة لكل لغة، سلامة الأرقام والروابط، وسجل الخطوط.

import assert from "node:assert/strict";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });

const L = await import("../src/lib/terboo-localization.js");
const UI = await import("../src/lib/terboo-ui-theme.js");
const fonts = await import("../src/lib/terboo-fonts.js");
const ar = (await import("../src/lib/terboo-locales/ar.js")).default;
const en = (await import("../src/lib/terboo-locales/en.js")).default;

const LANGS = ["ar", "en"];

// ── 1. اكتمال المفاتيح: كل مفتاح عربي له مقابل في en ──
function flatten(obj, prefix = "", out = []) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, full, out);
    else out.push(full);
  }
  return out;
}

const arKeys = flatten(ar).sort();
const enKeys = new Set(flatten(en));

const missingEn = arKeys.filter((k) => !enKeys.has(k));

assert.equal(missingEn.length, 0, `مفاتيح ناقصة في الإنجليزية: ${missingEn.slice(0, 8).join(", ")}`);
assert.ok(arKeys.length > 180, `عدد المفاتيح قليل: ${arKeys.length}`);

// ── 2. لا تسرّب لغوي: الإنجليزية بلا حروف عربية ──
const ARABIC = /[؀-ۿ]/;
for (const [name, pack] of [["en", en]]) {
  for (const key of flatten(pack)) {
    const value = L.t(name, key);
    if (typeof value !== "string") continue;
    // العلم والاسم المحلي للغات الأخرى مستثنيان (بطاقة اختيار اللغة)
    if (key.startsWith("meta.") || key.includes("cardHintMulti")) continue;
    assert.ok(!ARABIC.test(value), `تسرّب نص عربي في ${name}.${key}: ${value}`);
  }
}

// ── 3. الاحتياط للعربية عند غياب المفتاح ──
assert.equal(L.t("en", "__key_does_not_exist__"), "__key_does_not_exist__", "المفتاح المفقود يعود كما هو بلا انهيار");
assert.equal(L.t("zz", "common.wait"), ar.common.wait, "لغة غير معروفة ترجع للعربية");
assert.equal(L.t(null, "common.wait"), ar.common.wait, "قيمة فارغة ترجع للعربية");

// ── 4. استبدال المتغيرات آمن ──
assert.match(L.t("ar", "registration.stepLabel", { current: 2, total: 4 }), /2.*4/, "المتغيرات تُستبدل");
assert.match(L.t("en", "registration.stepLabel", {}), /\{current\}/, "المتغير الناقص يبقى ظاهراً بلا انهيار");

// ── 5. الزخارف مختلفة فعلياً بين اللغات ──
const themes = LANGS.map((l) => UI.theme(l));
assert.notEqual(themes[0].rule, themes[1].rule, "خط العربية يختلف عن الإنجليزية");
assert.notEqual(themes[0].row, themes[1].row, "علامة السطر تختلف بين اللغات");
for (const th of themes) {
  assert.ok(th.rule && th.softRule && th.row && th.section, "كل مجموعة زخرفة مكتملة");
}

// ── 6. لا زخرفة يونيكود على العربية ──
assert.equal(UI.styleLatin("مرحبا"), "مرحبا", "العربية لا تُزخرف");
assert.equal(UI.styleLatin("Cafe ñ"), "Cafe ñ", "الحروف اللاتينية الممدودة لا تتشوّه");
assert.notEqual(UI.styleLatin("MENU"), "MENU", "اللاتيني يُزخرف");

// ── 7. البطاقات تُبنى بلا صناديق مغلقة تكسر RTL ──
for (const lang of LANGS) {
  const card = UI.card({
    title: L.t(lang, "menu.title"),
    blocks: [UI.row(L.t(lang, "menu.fieldBot"), "Bot Terboo", lang)],
    footer: UI.footer("Bot Terboo", "Terboo", lang),
    lang,
  });
  assert.ok(card.includes(UI.theme(lang).rule), `${lang}: البطاقة تستخدم زخرفة لغتها`);
  for (const line of card.split("\n")) {
    assert.ok(!/^│.*│$/.test(line.trim()), `${lang}: لا يجوز استخدام صندوق مغلق`);
  }
}

// ── 8. الأرقام والتواريخ حسب اللغة بأرقام لاتينية ──
assert.equal(L.formatNumber(1234, "en"), "1,234");
assert.match(L.formatNumber(1234, "ar"), /1.?234/, "العربية تستخدم أرقاماً لاتينية");
assert.ok(!/[٠-٩]/.test(L.formatNumber(1234, "ar")), "لا أرقام هندية تكسر قراءة الأوامر");

// ── 9. العزل يحمي الروابط والأوامر ──
const isolated = UI.isolate("https://example.com/a?b=1");
assert.ok(isolated.includes("https://example.com/a?b=1"), "الرابط يبقى سليماً داخل العزل");
assert.equal(isolated.replace(/[⁦⁩]/g, ""), "https://example.com/a?b=1", "العزل غير مرئي ويمكن إزالته");

// ── 10. أسماء الأقسام مترجمة والمعرّف الداخلي ثابت ──
for (const lang of LANGS) {
  const label = L.getCategoryLabel("game", lang);
  assert.ok(label && label !== "categories.game", `${lang}: اسم القسم مترجم`);
}
assert.equal(L.getCategoryLabel("unknown_category_xyz", "ar"), "unknown_category_xyz", "قسم غير معروف يعود بمعرّفه");

// ── 11. قيم الجنس والرتب تُعرض مترجمة والقيمة المخزّنة ثابتة ──
assert.equal(L.getGenderLabel("ذكر", "en"), "Male");
assert.equal(L.getGenderLabel("ذكر", "ar"), "ذكر", "القيمة العربية المخزّنة تُعرض كما هي");
assert.match(L.getRoleLabel("🛡️ محارب", "en"), /Warrior/);

// ── 12. سجل الخطوط: الأساسي عربي/لاتيني وبدائل داخلية ──
const result = await fonts.registerFonts();
assert.ok(result.primaryReady, "يجب تسجيل الخطوط الأساسية");
assert.equal(result.missing.length, 0, `ملفات خطوط مفقودة: ${result.missing.join(", ")}`);
assert.equal(fonts.getFontForLanguage("ar"), fonts.FAMILY.arabic, "العربية تستخدم العائلة العربية");
assert.equal(fonts.getFontForLanguage("en"), fonts.FAMILY.latin, "الإنجليزية تستخدم العائلة اللاتينية");

const stack = fonts.getFontStack("ar", 700, 40);
assert.match(stack, /^700 40px /, "سلسلة ctx.font صحيحة");
assert.ok(stack.includes(fonts.FAMILY.arabic), "السلسلة تبدأ بالعائلة العربية");
assert.ok(stack.endsWith("sans-serif"), "توجد نهاية احتياطية");
assert.ok(!/Arial|Impact|Courier New/.test(stack), "لا خطوط نظام قديمة في السلسلة");

const installed = fonts.listInstalledFonts();
assert.ok(installed.filter((f) => f.primary).length >= 8, "8 أوزان أساسية على الأقل");
for (const weight of [400, 500, 600, 700]) {
  assert.ok(installed.some((f) => f.primary && f.weight === weight), `الوزن ${weight} متاح`);
}

console.log(`✅ terboo-localization: ${arKeys.length} مفتاح × ${LANGS.length} لغات · ${installed.length} ملف خط`);
process.exit(0);
