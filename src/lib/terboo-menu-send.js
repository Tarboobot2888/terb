// ═══════════════════════════════════════════════
// 📤 إرسال القوائم التفاعلية من السجل — عبر طبقة التسليم الموحّدة (§28–§31)
// ───────────────────────────────────────────────
// الصفوف والأزرار تأتي دائماً من سجل القوائم (terboo-menus.js)، والتسليم الفعلي
// (الهدف المحلول، الاقتباس، الطبقات، سجل كل مرحلة، البديل عند رفض الخادم)
// يمر حصراً عبر terboo-menu-delivery.js.
// ═══════════════════════════════════════════════

import * as UI from "./terboo-ui-theme.js";
import { t } from "./terboo-localization.js";
import { listSections, menuButtons, menuRows, quickReplies, legacyButtons } from "./terboo-menus.js";
import { deliverMenu } from "./terboo-menu-delivery.js";

/** نص احتياطي: كل صف كسطر أمر بنفس نظام التصميم */
function textFallback(menuId, ctx) {
  const lang = ctx.lang || "ar";
  return menuRows(menuId, ctx)
    .map((row) => UI.command(row.expectedCommand, row.display, { lang, prefix: ctx.prefix || "." }))
    .join("\n");
}

/**
 * يرسل قائمة من السجل مع نص البطاقة.
 * @param {Object} sock
 * @param {Object} m
 * @param {{menuId:string, ctx:Object, text:string, footer?:string, image?:{key:string, buffer:Buffer},
 *          extraButtons?:Array, floating?:{thumbnail?:Buffer, name?:string, address?:string, buttonText?:string}, mentions?:string[], media?:{type:string, buffer:Buffer}}} options
 *   floating ⇒ «الأزرار العائمة» الكلاسيكية تحت الرسالة أولاً (والبقية بدائل تلقائية)
 * @returns {Promise<"floating"|"native"|"native-image"|"buttons"|"text">} الطبقة التي أُرسلت أولاً
 */
async function sendMenu(sock, m, { menuId, ctx, text, footer = "", image = null, extraButtons = [], floating = null, mentions = [], media = null }) {
  const lang = ctx.lang || "ar";
  const buttons = extraButtons;
  const fallback = textFallback(menuId, ctx);
  const row = await deliverMenu(sock, m, {
    menuId,
    text,
    footer,
    title: t(lang, "menu.openList"),
    sections: listSections(menuId, ctx),
    quickReplies: quickReplies(menuId, ctx),
    extraButtons: buttons,
    legacyButtons: legacyButtons(menuId, ctx),
    fallbackText: fallback,
    image,
    floating,
    mentions,
    media,
  });
  return row.stage;
}

export { menuButtons, sendMenu, textFallback };
export default { sendMenu, textFallback };
