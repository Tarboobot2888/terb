import { clearRegistrationSession } from "./daftar.js";
import { getDatabase } from "../../src/lib/terboo-database.js";
import { getUserLanguage, t } from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";

const pluginConfig = {
  name: "الغاء_التسجيل",
  alias: ["bataldaftar", "cancelregister", "darsedebaja"],
  category: "user",
  description: "إلغاء جلسة التسجيل النشطة",
  usage: ".الغاء_التسجيل",
  example: ".الغاء_التسجيل",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 3,
  energi: 0,
  isEnabled: true,
  skipRegistration: true,
};

async function handler(m) {
  const lang = getUserLanguage(getDatabase().getUser(m.sender));
  const canceled = clearRegistrationSession(m.sender);

  if (!canceled) {
    return m.reply(t(lang, "registration.noActiveSession"));
  }

  return m.reply(
    UI.successCard(
      t(lang, "registration.sessionCancelled"),
      t(lang, "registration.startAgain", { command: UI.isolate(`${m.prefix}daftar`) }),
      { footer: UI.footer(brand.botName(), brand.developerName(), lang), lang },
    ),
  );
}

export { pluginConfig as config, handler };
