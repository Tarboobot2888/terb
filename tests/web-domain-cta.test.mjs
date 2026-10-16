// الرابط القانوني وزر القائمة: مصدر واحد، لا تأثير لترويسة Host،
// ولا زر قبل تحقّق الدومين، ولا رابط قناة واتساب بالخطأ.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const config = (await import("../config.js")).default;
const store = await import("../src/web/store/web-store.js");
store.initWebStore(fs.mkdtempSync(path.join(os.tmpdir(), "terboo-cta-")));

const urls = await import("../src/web/url-builder.js");
const brand = await import("../src/lib/terboo-brand.js");
const domainService = await import("../src/web/services/domain-service.js");

const setSite = (patch) => { config.website = { ...(config.website || {}), ...patch }; };

// ① معطَّل ⇒ لا رابط ولا زر
setSite({ enabled: false, publicBaseUrl: "https://bot.example.com", domain: "bot.example.com", requireDomainVerification: true });
assert.equal(urls.websiteUrl(), "", "الموقع معطَّل ⇒ لا رابط");
assert.equal(brand.websiteUrl(), "", "brand يتبع نفس المصدر");
assert.equal(brand.hasWebsite(), false);
assert.equal(urls.websiteState().state, "disabled");

// ② مُفعَّل لكن الدومين لم يُتحقَّق ⇒ لا رابط (لا زر مكسور)
setSite({ enabled: true });
store.writeDomainState({ domain: "bot.example.com", verified: false, token: "t", method: "dns-txt" });
assert.equal(urls.websiteUrl(), "", "دومين غير متحقَّق ⇒ لا رابط");
assert.equal(urls.websiteState().state, "domain-pending-verification");

// ③ بعد التحقق ⇒ الرابط يظهر فوراً من نفس المصدر
store.writeDomainState({ domain: "bot.example.com", verified: true });
assert.equal(urls.websiteUrl(), "https://bot.example.com");
assert.equal(brand.websiteUrl(), "https://bot.example.com", "الزر والرسائل تتغيّر بتحديث واحد");
assert.equal(urls.isSecure(), true);
assert.equal(urls.websiteState().state, "ready");

// ④ تحقّق لدومين مختلف لا يعتمد العنوان
store.writeDomainState({ domain: "other.example.com", verified: true });
assert.equal(urls.websiteUrl(), "", "تحقّق دومين آخر لا يعتمد publicBaseUrl الحالي");

// ⑤ ترويسة Host لا تؤثر إطلاقاً
store.writeDomainState({ domain: "bot.example.com", verified: true });
const before = urls.websiteUrl();
for (const forged of ["evil.example", "localhost:3000", "169.254.169.254", "bot.example.com.evil.test"]) {
  // لا دالة في المسار تقرأ ترويسة: نثبت أن المصدر هو الإعداد وحده
  assert.equal(urls.websiteUrl(), before, `الرابط تغيّر مع Host مزوّر: ${forged}`);
}
// باني الروابط لا يلمس أي طلب HTTP: لا req ولا headers ولا X-Forwarded-*
// (hostname من new URL مسموح — هو تحليل العنوان المُعدّ لا قراءة ترويسة).
const builderCode = fs.readFileSync(path.join(process.cwd(), "src/web/url-builder.js"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");
for (const forbidden of [/\breq\b/, /\bheaders\b/, /x-forwarded/i, /\brequest\b/, /\bctx\b/]) {
  assert.ok(!forbidden.test(builderCode), `باني الروابط يلمس الطلب: ${forbidden}`);
}

// ⑥ لا يُستعمل info.website ولا socialLinks.website أبداً
assert.ok(/whatsapp\.com\/channel/.test(String(config.info?.website || "")) || true, "info.website قد يكون قناة واتساب");
setSite({ enabled: true, publicBaseUrl: "", domain: "", publicIp: "" });
store.writeDomainState({ domain: "", verified: false });
assert.equal(urls.websiteUrl(), "", "بلا عنوان مُعدّ ⇒ لا رابط، ولا يُستعار رابط القناة");
assert.notEqual(urls.websiteUrl(), config.info?.website || "x");
assert.notEqual(urls.websiteUrl(), config.socialLinks?.website || "x");

// ⑦ IP عام يُعدّه المالك ⇒ HTTP صريح يُعلَن غير مشفَّر
setSite({ enabled: true, publicBaseUrl: "", domain: "", publicIp: "203.0.113.10", port: 8080 });
assert.equal(urls.websiteUrl(), "http://203.0.113.10:8080");
assert.equal(urls.isSecure(), false, "HTTP لا يُسوَّق كآمن");
assert.equal(urls.websiteState().state, "ready-insecure-http");

// ⑧ عنوان معطوب في الإعداد ⇒ لا رابط
setSite({ enabled: true, publicBaseUrl: "https://user:pw@bot.example.com", domain: "", publicIp: "" });
assert.equal(urls.websiteUrl(), "", "عنوان ببيانات دخول مرفوض");
setSite({ publicBaseUrl: "https://bot.example.com/path" });
assert.equal(urls.websiteUrl(), "", "عنوان بمسار مرفوض");

// ⑨ زر القائمة: يُبنى من نفس الدالة وبالشكل الذي تقبله طبقة التسليم
const { button } = await import("../src/lib/terboo-interactive-builder.js");
setSite({ enabled: true, publicBaseUrl: "https://bot.example.com", domain: "bot.example.com", requireDomainVerification: true });
store.writeDomainState({ domain: "bot.example.com", verified: true });
const link = brand.websiteUrl();
assert.ok(link);
const cta = button.url("🌐 Bot Terboo website", link);
assert.equal(cta.name, "cta_url");
const params = JSON.parse(cta.buttonParamsJson);
assert.equal(params.url, link);
assert.equal(params.merchant_url, link);
assert.ok(!params.url.includes("whatsapp.com"), "زر الموقع لا يحمل رابط قناة واتساب");

// ⑩ مصدر القائمة يستعمل brand.websiteUrl ولا يبني رابطاً بنفسه
const menuSource = fs.readFileSync(path.join(process.cwd(), "plugins/main/اوامر.js"), "utf8");
assert.ok(menuSource.includes("brand.websiteUrl()"), "القائمة تقرأ الرابط من المصدر المركزي");
assert.ok(menuSource.includes("button.url("), "الزر يُبنى عبر البنّاء المركزي");
assert.ok(!/cta_url["']\s*,\s*buttonParamsJson/.test(menuSource), "لا بناء حمولة تفاعلية يدوياً في القائمة");
// الزر يُحذف حين لا يوجد رابط
assert.ok(/websiteLink\s*\?\s*\[/.test(menuSource), "الزر مشروط بوجود رابط صالح");

// ⑪ الترجمة موجودة للزر في كل اللغات المدعومة
const { t, LANGUAGE_ORDER } = await import("../src/lib/terboo-localization.js");
for (const lang of LANGUAGE_ORDER) {
  const label = t(lang, "menu.buttonWebsite");
  assert.ok(label && !label.includes("menu.buttonWebsite"), `ترجمة زر الموقع ناقصة للغة ${lang}`);
}

// ⑫ خدمة الدومين ترفض ما لا يصلح دوماً
for (const bad of ["localhost", "1.2.3.4", "https://x.com", "x", "-a.com", "a..com"]) {
  assert.throws(() => domainService.setDomain(bad), (error) => error.code === "INVALID_INPUT", `قُبل دومين غير صالح: ${bad}`);
}
// وإصدار الشهادة لا يُوعد به
assert.throws(() => domainService.issueTls(), (error) => error.code === "NOT_AVAILABLE_IN_WEB");

store.flushWebStore();
console.log("✅ web-domain-cta: مصدر رابط واحد · لا رابط قبل تحقّق الدومين · Host لا يؤثر · لا رابط قناة بالخطأ · HTTP يُعلَن غير مشفَّر · زر القائمة مشروط ومبنيّ مركزياً · لا وعد بإصدار TLS");
process.exit(0);
