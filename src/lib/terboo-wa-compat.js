// ═══════════════════════════════════════════════
// 🔌 Terboo WhatsApp Compatibility — فوق @whiskeysockets/baileys@7.0.0-rc14 الرسمي
// ───────────────────────────────────────────────
// المكتبة السابقة (fork غير رسمي) كانت تضيف واجهات لا يملكها Baileys الرسمي، والمشروع
// يعتمد عليها في ~70 موضعاً. هنا تُعاد بنفس التواقيع، مبنية فقط على:
//   • دوال التصدير الرسمية (generateWAMessageFromContent · prepareWAMessageMedia ·
//     generateWAMessage · newsletterMetadata · relayMessage({ additionalNodes })).
//   • حقول WAProto المُتحقَّق منها في rc14 (interactiveMessage · albumMessage +
//     messageAssociation · requestPaymentMessage · eventMessage · extendedTextMessage
//     بحقول معاينة الرابط · richResponseMessage).
//
// ما يغطيه:
//   relayMessage : عقدة biz للرسائل التفاعلية (أزرار/قوائم/Native Flow) — واتساب لا يعرضها
//                  بدونها، والرسمي لا يضيفها تلقائياً بل يقبلها عبر additionalNodes.
//   القناة      : كل رسالة للمستخدمين تظهر «معاد توجيهها» من قناة البوت (config.saluran.forwardAll)
//                  — نص · وسائط · قوائم · أزرار · ردود الذكاء — بلا مساس بالأزرار.
//   sendMessage  : الأشكال الموسّعة: interactiveButtons · interactiveMessage (مختصر أو
//                  بروتو) · carousel · albumMessage[] · productMessage · requestPaymentMessage
//                  · eventMessage · stickerPack (غير مدعوم رسمياً ⇒ الملصقات فردياً).
//   طرق إضافية   : sendPreview · sendCodeBlock(V2) · sendTable(V2) · sendList · sendLinkV2
//                  · sendLatex · cekIDSaluran · newsletterMsg — الغنية منها عبر
//                  Rich Response Engine بلا انتحال Meta AI.
// كل مسار يُسجَّل؛ لا catch صامت.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import {
  generateMessageIDV2,
  generateWAMessage,
  generateWAMessageFromContent,
  isJidNewsletter,
  isJidStatusBroadcast,
  normalizeMessageContent,
  prepareWAMessageMedia,
  proto,
} from "@whiskeysockets/baileys";
import config from "../../config.js";
import { channelContext } from "./terboo-brand.js";
import { sendRich } from "./terboo-code-renderer.js";
import { detectLanguage } from "./terboo-rich-response.js";
import { redactSecrets } from "./terboo-secrets.js";

const log = (scope, error) => console.warn(`[WACompat] ${scope}: ${String(error?.message || error).slice(0, 200)}`);

/** نص لا معنى له للمستخدم: كائن حُوِّل نصاً أو قيمة فارغة («[object Object]» · «undefined») */
const JUNK_TEXT = /^[\s\u2060-\u2064]*(?:\[object \w+\]|undefined|null)[\s\u2060-\u2064]*$/;

/**
 * الحارس الأخير قبل واتساب: text/caption يجب أن تكون نصاً حقيقياً **وبلا أسرار**.
 * كائن ⇒ يُستخرج نصه ({text|answer|content|message}) · نص فارغ المعنى ⇒ لا يُرسل (يُسجَّل بدل إرسال «[object Object]»).
 *
 * الإخفاء هنا بـ`generic: false` عن قصد: يُخفي الأسرار المسجّلة وتوكنات اللوحات
 * وحدها، ولا يطبّق الأنماط العامة (`password: "..."`) حتى لا تُشوَّه أمثلة الكود
 * التي يرسلها البوت. هذه آخر نقطة قبل الشبكة، فما يفلت منها يصل للمستخدم.
 * @returns {Object|null} المحتوى المصحَّح، أو null إن لم يبقَ ما يُرسل
 */
function guardContentText(content) {
  if (!content || typeof content !== "object") return content;
  let out = content;
  for (const key of ["text", "caption"]) {
    let value = out[key];
    if (value === undefined || value === null || typeof value === "string") {
      if (typeof value === "string" && JUNK_TEXT.test(value)) {
        log("text-guard", new Error(["blocked_junk", key, value.trim().slice(0, 30)].join(":")));
        if (key === "text") return null;
        out = { ...out, caption: "" };
      }
      continue;
    }
    // كائن/رقم بدل نص: استخراج النص الحقيقي إن وُجد
    const inner = typeof value === "object" ? [value.text, value.answer, value.content, value.message, value.reply].find((v) => typeof v === "string" && v.trim()) : String(value);
    log("text-guard", new Error(["coerced_non_string", key, typeof value].join(":")));
    if (!inner || JUNK_TEXT.test(inner)) {
      if (key === "text") return null;
      out = { ...out, caption: "" };
    } else out = { ...out, [key]: inner };
  }
  // الإخفاء بعد التصحيح: النص المستخرَج من كائن يمر به أيضاً
  for (const key of ["text", "caption"]) {
    const value = out[key];
    if (typeof value !== "string" || !value) continue;
    const safe = redactSecrets(value, { generic: false });
    if (safe !== value) {
      log("text-guard", new Error(`redacted_secret:${key}`));
      out = { ...out, [key]: safe };
    }
  }
  return out;
}

// ═══════════════════════════════════════════════
// عقدة biz للرسائل التفاعلية
// ═══════════════════════════════════════════════

/** نوع الرسالة التفاعلية (أو null) داخل أغلفة viewOnce/ephemeral */
function interactiveTypeOf(message) {
  const msg = normalizeMessageContent(message) || message;
  if (!msg) return null;
  if (msg.listMessage) return "list";
  if (msg.buttonsMessage || msg.templateMessage) return "buttons";
  const inner = msg.viewOnceMessage?.message || msg.viewOnceMessageV2?.message || msg;
  if (inner?.interactiveMessage?.nativeFlowMessage || inner?.interactiveMessage?.carouselMessage) return "interactive";
  return null;
}

/** عقد biz التي تعلن الرسالة تفاعلية (Native Flow) للخادم وجهاز المستلم */
function bizNodes(type) {
  const base = { actual_actors: "2", host_storage: "2", privacy_mode_ts: `${Math.floor(Date.now() / 1000) - 77980457}` };
  const engagement = { tag: "engagement", attrs: { customer_service_state: "open", conversation_state: "open" } };
  if (type === "interactive" || type === "buttons" || type === "list") {
    return [{
      tag: "biz",
      attrs: base,
      content: [engagement, {
        tag: "interactive",
        attrs: { type: "native_flow", v: "1" },
        content: [{ tag: "native_flow", attrs: { v: "9", name: "mixed" }, content: [] }],
      }],
    }];
  }
  return [{ tag: "biz", attrs: base, content: [engagement] }];
}

// ═══════════════════════════════════════════════
// بناة الأشكال الموسّعة
// ═══════════════════════════════════════════════

const secretContext = () => ({ deviceListMetadata: {}, deviceListMetadataVersion: 2, messageSecret: crypto.randomBytes(32) });
const mediaSource = (value, key) => (value && typeof value === "object" && !Buffer.isBuffer(value) && value.url ? { [key]: { url: value.url } } : { [key]: value });

async function headerMedia(sock, { image, video, document, mimetype, fileName, jpegThumbnail, thumbnail }) {
  const upload = sock.waUploadToServer;
  if (image || thumbnail) return prepareWAMessageMedia(mediaSource(image || { url: thumbnail }, "image"), { upload });
  if (video) return prepareWAMessageMedia(mediaSource(video, "video"), { upload });
  if (document) {
    const media = await prepareWAMessageMedia({ ...mediaSource(document, "document"), ...(mimetype ? { mimetype } : {}) }, { upload });
    if (fileName) media.documentMessage.fileName = fileName;
    if (jpegThumbnail) media.documentMessage.jpegThumbnail = typeof jpegThumbnail === "string" ? Buffer.from(jpegThumbnail, "base64") : jpegThumbnail;
    return media;
  }
  return null;
}

function contextOf(content) {
  const context = { ...(content.contextInfo || {}) };
  if (content.mentions?.length) context.mentionedJid = content.mentions;
  return Object.keys(context).length ? context : undefined;
}

/** { text, footer, title, image…, interactiveButtons:[{name, buttonParamsJson}] } ⇒ interactiveMessage */
async function buildInteractiveButtons(sock, content) {
  const media = await headerMedia(sock, content);
  const location = content.location ? {
    locationMessage: {
      degreesLatitude: content.location.degreesLatitude ?? content.location.degressLatitude ?? 0,
      degreesLongitude: content.location.degreesLongitude ?? content.location.degressLongitude ?? 0,
      name: content.location.name || "",
    },
  } : null;
  const header = media || location;
  const interactiveMessage = {
    body: { text: content.text || content.caption || "" },
    footer: { text: content.footer || "" },
    header: {
      title: content.title || "",
      subtitle: content.subtitle || "",
      hasMediaAttachment: typeof content.hasMediaAttachment === "boolean" ? content.hasMediaAttachment : Boolean(header),
      ...(header || {}),
    },
    nativeFlowMessage: {
      buttons: content.interactiveButtons.map((button) => ({
        name: button.name,
        buttonParamsJson: typeof button.buttonParamsJson === "string" ? button.buttonParamsJson : JSON.stringify(button.buttonParamsJson || {}),
      })),
    },
    ...(contextOf(content) ? { contextInfo: contextOf(content) } : {}),
  };
  return { viewOnceMessage: { message: { messageContextInfo: secretContext(), interactiveMessage } } };
}

/** interactiveMessage بالشكل المختصر (title/buttons/image…) أو شكل البروتو (body/nativeFlowMessage) */
async function buildInteractiveMessage(sock, content) {
  const im = content.interactiveMessage;
  if (im.carouselMessage) return buildCarousel(sock, im);
  if (im.body || im.header?.hasMediaAttachment !== undefined && !im.title) {
    return { viewOnceMessage: { message: { messageContextInfo: secretContext(), interactiveMessage: im } } };
  }
  const media = await headerMedia(sock, im);
  const interactiveMessage = {
    body: { text: im.title || im.text || "" },
    footer: { text: im.footer || "" },
    header: { title: im.header || "", hasMediaAttachment: Boolean(media), ...(media || {}) },
    ...((im.buttons?.length || im.nativeFlowMessage) ? { nativeFlowMessage: { ...(im.nativeFlowMessage || {}), ...(im.buttons?.length ? { buttons: im.buttons } : {}) } } : {}),
  };
  const context = { ...(im.contextInfo || {}), ...(im.externalAdReply ? { externalAdReply: im.externalAdReply } : {}) };
  if (Object.keys(context).length) interactiveMessage.contextInfo = context;
  return { viewOnceMessage: { message: { messageContextInfo: secretContext(), interactiveMessage } } };
}

async function buildCarousel(sock, im) {
  const cards = [];
  for (const card of im.carouselMessage.cards || []) {
    const next = { body: card.body || { text: "" }, footer: card.footer || { text: "" }, header: { title: card.header?.title || "", hasMediaAttachment: false } };
    if (card.nativeFlowMessage) next.nativeFlowMessage = card.nativeFlowMessage;
    const source = card.header?.imageMessage ? ["image", card.header.imageMessage] : card.header?.videoMessage ? ["video", card.header.videoMessage] : null;
    if (source) {
      const [kind, value] = source;
      const url = value.url || value;
      const media = await prepareWAMessageMedia(typeof url === "string" ? { [kind]: { url } } : { [kind]: url }, { upload: sock.waUploadToServer });
      next.header = { title: card.header?.title || "", hasMediaAttachment: true, ...media };
    }
    cards.push(next);
  }
  const interactiveMessage = {
    body: im.body || { text: "" },
    footer: im.footer || { text: "" },
    header: im.header || { title: "", hasMediaAttachment: false },
    carouselMessage: { cards, messageVersion: im.carouselMessage.messageVersion || 1 },
    ...(im.contextInfo ? { contextInfo: im.contextInfo } : {}),
  };
  return { viewOnceMessage: { message: { messageContextInfo: secretContext(), interactiveMessage } } };
}

function buildPayment(content) {
  const data = content.requestPaymentMessage;
  const note = data.note ? { extendedTextMessage: { text: data.note } } : data.sticker?.stickerMessage ? { stickerMessage: data.sticker.stickerMessage } : undefined;
  return {
    requestPaymentMessage: {
      expiryTimestamp: data.expiry || 0,
      amount1000: data.amount || 0,
      currencyCodeIso4217: data.currency || "EGP",
      requestFrom: data.from || "0@s.whatsapp.net",
      ...(note ? { noteMessage: note } : {}),
      ...(data.background ? { background: data.background } : {}),
    },
  };
}

function buildEvent(content) {
  const data = content.eventMessage;
  const time = (value, fallback) => (typeof value === "string" ? Number.parseInt(value, 10) : value) || fallback;
  return {
    messageContextInfo: secretContext(),
    eventMessage: {
      isCanceled: Boolean(data.isCanceled),
      name: data.name,
      description: data.description || "",
      location: data.location || { degreesLatitude: 0, degreesLongitude: 0, name: data.locationName || "" },
      joinLink: data.joinLink || "",
      startTime: time(data.startTime, Math.floor(Date.now() / 1000)),
      endTime: time(data.endTime, Math.floor(Date.now() / 1000) + 3600),
      extraGuestsAllowed: data.extraGuestsAllowed !== false,
    },
  };
}

async function buildProduct(sock, content) {
  const data = content.productMessage;
  let productImage;
  if (data.thumbnail) {
    const media = await prepareWAMessageMedia(Buffer.isBuffer(data.thumbnail) ? { image: data.thumbnail } : { image: { url: data.thumbnail.url || data.thumbnail } }, { upload: sock.waUploadToServer });
    productImage = media.imageMessage;
  }
  return {
    viewOnceMessage: {
      message: {
        interactiveMessage: {
          body: { text: data.body || "" },
          footer: { text: data.footer || "" },
          header: {
            title: data.title || "",
            hasMediaAttachment: Boolean(productImage),
            productMessage: {
              product: {
                productImage, productId: data.productId, title: data.title, description: data.description,
                currencyCode: data.currencyCode || "EGP", priceAmount1000: data.priceAmount1000 ?? null,
                retailerId: data.retailerId, url: data.url, productImageCount: productImage ? 1 : 0,
              },
              businessOwnerJid: data.businessOwnerJid || "0@s.whatsapp.net",
            },
          },
          nativeFlowMessage: { buttons: data.buttons || [] },
        },
      },
    },
  };
}

// ═══════════════════════════════════════════════
// الإرسال
// ═══════════════════════════════════════════════

async function relayBuilt(sock, jid, content, options, extra = {}) {
  const msg = generateWAMessageFromContent(jid, content, {
    userJid: sock.user?.jid || sock.user?.id,
    ...(options?.quoted ? { quoted: options.quoted } : {}),
  });
  await sock.relayMessage(jid, msg.message, { messageId: msg.key.id, ...extra });
  return msg;
}

/** ألبوم رسمي: رسالة albumMessage ثم كل وسيط مرتبط بها (MEDIA_ALBUM) */
async function sendAlbum(sock, jid, items, options = {}, contextInfo = null) {
  const list = (items || []).filter(Boolean);
  const header = generateWAMessageFromContent(jid, {
    messageContextInfo: { messageSecret: crypto.randomBytes(32) },
    albumMessage: {
      expectedImageCount: list.filter((item) => "image" in item).length,
      expectedVideoCount: list.filter((item) => "video" in item).length,
    },
  }, { userJid: sock.user?.jid || sock.user?.id, ...(options.quoted ? { quoted: options.quoted } : {}) });
  await sock.relayMessage(jid, header.message, { messageId: header.key.id });
  for (const raw of list) {
    const item = contextInfo && !raw.contextInfo ? { ...raw, contextInfo } : raw;
    const child = await generateWAMessage(jid, item, { upload: sock.waUploadToServer, userJid: sock.user?.jid || sock.user?.id });
    child.message.messageContextInfo = {
      messageSecret: crypto.randomBytes(32),
      messageAssociation: { associationType: proto.MessageAssociation.AssociationType.MEDIA_ALBUM, parentMessageKey: header.key },
    };
    await sock.relayMessage(jid, child.message, { messageId: child.key.id });
  }
  return header;
}

/** حزمة ملصقات: غير مدعومة في Baileys الرسمي (لا نوع وسائط sticker-pack) ⇒ الملصقات فردياً */
async function sendStickerPackFallback(send, jid, pack, options) {
  const sent = [];
  for (const sticker of pack.stickers || []) {
    const data = sticker.data || sticker.sticker;
    const buffer = Buffer.isBuffer(data) ? data : data?.url ? { url: data.url } : data;
    if (!buffer) continue;
    sent.push(await send(jid, { sticker: buffer }, options));
  }
  return sent[0];
}

/**
 * يترجم محتوى sendMessage بشكل موسّع إلى رسالة رسمية، أو null إن كان محتوى عادياً.
 * @returns {Promise<Object|null>}
 */
async function translateContent(sock, send, jid, content, options) {
  if (!content || typeof content !== "object") return null;
  if (Array.isArray(content.interactiveButtons) && content.interactiveButtons.length) return relayBuilt(sock, jid, await buildInteractiveButtons(sock, content), options);
  if (content.interactiveMessage && typeof content.interactiveMessage === "object") return relayBuilt(sock, jid, await buildInteractiveMessage(sock, content), options);
  if (Array.isArray(content.albumMessage) || Array.isArray(content.album)) return sendAlbum(sock, jid, content.albumMessage || content.album, options, content.contextInfo || null);
  if (content.productMessage) return relayBuilt(sock, jid, await buildProduct(sock, content), options);
  if (content.requestPaymentMessage) return relayBuilt(sock, jid, buildPayment(content), options);
  if (content.eventMessage) return relayBuilt(sock, jid, buildEvent(content), options, { additionalNodes: [{ tag: "meta", attrs: { event_type: "creation" } }] });
  if (content.stickerPack) return sendStickerPackFallback(send, jid, content.stickerPack, options);
  return null;
}

// ═══════════════════════════════════════════════
// الطرق الإضافية بنفس تواقيع المكتبة السابقة
// ═══════════════════════════════════════════════

function tableRowsFromV2(table) {
  const [title, headerLine, ...rest] = table;
  const split = (value) => (typeof value !== "string" ? [] : value.includes("|") ? value.split("|") : value.split(",")).map((cell) => cell.trim());
  const header = split(headerLine);
  const rows = rest.flatMap((value) => String(value).split(";;").map(split));
  const width = Math.max(header.length, ...rows.map((row) => row.length));
  const pad = (row) => [...row, ...Array(Math.max(0, width - row.length)).fill("")];
  return { title, rows: [{ items: pad(header), isHeading: true }, ...rows.map((row) => ({ items: pad(row) }))] };
}

function extraMethods(sock, send, langOf) {
  const rich = (jid, parts, quoted, label) => sendRich(sock, jid, parts, { quoted, lang: langOf(jid, quoted), label });
  const text = (value) => (value ? [{ type: "text", text: String(value) }] : []);
  return {
    async sendPreview(jid, preview = {}, options = {}) {
      const ext = {
        text: preview.caption || preview.text || "",
        matchedText: preview.matchedText || preview.url || "",
        previewType: preview.previewType ?? 0,
        ...(preview.title ? { title: preview.title } : {}),
        ...(preview.description ? { description: preview.description } : {}),
      };
      let image = preview.image;
      if (typeof image === "string" && /^https?:/.test(image)) {
        try {
          const response = await fetch(image);
          image = Buffer.from(await response.arrayBuffer());
        } catch (error) {
          log("sendPreview.image", error);
          image = null;
        }
      }
      if (Buffer.isBuffer(image)) {
        try {
          const { imageMessage } = await prepareWAMessageMedia({ image }, { upload: sock.waUploadToServer, mediaTypeOverride: "thumbnail-link" });
          Object.assign(ext, {
            jpegThumbnail: imageMessage.jpegThumbnail, thumbnailDirectPath: imageMessage.directPath, mediaKey: imageMessage.mediaKey,
            mediaKeyTimestamp: imageMessage.mediaKeyTimestamp, thumbnailSha256: imageMessage.fileSha256, thumbnailEncSha256: imageMessage.fileEncSha256,
            thumbnailWidth: imageMessage.width, thumbnailHeight: imageMessage.height,
          });
        } catch (error) {
          log("sendPreview.upload", error);
          ext.jpegThumbnail = image;
        }
      } else if (preview.jpegThumbnail) ext.jpegThumbnail = preview.jpegThumbnail;
      const quoted = options.quoted;
      if (quoted?.key) {
        ext.contextInfo = { stanzaId: quoted.key.id, participant: quoted.key.fromMe ? sock.user?.id : quoted.key.participant || quoted.key.remoteJid, quotedMessage: quoted.message };
      }
      if (options.contextInfo) ext.contextInfo = { ...(ext.contextInfo || {}), ...options.contextInfo };
      const messageId = generateMessageIDV2(sock.user?.id);
      await sock.relayMessage(jid, { extendedTextMessage: ext }, { messageId });
      return messageId;
    },
    async sendCodeBlock(jid, code, quoted, options = {}) {
      const language = detectLanguage(code, { language: options.language, fileName: options.fileName }).language;
      const image = options.image || options.imageUrl || null;
      const imagePart = image ? [{ type: "media", kind: "image", source: image, imageText: options.imageText, tapLinkUrl: options.tapLinkUrl, sourceUrl: options.sourceUrl }] : [];
      return rich(jid, [...imagePart, ...text(options.title), ...text(options.text), { type: "code", code: String(code ?? ""), language }, ...text(options.footer)], quoted, "code");
    },
    async sendCodeBlockV2(jid, code, quoted, options = {}) {
      return this.sendCodeBlock(jid, code, quoted, options);
    },
    async sendTable(jid, title, headers, rows, quoted, options = {}) {
      const table = { type: "table", title, rows: [{ items: headers.map(String), isHeading: true }, ...rows.map((row) => ({ items: row.map(String) }))] };
      return rich(jid, [...text(options.headerText), table, ...text(options.footer)], quoted, "table");
    },
    async sendTableV2(jid, table, quoted, options = {}) {
      const parsed = tableRowsFromV2(table);
      return rich(jid, [...text(options.headerText || options.title), ...text(options.text), { type: "table", ...parsed }, ...text(options.footer)], quoted, "table");
    },
    async sendList(jid, title, items, quoted, options = {}) {
      const rows = (items || []).map((item) => ({ items: Array.isArray(item) ? item.map(String) : [String(item)] }));
      return rich(jid, [...text(options.headerText), { type: "table", title, rows }, ...text(options.footer)], quoted, "list");
    },
    async sendLinkV2(jid, value, links = [], quoted, options = {}) {
      const lines = links.map((link) => `> ◈ ${link.displayName || link.sourceDisplayName || link.url}: ${link.url}`);
      return rich(jid, [...text(value), ...text(lines.join("\n")), ...text(options.footer)], quoted, "links");
    },
    async sendLatex(jid, formulaOrQuoted, quotedOrOptions = {}) {
      // التوقيعان: (jid, quoted, {text, expressions}) للمكتبة السابقة، و(jid, formula, quoted) كما يستدعيه Auto AI
      const formula = typeof formulaOrQuoted === "string" ? formulaOrQuoted : null;
      const quoted = formula ? quotedOrOptions : formulaOrQuoted;
      const options = formula ? { text: formula, expressions: [{ latexExpression: formula }] } : quotedOrOptions || {};
      return rich(jid, [...text(options.headerText), { type: "latex", text: options.text || "", expressions: options.expressions || [] }, ...text(options.footer)], quoted, "latex");
    },
    async cekIDSaluran(linkOrCode) {
      const code = String(linkOrCode || "").match(/channel\/([A-Za-z0-9_-]+)/)?.[1] || String(linkOrCode || "").trim();
      return sock.newsletterMetadata("invite", code);
    },
    async newsletterMsg(jid) {
      return sock.newsletterMetadata(String(jid).endsWith("@newsletter") ? "jid" : "invite", String(jid));
    },
  };
}

// ═══════════════════════════════════════════════
// 📢 «معاد توجيهها من القناة» لكل رسائل البوت
// ═══════════════════════════════════════════════

/** محتوى sendMessage لا يحمل سياقاً معروضاً (تفاعل · حذف · تعديل · تثبيت · تصويت · بروتوكول) */
const CHANNEL_SKIP_CONTENT = ["react", "delete", "edit", "pin", "keep", "poll", "forward", "disappearingMessagesInChat", "eventMessage", "requestPaymentMessage", "buttonReply", "listReply", "sharePhoneNumber", "requestPhoneNumber", "limitSharing"];
/** عُقد الرسائل التي يُعرض فوقها «معاد توجيهها» (التفاعلية منها: الأزرار تبقى كما هي) */
const CHANNEL_NODES = ["interactiveMessage", "extendedTextMessage", "imageMessage", "videoMessage", "audioMessage", "documentMessage", "stickerMessage", "contactMessage", "contactsArrayMessage", "locationMessage", "buttonsMessage", "listMessage", "templateMessage", "productMessage", "groupInviteMessage"];
const CHANNEL_WRAPPERS = ["viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension", "ephemeralMessage", "documentWithCaptionMessage"];

/** مفعّل لهذا الهدف؟ (لا للقنوات نفسها ولا للحالة) */
function channelForwardOn(jid) {
  const target = String(jid || "");
  if (!target || config.saluran?.forwardAll === false) return false;
  if (!String(config.saluran?.id || "").endsWith("@newsletter")) return false;
  return !isJidNewsletter(target) && !isJidStatusBroadcast(target);
}

/** يضيف سياق القناة دون حذف ما في السياق (إشارات · اقتباس · إعلان خارجي) */
function channelFields(contextInfo) {
  const channel = channelContext();
  return {
    isForwarded: true,
    forwardingScore: contextInfo?.forwardingScore || channel.forwardingScore,
    forwardedNewsletterMessageInfo: channel.forwardedNewsletterMessageInfo,
  };
}

/** محتوى sendMessage ⇒ نسخة تحمل سياق القناة (الأصل لا يُعدَّل) */
function withChannelContent(jid, content) {
  if (!content || typeof content !== "object" || !channelForwardOn(jid)) return content;
  if (CHANNEL_SKIP_CONTENT.some((key) => key in content)) return content;
  if (content.contextInfo?.forwardedNewsletterMessageInfo) return content;
  return { ...content, contextInfo: { ...(content.contextInfo || {}), ...channelFields(content.contextInfo) } };
}

/** رسالة relayMessage (WAProto) ⇒ سياق القناة على عقدتها الظاهرة؛ الألبوم والرد الغني وما لا يُعرض يبقى كما هو */
function withChannelMessage(jid, message) {
  if (!message || typeof message !== "object" || !channelForwardOn(jid)) return message;
  let node = message;
  for (let depth = 0; depth < 3; depth += 1) {
    if (node.albumMessage || node.messageContextInfo?.messageAssociation) return message;
    const wrapper = CHANNEL_WRAPPERS.find((key) => node[key]?.message);
    if (!wrapper) break;
    node = node[wrapper].message;
  }
  if (node.albumMessage || node.messageContextInfo?.messageAssociation) return message;
  if (typeof node.conversation === "string" && node.conversation && Object.keys(node).every((key) => ["conversation", "messageContextInfo"].includes(key))) {
    node.extendedTextMessage = { text: node.conversation };
    delete node.conversation;
  }
  const type = CHANNEL_NODES.find((key) => node[key] && typeof node[key] === "object");
  if (!type) return message;
  const holder = node[type];
  if (holder.contextInfo?.forwardedNewsletterMessageInfo) return message;
  holder.contextInfo = Object.assign(holder.contextInfo && typeof holder.contextInfo === "object" ? holder.contextInfo : {}, channelFields(holder.contextInfo));
  return message;
}

/**
 * يثبّت طبقة التوافق على مقبس Baileys الرسمي (مرة واحدة، قبل أي غلاف آخر).
 * @param {Object} sock
 * @param {{langOf?:(jid:string, quoted?:Object)=>string}} [deps]
 */
function installWhatsAppCompat(sock, { langOf = () => "ar" } = {}) {
  if (!sock || sock.__terbooCompat) return sock;
  const relay = sock.relayMessage.bind(sock);
  sock.relayMessage = async (jid, message, options = {}) => {
    try { message = withChannelMessage(jid, message); } catch (error) { log("channel-relay", error); }
    const type = interactiveTypeOf(message);
    const nodes = options.additionalNodes || [];
    if (type && !isJidNewsletter(jid) && !isJidStatusBroadcast(jid) && !nodes.some((node) => node?.tag === "biz")) {
      return relay(jid, message, { ...options, additionalNodes: [...nodes, ...bizNodes(type)] });
    }
    return relay(jid, message, options);
  };
  const send = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options = {}) => {
    const guarded = guardContentText(content);
    if (guarded === null) return null;
    content = withChannelContent(jid, guarded);
    let translated;
    try {
      translated = await translateContent(sock, send, jid, content, options);
    } catch (error) {
      log(`sendMessage(${Object.keys(content || {}).join(",")})`, error);
      throw error;
    }
    return translated ?? send(jid, content, options);
  };
  const methods = extraMethods(sock, send, langOf);
  for (const [name, fn] of Object.entries(methods)) {
    if (typeof sock[name] !== "function") sock[name] = fn.bind(methods);
  }
  sock.__terbooCompat = true;
  return sock;
}

/** getBuffer كان يُستورد من المكتبة السابقة في أدوات المالك */
async function getBuffer(url, options = {}) {
  const response = await fetch(url, options);
  return Buffer.from(await response.arrayBuffer());
}

export { bizNodes, channelForwardOn, getBuffer, guardContentText, installWhatsAppCompat, interactiveTypeOf, sendAlbum, tableRowsFromV2, translateContent, withChannelContent, withChannelMessage };
export default { installWhatsAppCompat, interactiveTypeOf, bizNodes, getBuffer };
