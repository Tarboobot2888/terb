// ═══════════════════════════════════════════════
// 🌐 طبقة الترجمة المركزية - Bot Terboo
// ───────────────────────────────────────────────
// • مصدر واحد لكل النصوص التي يراها المستخدم (ar / en).
// • لا يوجد أي مفتاح يسبب انهيار البوت: أي مفتاح ناقص يعود للعربية ثم للمفتاح نفسه.
// • لا تنشئ قاعدة بيانات جديدة: اللغة تُحفظ داخل users database الحالية في حقل `language`.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import ar from "./terboo-locales/ar.js";
import en from "./terboo-locales/en.js";

const DEFAULT_LANGUAGE = "ar";

const LOCALES = { ar, en };

/** ترتيب عرض اللغات في بطاقة الاختيار */
const LANGUAGE_ORDER = ["ar", "en"];

/** بيانات العرض لكل لغة (العلم، الاسم المحلي، صيغة التاريخ/الأرقام، الاتجاه) */
const LANGUAGES = LANGUAGE_ORDER.reduce((acc, code) => {
  acc[code] = { code, ...LOCALES[code].meta };
  return acc;
}, {});

/** التحقق من أن الرمز لغة مدعومة */
function isSupportedLanguage(code) {
  return typeof code === "string" && Object.hasOwn(LOCALES, code.toLowerCase());
}

/** تطبيع أي قيمة لغة قادمة من قاعدة البيانات أو من المستخدم */
function normalizeLanguage(code, fallback = DEFAULT_LANGUAGE) {
  if (!code) return fallback;
  const lower = String(code).trim().toLowerCase();
  if (isSupportedLanguage(lower)) return lower;
  // أشكال شائعة: ar-EG / en_US ...
  const short = lower.split(/[-_]/)[0];
  if (isSupportedLanguage(short)) return short;
  const byName = LANGUAGE_ORDER.find(
    (lang) =>
      LOCALES[lang].meta.name.toLowerCase() === lower ||
      LOCALES[lang].meta.nativeName.toLowerCase() === lower,
  );
  return byName || fallback;
}

/** قراءة قيمة متداخلة عبر مفتاح منقوط مثل `registration.step1Title` */
function readPath(source, key) {
  if (!source) return undefined;
  let current = source;
  for (const part of String(key).split(".")) {
    if (current == null || typeof current !== "object") return undefined;
    current = current[part];
  }
  return current;
}

/**
 * استبدال المتغيرات داخل النص بشكل آمن.
 * المتغير يُحوَّل إلى نص فقط، ولا يُنفَّذ ولا يكسر تنسيق واتساب أو JSON
 * لأن النتيجة تُستخدم دائماً كقيمة نصية وليست كقالب قابل للتنفيذ.
 */
function interpolate(template, variables) {
  if (typeof template !== "string" || !variables) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => {
    const value = variables[name];
    if (value === undefined || value === null) return match;
    return String(value);
  });
}

/**
 * جلب نص مترجم.
 * @param {string} language رمز اللغة (ar | en | es)
 * @param {string} key مفتاح منقوط
 * @param {Object} [variables] متغيرات الاستبدال
 * @returns {string|any} النص المترجم، أو نص العربية، أو المفتاح نفسه كحل أخير
 */
function t(language, key, variables) {
  const lang = normalizeLanguage(language);
  let value = readPath(LOCALES[lang], key);
  if (value === undefined && lang !== DEFAULT_LANGUAGE) {
    value = readPath(LOCALES[DEFAULT_LANGUAGE], key);
  }
  if (value === undefined) return key;
  if (Array.isArray(value)) {
    return value.map((item) => interpolate(item, variables));
  }
  if (typeof value !== "string") return value;
  return interpolate(value, variables);
}

/** نسخة مربوطة بلغة واحدة: `const tr = translator(lang); tr("common.wait")` */
function translator(language) {
  const lang = normalizeLanguage(language);
  const bound = (key, variables) => t(lang, key, variables);
  bound.language = lang;
  bound.meta = LANGUAGES[lang];
  return bound;
}

/** لغة المستخدم من كائن المستخدم القادم من قاعدة البيانات (بدون قراءة إضافية) */
function getUserLanguage(user) {
  if (!user) return DEFAULT_LANGUAGE;
  if (typeof user === "string") return normalizeLanguage(user);
  return normalizeLanguage(user.language);
}

/** هل اختار المستخدم لغته بعد؟ (null = لم يختر) */
function hasUserLanguage(user) {
  return Boolean(user && typeof user === "object" && isSupportedLanguage(user.language));
}

/**
 * حفظ لغة المستخدم داخل قاعدة بيانات المستخدمين الحالية.
 * لا يضيف أي جدول أو ملف جديد، فقط الحقل `language`.
 */
function setUserLanguage(jid, language, db) {
  const lang = normalizeLanguage(language, null);
  if (!lang || !jid) return null;
  try {
    const database = db || null;
    if (!database) return null;
    database.setUser(jid, { language: lang });
    return lang;
  } catch (error) { noteFailure("localization", error, {where: "src/lib/terboo-localization.js:126",stage: "database.setUser"}); return null; }
}

/** قراءة لغة المستخدم مباشرة من قاعدة البيانات */
function getLanguageForJid(jid, db) {
  try {
    const user = db?.getUser?.(jid);
    return getUserLanguage(user);
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

/** بيانات اللغة (علم/اسم/اتجاه/صيغة محلية) */
function getLocale(language) {
  return LANGUAGES[normalizeLanguage(language)];
}

/** رمز Intl المناسب (ar-EG / en-US) */
function getIntlLocale(language) {
  return getLocale(language).locale;
}

/** تنسيق رقم حسب لغة المستخدم دون تغيير أي حساب داخلي */
function formatNumber(value, language) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  try {
    return number.toLocaleString(getIntlLocale(language));
  } catch {
    return String(number);
  }
}

/** تنسيق تاريخ/وقت حسب لغة المستخدم مع الحفاظ على المنطقة الزمنية الحالية للنظام */
function formatDateTime(date, language, options = {}) {
  const value = date instanceof Date ? date : new Date(date || Date.now());
  try {
    return value.toLocaleString(getIntlLocale(language), options);
  } catch {
    return value.toString();
  }
}

/** تنسيق التاريخ فقط */
function formatDate(date, language) {
  return formatDateTime(date, language, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** تنسيق الوقت فقط */
function formatTime(date, language) {
  return formatDateTime(date, language, { hour: "2-digit", minute: "2-digit" });
}

/**
 * عرض قيمة الجنس المخزّنة (ذكر / أنثى) بلغة المستخدم.
 * القيمة المخزّنة في قاعدة البيانات لا تتغير إطلاقاً.
 */
function getGenderLabel(storedGender, language) {
  if (!storedGender) return "-";
  const value = String(storedGender).trim();
  if (value === "ذكر" || /^(male|man|masculino|hombre)$/i.test(value)) {
    return t(language, "values.genderMale");
  }
  if (value === "أنثى" || /^(female|woman|femenino|mujer)$/i.test(value)) {
    return t(language, "values.genderFemale");
  }
  return value;
}

/**
 * عرض رتبة المستوى المخزّنة (من نظام المستويات الحالي) بلغة المستخدم.
 * لا يغيّر أي حساب: يترجم النص المعروض فقط.
 */
const ROLE_LABELS = {
  "🛡️ محارب": "values.roleWarrior",
  "⭐ نخبة": "values.roleElite",
  "🎖️ سيد": "values.roleMaster",
  "💪 سيد كبير": "values.roleGrandmaster",
  "💜 ملحمي": "values.roleEpic",
  "⚔️ خرافي": "values.roleLegend",
  "🐉 أسطوري": "values.roleMythic",
};

function getRoleLabel(storedRole, language) {
  if (!storedRole) return "-";
  const key = ROLE_LABELS[String(storedRole).trim()];
  return key ? t(language, key) : storedRole;
}

/** اسم القسم المعروض حسب اللغة مع الحفاظ على المعرّف الداخلي كما هو */
function getCategoryLabel(category, language) {
  const key = String(category || "").toLowerCase();
  const label = t(language, `categories.${key}`);
  return label === `categories.${key}` ? category : label;
}

export {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_ORDER,
  isSupportedLanguage,
  normalizeLanguage,
  t,
  translator,
  getUserLanguage,
  hasUserLanguage,
  setUserLanguage,
  getLanguageForJid,
  getLocale,
  getIntlLocale,
  formatNumber,
  formatDateTime,
  formatDate,
  formatTime,
  getCategoryLabel,
  getGenderLabel,
  getRoleLabel,
};

export default {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  LANGUAGE_ORDER,
  isSupportedLanguage,
  normalizeLanguage,
  t,
  translator,
  getUserLanguage,
  hasUserLanguage,
  setUserLanguage,
  getLanguageForJid,
  getLocale,
  getIntlLocale,
  formatNumber,
  formatDateTime,
  formatDate,
  formatTime,
  getCategoryLabel,
  getGenderLabel,
  getRoleLabel,
};
