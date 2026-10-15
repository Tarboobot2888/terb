// ═══════════════════════════════════════════════
// 🏠 القائمة الرئيسية وقوائمها الفرعية — Bot Terboo
// ───────────────────────────────────────────────
//   .menu            القائمة الرئيسية (الشكلان 1 و 2 كما هما)
//   .menu settings   الإعدادات      · .menu language  اللغة
//   .menu ai         الذكاء          · .menu owner     لوحة المالك (للمالك)
// الصفوف والأزرار كلها من سجل القوائم (terboo-menus.js)، والزخرفة من
// المحرّك المركزي (terboo-ui-theme.js) — لا زخرفة يدوية هنا.
// ═══════════════════════════════════════════════

import sharp from "sharp";
import crypto from "node:crypto";
import fs from "fs";
import config from "../../config.js";
import { formatUptime, getTimeGreeting } from "../../src/lib/terboo-formatter.js";
import { getUserLanguage, t, formatNumber, formatDate, formatTime } from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";
import { listSections, visibleCategories } from "../../src/lib/terboo-menus.js";
import { sendMenu } from "../../src/lib/terboo-menu-send.js";
import { WIDE_IMAGE, getAssetBuffer } from "../../src/lib/terboo-asset-manager.js";
import { quotedOf, resolveTarget } from "../../src/lib/terboo-menu-delivery.js";

const pluginConfig = {
  name: "menu",
  alias: ["help", "اوامر", "commands", "m", "أوامر"],
  category: "main",
  description: "عرض القائمة الرئيسية",
  usage: ".menu [settings|language|ai|owner]",
  example: ".menu",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

/** القوائم الفرعية بكل الكلمات المقبولة (عربي/English/Español) */
const SUBMENUS = {
  settings: ["settings", "إعدادات", "اعدادات", "الإعدادات", "ajustes", "configuracion", "configuración"],
  language: ["language", "لغة", "اللغة", "idioma", "lang"],
  ai: ["ai", "ذكاء", "الذكاء", "ia", "terboo"],
  owner: ["owner", "مالك", "المالك", "dueño", "dueno", "admin"],
};

function submenuOf(word) {
  const value = String(word || "").trim().toLowerCase();
  return Object.keys(SUBMENUS).find((key) => SUBMENUS[key].includes(value)) || null;
}

/** بطاقة قائمة فرعية: عنوان + تلميح + أسطر أوامرها */
function submenuText(menuId, ctx) {
  const { lang } = ctx;
  const titles = { settings: "menu.settingsTitle", language: "menu.languageTitle", ai: "menu.aiTitle", owner: "menu.ownerTitle" };
  const hints = { settings: "menu.settingsHint", language: "menu.languageHint", ai: "menu.aiHint", owner: "menu.ownerHint" };
  const icons = { settings: "⚙️", language: "🌐", ai: "🤖", owner: "👑" };
  const sections = listSections(menuId, ctx);
  const blocks = sections.map((section) => [
    UI.section(section.title, lang),
    ...section.rows.map((row) => UI.command(row.id.slice(ctx.prefix.length), row.title, { lang, prefix: ctx.prefix })),
  ].join("\n"));
  return UI.card({
    title: t(lang, titles[menuId]),
    icon: icons[menuId],
    subtitle: t(lang, hints[menuId]),
    kind: "menu",
    blocks,
    lang,
  });
}

/** نص القائمة الرئيسية بالتصميم الجديد */
function mainMenuText({ m, db, lang, uptime, categories }) {
  const user = db.getUser(m.sender) || {};
  const xp = user?.exp || 0;
  const level = Math.floor(xp / 20000) + 1;
  const requiredXP = level * 20000;
  const percent = Math.min(Math.floor((xp / requiredXP) * 100), 100);
  const totalCmds = categories.reduce((acc, { commands }) => acc + commands.length, 0);
  const role = m.isOwner ? t(lang, "common.owner") : m.isPremium ? t(lang, "common.premium") : t(lang, "common.user");
  const now = new Date();

  const account = [
    UI.section(`${m.isOwner ? "👑" : m.isPremium ? "💎" : "👤"} ${t(lang, "menu.userSection")}`, lang),
    UI.row(t(lang, "menu.fieldRole"), role, lang),
    UI.row(t(lang, "menu.fieldLevel"), formatNumber(level, lang), lang),
    UI.row(t(lang, "menu.fieldExp"), `${formatNumber(xp, lang)} / ${formatNumber(requiredXP, lang)}`, lang),
    UI.row(t(lang, "menu.fieldProgress"), UI.progressBar(percent, 10, lang), lang),
  ].join("\n");

  const bot = [
    UI.section(`🤖 ${t(lang, "menu.botSection")}`, lang),
    UI.row(t(lang, "menu.fieldVersion"), `v${brand.botVersion()}`, lang),
    UI.row(t(lang, "menu.fieldCommands"), formatNumber(totalCmds, lang), lang),
    UI.row(t(lang, "menu.fieldCategories"), formatNumber(categories.length, lang), lang),
    UI.row(t(lang, "menu.fieldUsers"), formatNumber(db.getUserCount(), lang), lang),
    UI.row(t(lang, "menu.fieldUptime"), formatUptime(uptime, lang), lang),
  ].join("\n");

  const when = UI.quote(`📅 ${formatDate(now, lang)}  ·  ⏰ ${formatTime(now, lang)}`, lang);

  // بلا سطر عنوان باسم البوت ولا سطر توقيع قبل التذييل: الاسم في الصورة وفي تذييل الرسالة
  return UI.card({
    kind: "menu",
    subtitle: `${getTimeGreeting(lang)} ${m.pushName || ""}`.trim(),
    blocks: [account, bot, when, UI.subtitle(t(lang, "menu.hint"))],
    lang,
  });
}


async function handler(m, { sock, config: botConfig, db, uptime }) {
  const user = db.getUser(m.sender) || {};
  const lang = getUserLanguage(user);
  const prefix = m.prefix || botConfig.command?.prefix || ".";
  const groupData = m.isGroup ? db.getGroup(m.chat) || {} : {};
  const ctx = { lang, prefix, isOwner: Boolean(m.isOwner), isGroup: Boolean(m.isGroup), botMode: groupData.botMode || "md", showCloud: false };
  // تذييل القوائم: «✦ Bot Terboo» فقط
  const footer = UI.footer(brand.plainName(), null, lang);

  // ── القوائم الفرعية ─────────────────────────
  const submenu = submenuOf(m.args?.[0]);
  if (submenu) {
    if (submenu === "owner" && !m.isOwner) return m.reply(UI.errorCard(t(lang, "menu.ownerTitle"), t(lang, "menu.categoryLocked"), { lang }));
    await sendMenu(sock, m, { menuId: submenu, ctx, text: submenuText(submenu, ctx), footer });
    return;
  }

  // ── القائمة الرئيسية ────────────────────────
  const categories = visibleCategories(ctx);
  const textBody = mainMenuText({ m, db, lang, uptime, categories });
  const variant = db.setting("menuVariant") || botConfig.ui?.menuVariant || 1;

  // كل الأشكال تمر عبر طبقة التسليم الموحّدة (§30): هدف محلول، اقتباس رسالة المستخدم،
  // وبديل تلقائي إن رفض الخادم/الجهاز العرض.
  // الشكل 1: «الأزرار العائمة» الكلاسيكية تحت الرسالة مع بطاقة البوت (كما كان) ← وإن رُفضت
  //          فـ Native Flow بصورة البوت · الشكل 2: صورة المصغّرة + زر المطوّر · غيرهما: بلا صورة.
  const imageKey = variant === 1 || variant === 2 ? "terboo-banner" : null;
  const image = imageKey ? await menuHeader(imageKey) : null;
  const extraButtons = variant === 2
    ? [{ name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: t(lang, "menu.buttonOwner"), url: brand.whatsappUrl(), merchant_url: brand.whatsappUrl() }) }]
    : [];
  const floating = variant === 1
    ? {
      thumbnail: await menuThumbnail("terboo-banner"),
      name: brand.botName(),
      address: `● ${t(lang, "common.online")} | v${brand.botVersion()}`,
      buttonText: t(lang, "menu.buttonCategories"),
    }
    : null;
  await sendMenu(sock, m, { menuId: "main", ctx, text: textBody, footer, image, extraButtons, floating });
  if (variant === 1 || variant === 2) await sendMenuAudio(sock, m, db);
}

/** صورة القائمة من مدير الأصول (اللافتة، وإن غابت فصورة البوت) */
function menuAsset(assetKey) {
  const buffer = getAssetBuffer(assetKey) || getAssetBuffer("terboo");
  if (!buffer) throw new Error(`asset-missing:${assetKey}`);
  return buffer;
}

/** صورة مصغّرة لبطاقة الموقع فوق الأزرار العائمة (300×170 كما كانت) */
async function menuThumbnail(assetKey) {
  try {
    return await sharp(menuAsset(assetKey)).resize(300, 170).jpeg({ quality: 80 }).toBuffer();
  } catch (error) {
    console.warn(`[menu] thumbnail ${assetKey}: ${error.message}`);
    return null;
  }
}

/** رؤوس القائمة الجاهزة (تُحضَّر مرة واحدة لكل بصمة) */
const headerCache = new Map();

/** JPEG بمقاس WIDE_IMAGE (1280×720): الأصل بالمقاس نفسه يُعاد كما هو (بلا ضغط ثانٍ)، وغيره يُصغَّر ويوضَّح */
async function fullHd(source) {
  const { width, height } = WIDE_IMAGE;
  const meta = await sharp(source).metadata();
  if (meta.format === "jpeg" && meta.width === width && meta.height === height) return source;
  return sharp(source).resize(width, height, { fit: "cover", kernel: "lanczos3" }).sharpen({ sigma: 0.55 }).jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
}

/** صورة رأس القائمة (تُرفع مرة وتُعاد): اللافتة 1280×720 تُرسل كما هي، وغيرها يُصغَّر مرة */
async function menuHeader(assetKey) {
  try {
    const source = menuAsset(assetKey);
    // البصمة في المفتاح: تغيير الصورة (أمر المالك أو حزمة جديدة) لا يعيد رفعاً قديماً مخزّناً
    const key = ["menu-header", assetKey, crypto.createHash("sha1").update(source).digest("hex").slice(0, 10), `${WIDE_IMAGE.width}x${WIDE_IMAGE.height}`].join("-");
    if (!headerCache.has(key)) {
      headerCache.clear();
      headerCache.set(key, await fullHd(source));
    }
    return { key, buffer: headerCache.get(key) };
  } catch (error) {
    console.warn(`[menu] header ${assetKey}: ${error.message}`);
    return null;
  }
}

async function sendMenuAudio(sock, m, db) {
  if (db.setting("audioMenu") === false) return;
  try {
    const target = await resolveTarget(m, sock);
    const quoted = quotedOf(m);
    await sock.sendMessage(target, { audio: fs.readFileSync(config.assets["terboo-mp3"]), mimetype: "audio/mpeg" }, quoted ? { quoted } : {});
  } catch (error) {
    console.warn(`[menu] audio: ${error.message}`);
  }
}

export { SUBMENUS, mainMenuText, submenuOf, submenuText };
export default { config: pluginConfig, handler };
