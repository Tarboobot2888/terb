// ═══════════════════════════════════════════════
// 🧭 Terboo Menu Registry — سجل القوائم المركزي (§19–§22)
// ───────────────────────────────────────────────
// كل صف وكل زر في قوائم البوت معرّف هنا مرة واحدة:
//
//   internalId      معرّف ثابت للصف (للاختبارات والسجلات)
//   display         النص المعروض (مترجم للغة المستخدم)
//   command + args  الأمر الحقيقي الذي تنتجه الضغطة
//   expectedPlugin  اسم البلوقن الحقيقي الذي يجب أن يصله
//
// معرّف الضغطة المرسَل لواتساب هو الأمر نفسه (".لغة en")، فيمر بمسار
// الأزرار الطبيعي: Normalize → Parse → Resolve → Dispatch، وبكل الصلاحيات.
// البلوقنات تبني صفوفها من هنا، والاختبار يبني Fixtures من هنا —
// فلا يمكن أن يختلف المعروض عن المُختبَر.
// ═══════════════════════════════════════════════

import config from "../../config.js";
import { getCategories, getCommandsByCategory, getPlugin } from "./terboo-plugins.js";
import { getCasesByCategory } from "../../case/terboo.js";
import * as botModes from "../../plugins/group/وضع_البوت.js";
import { formatNumber, getCategoryLabel, t } from "./terboo-localization.js";

/** رموز الأقسام */
const CATEGORY_EMOJIS = {
  owner: "👑", main: "🏠", utility: "🔧", tools: "🛠️", fun: "🎮", game: "🎯",
  download: "📥", downloader: "📥", search: "🔍", sticker: "🖼️", media: "🎬", ai: "🤖",
  group: "👥", religi: "☪️", info: "ℹ️", user: "📊", rpg: "🗡️", ephoto: "🖌️",
  anime: "🍥", panel: "🖥️", vps: "🌊", convert: "🔄", random: "🎲", premium: "💎",
  nsfw: "🔞", cek: "📋", canvas: "🎨", store: "🏪", jpm: "📨", pushkontak: "📤",
  linode: "☁️", primbon: "🔮", stalker: "🕵️", tts: "🗣️", berita: "📰", clan: "⚔️",
  economy: "💰", cloud: "☁️",
};

const CATEGORY_ORDER = [
  "owner", "main", "utility", "tools", "fun", "game", "download", "downloader",
  "search", "sticker", "media", "ai", "group", "religi", "info", "cek", "economy",
  "user", "canvas", "random", "premium", "ephoto", "jpm", "pushkontak", "cloud", "panel", "store",
];

/** الأقسام المستبعدة حسب وضع البوت في المجموعة */
const MODE_EXCLUDE = { md: ["panel", "pushkontak", "store"] };

/**
 * عناصر القوائم الثابتة.
 * label/description مفاتيح ترجمة؛ display ثابت يُستعمل لأسماء اللغات الأصلية.
 * group: يظهر في المجموعات فقط · owner: للمالك فقط.
 */
const ITEMS = {
  "nav.home": { command: "menu", args: "", icon: "🏠", label: "menu.nav.home", description: "menu.desc.home" },
  "nav.back": { command: "menu", args: "", icon: "↩️", label: "menu.nav.back", description: "menu.desc.back" },
  "nav.close": { command: "اغلاق_القائمة", args: "", icon: "✖️", label: "menu.nav.close", description: "menu.desc.close" },
  "nav.categories": { command: "فئة", args: "", icon: "🗂️", label: "menu.nav.categories", description: "menu.desc.categories" },
  "nav.all": { command: "الأوامر", args: "", icon: "📚", label: "menu.nav.all", description: "menu.desc.all" },

  "settings.open": { command: "menu", args: "settings", icon: "⚙️", label: "menu.nav.settings", description: "menu.desc.settings" },
  "settings.language": { command: "لغة", args: "", icon: "🌐", label: "menu.nav.language", description: "menu.rowLanguage" },
  "settings.profile": { command: "بروفايل", args: "", icon: "👤", label: "menu.nav.profile", description: "menu.desc.profile" },
  "settings.memory": { command: "ذاكرة", args: "", icon: "🧠", label: "menu.nav.memory", description: "menu.desc.memory" },
  "settings.privacy": { command: "ذاكرة", args: "شفافية", icon: "🛡️", label: "menu.nav.privacy", description: "menu.desc.privacy" },

  "language.open": { command: "menu", args: "language", icon: "🌐", label: "menu.nav.language", description: "menu.rowLanguage" },
  "lang.ar": { command: "لغة", args: "ar", icon: "🇸🇦", display: "العربية", description: "menu.desc.langAr" },
  "lang.en": { command: "لغة", args: "en", icon: "🇬🇧", display: "English", description: "menu.desc.langEn" },

  "ai.open": { command: "menu", args: "ai", icon: "🤖", label: "menu.nav.ai", description: "menu.desc.ai" },
  "ai.chat": { command: "تيربو", args: "", icon: "💬", label: "menu.nav.chat", description: "menu.desc.chat" },
  "ai.autoai": { command: "autoai", args: "حالة", icon: "🛰️", label: "menu.nav.autoai", description: "menu.desc.autoai", group: true },
  "ai.memory": { command: "ذاكرة", args: "", icon: "🧠", label: "menu.nav.memory", description: "menu.desc.memory" },
  "ai.privacy": { command: "ذاكرة", args: "شفافية", icon: "🛡️", label: "menu.nav.privacy", description: "menu.desc.privacy" },

  "owner.open": { command: "menu", args: "owner", icon: "👑", label: "menu.nav.owner", description: "menu.desc.owner", owner: true },
  "owner.developer": { command: "owner", args: "", icon: "👨‍💻", label: "menu.nav.developer", description: "menu.desc.developer" },
  "owner.ping": { command: "بينغ", args: "", icon: "📡", label: "menu.nav.ping", description: "menu.desc.ping" },

  "reg.start": { command: "daftar", args: "", icon: "📝", label: "menu.nav.register", description: "menu.desc.register" },
  "reg.cancel": { command: "الغاء_التسجيل", args: "", icon: "🗑️", label: "menu.nav.unregister", description: "menu.desc.unregister" },

  "info.rules": { command: "القوانين", args: "", icon: "📜", label: "menu.nav.rules", description: "menu.desc.rules" },
};

/**
 * اسم الأمر ووسائطه بلغة المستخدم — كلها مرادفات حقيقية لنفس البلوقن،
 * فيرى المستخدم الإنجليزي `.memory privacy` بدل `.ذاكرة شفافية`.
 */
const LOCAL_COMMANDS = {
  en: {
    "فئة": "menucat", "الأوامر": "allmenu", "اغلاق_القائمة": "closemenu", "لغة": "language", "بروفايل": "myprofile",
    "ذاكرة": "memory", "تيربو": "terboo", "تحكم": "control", "بينغ": "ping", "daftar": "register",
    "الغاء_التسجيل": "cancelregister", "القوانين": "rules",
  },
};
const LOCAL_ARGS = {
  en: { "شفافية": "privacy", "حالة": "status", settings: "settings", language: "language", ai: "ai", owner: "owner" },
};

function localCommand(command, lang) {
  return LOCAL_COMMANDS[lang]?.[command] || command;
}

function localArgs(args, lang) {
  if (!args) return args;
  return LOCAL_ARGS[lang]?.[args] ?? args;
}

const NAV = ["nav.back", "nav.close"];

/**
 * القوائم: أقسام مرتّبة. dynamic = صفوف مبنية من السجل الحيّ.
 * buttons = الأزرار السريعة تحت الرسالة (quick_reply).
 */
const MENUS = {
  main: {
    title: "menu.title",
    sections: [
      { title: "menu.sectionHint", dynamic: "categories" },
      { title: "menu.sectionSettings", items: ["settings.language", "settings.profile", "settings.memory"] },
      { title: "menu.sectionMore", items: ["ai.open", "settings.open", "owner.open", "nav.all", "info.rules", "owner.developer", "nav.close"] },
    ],
    // ثلاثة أزرار فقط (حد الأزرار القديمة)؛ «المطوّر» انتقل لقائمة «المزيد»
    buttons: ["settings.language", "settings.profile", "info.rules"],
  },
  categories: {
    title: "menu.allTitle",
    sections: [
      { title: "menu.sectionHint", dynamic: "categories" },
      { title: "menu.sectionNav", items: NAV },
    ],
  },
  category: {
    title: "menu.categoryTitle",
    sections: [
      { title: "menu.sectionCommands", dynamic: "commands" },
      { title: "menu.sectionNav", items: NAV },
    ],
    buttons: ["nav.back", "nav.close"],
  },
  settings: {
    title: "menu.settingsTitle",
    sections: [
      { title: "menu.sectionSettings", items: ["language.open", "settings.profile", "settings.memory", "settings.privacy"] },
      { title: "menu.sectionNav", items: NAV },
    ],
    buttons: ["nav.back", "nav.close"],
  },
  language: {
    title: "menu.languageTitle",
    sections: [
      { title: "menu.sectionLanguages", items: ["lang.ar", "lang.en"] },
      { title: "menu.sectionNav", items: NAV },
    ],
    buttons: ["nav.back", "nav.close"],
  },
  ai: {
    title: "menu.aiTitle",
    sections: [
      { title: "menu.sectionAi", items: ["ai.chat", "ai.autoai", "ai.memory", "ai.privacy"] },
      { title: "menu.sectionNav", items: NAV },
    ],
    buttons: ["nav.back", "nav.close"],
  },
  owner: {
    title: "menu.ownerTitle",
    owner: true,
    sections: [
      { title: "menu.sectionOwner", items: ["owner.ping", "owner.developer", "nav.all"] },
      { title: "menu.sectionNav", items: NAV },
    ],
    buttons: ["nav.back", "nav.close"],
  },
  profile: {
    title: "profile.title",
    sections: [{ title: "menu.sectionSettings", items: ["settings.language", "settings.memory", "nav.home"] }],
    buttons: ["settings.language", "nav.home"],
  },
  registration: {
    title: "registration.title",
    sections: [
      { title: "menu.sectionRegistration", items: ["reg.start", "settings.language", "info.rules"] },
      { title: "menu.sectionNav", items: ["reg.cancel", "nav.close"] },
    ],
  },
};

/** الاسم الأساسي للبلوقن الحقيقي خلف أمر */
function pluginNameOf(command) {
  const plugin = getPlugin(command);
  if (!plugin) return null;
  const name = plugin.config?.name;
  return Array.isArray(name) ? name[0] : name;
}

function prefixOf(ctx) {
  return ctx?.prefix || config.command?.prefix || ".";
}

/** الأقسام الظاهرة لهذا المستخدم في هذه المحادثة */
/** أوامر كل قسم: البلوقنات + أوامر case التي يعالجها handler */
function commandsByCategory() {
  const plugins = getCommandsByCategory();
  const cases = getCasesByCategory() || {};
  const out = {};
  for (const cat of new Set([...Object.keys(plugins), ...Object.keys(cases)])) {
    out[cat] = [...new Set([...(plugins[cat] || []), ...(cases[cat] || [])])];
  }
  return out;
}

/** قواعد وضع البوت في المجموعة (المصدر: بلوقن وضع_البوت نفسه) */
function modeRules(botMode = "md") {
  const mode = botModes?.MODES?.[botMode];
  if (mode) return { allowed: mode.allowedCategories || null, exclude: mode.excludeCategories || [] };
  return { allowed: null, exclude: MODE_EXCLUDE.md };
}

function visibleCategories(ctx = {}) {
  const byCategory = commandsByCategory();
  const { allowed, exclude } = modeRules(ctx.botMode || "md");
  return [...new Set([...getCategories(), ...Object.keys(byCategory)])]
    .sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a);
      const ib = CATEGORY_ORDER.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
    })
    .filter((cat) => (cat !== "owner" || ctx.isOwner)
      && !exclude.includes(String(cat).toLowerCase())
      && (!allowed || allowed.includes(String(cat).toLowerCase())))
    .map((cat) => ({ cat, commands: byCategory[cat] || [] }))
    .filter(({ commands }) => commands.length > 0);
}

/** صف ثابت جاهز للعرض والاختبار */
function resolveItem(internalId, ctx = {}) {
  const item = ITEMS[internalId];
  if (!item) return null;
  if (item.owner && !ctx.isOwner) return null;
  if (item.group && !ctx.isGroup) return null;
  const lang = ctx.lang || "ar";
  const label = item.display || t(lang, item.label);
  const command = localCommand(item.command, lang);
  const args = localArgs(item.args, lang);
  const body = `${command}${args ? ` ${args}` : ""}`;
  return {
    internalId,
    display: `${item.icon ? `${item.icon} ` : ""}${label}`,
    description: item.description ? t(lang, item.description) : "",
    command,
    args,
    id: `${prefixOf(ctx)}${body}`,
    expectedCommand: body,
    expectedPlugin: pluginNameOf(item.command),
  };
}

/** صفوف ديناميكية من السجل الحيّ */
function dynamicRows(kind, ctx = {}) {
  const lang = ctx.lang || "ar";
  const prefix = prefixOf(ctx);
  if (kind === "categories") {
    return visibleCategories(ctx).map(({ cat, commands }) => ({
      internalId: `cat.${cat}`,
      display: `${CATEGORY_EMOJIS[cat] || "📁"} ${getCategoryLabel(cat, lang)}`,
      description: t(lang, "menu.rowCommands", { count: formatNumber(commands.length, lang) }),
      command: localCommand("فئة", lang),
      args: cat,
      id: `${prefix}${localCommand("فئة", lang)} ${cat}`,
      expectedCommand: `${localCommand("فئة", lang)} ${cat}`,
      expectedPlugin: pluginNameOf("فئة"),
    }));
  }
  if (kind === "commands") {
    const cat = ctx.category;
    const commands = (commandsByCategory()[cat] || []).slice(0, ctx.limit || 40);
    return commands.map((name) => {
      const plugin = getPlugin(name);
      const isCase = !plugin;
      return {
        internalId: `cmd.${name}`,
        display: `${CATEGORY_EMOJIS[cat] || "▫️"} ${name}`,
        description: String(plugin?.config?.description || "").slice(0, 70),
        command: name,
        args: "",
        id: `${prefix}${name}`,
        expectedCommand: name,
        expectedPlugin: isCase ? `case:${name}` : pluginNameOf(name),
      };
    });
  }
  return [];
}

/**
 * كل صفوف قائمة بعد تطبيق الصلاحيات والسياق.
 * @param {string} menuId
 * @param {{lang?:string, prefix?:string, isOwner?:boolean, isGroup?:boolean, botMode?:string, category?:string, showCloud?:boolean}} ctx
 * @returns {Array<{section:string, rows:Array}>}
 */
function menuSections(menuId, ctx = {}) {
  const menu = MENUS[menuId];
  if (!menu) return [];
  if (menu.owner && !ctx.isOwner) return [];
  const lang = ctx.lang || "ar";
  return menu.sections
    .map((section) => ({
      title: t(lang, section.title),
      rows: section.dynamic
        ? dynamicRows(section.dynamic, ctx)
        : section.items.map((id) => resolveItem(id, ctx)).filter(Boolean),
    }))
    .filter((section) => section.rows.length);
}

/** كل الصفوف مسطّحة */
function menuRows(menuId, ctx = {}) {
  return menuSections(menuId, ctx).flatMap((section) => section.rows);
}

/** أزرار سريعة للقائمة */
function menuButtons(menuId, ctx = {}) {
  return (MENUS[menuId]?.buttons || []).map((id) => resolveItem(id, ctx)).filter(Boolean);
}

/** أقسام single_select جاهزة لواتساب */
function listSections(menuId, ctx = {}) {
  return menuSections(menuId, ctx).map((section) => ({
    title: section.title,
    rows: section.rows.map((row) => ({ title: row.display, description: row.description, id: row.id })),
  }));
}

/** أزرار quick_reply بصيغة Native Flow */
function quickReplies(menuId, ctx = {}) {
  return menuButtons(menuId, ctx).map((button) => ({
    name: "quick_reply",
    buttonParamsJson: JSON.stringify({ display_text: button.display, id: button.id }),
  }));
}

/** أزرار كلاسيكية (buttonsMessage) */
function legacyButtons(menuId, ctx = {}) {
  return menuButtons(menuId, ctx).map((button) => ({
    buttonId: button.id,
    buttonText: { displayText: button.display },
    type: 1,
  }));
}

/**
 * Fixtures الاختبار (§21): كل صف بقيمه الأربعة لكل قائمة.
 * @returns {Array<{menu:string, internalId:string, display:string, id:string, expectedCommand:string, expectedPlugin:string}>}
 */
function menuFixtures(ctx = {}) {
  const out = [];
  for (const menuId of Object.keys(MENUS)) {
    const extra = menuId === "category" ? { category: ctx.category || "main" } : {};
    for (const row of menuRows(menuId, { ...ctx, ...extra })) out.push({ menu: menuId, ...row });
    for (const button of menuButtons(menuId, { ...ctx, ...extra })) out.push({ menu: `${menuId}:button`, ...button });
  }
  return out;
}

export {
  CATEGORY_EMOJIS,
  LOCAL_COMMANDS,
  commandsByCategory,
  localCommand,
  ITEMS,
  MENUS,
  legacyButtons,
  listSections,
  menuButtons,
  menuFixtures,
  menuRows,
  menuSections,
  pluginNameOf,
  quickReplies,
  resolveItem,
  visibleCategories,
};

export default { MENUS, ITEMS, menuSections, menuRows, menuButtons, listSections, quickReplies, legacyButtons, menuFixtures, visibleCategories };
