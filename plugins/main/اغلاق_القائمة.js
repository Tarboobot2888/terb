// ═══════════════════════════════════════════════
// ✖️ إغلاق القائمة — زر «إغلاق» في كل قوائم Bot Terboo
// ───────────────────────────────────────────────
// ضغطة «إغلاق» يجب أن تنتج نتيجة واضحة (§19): تأكيد هادئ بلغة المستخدم
// مع طريقة فتح القائمة من جديد. لا تغيّر أي إعداد ولا تحفظ شيئاً.
// ═══════════════════════════════════════════════

import { getDatabase } from "../../src/lib/terboo-database.js";
import { getUserLanguage, t } from "../../src/lib/terboo-localization.js";
import * as UI from "../../src/lib/terboo-ui-theme.js";

const pluginConfig = {
  name: "اغلاق_القائمة",
  // مرادفات لا تتعارض مع «اقفل الجروب / close the group / cierra el grupo» (أمر شات)
  alias: ["menuclose", "closemenu", "cerrarmenu", "اغلاق_المنيو"],
  category: "main",
  description: "إغلاق القائمة الحالية",
  usage: ".اغلاق_القائمة",
  example: ".اغلاق_القائمة",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 2,
  energi: 0,
  isEnabled: true,
  skipRegistration: true,
};

async function handler(m) {
  const lang = getUserLanguage(getDatabase()?.getUser?.(m.sender));
  const prefix = m.prefix || ".";
  await m.react?.("✖️")?.catch?.(() => { });
  return m.reply([
    t(lang, "menu.closed"),
    UI.quote(t(lang, "menu.reopenHint", { command: UI.code(`${prefix}menu`) }), lang),
  ].join("\n"));
}

export { pluginConfig as config, handler };
