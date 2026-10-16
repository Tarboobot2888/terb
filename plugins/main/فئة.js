// ═══════════════════════════════════════════════
// 🗂️ الأقسام وتفاصيل القسم — Bot Terboo
// ───────────────────────────────────────────────
//   .فئة          كل الأقسام (قائمة منسدلة من السجل الحيّ)
//   .فئة <قسم>    أوامر القسم كصفوف قابلة للضغط + رجوع + إغلاق
// الصفوف من سجل القوائم، والزخرفة من المحرّك المركزي.
// ═══════════════════════════════════════════════

import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import crypto from "node:crypto";
import sharp from "sharp";
import config from "../../config.js";
import { WIDE_IMAGE, sectionImage } from "../../src/lib/terboo-asset-manager.js";
import { getPlugin } from "../../src/lib/terboo-plugins.js";
import { getUserLanguage, t, getCategoryLabel, formatNumber } from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";
import { CATEGORY_EMOJIS, commandsByCategory, visibleCategories } from "../../src/lib/terboo-menus.js";
import { sendMenu } from "../../src/lib/terboo-menu-send.js";

const pluginConfig = {
  name: "فئة",
  alias: ["menucat"],
  category: "main",
  description: "عرض الأوامر في فئة معينة",
  usage: ".فئة <الفئة>",
  example: ".فئة tools",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
};

/**
 * صورة رأس القائمة Full HD (تُرفع مرة وتُعاد) — بدل externalAdReply الذي لا يعرضه جهاز المستلم داخل الرسائل التفاعلية.
 * لكل قسم صورته من حزمة الهوية (assets/image/sections)، وقائمة الأقسام كلها صورة «default».
 */
const headers = new Map();
async function menuImage(category = "default") {
  try {
    const image = sectionImage(category);
    if (!image) return null;
    // صور الأقسام 1280×720 تُرسل كما هي؛ صورة بمقاس آخر (أمر المالك) تُصغَّر مرة لكل بصمة
    const hash = crypto.createHash("sha1").update(image.buffer).digest("hex").slice(0, 10);
    const { width, height } = WIDE_IMAGE;
    const key = ["menu-section", image.name, hash, `${width}x${height}`].join("-");
    if (!headers.has(key)) {
      if (headers.size >= 48) headers.delete(headers.keys().next().value);
      const meta = await sharp(image.buffer).metadata();
      const ready = meta.format === "jpeg" && meta.width === width && meta.height === height;
      headers.set(key, ready ? image.buffer : await sharp(image.buffer).resize(width, height, { fit: "cover", kernel: "lanczos3" }).sharpen({ sigma: 0.55 }).jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer());
    }
    return { key, buffer: headers.get(key) };
  } catch (error) { noteFailure("plugin:main/فئة", error, {where: "plugins/main/فئة.js:menuImage",stage: "sharp"}); return null; }
}

async function handler(m, { sock, db }) {
  const user = db.getUser(m.sender) || {};
  const lang = getUserLanguage(user);
  const prefix = m.prefix || config.command?.prefix || ".";
  const groupData = m.isGroup ? db.getGroup(m.chat) || {} : {};
  const ctx = { lang, prefix, isOwner: Boolean(m.isOwner), isGroup: Boolean(m.isGroup), botMode: groupData.botMode || "md", showCloud: false };
  // تذييل القوائم: «✦ Bot Terboo» فقط (يظهر مرة واحدة في تذييل الرسالة)
  const footer = UI.footer(brand.plainName(), null, lang);
  const categoryArg = String(m.args?.[0] || "").toLowerCase();

  // ── كل الأقسام ───────────────────────────────
  if (!categoryArg) {
    const categories = visibleCategories(ctx);
    const blocks = categories.map(({ cat, commands }) => UI.row(
      `${CATEGORY_EMOJIS[cat] || "📁"} ${getCategoryLabel(cat, lang)}`,
      t(lang, "menu.rowCommands", { count: formatNumber(commands.length, lang) }),
      lang,
    ));
    const text = UI.card({
      title: t(lang, "menu.allTitle"),
      icon: "🗂️",
      subtitle: t(lang, "menu.allHint"),
      kind: "menu",
      blocks: [blocks.join("\n")],
      lang,
    });
    await sendMenu(sock, m, { menuId: "categories", ctx, text, footer, image: await menuImage("default") });
    return;
  }

  // ── قسم محدّد ────────────────────────────────
  const all = commandsByCategory();
  const matched = Object.keys(all).find((cat) => cat.toLowerCase() === categoryArg);
  if (!matched) return m.reply(UI.errorCard(t(lang, "menu.allTitle"), t(lang, "menu.categoryUnknown"), { lang, footer }));
  if (matched === "owner" && !m.isOwner) return m.reply(UI.errorCard(t(lang, "menu.allTitle"), t(lang, "menu.categoryLocked"), { lang, footer }));
  const commands = all[matched] || [];
  if (!commands.length) return m.reply(UI.warningCard(t(lang, "menu.allTitle"), t(lang, "menu.categoryEmpty"), { lang, footer }));

  const label = `${CATEGORY_EMOJIS[matched] || "📁"} ${getCategoryLabel(matched, lang)}`;
  const lines = commands.map((name) => {
    const description = String(getPlugin(name)?.config?.description || "").slice(0, 60);
    return UI.command(name, description, { lang, prefix });
  });
  const text = UI.card({
    title: getCategoryLabel(matched, lang),
    icon: CATEGORY_EMOJIS[matched] || "📁",
    subtitle: t(lang, "menu.rowCommands", { count: formatNumber(commands.length, lang) }),
    kind: "command",
    blocks: [lines.join("\n")],
    lang,
  });

  // قسم الألعاب: زر مباشر لـ TERBOO ARCADE (قائمة الأقسام · بطاقات الألعاب المرئية)
  const extraButtons = matched === "game"
    ? [{ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🎮 TERBOO ARCADE", id: `${prefix}اركيد` }) }, { name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "🖼️ TERBOO ARCADE · HTML", id: `${prefix}اركيد html` }) }]
    : [];
  await sendMenu(sock, m, { menuId: "category", ctx: { ...ctx, category: matched }, text, footer, image: await menuImage(matched), extraButtons });
}

export { pluginConfig as config, handler };
