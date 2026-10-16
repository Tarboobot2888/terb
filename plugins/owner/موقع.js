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
import { noteFailure } from "../../src/lib/terboo-failure-log.js";

const pluginConfig = {
  name: "موقع",
  alias: ["website", "web", "sitio"],
  category: "owner",
  description: "لوحة تحكّم منصة Bot Terboo Web: الحالة والرابط والدومين والشهادة وOpenClaw والبوتات الفرعية",
  usage: ".موقع [لوحة|حالة|رابط|دومين <نطاق>|تحقق|شهادة|openclaw|بوتات|تشغيل|ايقاف|اعادة|فحص <رقم>]",
  example: ".موقع لوحة",
  isOwner: true,
  cooldown: 3,
  isEnabled: true,
};

/**
 * معرّف أمر لزر: يُبنى من اسم البلوقن وأجزائه لا كنصّ ثابت.
 * الضغط يرسل الأمر كما هو فيعود إلى هذا المعالج ويُعاد فحص صلاحية المالك.
 */
const CMD = (...parts) => [`.${pluginConfig.name}`, ...parts].join(" ");

/** وسم تجربة تنصيب البوت الفرعي — تسمية فقط، ليس رمز اقتران ولا سرّاً */
const INSTALL_LABEL = "TARBOOV6";

/** الأوامر الفرعية بثلاث صيغ (عربي · إنجليزي · إسباني) */
const SUB = {
  // الافتراضي: اللوحة التفاعلية
  menu: ["لوحة", "قائمة", "panel", "menu", "panel-web", ""],
  status: ["حالة", "الحالة", "status", "estado"],
  url: ["رابط", "الرابط", "url", "link", "enlace"],
  domain: ["دومين", "نطاق", "domain", "dominio", "set-domain"],
  verify: ["تحقق", "التحقق", "verify", "verify-domain", "verificar"],
  tls: ["شهادة", "تشفير", "tls", "ssl", "certificado"],
  openclaw: ["openclaw", "كلو", "محرك", "engine", "motor"],
  subbots: ["بوتات", "فرعية", "subbots", "sub-bots", "subbots-status", "subbots"],
  enable: ["تشغيل", "فعل", "enable", "on", "activar"],
  disable: ["ايقاف", "إيقاف", "تعطيل", "disable", "off", "desactivar"],
  restart: ["اعادة", "إعادة", "restart", "reiniciar"],
  // تشخيص تسليم رمز الدخول: يرسل رسالة اختبار (لا رمزاً) إلى رقم ويقول ماذا حدث
  otptest: ["فحص", "تشخيص", "اختبار", "otptest", "otp-test", "diagnose", "test", "probar"],
};

/** صيغ التأكيد المقبولة للأفعال الحسّاسة */
const CONFIRM = new Set(["تأكيد", "تاكيد", "confirm", "yes", "si", "sí"]);
const isConfirmed = (rest) => rest.some((part) => CONFIRM.has(String(part || "").trim().toLowerCase()));

/**
 * قفل عملية واحدة: يمنع الضغط المزدوج على زر والعمليات المتزامنة
 * (تشغيل/إيقاف/إعادة تشغيل الموقع). داخل العملية فقط — الموقع يُستضاف في
 * عملية البوت نفسها، فلا حاجة لقفل مشترك.
 */
const LOCK_MS = 30_000;
let running = { action: "", at: 0 };
function acquire(action) {
  const now = Date.now();
  if (running.action && now - running.at < LOCK_MS) return { ok: false, busy: running.action };
  running = { action, at: now };
  return { ok: true };
}
function release() {
  running = { action: "", at: 0 };
}

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

/** حالة محرّك OpenClaw الحقيقية — لا يُدّعى اتصال ولا يُعاد مفتاح */
async function openclawStatus() {
  try {
    const service = await import("../../src/web/services/openclaw-ai-service.js");
    return await service.status({ timeoutMs: 6000 });
  } catch (error) {
    noteFailure("owner-website", error, { where: "plugins/owner/موقع.js:openclawStatus", stage: "status" });
    return { enabled: false, status: "unavailable", reason: "bridge-unavailable", hasToken: false, protocol: 0, version: "", agentId: "", host: "" };
  }
}

/** وصف حالة المحرّك بلغة المالك */
function engineLabel(engine, lang) {
  const labels = {
    disabled: { ar: "معطَّل", en: "Disabled", es: "Desactivado" },
    connecting: { ar: "جاري الاتصال", en: "Connecting", es: "Conectando" },
    connected: { ar: "متصل", en: "Connected", es: "Conectado" },
    unreachable: { ar: "لا يُستجاب", en: "Unreachable", es: "Inalcanzable" },
    unavailable: { ar: "غير متاح", en: "Unavailable", es: "No disponible" },
  };
  const key = String(engine?.status || "disabled");
  return labels[key]?.[lang] || labels[key]?.ar || key;
}

/**
 * ملخّص البوتات الفرعية من المدير الحقيقي.
 * لا رمز اقتران ولا مسار جلسة ولا رقم كامل: المرجع مُقنَّع لآخر أربعة أرقام.
 */
async function subbotSummary() {
  try {
    const manager = await import("../../src/lib/terboo-jadibot-manager.js");
    const { maskPhone } = await import("../../src/web/services/identity-service.js");
    const stored = manager.getAllJadibotSessions();
    const rows = [];
    let active = 0;
    for (const session of stored.slice(0, 10)) {
      const live = manager.getJadibotStatus(session.jid);
      if (session.isActive) active += 1;
      const state = !session.isActive
        ? "متوقف"
        : live?.followedChannel ? "متصل ومتابع للقناة"
        : live?.connectionReady ? "متصل"
        : "قيد الاتصال";
      rows.push(`${maskPhone(String(session.id || "").replace(/\D/g, ""))} · ${state}`);
    }
    return { active, stored: stored.length, max: manager.MAX_JADIBOT_COUNT ?? 5, rows };
  } catch (error) {
    noteFailure("owner-website", error, { where: "plugins/owner/موقع.js:subbotSummary", stage: "manager" });
    return { active: 0, stored: 0, max: 0, rows: [] };
  }
}

async function handler(m, { text, sock }) {
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

  // ── اللوحة التفاعلية ──
  // كل زر يرسل أمراً كاملاً (`.موقع <فعل>`) فيعود إلى هذا المعالج نفسه،
  // ويُعاد فحص ملكية البوت في طبقة الصلاحيات (isOwner: true) عند كل ضغطة.
  // إخفاء زر لا يكفي: لا يوجد مسار تنفيذ لا يمرّ على هذا الفحص.
  if (sub === "menu") {
    const status = web.webStatus();
    const site = websiteConfig();
    const domain = domainService.domainStatus();
    const engine = await openclawStatus();
    const bots = await subbotSummary();
    const link = brand.websiteUrl();

    const { button } = await import("../../src/lib/terboo-interactive-builder.js");
    const { deliverMenu } = await import("../../src/lib/terboo-menu-delivery.js");

    const rows = [
      { id: CMD("حالة"), title: "حالة الموقع", description: stateLabel(status.state, lang) },
      { id: CMD("openclaw"), title: "صحة OpenClaw", description: engineLabel(engine, lang) },
      { id: CMD("بوتات"), title: "البوتات الفرعية", description: `${bots.active}/${bots.max}` },
      { id: CMD("شهادة"), title: "الدومين والشهادة", description: domain.verified ? "متحقَّق" : "غير متحقَّق" },
      { id: CMD("فحص"), title: "فحص تسليم الدخول", description: "رسالة اختبار بلا رمز" },
    ];

    // زر التشغيل/الإيقاف يحمل التأكيد في معرّفه: المالك يرى العاقبة في اللوحة
    // قبل الضغط، والمعالج يفرض القفل ضد الضغط المزدوج.
    const powerButton = status.listening
      ? button.quickReply(CMD("ايقاف", "تأكيد"), "إيقاف الموقع")
      : button.quickReply(CMD("تشغيل", "تأكيد"), "تشغيل الموقع");

    const buttons = [
      ...(link ? [button.url("فتح الموقع", link)] : []),
      powerButton,
      ...(status.listening ? [button.quickReply(CMD("اعادة", "تأكيد"), "إعادة تشغيل")] : []),
      // وسم التنصيب لا رمز اقتران: الرمز الحقيقي يبقى في تدفق الطالب وحده
      button.copy(`نسخ وسم التنصيب (${INSTALL_LABEL})`, INSTALL_LABEL),
    ];

    const body = UI.card({
      title: "لوحة تحكّم الموقع",
      kind: status.state === "ready" ? "success" : status.enabled ? "warning" : "info",
      blocks: [[
        UI.row("الحالة", stateLabel(status.state, lang), lang),
        UI.row("يستمع", yesNo(status.listening, lang), lang),
        UI.row("المنفذ", String(site.port), lang),
        UI.row("الرابط", link || "—", lang),
      ], [
        UI.row("OpenClaw", engineLabel(engine, lang), lang),
        UI.row("البوتات الفرعية", `${bots.active}/${bots.max}`, lang),
        UI.row("الدومين", domain.pendingDomain || domain.configuredDomain || "—", lang),
      ]],
      footer: link ? null : "لا رابط صالح بعد: لن يظهر زر الموقع في القوائم.",
      lang,
    });

    await deliverMenu(sock, m, {
      menuId: "owner-website",
      text: body,
      footer: "كل زر يُعاد فيه فحص صلاحية المالك على الخادم.",
      title: "اختر إجراءً",
      sections: [{ title: "لوحة الموقع", rows }],
      quickReplies: [],
      extraButtons: buttons,
      legacyButtons: [],
      fallbackText: [
        UI.command(CMD("حالة"), "حالة الموقع", { lang }),
        UI.command(CMD("openclaw"), "صحة OpenClaw", { lang }),
        UI.command(CMD("بوتات"), "البوتات الفرعية", { lang }),
        UI.command(CMD("شهادة"), "الدومين والشهادة", { lang }),
        UI.command(CMD("فحص"), "فحص تسليم الدخول", { lang }),
      ].join("\n"),
    });
    return undefined;
  }

  // ── صحة محرّك OpenClaw (بلا مفتاح ولا عنوان كامل ولا transcript) ──
  if (sub === "openclaw") {
    const engine = await openclawStatus();
    const { toolPolicy } = await import("../../src/web/openclaw/tool-policy.js");
    const tools = toolPolicy();
    const kind = engine.status === "connected" ? "success" : engine.enabled ? "warning" : "info";
    return m.reply(UI.card({
      title: "محرّك OpenClaw",
      kind,
      blocks: [[
        UI.row("الحالة", engineLabel(engine, lang), lang),
        UI.row("مُفعَّل", yesNo(engine.enabled, lang), lang),
        UI.row("مفتاح الخدمة", engine.hasToken ? "موجود" : "غائب", lang),
        UI.row("بروتوكول", String(engine.protocol), lang),
      ], [
        engine.host ? UI.row("المضيف", engine.host, lang) : "",
        engine.version ? UI.row("إصدار الـGateway", engine.version, lang) : "",
        engine.agentId ? UI.row("الوكيل", engine.agentId, lang) : "",
        UI.row("أدوات معروضة", String(tools.allowed.length), lang),
      ], [
        engine.reason ? UI.row("السبب", String(engine.reason), lang) : "",
      ]],
      footer: engine.enabled
        ? "الذكاء يرجع إلى نواة Terboo تلقائياً عند انقطاع المحرّك."
        : "التفعيل يحتاج نشر Gateway وضبط OPENCLAW_GATEWAY_URL والمفتاح — راجع docs/TERBOO_OPENCLAW_INTEGRATION_AUDIT.md.",
      lang,
    }));
  }

  // ── البوتات الفرعية: أعداد وحالات بلا رمز اقتران ولا مسار جلسة ──
  if (sub === "subbots") {
    const bots = await subbotSummary();
    return m.reply(UI.card({
      title: "البوتات الفرعية",
      kind: bots.active > 0 ? "success" : "info",
      blocks: [[
        UI.row("نشطة", String(bots.active), lang),
        UI.row("الحد الأقصى", String(bots.max), lang),
        UI.row("جلسات محفوظة", String(bots.stored), lang),
      ], bots.rows.length ? bots.rows : [UI.row("لا جلسات", "—", lang)]],
      footer: `التنصيب من الموقع أو بـ.تنصيب على واتساب — وسم التدفق ${INSTALL_LABEL}. رمز الاقتران لا يُعرض هنا أبداً.`,
      lang,
    }));
  }

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

  // ── تشغيل/إيقاف/إعادة تشغيل ──
  // فعل حسّاس: يحتاج تأكيداً صريحاً، ويُمنع الضغط المزدوج والتزامن بقفل واحد.
  if (sub === "enable" || sub === "disable" || sub === "restart") {
    const site = websiteConfig();
    const actionLabels = { enable: "تشغيل الموقع", disable: "إيقاف الموقع", restart: "إعادة تشغيل الموقع" };
    const confirmWord = { enable: CMD("تشغيل", "تأكيد"), disable: CMD("ايقاف", "تأكيد"), restart: CMD("اعادة", "تأكيد") };

    if (!isConfirmed(rest)) {
      return m.reply(UI.warningCard(actionLabels[sub], [
        sub === "disable"
          ? "سيُغلق منفذ الموقع وتُرفض الطلبات الجديدة. البوت وواتساب يبقيان يعملان."
          : sub === "restart"
            ? "سيُغلق المنفذ ثم يُفتح من جديد. الجلسات القائمة على الموقع ستنقطع لحظياً."
            : "سيُفتح منفذ الموقع داخل عملية البوت.",
        "",
        `للتأكيد أرسل: ${confirmWord[sub]}`,
      ], { lang }));
    }

    const gate = acquire(sub);
    if (!gate.ok) {
      return m.reply(UI.warningCard("عملية جارية", [
        "هناك عملية على الموقع قيد التنفيذ الآن — انتظر حتى تنتهي.",
        UI.row("الجاري", String(gate.busy), lang),
      ], { lang }));
    }

    try {
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

      // إعادة التشغيل: إغلاق ثم فتح بنفس الخدمة لا بإعادة تشغيل العملية
      if (sub === "restart") await web.stopWebServer();

      const started = await web.startWebServer();
      if (!started.ok) {
        return m.reply(UI.errorCard("تعذّر التشغيل", [UI.row("السبب", String(started.reason), lang)], { lang }));
      }
      const status = web.webStatus();
      return m.reply(UI.successCard(sub === "restart" ? "أُعيد تشغيل الموقع" : "الموقع يعمل", [
        UI.row("المنفذ", String(site.port), lang),
        UI.row("الحالة", stateLabel(status.state, lang), lang),
        UI.row("الرابط", status.url || "—", lang),
      ], { lang }));
    } finally {
      release();
    }
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
