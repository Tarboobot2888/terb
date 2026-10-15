// ═══════════════════════════════════════════════
// 📐 مقاسات بطاقة الترحيب/الوداع — مصدر واحد للوحة المولّدة (tools/terboo-brand-assets.mjs)
// وللرسم وقت الإرسال (src/lib/terboo-welcome-card.js) فتقع الصورة داخل إطارها تماماً.
// ═══════════════════════════════════════════════

export const MEMBER_CARD = Object.freeze({
  width: 1280,
  height: 720,
  avatar: Object.freeze({ cx: 226, cy: 352, r: 118 }),
  text: Object.freeze({ x: 412, maxWidth: 372 }),
});

export default MEMBER_CARD;
