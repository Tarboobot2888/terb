// ═══════════════════════════════════════════════
// 🧩 TERBOO ARCADE — Hybrid للألعاب القديمة ذات المنطق الخاص (دنجن · نينجا · ماينكرافت)
// ───────────────────────────────────────────────
// المنطق والتحقق والحفظ تبقى في البلوقن كما هي؛ هنا فقط تُعرض الاختيارات كأزرار/قائمة
// معرّفها = نفس النص المكتوب الذي يقبله answerHandler/الأمر (رقم الموقع · «هجوم» · «.mct mine»).
// فشل التسليم التفاعلي ⇒ نفس الرسالة النصية القديمة (لا اختيار يضيع).
// ═══════════════════════════════════════════════

import { noteFailure } from "../terboo-failure-log.js";
import { deliverVisual } from "../terboo-visual-response.js";

/**
 * @param {{cardId:string, text:string, rows?:Array<{id:string,title:string,description?:string}>, buttons?:Array<{id:string,text:string}>, sectionTitle?:string, listTitle?:string}} spec
 */
async function choiceCard(sock, m, spec) {
  try {
    const select = spec.rows?.length ? { title: spec.listTitle || "🎯", sections: [{ title: spec.sectionTitle || spec.listTitle || "🎯", rows: spec.rows.slice(0, 10) }] } : null;
    const sent = await deliverVisual(sock, m, { mode: "hybrid", cardId: spec.cardId, text: spec.text, actions: (spec.buttons || []).slice(0, 3), select });
    if (sent?.key || sent?.stage) return sent;
  } catch (error) {
    noteFailure("arcade-hybrid", error, { where: "terboo-arcade/hybrid:choiceCard", stage: spec.cardId, fallback: "text" });
  }
  return m.reply(spec.text);
}

export { choiceCard };
