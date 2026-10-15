// ═══════════════════════════════════════════════
// 🎴 Terboo UI Kit — بطاقات هادئة بصورة وأزرار عبر مسار التسليم الموحّد
// ───────────────────────────────────────────────
// كل شاشة جديدة (اللغة · التسجيل · نمط الاستخدام · اللوحات · VPS · الباقات) تُرسل من هنا:
//   نص البطاقة (terboo-ui-theme) + صورة رأس اختيارية + أزرار حقيقية
//   ← deliverMenu (native-image ← native ← نص) بلا مسار إرسال ثانٍ.
// الأزرار ليست زينة: كل زر يحمل معرّفاً يُنفَّذ (أمر أو معرّف تدفق)، والنص الاحتياطي
// يشرح البديل المكتوب لكل زر حين لا يدعم الجهاز الأزرار.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { getAssetBuffer, sectionImage } from "./terboo-asset-manager.js";
import { button } from "./terboo-interactive-builder.js";
import { noteFailure } from "./terboo-failure-log.js";
import { deliverMenu } from "./terboo-menu-delivery.js";
import { rememberCard, retireCard } from "./terboo-flow.js";
import * as UI from "./terboo-ui-theme.js";

const UI_DIR = path.join("assets", "image", "ui");
const uiCache = new Map();

/** صورة واجهة من assets/image/ui/<name>.jpg (مخزنة مؤقتاً حسب وقت التعديل) */
function uiImage(name) {
  const safe = String(name || "").replace(/[^\w-]/g, "");
  if (!safe) return null;
  const file = path.resolve(process.cwd(), UI_DIR, `${safe}.jpg`);
  // صورة غير موجودة ⇒ البديل التالي (قسم/أصل) — حالة طبيعية لا خطأ
  if (!fs.existsSync(file)) return null;
  try {
    const stat = fs.statSync(file);
    const cached = uiCache.get(file);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.buffer;
    const buffer = fs.readFileSync(file);
    uiCache.set(file, { buffer, mtimeMs: stat.mtimeMs });
    return buffer;
  } catch (error) {
    noteFailure("ui-kit", error, { where: "terboo-ui-kit:uiImage", stage: safe, fallback: "next-image" });
    return null;
  }
}

/** صورة الرأس: {key, buffer} مباشرة · صورة واجهة (ui) · قسم (sections) · مفتاح أصل */
function resolveImage(image) {
  if (!image) return null;
  if (image.buffer) return { key: image.key || "card", buffer: image.buffer };
  const name = String(image);
  const ui = uiImage(name);
  if (ui) return { key: ["ui-image", name].join("-"), buffer: ui };
  const section = sectionImage(name);
  if (section?.buffer && section.name === name) return { key: ["ui-card", name].join("-"), buffer: section.buffer };
  const asset = getAssetBuffer(name);
  if (asset) return { key: ["ui-asset", name].join("-"), buffer: asset };
  return section?.buffer ? { key: ["ui-card", section.name].join("-"), buffer: section.buffer } : null;
}

/** سطر احتياطي لكل زر (حين يصل النص فقط) */
function typedFallback(buttons, lang) {
  return buttons
    .filter((b) => b.typed || /^[.!#/]/.test(String(b.id)))
    .map((b) => UI.bullet(`${b.text}: ${UI.isolate(b.typed || b.id)}`, lang))
    .join("\n");
}

/**
 * يرسل بطاقة.
 * @param {Object} sock
 * @param {Object} m
 * @param {{cardId:string, lang?:string, text?:string, title?:string, icon?:string, subtitle?:string,
 *          blocks?:Array, footer?:string, image?:string|{key:string, buffer:Buffer},
 *          buttons?:Array<{id:string, text:string, typed?:string}>, links?:Array<{text:string, url:string}>,
 *          copies?:Array<{text:string, code:string}>, select?:{title:string, sections:Array},
 *          thumbnail?:{buffer:Buffer, name?:string, address?:string},
 *          media?:{type:"video"|"document", buffer:Buffer, gifPlayback?:boolean, mimetype?:string, fileName?:string, title?:string},
 *          mentions?:string[], to?:string, flow?:string, user?:string}} card
 *   flow ⇒ البطاقة تحل محل آخر بطاقة لنفس التدفق (تُحذف القديمة بعد وصول الجديدة)
 * @returns {Promise<{stage:string, key:Object|null}>}
 */
async function sendCard(sock, m, card) {
  const lang = card.lang || "ar";
  const text = card.text || UI.card({ title: card.title, icon: card.icon, subtitle: card.subtitle, blocks: card.blocks || [], lang });
  const buttons = card.buttons || [];
  const extra = [
    ...buttons.map((b) => button.quickReply(b.id, b.text)),
    ...(card.links || []).map((l) => button.url(l.text, l.url)),
    ...(card.copies || []).map((c) => button.copy(c.text, c.code)),
  ];
  // البديل النصي يحمل كل اختيار قابل للكتابة: الأزرار، صفوف القائمة، والروابط (لا خيار يضيع إن رُفضت الأزرار)
  const rows = (card.select?.sections || []).flatMap((section) => section.rows || []).map((row) => ({ id: row.id ?? row.rowId, text: row.title || row.id }));
  const fallback = [typedFallback([...buttons, ...rows], lang), ...(card.links || []).map((l) => UI.bullet(`${l.text}: ${l.url}`, lang))].filter(Boolean).join("\n");
  // to ⇒ تسليم لدردشة أخرى (خاص المستلم مثلاً) بلا اقتباس رسالة من دردشة مختلفة
  const route = card.to ? { chat: card.to, sender: card.to, isGroup: /@g\.us$/.test(card.to), fromMe: false } : m;
  const row = await deliverMenu(sock, route, {
    menuId: card.cardId,
    text,
    footer: card.footer || "",
    title: card.select?.title || "",
    sections: card.select?.sections || [],
    extraButtons: extra,
    fallbackText: fallback,
    image: resolveImage(card.image),
    // وسيط رأس غير الصورة: {type:"video"|"document", buffer, gifPlayback?, mimetype?, fileName?, title?}
    media: card.media?.buffer ? card.media : null,
    mentions: card.mentions || [],
    // بطاقة موقع بصورة مصغّرة (شكل «بطاقة النتيجة» القديم) — تُستعمل فقط إن لم تكن هناك صورة رأس
    floating: card.thumbnail?.buffer && !card.image ? { thumbnail: card.thumbnail.buffer, name: card.thumbnail.name || "", address: card.thumbnail.address || "" } : null,
  });
  const key = row?.messageId ? { remoteJid: row.target || m.chat, id: row.messageId, fromMe: true } : null;
  if (card.flow && !card.to) {
    const user = card.user || m.sender;
    await retireCard(sock, user, m.chat, card.flow);
    if (key) rememberCard(user, m.chat, card.flow, key);
  }
  return { stage: row?.stage || "text", key };
}

/**
 * بطاقات نتائج بصور (Carousel) — نية فقط، والبناء والتسليم والبديل في طبقة التسليم الموحّدة.
 * @param {{cardId:string, lang?:string, text?:string, footer?:string,
 *          cards:Array<{image?:{key?:string, buffer:Buffer}, media?:{type:"image"|"video", buffer?:Buffer, url?:string}, title?:string, body?:string, footer?:string,
 *          buttons?:Array<{id:string, text:string}>, links?:Array<{text:string, url:string}>, copies?:Array<{text:string, code:string}>}>}} spec
 * البديل: Native Flow بصورة البطاقة الأولى وأزرارها، ثم نص يسرد كل البطاقات وروابطها.
 */
async function sendCarousel(sock, m, spec) {
  const lang = spec.lang || "ar";
  const cards = (spec.cards || []).slice(0, 10).map((card) => ({
    image: card.image?.buffer ? card.image : null,
    media: card.media?.buffer || card.media?.url ? card.media : null,
    title: card.title || "",
    body: card.body || "",
    footer: card.footer || "",
    buttons: [
      ...(card.buttons || []).map((b) => button.quickReply(b.id, b.text)),
      ...(card.links || []).map((l) => button.url(l.text, l.url)),
      ...(card.copies || []).map((c) => button.copy(c.text, c.code)),
    ],
    links: card.links || [],
    typed: card.buttons || [],
  }));
  if (!cards.length) return { stage: "none", key: null };
  const first = cards[0];
  const fallback = cards.map((card, i) => [
    `${i + 1}. ${card.title}`.trim(),
    card.body,
    ...card.links.map((l) => UI.bullet(`${l.text}: ${l.url}`, lang)),
    typedFallback(card.typed, lang),
  ].filter(Boolean).join("\n")).join("\n\n");
  const row = await deliverMenu(sock, m, {
    menuId: spec.cardId,
    text: spec.text || "",
    footer: spec.footer || "",
    carousel: { cards },
    extraButtons: first.buttons,
    // نتائج متغيرة ⇒ بلا تخزين مؤقت للرأس (كل بحث صورته)
    media: first.media || (first.image ? { type: "image", buffer: first.image.buffer } : null),
    fallbackText: fallback,
  });
  return { stage: row?.stage || "text", key: row?.messageId ? { remoteJid: row.target || m.chat, id: row.messageId, fromMe: true } : null };
}

/** رسالة نصية قصيرة (طلب مدخل مثلاً) تُستبدل ضمن نفس التدفق */
async function sendPrompt(sock, m, { text, flow = null, user = null }) {
  const sent = await sock.sendMessage(m.chat, { text }, {});
  const key = sent?.key ? { ...sent.key, fromMe: true } : null;
  if (flow) {
    await retireCard(sock, user || m.sender, m.chat, `${flow}:prompt`);
    if (key) rememberCard(user || m.sender, m.chat, `${flow}:prompt`, key);
  }
  return key;
}

export { resolveImage, sendCard, sendCarousel, sendPrompt, typedFallback, uiImage };
export default { sendCard, sendCarousel, sendPrompt, resolveImage };
