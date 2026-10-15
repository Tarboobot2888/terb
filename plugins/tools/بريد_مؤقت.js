import { getDatabase } from "../../src/lib/terboo-database.js";
import { TempMailCreate, TempMailInbox } from "../../src/scraper/tempmail.js";

const pluginConfig = {
  name: "بريد_مؤقت",
  alias: ["tempmail"],
  category: "tools",
  description: "إنشاء بريد إلكتروني مؤقت والتحقق من صندوق الوارد",
  usage: ".بريد_مؤقت إنشاء/وارد",
  example: ".بريد_مؤقت إنشاء",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

async function handler(m) {
  const db = getDatabase();
  const rawOption = m.text?.toLowerCase()?.trim();
  // الكلمات العربية/الإسبانية لنفس الخيارين
  const option = { إنشاء: "create", انشاء: "create", جديد: "create", crear: "create", nuevo: "create",
    وارد: "inbox", الوارد: "inbox", رسائل: "inbox", bandeja: "inbox", mensajes: "inbox" }[rawOption] || rawOption;

  if (!option) {
    const saved = db.getUser(m.sender)?.tempmail;
    return m.reply(
      `📧 *بريد مؤقت*\n\n` +
        `أنشئ بريداً إلكترونياً مؤقتاً يمكنه استقبال الرسائل - مناسب للتسجيل في المواقع دون استخدام بريدك الحقيقي.\n\n` +
        `*الاستخدام:*\n` +
        `> *${m.prefix}بريد_مؤقت إنشاء* — إنشاء بريد جديد\n` +
        `> *${m.prefix}بريد_مؤقت وارد* — التحقق من الرسائل الواردة\n\n` +
        (saved
          ? `> البريد النشط: *${saved}*\n`
          : `> ليس لديك بريد بعد، اكتب *${m.prefix}بريد_مؤقت إنشاء* أولاً\n`) +
        `\n_هذا البريد مؤقت وقد ينتهي في أي وقت_`
    );
  }

  if (option === "create") {
    m.react("🕕");
    const result = await TempMailCreate();

    if (!result.status) {
      m.react("☢");
      return m.reply(`❌ *فشل إنشاء البريد*\n\n> ${result.error}`);
    }

    const userData = db.getUser(m.sender) || {};
    userData.tempmail = result.email;
    db.setUser(m.sender, userData);

    m.react("✅");
    return m.reply(
      `📧 *تم إنشاء البريد المؤقت!*\n\n` +
        `> 📬 البريد: *${result.email}*\n\n` +
        `يمكنك الآن استخدام هذا البريد للتسجيل في أي خدمة.\n` +
        `تحقق من الرسائل الواردة باستخدام *${m.prefix}بريد_مؤقت وارد*\n\n` +
        `_هذا البريد مؤقت، لا تستخدمه للأمور المهمة_`
    );
  }

  if (option === "inbox") {
    const saved = db.getUser(m.sender)?.tempmail;
    if (!saved) {
      m.react("❌");
      return m.reply(
        `❌ *لا يوجد بريد*\n\n` +
          `لم تقم بإنشاء بريد مؤقت بعد.\n` +
          `اكتب *${m.prefix}بريد_مؤقت إنشاء* أولاً.`
      );
    }

    m.react("🕕");
    const result = await TempMailInbox(saved);

    if (!result.status) {
      m.react("☢");
      return m.reply(`❌ *فشل التحقق من صندوق الوارد*\n\n> ${result.error}`);
    }

    if (result.count === 0) {
      m.react("📭");
      return m.reply(
        `📭 *صندوق الوارد فارغ*\n\n` +
          `> البريد: *${saved}*\n\n` +
          `لا توجد رسائل واردة. حاول التحقق لاحقاً.`
      );
    }

    let txt = `📬 *صندوق الوارد — ${result.count} رسالة*\n\n`;
    txt += `> البريد: *${saved}*\n\n`;

    for (const msg of result.messages) {
      txt += `┄┄┄┄┄┄┄┄┄┄┄┄┄┄\n`;
      txt += `> 📧 من: *${msg.from}*\n`;
      txt += `> 📌 الموضوع: *${msg.subject}*\n`;
      txt += `> 🕐 ${msg.created_at}\n`;
      txt += `> 📝 ${msg.body_text?.substring(0, 500) || "(لا يوجد محتوى)"}\n\n`;
    }

    m.react("✅");
    return m.reply(txt.trim());
  }

  return m.reply(
    `❌ *خيار غير صالح*\n\n> استخدم *${m.prefix}بريد_مؤقت إنشاء* أو *${m.prefix}بريد_مؤقت وارد*`
  );
}

export { pluginConfig as config, handler };