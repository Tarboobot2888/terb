import { getDatabase } from "../../src/lib/terboo-database.js";
import config from "../../config.js";
import { getUserLanguage, t } from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";

const pluginConfig = {
  name: "unreg",
  alias: ["unregister"],
  category: "user",
  description: "حذف بيانات تسجيلك من البوت",
  usage: ".unreg",
  example: ".unreg",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 30,
  energi: 0,
  isEnabled: true,
};

async function handler(m, { sock }) {
  const db = getDatabase();
  const user = db.getUser(m.sender);
  const lang = getUserLanguage(user);

  if (!user?.isRegistered) {
    return m.reply(
      UI.errorCard(
        t(lang, "registration.notRegistered"),
        t(lang, "registration.startAgain", { command: UI.isolate(`${m.prefix}daftar`) }),
        { footer: UI.footer(brand.botName(), brand.developerName(), lang), lang },
      ),
    );
  }

  const saluranId = config.saluran?.id || "120363418715609508@newsletter";
  const saluranName = config.saluran?.name || config.bot?.name || "Bot Terboo";
  const unregisteredAt = new Date().toISOString();

  db.setUser(m.sender, {
    isRegistered: false,
    regName: null,
    regAge: null,
    regGender: null,
    unregisteredAt,
  });

  await db.save();

  await sock.sendMessage(
    m.chat,
    {
      text: UI.successCard(
        t(lang, "registration.unregisterTitle"),
        [
          t(lang, "registration.unregisterBody"),
          t(lang, "registration.startAgain", { command: UI.isolate(`${m.prefix}daftar`) }),
        ].join("\n"),
        { footer: UI.footer(brand.botName(), brand.developerName(), lang), lang },
      ),
      contextInfo: {
        forwardingScore: 9999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: saluranId,
          newsletterName: saluranName,
          serverMessageId: 127,
        },
      },
    },
    { quoted: m },
  );

  m.react("✅");
}

export { pluginConfig as config, handler };