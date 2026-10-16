// ═══════════════════════════════════════════════
// 🔤 سجل الخطوط المركزي - Bot Terboo
// ───────────────────────────────────────────────
// منظومة Typography جديدة بالكامل:
//   • العربية : Noto Sans Arabic  (دعم RTL ممتاز وتشكيل سليم)
//   • اللاتينية: Plus Jakarta Sans (English / Español)
//   • خطوط ثانوية داخل المشروع كاحتياط حقيقي: Cairo ثم Inter ثم Manrope.
//
// قواعد ثابتة:
//   • التسجيل يتم مرة واحدة فقط لكامل العملية؛ لا يسجّل أي بلوقن خطاً بنفسه.
//   • لا اعتماد إطلاقاً على خطوط مثبّتة في نظام التشغيل: كل الملفات داخل المشروع.
//   • فشل تحميل أي خط لا يوقف البوت: سلسلة احتياط داخلية ثم خط النظام.
//   • هذه الخطوط للصور/الكانفس/SVG فقط. واتساب يتحكم في خط الرسائل النصية،
//     ولا يمكن تقنياً فرض font-family عليها، فنستخدم Unicode styling باعتدال.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import fs from "fs";
import path from "path";

const FONT_ROOT = path.join(process.cwd(), "assets", "fonts");
const TERBOO_DIR = path.join(FONT_ROOT, "terboo");

/** الأوزان المدعومة */
const WEIGHTS = { Regular: 400, Medium: 500, SemiBold: 600, Bold: 700 };

/** عائلات الهوية */
const FAMILY = {
  arabic: "Terboo Arabic",
  latin: "Terboo Latin",
  arabicAlt: "Terboo Arabic Alt",
  latinAlt: "Terboo Latin Alt",
  /** أحادي المسافة لبطاقات الكود (JetBrains Mono) */
  mono: "Terboo Mono",
  /** عناوين حزمة الهوية «Aurora» (Plus Jakarta Sans ExtraBold — لاتيني فقط) */
  display: "Terboo Display",
};

/**
 * ملفات الخطوط مرتبة بالأولوية.
 * `primary: true` يعني أن هذه هي العائلة المعتمدة للعرض.
 */
const FONT_FILES = [
  // ── العربية: Noto Sans Arabic (أساسي) ──
  { family: FAMILY.arabic, style: "Regular", weight: 400, primary: true, file: path.join(TERBOO_DIR, "NotoSansArabic-Regular.ttf") },
  { family: FAMILY.arabic, style: "Medium", weight: 500, primary: true, file: path.join(TERBOO_DIR, "NotoSansArabic-Medium.ttf") },
  { family: FAMILY.arabic, style: "SemiBold", weight: 600, primary: true, file: path.join(TERBOO_DIR, "NotoSansArabic-SemiBold.ttf") },
  { family: FAMILY.arabic, style: "Bold", weight: 700, primary: true, file: path.join(TERBOO_DIR, "NotoSansArabic-Bold.ttf") },

  // ── اللاتينية: Plus Jakarta Sans (أساسي) ──
  { family: FAMILY.latin, style: "Regular", weight: 400, primary: true, file: path.join(TERBOO_DIR, "PlusJakartaSans-Regular.ttf") },
  { family: FAMILY.latin, style: "Medium", weight: 500, primary: true, file: path.join(TERBOO_DIR, "PlusJakartaSans-Medium.ttf") },
  { family: FAMILY.latin, style: "SemiBold", weight: 600, primary: true, file: path.join(TERBOO_DIR, "PlusJakartaSans-SemiBold.ttf") },
  { family: FAMILY.latin, style: "Bold", weight: 700, primary: true, file: path.join(TERBOO_DIR, "PlusJakartaSans-Bold.ttf") },

  // ── احتياط عربي داخل المشروع: Cairo ──
  { family: FAMILY.arabicAlt, style: "Regular", weight: 400, file: path.join(TERBOO_DIR, "Cairo-Regular.ttf") },
  { family: FAMILY.arabicAlt, style: "Medium", weight: 500, file: path.join(TERBOO_DIR, "Cairo-Medium.ttf") },
  { family: FAMILY.arabicAlt, style: "SemiBold", weight: 600, file: path.join(TERBOO_DIR, "Cairo-SemiBold.ttf") },
  { family: FAMILY.arabicAlt, style: "Bold", weight: 700, file: path.join(TERBOO_DIR, "Cairo-Bold.ttf") },

  // ── احتياط لاتيني داخل المشروع: Inter ──
  { family: FAMILY.latinAlt, style: "Regular", weight: 400, file: path.join(TERBOO_DIR, "Inter-Regular.ttf") },
  { family: FAMILY.latinAlt, style: "Medium", weight: 500, file: path.join(TERBOO_DIR, "Inter-Medium.ttf") },
  { family: FAMILY.latinAlt, style: "SemiBold", weight: 600, file: path.join(TERBOO_DIR, "Inter-SemiBold.ttf") },
  { family: FAMILY.latinAlt, style: "Bold", weight: 700, file: path.join(TERBOO_DIR, "Inter-Bold.ttf") },
];

/**
 * خطوط إضافية مسموحة (§28: Manrope من الخطوط المعتمدة للاتينية).
 * الخطوط القديمة (Zahraaa كخط عام، Levelup/ArialNarrow، Epep/«CartoonVibes»، Arial،
 * Poppins) لم تعد تُسجَّل ولا يستعملها أي ملف.
 */
const EXTRA_FONTS = [
  // بطاقات الكود (terboo-code-card): أحادي المسافة، OFL 1.1
  { family: FAMILY.mono, file: path.join(TERBOO_DIR, "JetBrainsMono-Regular.ttf") },
  { family: `${FAMILY.mono} Bold`, file: path.join(TERBOO_DIR, "JetBrainsMono-Bold.ttf") },
  // عناوين صور الهوية (tools/terboo-brand-assets.mjs): OFL 1.1
  { family: FAMILY.display, file: path.join(TERBOO_DIR, "PlusJakartaSans-ExtraBold.ttf") },
  { family: "Manrope", file: path.join(FONT_ROOT, "kalender", "Manrope-Bold.ttf") },
  { family: "Manrope ExtraBold", file: path.join(FONT_ROOT, "kalender", "Manrope-ExtraBold.ttf") },
];
/** اسم قديم للقائمة نفسها (توافق مع أي استيراد سابق) */
const LEGACY_FONTS = EXTRA_FONTS;

/**
 * خطوط خاصة بمراجعة موثّقة (§28 «إلا في حالة تقنية مثبتة وبعد مراجعة»).
 * handwriting: وظيفة «كتابة يدوية» تحاكي خط اليد على ورقة؛ استبداله بخط طباعي
 * يلغي الميزة نفسها. يُستعمل في ذلك البلوقن وحده، باسم عائلة Terboo، ومع سلسلة
 * احتياط Noto Sans Arabic/Plus Jakarta Sans لكل حرف لا يغطيه (العربية مثلاً).
 */
const SPECIAL_FONTS = {
  handwriting: {
    family: "Terboo Handwriting",
    file: path.join(process.cwd(), "assets", "terboo-font.ttf"),
    reason: "محاكاة الكتابة اليدوية في بلوقن كتابة_يدوية فقط",
  },
};

/** آخر احتياط: خط النظام العام (لا نعتمد عليه، لكنه يمنع الانهيار) */
const SYSTEM_FALLBACK = "sans-serif";

// ═══════════════════════════════════════════════
// خطوط SVG (sharp/librsvg) — v4 §35
// ───────────────────────────────────────────────
// محرّك SVG لا يعرف إلا خطوط fontconfig (خطوط النظام)، فكانت "Noto Sans Arabic" و
// "Plus Jakarta Sans" داخل صور SVG (brat · quote · fake-card) تُرسم بخط النظام بصمت
// (مُثبت بالمقارنة: الصورة نفسها بايت-ببايت مع عائلة غير موجودة). ملف fontconfig خاص
// يضيف مجلد خطوط الهوية مع إبقاء إعداد النظام، ويُضبط قبل أول رسم نصي.
// FONTCONFIG_FILE الذي يضبطه المالك بنفسه يُحترم كما هو.
// ═══════════════════════════════════════════════

const xmlEscape = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function ensureSvgFontConfig() {
  if (process.env.FONTCONFIG_FILE && !process.env.TERBOO_FONTCONFIG) return process.env.FONTCONFIG_FILE;
  try {
    const dir = path.join(process.cwd(), "tmp", "fontconfig");
    fs.mkdirSync(path.join(dir, "cache"), { recursive: true });
    const file = path.join(dir, "terboo-fonts.conf");
    const system = ["/etc/fonts/fonts.conf"].filter((candidate) => fs.existsSync(candidate));
    const xml = [
      "<?xml version=\"1.0\"?>",
      "<!DOCTYPE fontconfig SYSTEM \"fonts.dtd\">",
      "<fontconfig>",
      `  <dir>${xmlEscape(TERBOO_DIR)}</dir>`,
      ...system.map((candidate) => `  <include ignore_missing="yes">${xmlEscape(candidate)}</include>`),
      `  <cachedir>${xmlEscape(path.join(dir, "cache"))}</cachedir>`,
      "</fontconfig>",
      "",
    ].join("\n");
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== xml) fs.writeFileSync(file, xml);
    process.env.FONTCONFIG_FILE = file;
    process.env.TERBOO_FONTCONFIG = "1";
    return file;
  } catch (error) {
    noteFailure("fonts", error, { where: "src/lib/terboo-fonts.js:ensureSvgFontConfig", stage: "fontconfig", fallback: "system-fonts-in-svg" });
    return null;
  }
}
const SVG_FONTCONFIG = ensureSvgFontConfig();

let registered = false;
const readyFamilies = new Set();

async function loadCanvas() {
  try {
    return await import("@napi-rs/canvas");
  } catch (error) { noteFailure("fonts", error, {where: "src/lib/terboo-fonts.js:99",stage: "import:canvas"}); return null; }
}

/**
 * تسجيل كل خطوط الهوية مرة واحدة.
 * آمن للاستدعاء المتكرر ولا يرمي أي استثناء.
 * @returns {Promise<{registered: string[], missing: string[], primaryReady: boolean}>}
 */
async function registerFonts() {
  if (registered) {
    return { registered: [...readyFamilies], missing: [], primaryReady: isPrimaryReady() };
  }
  registered = true;

  const canvas = await loadCanvas();
  const done = [];
  const missing = [];

  if (!canvas?.GlobalFonts) {
    return { registered: done, missing: FONT_FILES.map((f) => f.file), primaryReady: false };
  }

  for (const font of [...FONT_FILES, ...EXTRA_FONTS]) {
    try {
      if (!fs.existsSync(font.file)) {
        missing.push(font.file);
        continue;
      }
      canvas.GlobalFonts.registerFromPath(font.file, font.family);
      readyFamilies.add(font.family);
      done.push(`${font.family}${font.style ? ` ${font.style}` : ""}`);
    } catch {
      missing.push(font.file);
    }
  }

  return { registered: done, missing, primaryReady: isPrimaryReady() };
}

/** هل العائلات الأساسية جاهزة؟ */
function isPrimaryReady() {
  return readyFamilies.has(FAMILY.arabic) && readyFamilies.has(FAMILY.latin);
}

/** هل تم تسجيل عائلة معينة؟ */
function isFamilyReady(family) {
  return readyFamilies.has(family);
}

/** هل اللغة عربية (RTL)؟ */
function isArabic(language) {
  return String(language || "").toLowerCase().startsWith("ar");
}

/**
 * العائلة المعتمدة للغة، مع النزول للاحتياط الداخلي إذا لم تُسجَّل.
 * @param {string} language ar | en | es
 */
function getFontForLanguage(language) {
  const [primary, alt] = isArabic(language)
    ? [FAMILY.arabic, FAMILY.arabicAlt]
    : [FAMILY.latin, FAMILY.latinAlt];

  if (isFamilyReady(primary)) return primary;
  if (isFamilyReady(alt)) return alt;
  if (isFamilyReady("Manrope")) return "Manrope";
  return SYSTEM_FALLBACK;
}

/**
 * سلسلة خطوط كاملة صالحة لـ ctx.font و CSS و SVG.
 * تتضمن الاحتياط الداخلي قبل خط النظام.
 * @param {string} language ar | en | es
 * @param {number|string} [weight] 400 | 500 | 600 | 700
 * @param {number} [size] الحجم بالبكسل — يُرجع صيغة ctx.font الكاملة
 */
function getFontStack(language, weight = 400, size = null) {
  const arabic = isArabic(language);
  const chain = arabic
    ? [FAMILY.arabic, FAMILY.arabicAlt, FAMILY.latin]
    : [FAMILY.latin, FAMILY.latinAlt, "Manrope"];

  const available = chain.filter((family) => isFamilyReady(family));
  const families = (available.length ? available : [])
    .map((family) => `"${family}"`)
    .concat(SYSTEM_FALLBACK)
    .join(", ");

  if (!size) return families;
  return `${weight} ${size}px ${families}`;
}

/**
 * مسار ملف خط محدد (لمن يحتاج الملف نفسه مثل wa-sticker أو satori).
 * @param {string} language ar | en | es
 * @param {string} [style] Regular | Medium | SemiBold | Bold
 */
const STYLE_OF_WEIGHT = { 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "Bold", 900: "Bold" };

function getFontFile(language, style = "Regular") {
  // يقبل اسم الوزن («Bold») أو رقمه (700)
  if (typeof style === "number" || /^\d+$/.test(String(style))) style = STYLE_OF_WEIGHT[Number(style)] || "Regular";
  const arabic = isArabic(language);
  const order = arabic
    ? [FAMILY.arabic, FAMILY.arabicAlt]
    : [FAMILY.latin, FAMILY.latinAlt];

  for (const family of order) {
    const found = FONT_FILES.find((f) => f.family === family && f.style === style);
    if (found && fs.existsSync(found.file)) return found.file;
  }

  const extra = EXTRA_FONTS.find((f) => fs.existsSync(f.file));
  return extra ? extra.file : null;
}

/**
 * تسجيل خط خاص موثّق (مرة واحدة) وإرجاع سلسلته الكاملة لـ ctx.font.
 * @param {"handwriting"} name
 * @param {string} language
 * @param {number} size
 * @param {number} [weight]
 */
async function getSpecialFontStack(name, language, size, weight = 400) {
  const special = SPECIAL_FONTS[name];
  await registerFonts();
  if (special && !readyFamilies.has(special.family) && fs.existsSync(special.file)) {
    const canvas = await loadCanvas();
    try {
      canvas?.GlobalFonts?.registerFromPath(special.file, special.family);
      readyFamilies.add(special.family);
    } catch (error) { noteFailure("fonts", error, {where: "src/lib/terboo-fonts.js:232",stage: "canvas.GlobalFonts.registerFromPath"}); }
  }
  const base = getFontStack(language, weight);
  const families = special && readyFamilies.has(special.family) ? `"${special.family}", ${base}` : base;
  return `${weight} ${size}px ${families}`;
}

/** كل ملفات الهوية الموجودة فعلياً على القرص (للفحص والاختبارات) */
function listInstalledFonts() {
  return FONT_FILES.filter((f) => fs.existsSync(f.file)).map((f) => ({
    family: f.family,
    style: f.style,
    weight: f.weight,
    file: path.relative(process.cwd(), f.file),
    primary: Boolean(f.primary),
  }));
}

/**
 * أسماء العائلات الحقيقية داخل ملفات الخط — يحتاجها مُصيّر SVG
 * (sharp/resvg) لأنه لا يرى الأسماء المستعارة المسجّلة في Canvas.
 * تبقى في هذا الملف وحده حتى لا يُكتب اسم خط مباشرةً في أي واجهة (§20).
 */
const SVG_FAMILY = {
  display: "Plus Jakarta Sans ExtraBold",
  arabic: "Noto Sans Arabic",
  arabicAlt: "Cairo",
  latin: "Plus Jakarta Sans",
  latinAlt: "Inter",
};

/**
 * سلسلة الخطوط الجاهزة لخاصية font-family داخل SVG.
 * @param {string} language ar | en | es
 * @returns {string} مثال: Noto Sans Arabic, Cairo, Plus Jakarta Sans, sans-serif
 */
function getSvgFontStack(language) {
  const chain = isArabic(language)
    ? [SVG_FAMILY.arabic, SVG_FAMILY.arabicAlt, SVG_FAMILY.latin]
    : [SVG_FAMILY.latin, SVG_FAMILY.latinAlt, SVG_FAMILY.arabic];
  return [...chain, SYSTEM_FALLBACK].join(", ");
}

/** اسم العائلة الواحدة كما تعرفها ملفات Canvas (للبلوقنات القديمة) */
function getCanvasFamily(language) {
  return isArabic(language) ? FAMILY.arabic : FAMILY.latin;
}

export {
  SVG_FONTCONFIG,
  ensureSvgFontConfig,
  EXTRA_FONTS,
  SPECIAL_FONTS,
  getSpecialFontStack,
  SVG_FAMILY,
  getSvgFontStack,
  getCanvasFamily,
  FAMILY,
  WEIGHTS,
  FONT_FILES,
  LEGACY_FONTS,
  SYSTEM_FALLBACK,
  registerFonts,
  isFamilyReady,
  isPrimaryReady,
  getFontForLanguage,
  getFontStack,
  getFontFile,
  listInstalledFonts,
};

export default {
  FAMILY,
  WEIGHTS,
  registerFonts,
  getFontForLanguage,
  getFontStack,
  getFontFile,
  listInstalledFonts,
};
