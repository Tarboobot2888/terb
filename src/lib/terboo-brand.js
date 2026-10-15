// ═══════════════════════════════════════════════
// ✦ هوية Bot Terboo - مصدر واحد للعلامة التجارية
// ───────────────────────────────────────────────
// كل القيم تُقرأ من config.js أولاً، والقيم هنا هي الاحتياط الرسمي فقط.
// هذا الملف لا يغيّر أي منطق تشغيلي؛ وظيفته العرض والهوية فقط.
// ═══════════════════════════════════════════════

import config from "../../config.js";
// رابط الموقع يأتي من باني الروابط المركزي وحده (config.website.publicBaseUrl
// بعد تحقّق الدومين). لا يُستعمل info.website ولا socialLinks.website لأنهما
// يشيران إلى قناة واتساب الرسمية ومعناهما مختلف.
import { websiteUrl as webPlatformUrl } from "../web/url-builder.js";

const FALLBACK = {
  botName: "Bot Terboo",
  shortName: "TERBOO",
  developer: "Terboo",
  owner: "Terboo",
  version: "6.0",
  ownerNumber: "201225655220",
  botNumber: "2348093093240",
  channelId: "120363418715609508@newsletter",
  channelName: "Bot Terboo",
  channelUrl: "https://whatsapp.com/channel/0029Vb5Vczr7j6g3foFrXM2x",
  communityUrl: "https://whatsapp.com/channel/0029VbDhVJmBVJkxkVqLSI0y",
  stickerPack: "Bot Terboo",
  stickerAuthor: "Terboo",
};

/**
 * أسماء عرض قديمة تبقى مرادفاً داخلياً فقط: config.js قديم باسم البوت مع رقم إصدار قديم يُعرض «Bot Terboo».
 * لا يمس اسماً اختاره المالك غير هذه الأسماء.
 */
const LEGACY_DISPLAY_NAME = /^\s*(bot\s+terboo)\s+v?\d+(?:\.\d+)*\s*$/i;
function displayName(value) {
  const text = String(value || "").trim();
  return LEGACY_DISPLAY_NAME.test(text) ? "Bot Terboo" : text;
}

/** يطبّع أسماء العرض القديمة في config المحمّل (مرة عند أول استيراد) حتى لا يظهر «v4.0» لأي مستخدم */
function normalizeLegacyConfig(target = config) {
  if (target.bot?.name) target.bot.name = displayName(target.bot.name);
  if (target.saluran?.name) target.saluran.name = displayName(target.saluran.name);
  if (target.sticker?.packname) target.sticker.packname = displayName(target.sticker.packname);
  return target;
}
normalizeLegacyConfig();

/** اسم البوت الظاهر للمستخدم */
function botName() {
  return displayName(config.bot?.name) || FALLBACK.botName;
}

/** اسم البوت بلا رقم الإصدار — لتذييل القوائم */
function plainName() {
  return botName().replace(/\s*\bv?\d+(?:\.\d+)+\s*$/i, "").trim() || botName();
}

/** اسم مختصر يصلح للعناوين القصيرة والأزرار */
function shortName() {
  return FALLBACK.shortName;
}

/** اسم المطور */
function developerName() {
  return config.bot?.developer?.trim() || FALLBACK.developer;
}

/** اسم المالك */
function ownerName() {
  return config.owner?.name?.trim() || FALLBACK.owner;
}

/** إصدار البوت */
function botVersion() {
  return config.bot?.version || FALLBACK.version;
}

/** رقم المالك/المطور الأساسي */
function ownerNumber() {
  const first = config.owner?.number?.[0];
  return String(first || FALLBACK.ownerNumber).replace(/[^0-9]/g, "");
}

/** رقم البوت الرسمي */
function botNumber() {
  const num = config.session?.pairingNumber || config.bot?.primaryNumber;
  return String(num || FALLBACK.botNumber).replace(/[^0-9]/g, "");
}

/** معرّف القناة الرسمية */
function channelId() {
  return config.saluran?.id || FALLBACK.channelId;
}

/** اسم القناة الرسمية */
function channelName() {
  return displayName(config.saluran?.name) || botName();
}

/** رابط القناة الرسمية */
function channelUrl() {
  return config.saluran?.link || config.info?.website || FALLBACK.channelUrl;
}

/** رابط المجموعة/المجتمع */
function communityUrl() {
  return config.info?.grupwa || FALLBACK.communityUrl;
}

/** رابط واتساب المباشر للمطور */
function whatsappUrl() {
  return config.socialLinks?.whatsapp || `https://wa.me/${ownerNumber()}`;
}

/** روابط التواصل الرسمية */
function socialLinks() {
  return config.socialLinks || {};
}

/**
 * رابط منصة Bot Terboo Web، أو "" حين لا يصلح أن يُرسل زر:
 * الموقع معطَّل · لا عنوان عام · دومين لم يُتحقَّق منه بعد.
 * مصدر الحقيقة الوحيد — لا تبنِ رابط الموقع في أي مكان آخر.
 */
function websiteUrl() {
  return webPlatformUrl();
}

/** هل يوجد رابط موقع صالح يُعرض الآن؟ */
function hasWebsite() {
  return Boolean(webPlatformUrl());
}

/** اسم حزمة الملصقات */
function stickerPack() {
  return displayName(config.sticker?.packname) || FALLBACK.stickerPack;
}

/** مؤلف الملصقات */
function stickerAuthor() {
  return config.sticker?.author?.trim() || FALLBACK.stickerAuthor;
}

/** سياق القناة الموحّد (forwardedNewsletterMessageInfo) */
function channelContext(extra = {}) {
  return {
    forwardingScore: 9,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: channelId(),
      newsletterName: channelName(),
      serverMessageId: 127,
    },
    ...extra,
  };
}

/** إعلان خارجي موحّد يحمل الهوية الجديدة */
function externalAd({ title, body, thumbnail, sourceUrl, largeThumb = false } = {}) {
  const ad = {
    title: title || botName(),
    body: body || developerName(),
    mediaType: 1,
    sourceUrl: sourceUrl || channelUrl(),
    renderLargerThumbnail: Boolean(largeThumb),
    showAdAttribution: false,
  };
  if (thumbnail) ad.thumbnail = thumbnail;
  return ad;
}

// ── قفل الهوية (§5 §38 §41): اسم واحد ثابت لا يُترجم ولا يُعرّب ولا يتغيّر حسب اللغة ──
const BRAND_LOCK = Object.freeze({
  name: "Terboo",
  full: "Bot Terboo",
  ar: "تيربو",
  arFull: "بوت تيربو",
  en: "Terboo",
});

/** اسم البوت بلغة المستخدم — العربية «تيربو»، وغيرها «Terboo» حرفياً */
function brandName(lang = "ar", { full = false } = {}) {
  if (lang === "ar") return full ? BRAND_LOCK.arFull : BRAND_LOCK.ar;
  return full ? BRAND_LOCK.full : BRAND_LOCK.name;
}

/** أشكال خاطئة للاسم يُمنع ظهورها في أي رد (ترجمة/تعريب/هوية سابقة) */
const FORBIDDEN_NAME_FORMS = /طربوش|تاربـو|تاربو|\bBot\s+Tarboo\b|\bTarboo\b|\bMaroBot\b|\bMaro-?AI\b/giu;

/** تصحيح أي شكل خاطئ لاسم البوت في نص صادر (رد نموذج أو نص قديم) */
function enforceBrand(text, lang = "ar") {
  if (typeof text !== "string" || !text) return text;
  return text.replace(FORBIDDEN_NAME_FORMS, (hit) => (/[؀-ۿ]/.test(hit) ? BRAND_LOCK.ar : BRAND_LOCK.name));
}

/** تعليمة الهوية التي تُضاف لكل موجّه ذكاء اصطناعي */
function brandLockPrompt(lang = "ar") {
  return [
    `Your name is exactly "${BRAND_LOCK.name}". In Arabic it is written exactly "${BRAND_LOCK.ar}" (or "${BRAND_LOCK.arFull}"); in English it stays "${BRAND_LOCK.name}".`,
    "Never translate, arabize, reinterpret or respell the name (not طربوش, not تاربو, not Turbo). Never use any previous name.",
    "Do not re-introduce yourself unless the user asks who you are; if they already know you, just continue naturally.",
    lang === "ar" ? `When asked in Arabic who you are, say: "أنا ${BRAND_LOCK.ar}".` : `When asked who you are, say you are ${BRAND_LOCK.name}.`,
  ].join("\n");
}

/** مرادفات توافق قديمة (maro/tarboo/مارو/تاربو) — تُقبل للاستدعاء ولا تُعرض أبداً */
const LEGACY_ALIAS = /maro|tarboo|مارو|تاربو/i;
function isLegacyAlias(name) {
  return LEGACY_ALIAS.test(String(name || ""));
}
function visibleAliases(list) {
  return (Array.isArray(list) ? list : [list]).filter((a) => a && !isLegacyAlias(a));
}

const brand = {
  FALLBACK,
  BRAND_LOCK,
  brandName,
  enforceBrand,
  brandLockPrompt,
  isLegacyAlias,
  visibleAliases,
  botName,
  plainName,
  displayName,
  normalizeLegacyConfig,
  shortName,
  developerName,
  ownerName,
  botVersion,
  ownerNumber,
  botNumber,
  channelId,
  channelName,
  channelUrl,
  communityUrl,
  whatsappUrl,
  socialLinks,
  websiteUrl,
  hasWebsite,
  stickerPack,
  stickerAuthor,
  channelContext,
  externalAd,
};

export {
  FALLBACK,
  BRAND_LOCK,
  brandName,
  enforceBrand,
  brandLockPrompt,
  isLegacyAlias,
  visibleAliases,
  botName,
  plainName,
  displayName,
  normalizeLegacyConfig,
  shortName,
  developerName,
  ownerName,
  botVersion,
  ownerNumber,
  botNumber,
  channelId,
  channelName,
  channelUrl,
  communityUrl,
  whatsappUrl,
  socialLinks,
  websiteUrl,
  hasWebsite,
  stickerPack,
  stickerAuthor,
  channelContext,
  externalAd,
};

export default brand;
