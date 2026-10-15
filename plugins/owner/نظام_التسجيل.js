// نظام التسجيل - إحصائيات التسجيل الاختياري (V6: لا تسجيل إجباري)

import { getDatabase } from "../../src/lib/terboo-database.js";
import config from "../../config.js";

function getRegistrationContextInfo() {
  const saluranId = config.saluran?.id || "120363418715609508@newsletter";
  const saluranName = config.saluran?.name || config.bot?.name || "Bot Terboo";

  return {
    forwardingScore: 9999,
    isForwarded: true,
    forwardedNewsletterMessageInfo: {
      newsletterJid: saluranId,
      newsletterName: saluranName,
      serverMessageId: 127,
    },
  };
}

function toDateKey(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getRegistrationStats(db) {
  const users = Object.values(db.getAllUsers() || {});
  const todayKey = toDateKey(new Date());

  return {
    totalRegistered: users.filter((user) => user?.isRegistered).length,
    registeredToday: users.filter(
      (user) =>
        toDateKey(user?.lastRegisteredAt || user?.registeredAt) === todayKey,
    ).length,
    unregisteredToday: users.filter(
      (user) => toDateKey(user?.unregisteredAt) === todayKey,
    ).length,
    activeSessions: Object.keys(global.registrationSessions || {}).length,
  };
}

const pluginConfig = {
  name: "نظام_التسجيل",
  alias: ["sistemdaftar"],
  category: "owner",
  description: "إحصائيات التسجيل الاختياري (الملف الشخصي)",
  usage: ".نظام_التسجيل [إحصائيات]",
  example: ".نظام_التسجيل إحصائيات",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

async function handler(m, { sock }) {
  const db = getDatabase();
  const args = m.text?.trim() || "";
  const normalizedArgs = args.toLowerCase();

  const stats = getRegistrationStats(db);

  // عرض الحالة
  if (!normalizedArgs) {
    return m.reply(
      `⚙️ *نظام التسجيل*\n\n` +
        `الحالة: 🟢 اختياري — لا يُمنع أحد\n\n` +
        `*الإحصائيات:*\n` +
        `> إجمالي المسجلين: *${stats.totalRegistered}*\n` +
        `> المسجلين اليوم: *${stats.registeredToday}*\n` +
        `> إلغاء التسجيل اليوم: *${stats.unregisteredToday}*\n` +
        `> الجلسات النشطة: *${stats.activeSessions}*\n\n` +
        `*طريقة الاستخدام:*\n` +
        `> ${m.prefix}نظام_التسجيل إحصائيات - عرض الإحصائيات\n\n` +
        `> التسجيل اختياري: ${m.prefix}daftar لتخصيص الملف الشخصي فقط`,
    );
  }

  // عرض الإحصائيات
  if (normalizedArgs === "stats" || normalizedArgs === "إحصائيات") {
    await sock.sendMessage(
      m.chat,
      {
        text:
          `📊 *إحصائيات التسجيل*\n\n` +
          `حالة النظام: 🟢 اختياري\n\n` +
          `❋ 📈 *الإحصائيات*\n` +
          `> ◈ إجمالي المسجلين: *${stats.totalRegistered}*\n` +
          `> ◈ المسجلين اليوم: *${stats.registeredToday}*\n` +
          `> ◈ إلغاء التسجيل اليوم: *${stats.unregisteredToday}*\n` +
          `> ◈ الجلسات النشطة: *${stats.activeSessions}*\n` +
          ``,
        contextInfo: getRegistrationContextInfo(),
      },
      { quoted: m },
    );

    await m.react("📊");
    return;
  }

  // V6: لا تسجيل إجباري — التشغيل/الإيقاف لم يعودا يمنعان أحداً، فالرد يشرح ذلك بدل نجاح وهمي
  if (["on", "1", "true", "تشغيل", "off", "0", "false", "ايقاف", "إيقاف"].includes(normalizedArgs)) {
    if (db.setting("registrationRequired") === true) {
      db.setting("registrationRequired", false);
      await db.save();
    }
    await m.reply(
      `ℹ️ *التسجيل اختياري في Bot Terboo V6*\n\n` +
        `لا يُمنع أي مستخدم من الأوامر بسبب عدم التسجيل؛ بعد اختيار اللغة يصبح البوت جاهزاً فوراً.\n` +
        `من يريد تخصيص ملفه الشخصي يكتب ${m.prefix}daftar متى شاء.\n\n` +
        `> الإحصائيات: ${m.prefix}نظام_التسجيل إحصائيات`,
    );
    return;
  }

  return m.reply(
    `❌ خيار غير صالح!\n\n> استخدم: إحصائيات`,
  );
}

export { pluginConfig as config, handler };