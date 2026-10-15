import config from '../../config.js'
import * as timeHelper from './terboo-time.js'
import { t } from './terboo-localization.js'
import * as UI from './terboo-ui-theme.js'

// رموز التصميم: مأخوذة من محرّك التصميم الموحّد (terboo-ui-theme.js) — لا إطارات قديمة (§33–§36)
const CHARS = {
  cornerTopLeft: "",
  cornerTopRight: "",
  cornerBottomLeft: "",
  cornerBottomRight: "",
  horizontal: "┄",
  vertical: ">",
  arrow: UI.MARK.row,
  bullet: UI.MARK.row,
  star: "✦",
  diamond: "◇",
  dot: UI.MARK.bullet,
  check: "",
  cross: "✗",
  line: "┄",
  d: "",
  wing: "",
  wing2: "",
};

const EMOJIS = {
  dashboard: "📊",
  info: "ℹ️",
  user: "👤",
  bot: "🤖",
  owner: "👑",
  premium: "💎",
  free: "🆓",
  public: "🌐",
  self: "🔒",
  commands: "⚙️",
  utilities: "🔧",
  fun: "🎮",
  group: "👥",
  time: "⏰",
  uptime: "⏱️",
  version: "📌",
  speed: "⚡",
  limit: "📊",
  status: "📋",
  mode: "🔄",
  name: "📝",
  number: "📱",
  developer: "👨‍💻",
  total: "📈",
  tip: "💡",
  warning: "⚠️",
  success: "✅",
  error: "❌",
  loading: "⏳",
};

function formatUptime(ms, lang = "ar") {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));

  const parts = [];
  if (days > 0) parts.push(`${days} ${t(lang, "time.day")}`);
  if (hours > 0) parts.push(`${hours} ${t(lang, "time.hour")}`);
  if (minutes > 0) parts.push(`${minutes} ${t(lang, "time.minute")}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} ${t(lang, "time.second")}`);

  return parts.join(" ");
}

function formatDate(date) {
  return timeHelper.fromTimestamp(date, "DD/MM/YYYY HH:mm:ss");
}

function formatNumber(number) {
  if (!number) return "";
  const cleaned = number.replace(/[^0-9]/g, "");
  if (cleaned.length < 10) return cleaned;

  if (cleaned.startsWith("20")) {
    const withoutCode = cleaned.slice(2);
    const formatted = withoutCode.replace(/(\d{3})(\d{4})(\d+)/, "$1-$2-$3");
    return `20 ${formatted}`;
  }

  return cleaned;
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 بايت";

  const k = 1024;
  const sizes = ["بايت", "ك.ب", "م.ب", "ج.ب", "ت.ب"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function createLine(length = 20, char = CHARS.horizontal) {
  // فاصل المحرّك بطول معتدل (6–14)
  return (char || CHARS.horizontal).repeat(Math.max(6, Math.min(length, 14)));
}

function createHeader(title, width = 20) {
  return UI.section(title);
}

function createFooter(width = 20) {
  return UI.thinRule();
}

function createBodyLine(text, prefix = CHARS.vertical, bullet = CHARS.bullet) {
  return UI.quote(`${bullet} ${text}`);
}

function createArrowLine(label, value) {
  return UI.row(label, value);
}

function createDashboard(data) {
  const {
    userName = "مستخدم",
    userStatus = "مجاني",
    mode = "عام",
    totalUsers = 0,
    userLimit = 25,
  } = data;

  return [
    UI.section(`${EMOJIS.dashboard} لوحة التحكم`),
    createArrowLine("الاسم", userName),
    createArrowLine("الحالة", userStatus),
    createArrowLine("الوضع", mode),
    createArrowLine("المستخدمين", totalUsers.toString()),
    createArrowLine("الحد", userLimit.toString()),
  ].join("\n");
}

function createBotInfo(data) {
  const {
    botName = config.bot?.name || "Bot Terboo",
    developer = config.owner?.name || "Owner",
    version = config.bot?.version || "6.0",
    uptime = "0s",
    totalFeatures = 0,
    mode = config.mode || "public",
    platform = "Node.js",
  } = data;

  return [
    UI.section("معلومات البوت"),
    UI.row("اسم البوت", botName),
    UI.row("المطور", developer),
    UI.row("الوضع", mode === "public" ? "عام" : "خاص"),
    UI.row("الإصدار", version),
    UI.row("وقت التشغيل", uptime),
    UI.row("إجمالي الميزات", totalFeatures),
    UI.row("المنصة", platform),
    "",
  ].join("\n");
}

function createUserProfile(data) {
  const {
    name = "مستخدم",
    number = "",
    status = "مجاني",
    limit = 25,
    registeredAt = "",
  } = data;

  const statusEmoji =
    status === "مالك"
      ? EMOJIS.owner
      : status === "مميز"
        ? EMOJIS.premium
        : EMOJIS.free;

  return [
    UI.section("الملف الشخصي"),
    UI.row(`${EMOJIS.name} الاسم`, name),
    UI.row(`${EMOJIS.number} الرقم`, formatNumber(number)),
    UI.row(`${statusEmoji} الحالة`, status),
    UI.row(`${EMOJIS.limit} الحد`, limit),
    registeredAt ? UI.row(`${EMOJIS.time} التسجيل`, registeredAt) : null,
    "",
  ].filter((line) => line !== null).join("\n");
}

function createBotStatus(data) {
  const {
    botName = config.bot?.name || "Bot Terboo",
    uptime = "0s",
    mode = "عام",
    totalCommands = 0,
    totalUsers = 0,
    speed = "0.00s",
  } = data;

  return [
    UI.section("حالة البوت"),
    UI.row(`${EMOJIS.bot} البوت`, botName),
    UI.row(`${EMOJIS.uptime} وقت التشغيل`, uptime),
    UI.row(`${EMOJIS.mode} الوضع`, mode),
    UI.row(`${EMOJIS.commands} الأوامر`, `${totalCommands} ميزة`),
    UI.row(`${EMOJIS.user} المستخدمين`, `${totalUsers} مستخدم`),
    UI.row(`${EMOJIS.speed} السرعة`, speed),
    "",
  ].join("\n");
}

function createCategoryMenu(category, prefix = config.command?.prefix || ".") {
  const { name, emoji, description = "", commands = [] } = category;

  if (commands.length === 0) {
    return "";
  }

  return [
    UI.section(`${emoji} ${name}`),
    ...commands.map((cmd) => UI.command(cmd, "", { prefix })),
  ].join("\n");
}

function createCategorySection(data) {
  const { emoji, title, command, description, prefix = "." } = data;

  return [
    UI.section(`${emoji} ${title}`),
    UI.command(command, description, { prefix }),
    ``,
  ].join("\n");
}

function createMainMenu(data) {
  const {
    greeting = "",
    userName = "مستخدم",
    userStatus = "مجاني",
    categories = [],
    botInfo = {},
    prefix = config.command?.prefix || ".",
  } = data;

  const parts = [];

  if (greeting) {
    parts.push(greeting);
    parts.push("");
  }

  parts.push(createDashboard({ userName, userStatus, ...data }));
  parts.push("");

  parts.push(createBotInfo(botInfo));
  parts.push("");

  for (const category of categories) {
    parts.push(
      createCategorySection({
        ...category,
        prefix,
      }),
    );
  }

  parts.push(`${EMOJIS.tip} *نصيحة:* إذا كنت لا تعرف كيفية استخدام البوت`);
  parts.push(`يمكنك سؤال المطور`);
  parts.push(UI.row("الوضع", data.mode || "عام"));

  return parts.join("\n");
}

function createCommandList(categoryName, commands, prefix = ".") {
  const emoji = config.categoryEmojis?.[categoryName.toLowerCase()] || "📋";

  return [
    UI.section(`${emoji} ${categoryName.toUpperCase()}`),
    ...commands.map((cmd) => UI.command(cmd, "", { prefix })),
  ].join("\n");
}

function createWaitMessage(message = "جاري المعالجة...") {
  return `${EMOJIS.loading} *${message}*`;
}

function createSuccessMessage(message = "تم بنجاح!") {
  return `${EMOJIS.success} *${message}*`;
}

function createErrorMessage(message = "حدث خطأ!") {
  return `${EMOJIS.error} *${message}*`;
}

function createWarningMessage(message) {
  return `${EMOJIS.warning} *${message}*`;
}

function getTimeGreeting(lang = "ar") {
  const hour = timeHelper.getHour();

  if (hour >= 4 && hour < 10) return t(lang, "time.greetingMorning");
  if (hour >= 10 && hour < 15) return t(lang, "time.greetingNoon");
  if (hour >= 15 && hour < 18) return t(lang, "time.greetingEvening");
  return t(lang, "time.greetingNight");
}

function capitalize(str) {
  if (!str) return "";
  return str.replace(/\b\w/g, (char) => char.toUpperCase());
}

function truncate(text, maxLength, suffix = "...") {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength - suffix.length) + suffix;
}

/**
 * تزيين رسالة ببطاقة Bot Terboo من محرّك التصميم (بدل الإطار القديم)
 */
function decorateMessage(message) {
  return UI.card({ title: "Bot Terboo", blocks: [UI.quote(String(message ?? ""))] });
}

export { CHARS, EMOJIS, formatUptime, formatDate, formatNumber, formatFileSize, createLine, createHeader, createFooter, createBodyLine, createArrowLine, createDashboard, createBotInfo, createUserProfile, createBotStatus, createCategoryMenu, createCategorySection, createMainMenu, createCommandList, createWaitMessage, createSuccessMessage, createErrorMessage, createWarningMessage, getTimeGreeting, capitalize, truncate, decorateMessage };