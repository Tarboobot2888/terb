// ═══════════════════════════════════════════════
// 📁 plugins/main/owner.js
// 👑 عرض معلومات المطور - Bot Terboo
// ═══════════════════════════════════════════════

import crypto from "crypto";
import config, { getOwnerName } from "../../config.js";
import { getDatabase } from "../../src/lib/terboo-database.js";
import {
  proto,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
} from "@whiskeysockets/baileys";
import { AIRich } from "../../src/lib/terboo-builder.js";
import { getUserLanguage, t } from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";
import axios from "axios";
import sharp from "sharp";

const pluginConfig = {
  name: "owner",
  alias: ["creator", "dev", "developer", "مطور", "المطور", "صاحب"],
  category: "main",
  description: "عرض معلومات مطور البوت",
  usage: ".مطور",
  example: ".مطور",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 0,
  isEnabled: true,
};

async function handler(m, { sock, config: botConfig }) {
  const db = getDatabase();
  const lang = getUserLanguage(db.getUser(m.sender));
  const ownerType = db.setting("ownerType") || 1;
  const configOwners = botConfig.owner?.number || [];
  const dbOwners = db.data.owner || [];
  const ownerNumbers = [...new Set([...configOwners, ...dbOwners])];
  const botName = brand.botName();

  if (ownerType === 2) {
    const contacts = [];

    for (const number of ownerNumbers) {
      const cleanNumber = number.replace(/[^0-9]/g, "");
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${getOwnerName(number)}\nTEL;type=CELL;type=VOICE;waid=${cleanNumber}:+${cleanNumber}\nEND:VCARD`;
      contacts.push({ vcard });
    }

    const sent = await sock.sendMessage(
      m.chat,
      {
        contacts: {
          displayName: `👑 ${t(lang, "developerCard.contactLabel")}`,
          contacts,
        },
      },
      { quoted: m.raw },
    );

    await sock.sendMessage(m.chat, {
      text: t(lang, "developerCard.contactNote")
    }, { quoted: sent });

  } else {
    const ownerText = UI.card({
      title: t(lang, "developerCard.title"),
      icon: "👑",
      blocks: [
        [
          UI.row(`👤 ${t(lang, "developerCard.name")}`, ownerNumbers.map((n) => getOwnerName(n)).join(", "), lang),
          UI.row(`🤖 ${t(lang, "developerCard.bot")}`, botName, lang),
          UI.row(`📊 ${t(lang, "developerCard.status")}`, `🟢 ${t(lang, "common.online")}`, lang),
          UI.row(`📢 ${t(lang, "developerCard.channel")}`, UI.isolate(brand.channelUrl()), lang),
        ].join("\n"),
        `_${t(lang, "developerCard.contactHint")}_`,
      ],
      footer: UI.footer(botName, brand.developerName(), lang),
      lang,
    });

    await m.reply(ownerText);

    for (const number of ownerNumbers) {
      const cleanNumber = number.replace(/[^0-9]/g, "");
      const vcard = `BEGIN:VCARD\nVERSION:3.0\nFN:${getOwnerName(number)} (${t(lang, "developerCard.contactLabel")} — ${botName})\nTEL;type=CELL;type=VOICE;waid=${cleanNumber}:+${cleanNumber}\nEND:VCARD`;

      await sock.sendMessage(
        m.chat,
        {
          contacts: {
            displayName: getOwnerName(number),
            contacts: [{ vcard }],
          },
        },
        { quoted: m.raw },
      );
    }
  }
}

export { pluginConfig as config, handler };