// ═══════════════════════════════════════════════
// 💻 Terboo Code Renderer — Native Rich Code path
// ───────────────────────────────────────────────
// كل كود يخرج من البوت يمر من هنا ويُرسل كـ richResponseMessage باستخدام
// codeMetadata.codeLanguage + codeBlocks في رسالة واحدة متى أمكن.
// لا يتم إنشاء PNG للكود ولا رسالة نسخ منفصلة.
// ═══════════════════════════════════════════════

import { buildNativeRichCodeContent, buildRichContent, detectLanguage, hasRenderableCode, imageUrlOf, parseOutput, renderFallback, richBatches, safeLanguageTag } from "./terboo-rich-response.js";
import { recordDelivery, trackDelivery } from "./terboo-menu-delivery.js";
import { presentText, recipientLanguage, translateText } from "./terboo-i18n/runtime.js";

const MODES = new Set(["rich", "text", "image"]);
const LEGACY_MODES = { auto: "rich", image: "rich" };
const NATIVE_CODE_MODE = "rich";
let installedDatabase = null;

const normalizeMode = (value) => {
  const mode = LEGACY_MODES[value] || value;
  return MODES.has(mode) ? mode : "rich";
};

function modeOf(getDatabase) {
  try {
    return normalizeMode(getDatabase?.()?.setting?.("richCode"));
  } catch (error) {
    console.warn("[CodeRenderer] قراءة إعداد richCode:", error.message);
    return NATIVE_CODE_MODE;
  }
}

async function sendFallback(sock, send, jid, parts, { quoted, lang, meta, reason }) {
  const messages = renderFallback(parts, { lang });
  const sent = [];
  for (const item of messages) {
    const content = item.document
      ? { document: item.document.buffer, fileName: item.document.fileName, mimetype: "text/plain", caption: item.document.caption }
      : { text: item.text };
    const result = await send(jid, content, { ...(quoted ? { quoted } : {}), terbooPlain: true });
    recordDelivery({
      ...meta,
      stage: item.document ? "code-file" : "code-text",
      payloadType: item.document ? "documentMessage" : "text",
      messageId: result?.key?.id || null,
      outcome: "sent",
      fallbackFrom: reason || "",
    });
    sent.push(result);
  }
  return sent[0] || null;
}

async function sendMedia(send, jid, part, { quoted, meta }) {
  const kind = ["image", "video", "document", "audio"].includes(part.kind) ? part.kind : "image";
  const source = Buffer.isBuffer(part.source) ? part.source : { url: String(part.source?.url || part.source || "") };
  const content = {
    [kind]: source,
    ...(part.caption && kind !== "audio" ? { caption: part.caption } : {}),
    ...(part.mimetype ? { mimetype: part.mimetype } : {}),
    ...(part.fileName ? { fileName: part.fileName } : {}),
  };
  const result = await send(jid, content, quoted ? { quoted } : {});
  recordDelivery({ ...meta, stage: "media", payloadType: `${kind}Message`, messageId: result?.key?.id || null, outcome: "sent" });
  return result;
}

function isInlineImagePart(part) {
  return part?.type === "media" && part?.kind === "image" && Boolean(imageUrlOf(part));
}

function segmentParts(parts) {
  const segments = [];
  for (const part of parts || []) {
    if (isInlineImagePart(part)) {
      if (segments.at(-1)?.type === "rich") segments.at(-1).parts.push(part);
      else segments.push({ type: "rich", parts: [part] });
    } else if (part?.type === "media") {
      segments.push({ type: "media", part });
    } else if (segments.at(-1)?.type === "rich") {
      segments.at(-1).parts.push(part);
    } else {
      segments.push({ type: "rich", parts: [part] });
    }
  }
  return segments;
}

function hasCodePart(parts) {
  return (parts || []).some((part) => part?.type === "code" && typeof part.code === "string");
}

function nativeMessageId(sock) {
  if (typeof sock?.generateMessageTag === "function") return sock.generateMessageTag();
  return `TBC-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function sendNativeRichCodeSegment(sock, deliver, target, parts, { quoted, lang, meta }) {
  const nativeParts = (parts || []).filter((part) => part?.type === "text" || part?.type === "code" || part?.type === "table" || part?.type === "latex" || isInlineImagePart(part));
  if (!hasCodePart(nativeParts)) return null;

  try {
    const content = buildNativeRichCodeContent(nativeParts, { quoted });
    if (!content) return null;

    const messageId = nativeMessageId(sock);
    await sock.relayMessage(target, content, {
      ...(quoted ? { quoted } : {}),
      messageId,
    });

    recordDelivery({
      ...meta,
      stage: "native-rich-code",
      payloadType: "richResponseMessage",
      messageId,
      outcome: "sent",
      languageCount: nativeParts.filter((part) => part.type === "code").length,
    });

    trackDelivery(
      sock,
      messageId,
      { ...meta, stage: "native-rich-code", payloadType: "richResponseMessage" },
      (why) => sendFallback(sock, deliver, target, nativeParts, { quoted, lang, meta, reason: why }),
    );

    return {
      key: {
        id: messageId,
        remoteJid: target,
        fromMe: true,
      },
    };
  } catch (error) {
    recordDelivery({
      ...meta,
      stage: "native-rich-code",
      payloadType: "richResponseMessage",
      messageId: null,
      outcome: "error",
      error: String(error?.message || error).slice(0, 200),
    });
    return sendFallback(sock, deliver, target, nativeParts, {
      quoted,
      lang,
      meta,
      reason: "native-rich-code:error",
    });
  }
}

async function sendRichSegment(sock, deliver, target, parts, { quoted, lang, meta, mode }) {
  if (mode === "text") {
    return sendFallback(sock, deliver, target, parts, { quoted, lang, meta, reason: "mode:text" });
  }

  // أي كود أو صورة inline URL يدخلان الرسالة الغنية الأصلية.
  if (hasCodePart(parts)) {
    return sendNativeRichCodeSegment(sock, deliver, target, parts, { quoted, lang, meta });
  }

  let first = null;
  for (const batch of richBatches(parts)) {
    let messageId = null;
    try {
      const content = buildRichContent(batch, { quoted });
      const msg = { key: { id: nativeMessageId(sock), remoteJid: target, fromMe: true }, message: content };
      messageId = msg.key.id;
      await sock.relayMessage(target, msg.message, { ...(quoted ? { quoted } : {}), messageId });
      recordDelivery({ ...meta, stage: "rich", payloadType: "richResponseMessage", messageId, outcome: "sent" });
      trackDelivery(
        sock,
        messageId,
        { ...meta, stage: "rich", payloadType: "richResponseMessage" },
        (why) => sendFallback(sock, deliver, target, batch, { quoted, lang, meta, reason: why }),
      );
      first ||= msg;
    } catch (error) {
      recordDelivery({ ...meta, stage: "rich", payloadType: "richResponseMessage", messageId, outcome: "error", error: String(error?.message || error).slice(0, 200) });
      const fallback = await sendFallback(sock, deliver, target, batch, { quoted, lang, meta, reason: "rich:error" });
      first ||= fallback;
    }
  }
  return first;
}

async function sendRich(sock, jid, parts, { quoted = null, mode: requestedMode = modeOf(installedDatabase), lang = "ar", send = null, label = "code" } = {}) {
  const mode = normalizeMode(requestedMode);
  const deliver = send || ((to, content, opts = {}) => sock.sendMessage(to, content, { ...opts, terbooPlain: true }));
  const target = jid;
  const meta = { menuId: label, target };
  let first = null;
  for (const segment of segmentParts(parts)) {
    const result = segment.type === "media"
      ? await sendMedia(deliver, target, segment.part, { quoted, meta })
      : await sendRichSegment(sock, deliver, target, segment.parts, { quoted, lang, meta, mode });
    first ||= result;
  }
  return first;
}

function localizeParts(parts, lang, ctx = {}) {
  const cell = (value) => translateText(String(value ?? ""), lang);
  return (parts || []).map((part) => {
    if (part?.type === "text") return { ...part, text: presentText(part.text, lang, "text", ctx) };
    if (part?.type === "table") {
      return { ...part, title: part.title ? cell(part.title) : part.title, rows: (part.rows || []).map((row) => ({ ...row, items: (row.items || []).map(cell) })) };
    }
    if (part?.type === "media" && part.caption) return { ...part, caption: presentText(part.caption, lang, "caption", ctx) };
    return part;
  });
}

function codePartsOf(content) {
  if (!content || typeof content !== "object") return null;
  const image = content.image || content.imageUrl || null;
  const imagePart = image ? { type: "media", kind: "image", source: image, imageText: content.imageText, tapLinkUrl: content.tapLinkUrl, sourceUrl: content.sourceUrl } : null;
  if (typeof content.code === "string") {
    const detected = detectLanguage(content.code, { language: content.language, fileName: content.fileName, context: content.context });
    const language = detected.language || safeLanguageTag(content.language) || "text";
    return [
      ...(imagePart && imageUrlOf(imagePart) ? [imagePart] : []),
      ...(content.title ? [{ type: "text", text: String(content.title) }] : []),
      ...(content.text ? [{ type: "text", text: String(content.text) }] : []),
      { type: "code", code: content.code, language, title: content.title || "", fileName: content.fileName || "" },
      ...(content.footer ? [{ type: "text", text: String(content.footer) }] : []),
    ];
  }
  const keys = Object.keys(content);
  if (typeof content.text === "string" && keys.every((key) => ["text", "mentions", "contextInfo", "linkPreview", "image", "imageUrl", "imageText", "tapLinkUrl", "sourceUrl"].includes(key)) && hasRenderableCode(content.text)) {
    return [
      ...(imagePart && imageUrlOf(imagePart) ? [imagePart] : []),
      ...parseOutput(content.text),
    ];
  }
  return null;
}
function installCodeRenderer(sock, { getDatabase = null } = {}) {
  if (!sock?.sendMessage || sock.__terbooCodeRenderer) return sock;
  if (getDatabase) installedDatabase = getDatabase;
  const base = sock.sendMessage.bind(sock);
  sock.sendMessage = async (jid, content, options = {}) => {
    if (options?.terbooPlain) return base(jid, content, options);
    const parts = codePartsOf(content);
    if (!parts) return base(jid, content, options);
    const lang = recipientLanguage(jid, options, getDatabase?.() || null);
    return sendRich(sock, jid, parts, {
      quoted: options?.quoted || null,
      mode: modeOf(getDatabase),
      lang,
      send: base,
      label: "code",
    });
  };
  sock.sendCode = (jid, code, { language = "", fileName = "", title = "", text = "", footer = "", image = null, imageText = "", tapLinkUrl = "", sourceUrl = "", quoted = null } = {}) =>
    sock.sendMessage(jid, { code, language, fileName, title, text, footer, image, imageText, tapLinkUrl, sourceUrl }, quoted ? { quoted } : {});
  sock.__terbooCodeRenderer = true;
  return sock;
}

export { codePartsOf, installCodeRenderer, localizeParts, modeOf, normalizeMode, segmentParts, sendRich };
export default { installCodeRenderer, sendRich, codePartsOf };
