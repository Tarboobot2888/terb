// ═══════════════════════════════════════════════
// 🌐 تغيير لغة الواجهة - Bot Terboo
// يعيد استخدام نفس بطاقة اختيار اللغة الخاصة بمسار الانضمام،
// ولا ينشئ أي نظام جلسات أو قاعدة بيانات جديدة.
// ═══════════════════════════════════════════════

import { getDatabase } from "../../src/lib/terboo-database.js";
import { sendLanguageSelector } from "../../src/lib/terboo-onboarding.js";
import {
  getUserLanguage,
  normalizeLanguage,
  isSupportedLanguage,
  t,
} from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";
import * as brand from "../../src/lib/terboo-brand.js";

const pluginConfig = {
  name: "لغة",
  alias: ["language", "lang", "idioma"],
  category: "user",
  description: "تغيير لغة واجهة البوت (العربية / English / Español)",
  usage: ".لغة",
  example: ".لغة",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
  skipRegistration: true,
};

async function handler(m, { sock }) {
  const db = getDatabase();
  const user = db.getUser(m.sender);
  const lang = getUserLanguage(user);
  const requested = String(m.args?.[0] || "").trim();

  // اختيار مباشر بالأمر: .لغة en
  if (requested) {
    const target = normalizeLanguage(requested, null);
    if (!target || !isSupportedLanguage(target)) {
      return m.reply(
        UI.errorCard(t(lang, "language.cardTitle"), t(lang, "language.invalid"), {
          footer: UI.footer(brand.botName(), brand.developerName(), lang),
          lang,
        }),
      );
    }
    db.setUser(m.sender, { language: target });
    return m.reply(
      UI.successCard(t(target, "language.cardTitle"), t(target, "language.changed"), {
        footer: UI.footer(brand.botName(), brand.developerName(), target),
        lang: target,
      }),
    );
  }

  // بدون وسيط: نعرض نفس البطاقة التفاعلية المستخدمة في الانضمام
  await sendLanguageSelector(sock, m, { language: lang, existingUser: true });
}

export { pluginConfig as config, handler };
