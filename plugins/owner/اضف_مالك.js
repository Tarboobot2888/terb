import config, { getOwnerName } from "../../config.js";
import { getDatabase } from "../../src/lib/terboo-database.js";
import {
  addJadibotOwner,
  removeJadibotOwner,
  getJadibotOwners,
} from "../../src/lib/terboo-jadibot-database.js";
import {
  isLid,
  lidToJid,
  resolveAnyLidToJid,
  isLidConverted,
} from "../../src/lib/terboo-lid.js";

const pluginConfig = {
  name: "اضف_مالك",
  alias: ["addowner"],
  category: "owner",
  description: "إدارة مالك البوت",
  usage: ".اضف_مالك <رقم/@منشن/رد>",
  example: ".اضف_مالك 6281234567890",
  isOwner: true,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
};

function cleanJid(jid) {
  if (!jid) return null;
  if (isLid(jid)) jid = lidToJid(jid);
  return jid.includes("@") ? jid : jid + "@s.whatsapp.net";
}

function extractNumber(m) {
  let targetNumber = "";

  if (m.quoted) {
    let sender = m.quoted.sender || "";
    if (isLid(sender) || isLidConverted(sender)) {
      sender = resolveAnyLidToJid(sender, m.groupMembers || []);
    }
    targetNumber = sender?.replace(/[^0-9]/g, "") || "";
  } else if (m.mentionedJid?.length) {
    let jid = cleanJid(m.mentionedJid[0]);
    if (isLid(jid) || isLidConverted(jid)) {
      jid = resolveAnyLidToJid(jid, m.groupMembers || []);
    }
    targetNumber = jid?.replace(/[^0-9]/g, "") || "";
  } else if (m.args[0]) {
    targetNumber = m.args[0].replace(/[^0-9]/g, "");
    if (targetNumber.startsWith("08")) {
      targetNumber = "62" + targetNumber.slice(1);
    }
  }

  if (targetNumber.startsWith("0")) {
    targetNumber = "62" + targetNumber.slice(1);
  }

  if (targetNumber.length > 15) {
    return "";
  }

  return targetNumber;
}

function toMentionJid(value) {
  const number = String(value || "").replace(/[^0-9]/g, "");
  return number ? `${number}@s.whatsapp.net` : null;
}

async function handler(m, { jadibotId, isJadibot }) {
  const db = getDatabase();
  const cmd = m.command.toLowerCase();

  const isAdd = ["اضف_مالك", "addowner"].includes(cmd);
  const isDel = ["delowner", "dedown"].includes(cmd);
  const isList = ["ownerlist", "listowner"].includes(cmd);

  if (!db.data.owner) db.data.owner = [];

  if (isList) {
    if (isJadibot && jadibotId) {
      const jbOwners = getJadibotOwners(jadibotId);
      if (jbOwners.length === 0) {
        return m.reply(
          `📋 *قائمة مالك البوت الفرعي*\n\n> لا يوجد مالك مسجل بعد.\n> استخدم ${m.prefix}اضف_مالك للإضافة.`,
        );
      }
      let txt = `📋 *قائمة مالك البوت الفرعي* — ${jadibotId}\n\n`;
      const mentions = jbOwners.map(toMentionJid).filter(Boolean);
      jbOwners.forEach((s, i) => {
        const number = String(s || "").replace(/[^0-9]/g, "");
        const name = getOwnerName(number);
        txt += `${i + 1}. 👑 @${number}${name !== "Owner" ? ` — *${name}*` : ""}\n`;
      });
      txt += `\nالمجموع: *${jbOwners.length}* مالك`;
      return m.reply(txt, { mentions });
    }
    const configOwners = (config.owner?.number || []).map(String);
    const dbOwners = db.data.owner || [];
    const allOwners = [...new Set([...configOwners, ...dbOwners])];

    if (allOwners.length === 0) {
      return m.reply(`📋 *قائمة المالك*\n\n> لا يوجد مالك مسجل بعد.`);
    }
    let txt = `📋 *قائمة المالك*\n\n`;
    const mentions = allOwners.map(toMentionJid).filter(Boolean);
    allOwners.forEach((s, i) => {
      const number = String(s || "").replace(/[^0-9]/g, "");
      const isMain = configOwners.some(
        (o) => o.replace(/[^0-9]/g, "") === number,
      );
      const isDb = dbOwners.some(
        (o) => String(o).replace(/[^0-9]/g, "") === number,
      );
      const label = isMain && isDb ? "👑⭐" : isMain ? "⭐" : "👑";
      const name = getOwnerName(number);
      txt += `${i + 1}. ${label} @${number}${name !== "Owner" ? ` — *${name}*` : ""}\n`;
    });
    txt += `\nالمجموع: *${allOwners.length}* مالك | ⭐ رئيسي, 👑 مضاف`;
    return m.reply(txt, { mentions });
  }

  const targetNumber = await extractNumber(m);
  const numberFromArgs = !m.quoted && !m.mentionedJid?.length && m.args[0];
  const customName = isAdd
    ? (numberFromArgs ? m.args.slice(1) : m.args).join(" ").trim()
    : "";

  if (!targetNumber) {
    return m.reply(
      `👑 *${isAdd ? "إضافة" : "حذف"} مالك*\n\n` +
        `رد/منشن/اكتب رقم المستخدم\n` +
        `مثال: ${m.prefix}اضف_مالك 6281234567890\n` +
        `مع اسم: ${m.prefix}اضف_مالك 6281234567890 اسم_المالك`,
    );
  }

  if (targetNumber.length < 10 || targetNumber.length > 15) {
    return m.reply(`❌ *فشل*\n\n> صيغة الرقم غير صالحة`);
  }

  if (isJadibot && jadibotId) {
    if (isAdd) {
      if (addJadibotOwner(jadibotId, targetNumber)) {
        await m.react("👑");
        return m.reply(
          `✅ تمت إضافة *${targetNumber}* كمالك للبوت الفرعي بنجاح`,
        );
      }
      return m.reply(`❌ ${targetNumber} مالك لهذا البوت الفرعي بالفعل.`);
    } else if (isDel) {
      if (removeJadibotOwner(jadibotId, targetNumber)) {
        await m.react("✅");
        return m.reply(
          `✅ تم حذف *${targetNumber}* من مالك البوت الفرعي بنجاح`,
        );
      }
      return m.reply(`❌ ${targetNumber} ليس مالكاً لهذا البوت الفرعي.`);
    }
    return;
  }

  if (isAdd) {
    if (db.data.owner.includes(targetNumber)) {
      return m.reply(`❌ ${targetNumber} مالك كامل بالفعل.`);
    }

    db.data.owner.push(targetNumber);
    if (customName) {
      const nameMap = db.setting("ownerNames") || {};
      nameMap[targetNumber] = customName;
      db.setting("ownerNames", nameMap);
    }
    db.save();

    await m.react("👑");
    return m.reply(
      `✅ تمت إضافة *${targetNumber}* كمالك كامل بنجاح${customName ? ` (${customName})` : ""}`,
    );
  } else if (isDel) {
    const index = db.data.owner.indexOf(targetNumber);
    if (index === -1) {
      return m.reply(`❌ ${targetNumber} ليس مالكاً كاملاً.`);
    }

    db.data.owner.splice(index, 1);
    const nameMap = db.setting("ownerNames") || {};
    delete nameMap[targetNumber];
    db.setting("ownerNames", nameMap);
    db.save();

    await m.react("✅");
    return m.reply(`✅ تم حذف *${targetNumber}* من المالك الكامل بنجاح`);
  }
}

export { pluginConfig as config, handler };
