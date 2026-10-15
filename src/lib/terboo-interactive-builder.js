// ═══════════════════════════════════════════════
// 🧱 Terboo Interactive Builder — بنّاء واحد لكل الأزرار والقوائم والبطاقات (§9 §10)
// ───────────────────────────────────────────────
// دوال نقية تُنتج محتوى رسائل WAProto عادياً (بلا .fromObject/.create في البلوقنات):
//   button.quickReply · button.select · button.url · button.copy · button.call
//   nativeFlow({text, footer, header, buttons}) · carousel({cards}) · header.image/location
//   legacyToNativeFlow(buttonsMessage|listMessage|templateMessage) ⇒ Native Flow
//
// التحويل من القديم يحافظ على معرّفات الأزرار حرفياً، فيمر الضغط على المحلّل نفسه
// (terboo-interactive.js) ويصل لنفس الأمر — بلا تعديل أي بلوقن.
// كل حمولة تمر على validateMessage (تحويل + ترميز + فك حقيقي) قبل النقل.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { proto } from "@whiskeysockets/baileys";
import { innerOf, validateMessage } from "./terboo-wa-capabilities.js";

const json = (value) => (typeof value === "string" ? value : JSON.stringify(value ?? {}));

// ═══════════════════════════════════════════════
// الأزرار
// ═══════════════════════════════════════════════

const button = {
  /** زر رد سريع: الضغط يرسل id كما هو */
  quickReply: (id, displayText) => ({ name: "quick_reply", buttonParamsJson: json({ display_text: String(displayText || id), id: String(id) }) }),
  /** قائمة منسدلة: sections = [{title, rows:[{id, title, description?, header?}]}] */
  select: (title, sections) => ({
    name: "single_select",
    buttonParamsJson: json({
      title: String(title || ""),
      sections: (sections || []).map((section) => ({
        title: String(section.title || ""),
        ...(section.highlight_label ? { highlight_label: section.highlight_label } : {}),
        rows: (section.rows || []).map((row) => ({
          id: String(row.id ?? row.rowId ?? ""),
          title: String(row.title || row.id || ""),
          ...(row.description ? { description: String(row.description) } : {}),
          ...(row.header ? { header: String(row.header) } : {}),
        })),
      })),
    }),
  }),
  url: (displayText, url) => ({ name: "cta_url", buttonParamsJson: json({ display_text: String(displayText), url: String(url), merchant_url: String(url) }) }),
  copy: (displayText, code) => ({ name: "cta_copy", buttonParamsJson: json({ display_text: String(displayText), id: `copy_${String(code).slice(0, 480)}`, copy_code: String(code) }) }),
  call: (displayText, phoneNumber) => ({ name: "cta_call", buttonParamsJson: json({ display_text: String(displayText), phone_number: String(phoneNumber) }) }),
};

// ═══════════════════════════════════════════════
// الرؤوس
// ═══════════════════════════════════════════════

const header = {
  none: (title = "") => ({ title: String(title || ""), hasMediaAttachment: false }),
  /** imageMessage مرفوعة مسبقاً (prepareWAMessageMedia) */
  image: (imageMessage, title = "") => ({ title: String(title || ""), hasMediaAttachment: true, imageMessage }),
  video: (videoMessage, title = "") => ({ title: String(title || ""), hasMediaAttachment: true, videoMessage }),
  document: (documentMessage, title = "") => ({ title: String(title || ""), hasMediaAttachment: true, documentMessage }),
  /** بطاقة موقع بصورة مصغّرة (شكل «بطاقة البوت» فوق الأزرار) */
  location: ({ thumbnail = null, name = "", address = "" } = {}, title = "") => ({
    title: String(title || ""),
    hasMediaAttachment: true,
    locationMessage: { degreesLatitude: 0, degreesLongitude: 0, name: String(name || ""), address: String(address || ""), ...(thumbnail ? { jpegThumbnail: thumbnail } : {}) },
  }),
};

// ═══════════════════════════════════════════════
// الرسائل
// ═══════════════════════════════════════════════

const secretContext = () => ({ deviceListMetadata: {}, deviceListMetadataVersion: 2, messageSecret: crypto.randomBytes(32) });

/** يلفّ interactiveMessage بغلاف viewOnce الذي يعرضه واتساب للرسائل التفاعلية */
function wrap(interactiveMessage) {
  return { viewOnceMessage: { message: { messageContextInfo: secretContext(), interactiveMessage } } };
}

/**
 * رسالة Native Flow.
 * @param {{text:string, footer?:string, header?:Object, buttons:Array, contextInfo?:Object, layout?:"vertical"|""}} spec
 */
function nativeFlow({ text, footer = "", header: head = null, buttons = [], contextInfo = null, layout = "vertical" }) {
  return wrap({
    ...(head ? { header: head } : {}),
    body: { text: String(text || "") },
    footer: { text: String(footer || "") },
    nativeFlowMessage: {
      ...(layout ? { messageParamsJson: json({ settings: { button_layout: layout } }) } : {}),
      buttons,
    },
    ...(contextInfo ? { contextInfo } : {}),
  });
}

/**
 * بطاقات Carousel. كل بطاقة تحمل وسيطها المرفوع مسبقاً.
 * @param {{text?:string, footer?:string, cards:Array<{title?:string, body?:string, footer?:string, imageMessage?:Object, videoMessage?:Object, buttons?:Array}>, contextInfo?:Object}} spec
 */
function carousel({ text = "", footer = "", cards = [], contextInfo = null }) {
  return wrap({
    body: { text: String(text || "") },
    footer: { text: String(footer || "") },
    header: { title: "", hasMediaAttachment: false },
    carouselMessage: {
      messageVersion: 1,
      cards: cards.map((card) => ({
        header: card.imageMessage ? header.image(card.imageMessage, card.title) : card.videoMessage ? header.video(card.videoMessage, card.title) : header.none(card.title),
        body: { text: String(card.body || "") },
        footer: { text: String(card.footer || "") },
        nativeFlowMessage: { buttons: card.buttons || [] },
      })),
    },
    ...(contextInfo ? { contextInfo } : {}),
  });
}

// ═══════════════════════════════════════════════
// التحويل من الأشكال القديمة (حتمي، بلا انتظار رفض)
// ═══════════════════════════════════════════════

/** رأس buttonsMessage القديم ⇒ رأس InteractiveMessage */
function legacyHeader(bm) {
  if (bm.imageMessage) return header.image(bm.imageMessage, bm.title || "");
  if (bm.videoMessage) return header.video(bm.videoMessage, bm.title || "");
  if (bm.documentMessage) return header.document(bm.documentMessage, bm.title || "");
  if (bm.locationMessage) return { title: bm.title || "", hasMediaAttachment: true, locationMessage: bm.locationMessage };
  if (bm.text) return header.none(bm.text);
  return null;
}

function legacyButtonsToNative(bm) {
  const buttons = [];
  for (const b of bm.buttons || []) {
    if (b.nativeFlowInfo?.name) {
      buttons.push({ name: b.nativeFlowInfo.name, buttonParamsJson: b.nativeFlowInfo.paramsJson || "{}" });
    } else if (b.buttonId) {
      buttons.push(button.quickReply(b.buttonId, b.buttonText?.displayText || b.buttonId));
    }
  }
  return nativeFlow({ text: bm.contentText || "", footer: bm.footerText || "", header: legacyHeader(bm), buttons, contextInfo: bm.contextInfo || null });
}

function legacyListToNative(lm) {
  const sections = (lm.sections || []).map((section) => ({
    title: section.title || "",
    rows: (section.rows || []).map((row) => ({ id: row.rowId, title: row.title, description: row.description })),
  }));
  const text = [lm.title, lm.description].filter(Boolean).join("\n\n");
  return nativeFlow({ text, footer: lm.footerText || "", buttons: [button.select(lm.buttonText || lm.title || "", sections)], contextInfo: lm.contextInfo || null });
}

function legacyTemplateToNative(tm) {
  const hydrated = tm.hydratedTemplate || tm.hydratedFourRowTemplate || tm.fourRowTemplate || {};
  const buttons = [];
  for (const b of hydrated.hydratedButtons || []) {
    if (b.quickReplyButton) buttons.push(button.quickReply(b.quickReplyButton.id, b.quickReplyButton.displayText));
    else if (b.urlButton) buttons.push(button.url(b.urlButton.displayText, b.urlButton.url));
    else if (b.callButton) buttons.push(button.call(b.callButton.displayText, b.callButton.phoneNumber));
  }
  return nativeFlow({ text: hydrated.hydratedContentText || "", footer: hydrated.hydratedFooterText || "", buttons, contextInfo: tm.contextInfo || hydrated.contextInfo || null });
}

/**
 * يحوّل رسالة تفاعلية قديمة إلى Native Flow بنفس المعرّفات، أو null إن لم تكن قديمة.
 * يحافظ على messageContextInfo الأصلي إن وُجد.
 */
function legacyToNativeFlow(message) {
  const inner = innerOf(message);
  let converted = null;
  if (inner.buttonsMessage) converted = legacyButtonsToNative(inner.buttonsMessage);
  else if (inner.listMessage) converted = legacyListToNative(inner.listMessage);
  else if (inner.templateMessage) converted = legacyTemplateToNative(inner.templateMessage);
  if (!converted) return null;
  if (inner.messageContextInfo) converted.viewOnceMessage.message.messageContextInfo = { ...secretContext(), ...inner.messageContextInfo };
  return converted;
}

/** نوع الرسالة القديمة داخل الأغلفة، أو null */
function legacyKind(message) {
  const inner = innerOf(message);
  if (inner.buttonsMessage) return "buttonsMessage";
  if (inner.listMessage) return "listMessage";
  if (inner.templateMessage) return "templateMessage";
  return null;
}

/**
 * محوّل WAProto واحد للمشروع (§4): التحويل الكامل حين يوفّره الـruntime (fromObject في rc14)،
 * وإلا create. البلوقنات لا تستدعي أياً منهما مباشرة.
 * @param {string} typePath مثل "Message.InteractiveMessage"
 */
function protoMessage(typePath, value) {
  let type = proto;
  for (const part of String(typePath).split(".")) type = type?.[part];
  if (typeof type !== "function") throw new Error(`proto type غير موجود: ${typePath}`);
  return typeof type.fromObject === "function" ? type.fromObject(value) : type.create(value);
}

/** حمولة جاهزة + تحقق: {content, check} */
function build(content) {
  return { content, check: validateMessage(content) };
}

export { button, build, carousel, header, legacyKind, legacyToNativeFlow, nativeFlow, protoMessage, validateMessage, wrap };
export default { button, header, nativeFlow, carousel, legacyToNativeFlow, legacyKind, protoMessage, build };
