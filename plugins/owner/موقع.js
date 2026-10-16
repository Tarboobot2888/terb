// ═══════════════════════════════════════════════
// 📁 plugins/owner/موقع.js
// 🌐 إدارة منصة Bot Terboo Web من واتساب — للمالك وحده
// ───────────────────────────────────────────────
// الإجراءات كلها تمرّ على خدمات src/web/*: لا shell ولا تعديل ملفات نظام
// ولا تركيب أمر من نص المستخدم. الدومين لا يُعتمد قبل تحقّق DNS، والشهادة
// لا تُصدَر من هنا (تقرير صادق بدل وعد). الرابط المعروض من باني الروابط
// المركزي وحده (config.website.publicBaseUrl)، لا من info.website.
// ═══════════════════════════════════════════════

import * as UI from "../../src/lib/terboo-ui-theme.js";
import { getUserLanguage, t } from "../../src/lib/terboo-localization.js";
import { getDatabase } from "../../src/lib/terboo-database.js";

const pluginConfig = {
  name: "موقع",
  alias: ["website", "web", "sitio"],
  category: "owner",
  description: "حالة منصة Bot Terboo Web وإعداد الدومين والشهادة والرابط",
  usage: ".موقع [حالة|رابط|دومين <نطاق>|تحقق|شهادة|تشغيل|ايقاف|فحص <رقم>]",
  example: ".موقع حالة",
  isOwner: true,
  cooldown: 3,
  isEnabled: true,
};

/** الأوامر الفرعية بثلاث صيغ (عربي · إنجليزي · إسباني) */
const SUB = {
  status: ["حالة", "الحالة", "status", "estado", ""],
  url: ["رابط", "الرابط", "url", "link", "enlace"],
  domain: ["دومين", "نطاق", "domain", "dominio", "set-domain"],
  verify: ["تحقق", "التحقق", "verify", "verify-domain", "verificar"],
  tls: ["شهادة", "تشفير", "tls", "ssl", "certificado"],
  enable: ["تشغيل", "فعل", "enable", "on", "activar"],
  disable: ["ايقاف", "إيقاف", "تعطيل", "disable", "off", "desactivar"],
  // تشخيص تسليم رمز الدخول: يرسل رسالة اختبار (لا رمزاً) إلى رقم ويقول ماذا حدث
  otptest: ["فحص", "تشخيص", "اختبار", "otptest", "otp-test", "diagnose", "test", "probar"],
};

function subcommandOf(token) {
  const value = String(token || "").trim().toLowerCase();
  for (const [key, forms] of Object.entries(SUB)) {
    if (forms.includes(value)) return key;
  }
  return null;
}

/** وصف الحالة بلغة المالك */
function stateLabel(state, lang) {
  const labels = {
    disabled: { ar: "معطَّل", en: "Disabled", es: "Desactivado" },
    "domain-pending-verification": { ar: "الدومين بانتظار التحقق", en: "Domain pending verification", es: "Dominio pendiente de verificación" },
    "tls-missing": { ar: "الشهادة غائبة", en: "TLS missing", es: "Certificado ausente" },
    "no-public-address": { ar: "بلا عنوان عام", en: "No public address", es: "Sin dirección pública" },
    "ready-insecure-http": { ar: "يعمل على HTTP غير مشفَّر", en: "Running on plain HTTP", es: "Funcionando en HTTP sin cifrar" },
    ready: { ar: "جاهز", en: "Ready", es: "Listo" },
  };
  return labels[state]?.[lang] || labels[state]?.ar || state;
}

const yesNo = (value, lang) => (value ? (lang === "en" ? "yes" : lang === "es" ? "sí" : "نعم") : (lang === "en" ? "no" : lang === "es" ? "no" : "لا"));

async function handler(m, { text }) {
  const db = getDatabase();
  const lang = getUserLanguage(db.getUser(m.sender) || {});
  const [token, ...rest] = String(text || "").trim().split(/\s+/);
  const sub = subcommandOf(token);

  if (sub === null) {
    return m.reply(UI.errorCard("موقع", [
      pluginConfig.usage,
      "",
      `${t(lang, "common.example") || "مثال"}: ${pluginConfig.example}`,
    ], { lang }));
  }

  const web = await import("../../src/web/index.js");
  const domainService = await import("../../src/web/services/domain-service.js");
  const { websiteConfig } = await import("../../src/web/config.js");
  const brand = await import("../../src/lib/terboo-brand.js");

  // ── الرابط القانوني ──
  if (sub === "url") {
    const link = brand.websiteUrl();
    if (!link) {
      const status = web.webStatus();
      return m.reply(UI.warningCard("رابط الموقع", [
        "لا يوجد رابط صالح الآن، فلا يُرسل زر في القوائم.",
        UI.row("الحالة", stateLabel(status.state, lang), lang),
        status.domain && !status.domainVerified ? "الدومين مُعدّ لكنه لم يُتحقَّق منه بعد: شغّل «.موقع تحقق»." : "لا دومين متحقَّق ولا عنوان IP عام مُعدّ.",
      ], { lang }));
    }
    const secure = link.startsWith("https://");
    return m.reply(UI[secure ? "successCard" : "warningCard"]("رابط الموقع", [
      link,
      "",
      UI.row("التشفير", secure ? "HTTPS" : "HTTP غير مشفَّر", lang),
      secure ? "" : "⚠️ هذا الرابط غير مشفَّر. استعمل reverse proxy بشهادة قبل مشاركته.",
    ], { lang }));
  }

  // ── الحالة الكاملة ──
  if (sub === "status") {
    const status = web.webStatus();
    const site = websiteConfig();
    const domain = domainService.domainStatus();
    const tls = domainService.tlsStatus();
    return m.reply(UI.card({
      title: "منصة Bot Terboo Web",
      kind: status.state === "ready" ? "success" : status.enabled ? "warning" : "info",
      blocks: [[
        UI.row("الحالة", stateLabel(status.state, lang), lang),
        UI.row("مُفعَّل", yesNo(status.enabled, lang), lang),
        UI.row("يستمع", yesNo(status.listening, lang), lang),
        UI.row("المنفذ", String(site.port), lang),
        UI.row("الرابط", status.url || "—", lang),
        UI.row("مشفَّر", yesNo(status.secure, lang), lang),
      ], [
        UI.row("الدومين", domain.pendingDomain || domain.configuredDomain || "—", lang),
        UI.row("متحقَّق", yesNo(domain.verified, lang), lang),
        UI.row("وضع TLS", tls.mode, lang),
        tls.mode === "direct" && tls.readable ? UI.row("الشهادة", `${tls.daysLeft} يوماً متبقياً`, lang) : "",
      ], [
        UI.row("الاتصالات", String(status.openConnections), lang),
        status.uptimeMs ? UI.row("مدة التشغيل", `${Math.floor(status.uptimeMs / 60000)} دقيقة`, lang) : "",
      ]],
      footer: status.enabled ? null : "فعّله بـ«.موقع تشغيل» أو بتعديل website.enabled في config.js",
      lang,
    }));
  }

  // ── ضبط الدومين ──
  if (sub === "domain") {
    const wanted = rest.join("").trim();
    if (!wanted) {
      const domain = domainService.domainStatus();
      return m.reply(UI.infoCard("دومين الموقع", [
        UI.row("الحالي", domain.pendingDomain || domain.configuredDomain || "—", lang),
        UI.row("متحقَّق", yesNo(domain.verified, lang), lang),
        "",
        "لضبطه: .موقع دومين bot.example.com",
      ], { lang }));
    }
    try {
      const result = domainService.setDomain(wanted);
      return m.reply(UI.successCard("دومين بانتظار التحقق", [
        UI.row("النطاق", result.domain, lang),
        "",
        "أضف سجل DNS التالي ثم شغّل «.موقع تحقق»:",
        // كتلة كود واحدة في نص واحد: حواجزها جزء من المحتوى الوظيفي لا زخرفة
        `\`\`\`\n${result.record.type}  ${result.record.name}  ${result.record.value}\n\`\`\``,
        "الدومين لا يُستعمل في أي رابط أو زر قبل نجاح التحقق.",
      ], { lang }));
    } catch (error) {
      return m.reply(UI.errorCard("دومين غير صالح", [error.message], { lang }));
    }
  }

  // ── تحقق DNS حقيقي ──
  if (sub === "verify") {
    const result = await domainService.verifyDomain().catch((error) => ({ verified: false, reason: error.message }));
    if (result.verified) {
      return m.reply(UI.successCard("تم التحقق من الدومين", [
        "صار الدومين مصدر الرابط القانوني، وزر الموقع في القائمة يستعمله الآن.",
        UI.row("الرابط", brand.websiteUrl() || "—", lang),
      ], { lang }));
    }
    return m.reply(UI.errorCard("لم يتم التحقق", [
      UI.row("السبب", String(result.reason || "unknown"), lang),
      result.record ? "" : "عيّن دوماً أولاً: .موقع دومين <نطاق>",
      ...(result.record ? [
        "تأكد من وجود هذا السجل (قد يحتاج الانتشار دقائق):",
        `\`\`\`\n${result.record.type}  ${result.record.name}  ${result.record.value}\n\`\`\``,
      ] : []),
    ], { lang }));
  }

  // ── الشهادة ──
  if (sub === "tls") {
    const tls = domainService.tlsStatus();
    const routing = await domainService.routingCheck();
    return m.reply(UI.infoCard("TLS والتوجيه", [
      UI.row("الوضع", tls.mode, lang),
      tls.note || "",
      tls.readable ? UI.row("ينتهي في", String(tls.validTo), lang) : "",
      tls.readable && tls.keyTooOpen ? "⚠️ صلاحيات ملف المفتاح واسعة — اضبطها على 600." : "",
      "",
      routing.checked ? UI.row("A", (routing.a || []).join(", ") || "—", lang) : "",
      routing.checked && routing.matchesPublicIp !== null ? UI.row("يطابق publicIp", yesNo(routing.matchesPublicIp, lang), lang) : "",
      "",
      "الإصدار والتجديد يتمّان عبر reverse proxy أو عميل ACME خارج البوت — راجع docs/web-platform/DOMAIN_AND_TLS.md.",
    ], { lang }));
  }

  // ── تشغيل/إيقاف ──
  if (sub === "enable" || sub === "disable") {
    const site = websiteConfig();
    if (sub === "disable") {
      await web.stopWebServer();
      return m.reply(UI.successCard("أُوقف الموقع", [
        "المنفذ مُغلق ولا تُقبل طلبات جديدة، والبوت يعمل كما هو.",
        "لإيقافه دائماً بعد إعادة التشغيل: اضبط website.enabled=false في config.js.",
      ], { lang }));
    }
    if (!site.enabled) {
      return m.reply(UI.warningCard("الموقع معطَّل في الإعداد", [
        "website.enabled=false في config.js، فلا يُفتح منفذ.",
        "",
        "فعّله في الملف ثم أعد تشغيل البوت، أو شغّل «.موقع تشغيل» بعد تفعيله.",
        "التفعيل لا يُكتب من هنا: الإعداد الحيّ يحمل أرقام المالك والمفاتيح ولا يُعدّله أمر محادثة.",
      ], { lang }));
    }
    const started = await web.startWebServer();
    if (!started.ok) {
      return m.reply(UI.errorCard("تعذّر التشغيل", [UI.row("السبب", String(started.reason), lang)], { lang }));
    }
    const status = web.webStatus();
    return m.reply(UI.successCard("الموقع يعمل", [
      UI.row("المنفذ", String(site.port), lang),
      UI.row("الحالة", stateLabel(status.state, lang), lang),
      UI.row("الرابط", status.url || "—", lang),
    ], { lang }));
  }

  // ── تشخيص تسليم رمز الدخول ──
  if (sub === "otptest") {
    const raw = rest.join(" ").trim();
    if (!raw) {
      return m.reply(UI.infoCard("فحص تسليم الدخول", [
        "يرسل رسالة اختبار (بلا رمز) إلى رقم ويخبرك هل تصل فعلاً.",
        "",
        "الاستخدام: .موقع فحص +201012345678",
        "اكتب رقمك أنت لتتأكد أن رمز الدخول سيصلك.",
      ], { lang }));
    }
    const { identityFromInput } = await import("../../src/web/services/identity-service.js");
    const { diagnoseDelivery } = await import("../../src/web/services/otp-service.js");
    const identity = identityFromInput(raw);
    if (!identity) {
      return m.reply(UI.errorCard("رقم غير صالح", ["اكتب الرقم بالصيغة الدولية، مثل +201012345678."], { lang }));
    }
    const result = await diagnoseDelivery(identity, lang);
    if (result.ok) {
      return m.reply(UI.successCard("التسليم يعمل", [
        "أُرسلت رسالة اختبار بنجاح — افتح واتساب وتأكد من وصولها.",
        UI.row("الهدف", result.maskedTarget, lang),
        UI.row("مؤكَّد من واتساب", result.confirmed ? "نعم" : "لا (أُرسل بالمعرّف المشتقّ)", lang),
        "",
        "إن لم تصلك الرسالة رغم «أُرسلت»: الرقم قد لا يقبل رسالة أولى من البوت، أو هو رقم البوت نفسه (إرسال لنفسه).",
      ], { lang }));
    }
    const reasons = {
      "bot-offline": "اتصال واتساب غير متاح الآن — تأكد أن البوت متصل.",
      "not-on-whatsapp": "هذا الرقم غير موجود على واتساب (onWhatsApp أكّد غيابه).",
      "delivery-failed": "فشل الإرسال فعلياً — راجع سجل [transport] / [web-otp].",
    };
    return m.reply(UI.errorCard("التسليم لا يعمل", [
      UI.row("السبب", reasons[result.reason] || result.reason, lang),
      result.maskedTarget ? UI.row("الهدف", result.maskedTarget, lang) : "",
    ], { lang }));
  }

  return m.reply(UI.errorCard("موقع", [pluginConfig.usage], { lang }));
}

export { pluginConfig as config, handler };
