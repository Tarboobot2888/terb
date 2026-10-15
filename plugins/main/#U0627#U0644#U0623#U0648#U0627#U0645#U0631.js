import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import * as botmodePlugin from "../group/وضع_البوت.js";
import { getCasesByCategory, getCaseCount } from "../../case/terboo.js";
import config from "../../config.js";
import fs from "fs"
import {
  getCommandsByCategory,
  getCategories,
} from "../../src/lib/terboo-plugins.js";
import { getDatabase } from "../../src/lib/terboo-database.js";
import {
  getUserLanguage,
  t,
  getCategoryLabel,
  formatNumber,
} from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";
import { listSections } from "../../src/lib/terboo-menus.js";

const pluginConfig = {
  name: "الأوامر",
  alias: ["allmenu"],
  category: "main",
  description: "عرض جميع الأوامر الكاملة حسب الفئة",
  usage: ".الأوامر",
  example: ".الأوامر",
  isOwner: false, isPremium: false, isGroup: false, isPrivate: false,
  cooldown: 5, energi: 0, isEnabled: true,
};

const CATEGORY_EMOJIS = {
  owner: "👑", main: "🏠", utility: "🔧", fun: "🎮", group: "👥",
  download: "📥", search: "🔍", tools: "🛠️", sticker: "🖼️", ai: "🤖",
  game: "🎯", media: "🎬", info: "ℹ️", religi: "☪️", panel: "🖥️",
  user: "📊", random: "🎲", canvas: "🎨", premium: "💎",
  convert: "🔄", economy: "💰", cek: "📋",
};

const THEMES = {
  1: { emoji: "🍒", name: "أحمر" },
  2: { emoji: "🍊", name: "برتقالي" },
  3: { emoji: "🍋", name: "أصفر" },
  4: { emoji: "🍀", name: "أزرق" },
  5: { emoji: "🍇", name: "بنفسجي" },
  6: { emoji: "🌸", name: "وردي" },
  7: { emoji: "💎", name: "سماوي" },
};

async function handler(m, { sock, db }) {
  const prefix = m.prefix || config.command?.prefix || ".";
  const user = db.getUser(m.sender) || {};
  const lang = getUserLanguage(user);
  const groupData = m.isGroup ? db.getGroup(m.chat) || {} : {};
  const botMode = groupData.botMode || "md";
  const categories = getCategories();
  const commandsByCategory = getCommandsByCategory();
  const casesByCategory = getCasesByCategory();
  let totalCommands = 0;
  for (const category of categories) {
    totalCommands += (commandsByCategory[category] || []).length;
  }
  const totalCases = getCaseCount();
  const totalFeatures = totalCommands + totalCases;
  const botName = brand.botName();
  const botVersion = brand.botVersion();
  const ownerName = brand.ownerName();

  const savedVariant = db.setting("allmenuVariant");
  const allmenuVariant = savedVariant || config.ui?.allmenuVariant || 2;
  const theme = THEMES[allmenuVariant] || THEMES[2];

  const categoryOrder = [
    "owner", "main", "utility", "tools", "fun", "game", "download",
    "search", "sticker", "media", "ai", "group", "religi", "info",
    "cek", "economy", "user", "canvas", "random", "premium"
  ];

  const sortedCategories = [...categories].sort((a, b) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
  });

  let modeAllowedMap = { md: null, cpanel: ["main", "group", "sticker", "owner", "tools", "panel"], store: ["main", "group", "sticker", "owner", "store"], pushkontak: ["main", "group", "sticker", "owner", "pushkontak"] };
  let modeExcludeMap = { md: ["panel", "pushkontak", "store"], cpanel: null, store: null, pushkontak: null };

  try {
    if (botmodePlugin && botmodePlugin.MODES) {
      const modes = botmodePlugin.MODES;
      modeAllowedMap = {}; modeExcludeMap = {};
      for (const [key, val] of Object.entries(modes)) {
        modeAllowedMap[key] = val.allowedCategories;
        modeExcludeMap[key] = val.excludeCategories;
      }
    }
  } catch (e) { noteFailure("plugin:main/الأوامر", e, {where: "plugins/main/الأوامر.js:96",stage: "Object.entries"}); }

  const allowedCategories = modeAllowedMap[botMode];
  const excludeCategories = modeExcludeMap[botMode] || [];

  const categoryRows = [];
  const summaryLines = [];

  for (const category of sortedCategories) {
    if (category === "owner" && !m.isOwner) continue;
    if (allowedCategories && !allowedCategories.includes(category.toLowerCase())) continue;
    if (excludeCategories && excludeCategories.includes(category.toLowerCase())) continue;

    const pluginCmds = commandsByCategory[category] || [];
    const caseCmds = casesByCategory[category] || [];
    const allCmds = [...pluginCmds, ...caseCmds];
    if (allCmds.length === 0) continue;

    const emoji = CATEGORY_EMOJIS[category] || "📋";
    const label = getCategoryLabel(category, lang);

    // المعرّف الداخلي للصف يبقى كما هو، والمعروض فقط مترجم
    categoryRows.push({
      title: `${emoji} ${label}`,
      description: t(lang, "menu.rowCommands", { count: formatNumber(allCmds.length, lang) }),
      id: `${prefix}menucat ${category}`,
    });

    summaryLines.push(UI.row(`${emoji} ${label}`, formatNumber(allCmds.length, lang), lang));
  }

  const txt = UI.card({
    title: t(lang, "menu.allTitle"),
    icon: "🗂️",
    subtitle: botName,
    blocks: [
      [
        UI.row(t(lang, "menu.fieldVersion"), `v${botVersion}`, lang),
        UI.row(t(lang, "menu.fieldOwner"), ownerName, lang),
        UI.row(t(lang, "menu.fieldCommands"), formatNumber(totalFeatures, lang), lang),
        UI.row(t(lang, "menu.fieldCategories"), formatNumber(categoryRows.length, lang), lang),
      ].join("\n"),
      [UI.section(`📂 ${t(lang, "menu.sectionTitle")}`, lang), ...summaryLines].join("\n"),
      UI.subtitle(t(lang, "menu.allHint")),
    ],
    lang,
    footer: UI.footer(botName, brand.developerName(), lang),
  });

  const img = fs.readFileSync(config.assets["terboo"]);
  const { ButtonV2 } = await import("../../src/lib/terboo-builder.js");

  const msg = await new ButtonV2(sock)
    .setTitle(`${theme.emoji} ${botName}`)
    .setSubtitle(`${t(lang, "menu.fieldVersion")}: v${botVersion}`)
    .setBody(txt)
    .setFooter(UI.footer(botName, brand.developerName(), lang))
    .setThumbnail(img)
    .addRawButton({
      buttonText: { displayText: t(lang, "menu.buttonCategories") },
      buttonId: 'menu',
      type: 1,
      nativeFlowInfo: {
        name: 'single_select',
        paramsJson: JSON.stringify({
          title: t(lang, "menu.sectionTitle"),
          // الصفوف من سجل القوائم المركزي (نفس ما يختبره tests/terboo-menus.test.mjs)
          sections: listSections("main", { lang, prefix, isOwner: Boolean(m.isOwner), isGroup: Boolean(m.isGroup), botMode }),
        }),
      },
    })
    .addButton(t(lang, "menu.buttonOwner"), `${prefix}owner`)
    .build(m.chat);

  await sock.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
  await m.react(theme.emoji);
}

export { pluginConfig as config, handler };
