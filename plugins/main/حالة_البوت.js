import os from "os";
import te from "../../src/lib/terboo-error.js";
import { getUserLanguage, t, formatNumber, formatTime } from "../../src/lib/terboo-localization.js";
import * as brand from "../../src/lib/terboo-brand.js";

const pluginConfig = {
  name: "حالة_البوت",
  alias: [],
  category: "main",
  description: "عرض إحصائيات البوت",
  usage: ".حالة_البوت",
  example: ".حالة_البوت",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 0,
  isEnabled: true,
};

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}ي`);
  if (hours > 0) parts.push(`${hours}س`);
  if (minutes > 0) parts.push(`${minutes}د`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}ث`);

  return parts.join(" ");
}

async function handler(m, { sock, db, uptime, config: botConfig }) {
  try {
    const lang = getUserLanguage(db.getUser(m.sender));
    const users = db.db?.data?.users || {};
    const groups = db.db?.data?.groups || {};
    const memUsed = process.memoryUsage();
    const cpuUsage = os.loadavg()[0].toFixed(2);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    const totalUsers = Object.keys(users).length;
    const totalGroups = Object.keys(groups).length;
    const premiumUsers = Object.values(users).filter((u) => u.premium).length;

    const statsObj = {
      bot: brand.botName(),
      version: `v${brand.botVersion()}`,
      uptime: formatUptime(uptime),
      database: {
        users: totalUsers,
        premium: premiumUsers,
        groups: totalGroups,
      },
      system: {
        platform: `${os.platform()} ${os.arch()}`,
        node: process.version,
        cpuLoad: `${cpuUsage}%`,
        ram: `${formatBytes(usedMem)} / ${formatBytes(totalMem)}`,
        heap: `${formatBytes(memUsed.heapUsed)} / ${formatBytes(memUsed.heapTotal)}`,
      },
      updated: formatTime(new Date(), lang),
    };

    const table = [
      `📊 ${t(lang, "status.title")}`,
      `${t(lang, "status.columnKey")} | ${t(lang, "status.columnValue")}`,
      `${t(lang, "menu.fieldBot")} | ${statsObj.bot};;${t(lang, "menu.fieldVersion")} | ${statsObj.version};;${t(lang, "status.uptime")} | ${statsObj.uptime}`,
      `${t(lang, "status.users")} | ${formatNumber(statsObj.database.users, lang)};;${t(lang, "common.premium")} | ${formatNumber(statsObj.database.premium, lang)};;${t(lang, "status.groups")} | ${formatNumber(statsObj.database.groups, lang)}`,
      `${t(lang, "status.mode")} | ${statsObj.system.platform};;Node | ${statsObj.system.node};;CPU | ${statsObj.system.cpuLoad}`,
      `${t(lang, "status.memory")} | ${statsObj.system.ram};;Heap | ${statsObj.system.heap};;${t(lang, "menu.fieldTime")} | ${statsObj.updated}`,
    ];

    await sock.sendTableV2(m.chat, table, m, {
      title: `📊 ${t(lang, "status.title")}`,
      footer: brand.botName(),
    });
  } catch (error) {
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };