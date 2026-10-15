// ═══════════════════════════════════════════════
// 🚪 تجربة المستخدم الجديد - Bot Terboo
// ───────────────────────────────────────────────
// المسار الرسمي (V6):
//   رسالة أولى → بطاقة اختيار اللغة → حفظ اللغة → القائمة الرئيسية مباشرةً
//   التسجيل اختياري بالكامل (.daftar للتخصيص فقط) — لا بوابة ولا منع أوامر بسببه.
//
// قواعد صارمة محفوظة هنا:
//  • لا يُبنى نظام تسجيل جديد: نستدعي plugins/user/daftar.js نفسه.
//  • استثناءات الصلاحيات كما هي: المالك والشريك والمميز لا يمرّون من هذه البوابة.
//  • البطاقة لا تتكرر مع كل رسالة، والحالة مرتبطة بالمستخدم وليس بالمحادثة.
//  • أزرار اللغة تُعالج قبل توجيه الأوامر العادي وتعود فوراً.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import config from "../../config.js";
import {
  LANGUAGE_ORDER,
  LANGUAGES,
  normalizeLanguage,
  hasUserLanguage,
  t,
} from "./terboo-localization.js";
import * as UI from "./terboo-ui-theme.js";
import * as brand from "./terboo-brand.js";
import { retireCard } from "./terboo-flow.js";
import { sendCard } from "./terboo-ui-kit.js";

// ── معرّفات أزرار اللغة (داخلية، لا تتعارض مع أي أمر حالي) ──
const LANGUAGE_BUTTON_PREFIX = "terboo_language_";
const LANGUAGE_BUTTON_IDS = LANGUAGE_ORDER.reduce((acc, code) => {
  acc[`${LANGUAGE_BUTTON_PREFIX}${code}`] = code;
  return acc;
}, {});

// ── حالات آلة الحالة ──
const STATE = {
  NONE: "NONE",
  LANGUAGE_PENDING: "LANGUAGE_PENDING",
  LANGUAGE_SELECTED: "LANGUAGE_SELECTED",
  REGISTRATION_ACTIVE: "REGISTRATION_ACTIVE",
  REGISTERED: "REGISTERED",
};

/** أنواع الرسائل التي تُعتبر ضغطة زر حقيقية */
const BUTTON_RESPONSE_TYPES = new Set([
  "buttonsResponseMessage",
  "listResponseMessage",
  "templateButtonReplyMessage",
  "interactiveResponseMessage",
]);

/** مهلة عدم تكرار بطاقة اللغة لنفس المستخدم */
const PROMPT_COOLDOWN = 3 * 60 * 1000;

if (!global.terbooOnboarding) {
  global.terbooOnboarding = { prompts: new Map(), notified: new Set() };
}

const promptState = global.terbooOnboarding.prompts;
const notifiedExisting = global.terbooOnboarding.notified;

/** مفتاح الحالة مرتبط بالمستخدم نفسه لا بالمحادثة (أمان المجموعات) */
function stateKey(jid) {
  return String(jid || "").replace(/[^0-9]/g, "") || String(jid || "");
}

function markPrompted(jid) {
  promptState.set(stateKey(jid), Date.now());
}

function wasPromptedRecently(jid) {
  const at = promptState.get(stateKey(jid));
  if (!at) return false;
  if (Date.now() - at > PROMPT_COOLDOWN) {
    promptState.delete(stateKey(jid));
    return false;
  }
  return true;
}

function clearPrompt(jid) {
  promptState.delete(stateKey(jid));
}

/** هل المستخدم في انتظار اختيار اللغة الآن؟ */
function isAwaitingLanguage(jid) {
  return promptState.has(stateKey(jid));
}

// ═══════════════════════════════════════════════
// إعداد التسجيل
// ═══════════════════════════════════════════════

/**
 * V6: التسجيل اختياري. ترقية الإصدارات السابقة كانت تفعّل registrationRequired تلقائياً
 * (enforceForNewUsers) — هنا يُطفأ الإعداد المخزّن مرة واحدة ولا يُعاد تفعيله أبداً.
 * بيانات المسجلين (الاسم · العمر · المكافآت) تبقى كما هي.
 */
function ensureRegistrationSetting(db) {
  try {
    if (!db?.ready) return;
    if (db.setting("terbooRegistrationOptionalV6") === true) return;
    if (db.setting("registrationRequired") === true) db.setting("registrationRequired", false);
    db.setting("terbooRegistrationOptionalV6", true);
  } catch (error) {
    noteFailure("onboarding", error, { where: "src/lib/terboo-onboarding.js:ensureRegistrationSetting", stage: "registration-optional-migration", fallback: "skip-migration" });
  }
}

/** V6: لا يوجد تسجيل إجباري — تبقى الدالة لتوافق الاستيراد وتعيد false دائماً */
function isRegistrationRequired() {
  return false;
}

// ═══════════════════════════════════════════════
// آلة الحالة
// ═══════════════════════════════════════════════

/** حالة المستخدم الحالية داخل مسار الانضمام */
function getOnboardingState(user, options = {}) {
  const { hasRegistrationSession = false, awaitingLanguage = false } = options;
  if (user?.isRegistered) return STATE.REGISTERED;
  if (hasRegistrationSession) return STATE.REGISTRATION_ACTIVE;
  if (hasUserLanguage(user)) return STATE.LANGUAGE_SELECTED;
  if (awaitingLanguage) return STATE.LANGUAGE_PENDING;
  return STATE.NONE;
}

// ═══════════════════════════════════════════════
// بطاقة اختيار اللغة
// ═══════════════════════════════════════════════

/** نص البطاقة: ثلاثي اللغة لأن المستخدم لم يختر لغته بعد */
function buildLanguageCardText({ language = null, existingUser = false } = {}) {
  const botName = brand.botName();
  const lines = [];

  if (language) {
    lines.push(t(language, "language.cardGreeting", { bot: botName }));
    lines.push(t(language, "language.cardPrompt"));
  } else {
    lines.push("👋 أهلاً بك · Welcome");
    lines.push(
      [
        `🇸🇦 اختر لغة الواجهة لتبدأ.`,
        `🇬🇧 Choose your interface language.`,
      ].join("\n"),
    );
  }

  if (existingUser) {
    lines.push(
      [
        "🔁 حسابك مسجّل بالفعل — هذه الخطوة لضبط اللغة فقط.",
        "Your account is already registered — this only sets the language.",
      ].join("\n"),
    );
  }

  return UI.card({
    title: botName,
    icon: UI.theme(language || "ar").brand,
    lang: language || "ar",
    subtitle: null,
    blocks: [lines.join("\n\n"), LANGUAGE_ORDER.map(
      (code) => `${LANGUAGES[code].flag} ${LANGUAGES[code].nativeName}`,
    ).join("   ·   ")],
    footer: UI.footer(botName, brand.developerName()),
  });
}

/** أزرار اللغة بصيغة Native Flow (quick_reply) */
function buildLanguageButtons() {
  return LANGUAGE_ORDER.map((code) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({
      display_text: `${LANGUAGES[code].flag} ${LANGUAGES[code].nativeName}`,
      id: `${LANGUAGE_BUTTON_PREFIX}${code}`,
    }),
  }));
}

/** أزرار احتياطية بصيغة buttonsMessage للأجهزة التي لا تدعم Native Flow */
function buildLegacyLanguageButtons() {
  return LANGUAGE_ORDER.map((code) => ({
    buttonId: `${LANGUAGE_BUTTON_PREFIX}${code}`,
    buttonText: { displayText: `${LANGUAGES[code].flag} ${LANGUAGES[code].nativeName}` },
    type: 1,
  }));
}

const LANGUAGE_FLOW = "onboarding-language";

/** نص البطاقة الهادئة: اسم البوت + «اختر لغتك» بثلاث لغات فقط */
function buildCalmLanguageText({ existingUser = false } = {}) {
  const lines = [`🌐 *${brand.plainName().toUpperCase()}*`, LANGUAGE_ORDER.map((code) => t(code, "language.selectTitle")).join("\n")];
  if (existingUser) lines.push(LANGUAGE_ORDER.map((code) => `_${t(code, "language.existingNote")}_`).join("\n"));
  return lines.join("\n\n");
}

/**
 * بطاقة اللغة الهادئة بصورة احترافية عبر مسار التسليم الموحّد (صورة+أزرار ← أزرار ← نص).
 * نفس معرّفات الأزرار (terboo_language_*) فلا يتغير شيء في معالجتها.
 */
async function sendLanguageCard(sock, m, options = {}) {
  return sendCard(sock, m, {
    cardId: "language",
    lang: "ar",
    text: buildCalmLanguageText(options),
    image: "language",
    buttons: LANGUAGE_ORDER.map((code, index) => ({
      id: `${LANGUAGE_BUTTON_PREFIX}${code}`,
      text: `${LANGUAGES[code].flag} ${LANGUAGES[code].nativeName}`,
      typed: String(index + 1),
    })),
    flow: LANGUAGE_FLOW,
  });
}

/**
 * إرسال بطاقة اختيار اللغة.
 * ثلاث طبقات: Native Flow أفقي → buttonsMessage → نص عادي، حتى لا تنكسر التجربة أبداً.
 */
async function sendLanguageSelector(sock, m, options = {}) {
  try {
    const sent = await sendLanguageCard(sock, m, options);
    if (sent?.stage) return sent;
  } catch (error) {
    noteFailure("onboarding", error, { where: "src/lib/terboo-onboarding.js:language-card", stage: "ui-kit", target: m.chat, fallback: "legacy-layers" });
  }

  const text = buildLanguageCardText(options);
  const contextInfo = brand.channelContext();

  // 1) Native Flow أفقي (الشكل الحديث المطابق لأزرار القائمة الحالية)
  //    نجرّبه مرة مع الاقتباس ومرة بدونه حتى لا نفقد الشكل الحديث بسبب اقتباس غير صالح.
  for (const useQuote of [true, false]) {
    try {
      const { generateWAMessageFromContent } = await import("@whiskeysockets/baileys");
      const content = {
        viewOnceMessage: {
          message: {
            messageContextInfo: {},
            interactiveMessage: {
              body: { text },
              footer: { text: UI.footer(brand.botName(), brand.developerName()) },
              nativeFlowMessage: {
                messageParamsJson: JSON.stringify({
                  settings: { button_layout: "horizontal" },
                }),
                buttons: buildLanguageButtons(),
              },
              contextInfo,
            },
          },
        },
      };

      const options = { userJid: sock.user?.jid };
      if (useQuote && m.raw) options.quoted = m.raw;

      const msg = generateWAMessageFromContent(m.chat, content, options);
      await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
      return msg;
    } catch (error) {
      noteFailure("onboarding", error, { where: "src/lib/terboo-onboarding.js:235", stage: "language-card-native", target: m.chat, payload: "interactiveMessage", fallback: "next-form" });
    }
  }

  // 2) أزرار كلاسيكية
  try {
    const { generateWAMessageFromContent } = await import("@whiskeysockets/baileys");
    const content = {
      buttonsMessage: {
        contentText: text,
        footerText: UI.footer(brand.botName(), brand.developerName()),
        buttons: buildLegacyLanguageButtons(),
        headerType: 1,
        contextInfo,
      },
    };
    const msg = generateWAMessageFromContent(m.chat, content, {
      userJid: sock.user?.jid,
    });
    await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
    return msg;
  } catch (error) {
    noteFailure("onboarding", error, { where: "src/lib/terboo-onboarding.js:257", stage: "language-card-buttons", target: m.chat, payload: "buttonsMessage", fallback: "text" });
  }

  // 3) نص عادي مع أرقام اختيار (حتى لا يعلق المستخدم على أي إصدار قديم)
  const numbered = LANGUAGE_ORDER.map(
    (code, index) => `${index + 1}. ${LANGUAGES[code].flag} ${LANGUAGES[code].nativeName}`,
  ).join("\n");
  return m.reply(`${text}\n\n${numbered}`);
}

// ═══════════════════════════════════════════════
// قراءة اختيار اللغة
// ═══════════════════════════════════════════════

/** هل هذا النص معرّف زر لغة؟ */
function resolveLanguageButtonId(body) {
  const value = String(body || "").trim().toLowerCase();
  return LANGUAGE_BUTTON_IDS[value] || null;
}

/** هل الرسالة ناتجة عن ضغط زر فعلي؟ */
function isButtonResponse(m) {
  return BUTTON_RESPONSE_TYPES.has(m?.type);
}

/**
 * اختيار مكتوب كاحتياط، ولا يُقبل إلا أثناء حالة انتظار اللغة.
 * لا يقبل أبداً معرّف الزر الداخلي كنص عادي.
 */
function resolveTypedLanguage(body) {
  const value = String(body || "").trim().toLowerCase();
  if (!value || value.length > 12) return null;
  if (value.startsWith(LANGUAGE_BUTTON_PREFIX)) return null;

  const numeric = { 1: "ar", 2: "en" };
  if (numeric[value]) return numeric[value];

  const aliases = {
    ar: "ar", arabic: "ar", "العربية": "ar", "عربي": "ar", عربية: "ar",
    en: "en", english: "en", "انجليزي": "en", "إنجليزي": "en",
  };
  return aliases[value] || null;
}

// ═══════════════════════════════════════════════
// البوابة الرئيسية
// ═══════════════════════════════════════════════

/** هل يجب تجاهل هذه الرسالة تماماً من منظور الانضمام؟ */
function shouldSkipMessage(m) {
  if (!m || !m.sender) return true;
  // أمر أرسلته النواة نيابةً عن المستخدم: رسالته الأصلية مرت بالبوابة بالفعل
  if (m.aiDispatched) return true;
  if (m.fromMe || m.isBot || m.isNewsletter) return true;
  if (m.chat === "status@broadcast") return true;
  return false;
}

/** أصحاب الاستثناءات الحالية لا تلمسهم البوابة */
function isExemptUser(m) {
  return Boolean(m.isOwner || m.isPartner || m.isPremium);
}

/**
 * هل للأمر الحالي استثناء من التسجيل؟ skipRegistration الموجود أصلاً، أو أمر إدارة مجموعة
 * داخل المجموعة (التسجيل لتخصيص التجربة لا لإثبات وجود العضو — الصلاحيات تُفحص كما هي).
 */
async function commandSkipsRegistration(m) {
  if (!m.isCommand || !m.command) return false;
  try {
    const { getPlugin } = await import("./terboo-plugins.js");
    const plugin = getPlugin(m.command);
    return Boolean(plugin?.config?.skipRegistration || (m.isGroup && plugin?.config?.category === "group"));
  } catch (error) { noteFailure("onboarding", error, {where: "src/lib/terboo-onboarding.js:326",stage: "import:terboo-plugins"}); return false; }
}

/** هل هناك جلسة تسجيل نشطة لهذا المستخدم؟ */
function hasRegistrationSession(jid) {
  const key = stateKey(jid);
  const sessions = global.registrationSessions || {};
  if (sessions[key]) return true;
  return Object.keys(sessions).some((k) => stateKey(k) === key);
}

/** تشغيل نظام التسجيل الحالي دون إعادة بنائه */
async function startExistingRegistration(m, sock) {
  try {
    const registration = await import("../../plugins/user/daftar.js");
    if (typeof registration.startRegistration === "function") {
      await registration.startRegistration(m, sock);
      return true;
    }
    if (typeof registration.handler === "function") {
      await registration.handler(m, { sock });
      return true;
    }
  } catch (error) {
    console.error("[Onboarding] تعذّر بدء التسجيل:", error.message);
  }
  return false;
}

/** حفظ اللغة ثم متابعة المسار الصحيح */
async function applyLanguageSelection(m, sock, db, language) {
  const lang = normalizeLanguage(language, null);
  if (!lang) return false;

  const before = db.getUser(m.sender);
  db.setUser(m.sender, { language: lang });
  clearPrompt(m.sender);
  notifiedExisting.add(stateKey(m.sender));

  const alreadyRegistered = Boolean(before?.isRegistered);
  const botName = brand.botName();

  if (alreadyRegistered) {
    await m.reply(
      UI.card({
        title: t(lang, "language.cardTitle"),
        icon: "🌐",
        blocks: [
          [
            t(lang, "language.savedExisting"),
            t(lang, "language.current"),
          ].join("\n"),
        ],
        footer: UI.footer(botName, brand.developerName(), lang),
        lang,
      }),
    );
    await m.react("🌐").catch((error) => { noteFailure("onboarding", error, {where: "src/lib/terboo-onboarding.js:385",stage: "m.react"}); });
    return true;
  }

  // البطاقة التالية تظهر بلغته مباشرة (بطاقة اللغة تُزال) ⇒ بلا رسائل تأكيد متراكمة
  await retireCard(sock, m.sender, m.chat, LANGUAGE_FLOW);
  // V6: اللغة ← القائمة الرئيسية مباشرةً (بلا خطوة نمط استخدام)
  let next = false;
  try {
    const menu = await import("../../plugins/main/اوامر.js");
    const { getUptime } = await import("../connection.js");
    const handler = menu.handler || menu.default?.handler;
    if (typeof handler === "function") {
      await handler(m, { sock, config, db, uptime: getUptime() });
      next = true;
    }
  } catch (error) {
    noteFailure("onboarding", error, { where: "src/lib/terboo-onboarding.js:main-menu", stage: "after-language", fallback: "saved-card" });
  }
  if (!next) {
    await m.reply(
      UI.card({
        title: t(lang, "language.cardTitle"),
        icon: "✅",
        blocks: [[t(lang, "language.saved"), t(lang, "language.savedNext")].join("\n")],
        footer: UI.footer(botName, brand.developerName(), lang),
        lang,
      }),
    );
  }

  await m.react("✅").catch((error) => { noteFailure("onboarding", error, {where: "src/lib/terboo-onboarding.js:403",stage: "m.react"}); });
  return true;
}

/**
 * بوابة الانضمام: تُستدعى من src/handler.js قبل توجيه الأوامر.
 * @returns {Promise<boolean>} true = تمت المعالجة هنا ويجب إيقاف بقية المعالجة
 */
async function handleOnboarding(m, sock, db) {
  try {
    if (shouldSkipMessage(m)) return false;
    if (!db?.ready) return false;

    ensureRegistrationSetting(db);

    const user = db.getUser(m.sender);

    // 1) ضغطة زر اللغة: تُعالَج أولاً وتعود فوراً
    const buttonLanguage = resolveLanguageButtonId(m.body);
    if (buttonLanguage) {
      if (!isButtonResponse(m)) return false; // نص عادي يحمل معرّف الزر: يُتجاهل
      return await applyLanguageSelection(m, sock, db, buttonLanguage);
    }

    // 2) اختيار مكتوب، مقبول فقط أثناء انتظار اللغة
    if (isAwaitingLanguage(m.sender) && !hasUserLanguage(user)) {
      const typed = resolveTypedLanguage(m.body);
      if (typed) return await applyLanguageSelection(m, sock, db, typed);
    }

    if (isExemptUser(m)) return false;
    if (hasUserLanguage(user)) return false;

    // 3) مستخدم مسجّل بلا لغة: بطاقة واحدة فقط دون قطع وصوله
    if (user?.isRegistered) {
      const key = stateKey(m.sender);
      if (!notifiedExisting.has(key) && !wasPromptedRecently(m.sender)) {
        notifiedExisting.add(key);
        markPrompted(m.sender);
        await sendLanguageSelector(sock, m, { existingUser: true });
      }
      return false;
    }

    // 4) جلسة تسجيل نشطة: لا نقطعها
    if (hasRegistrationSession(m.sender)) return false;

    // 5) استثناءات التسجيل الحالية تبقى كما هي
    if (await commandSkipsRegistration(m)) return false;

    // 6) داخل المجموعات نتدخل عند الأوامر فقط حتى لا نسبب إزعاجاً
    const isDirectInteraction = m.isCommand || !m.isGroup;
    if (!isDirectInteraction) return false;

    if (wasPromptedRecently(m.sender)) {
      // البطاقة أُرسلت للتو: نمنع الوصول بصمت بدل تكرار نفس الرسالة
      return true;
    }

    markPrompted(m.sender);
    await sendLanguageSelector(sock, m, {});
    return true;
  } catch (error) {
    console.error("[Onboarding] خطأ:", error.message);
    return false; // أي خطأ هنا يجب ألا يمنع البوت من العمل
  }
}

export {
  STATE,
  LANGUAGE_BUTTON_PREFIX,
  LANGUAGE_BUTTON_IDS,
  PROMPT_COOLDOWN,
  getOnboardingState,
  ensureRegistrationSetting,
  isRegistrationRequired,
  sendLanguageSelector,
  sendLanguageCard,
  buildCalmLanguageText,
  buildLanguageCardText,
  buildLanguageButtons,
  resolveLanguageButtonId,
  resolveTypedLanguage,
  isButtonResponse,
  isAwaitingLanguage,
  applyLanguageSelection,
  handleOnboarding,
};

export default {
  STATE,
  LANGUAGE_BUTTON_IDS,
  getOnboardingState,
  isRegistrationRequired,
  sendLanguageSelector,
  handleOnboarding,
};
