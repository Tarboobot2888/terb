// ═══════════════════════════════════════════════
// 🚚 Terboo Message Transport Core — المصدر الرسمي الوحيد للإرسال (§7 §8)
// ───────────────────────────────────────────────
// لا طبقة نقل موازية: الأغلفة الموجودة على حدّ المقبس هي النقل، وهذا الملف:
//   ① يملك ترتيب تثبيتها في مكان واحد (المقبس الرئيسي و Jadibot معاً):
//        التوافق (biz) ⇐ مسار الكود ⇐ امتدادات المقبس ⇐ الترجمة ⇐ تسليم التفاعلي ⇐ الهوية
//   ② يقدّم sock.terboo.send(to, payload, options) بنتيجة منظّمة لكل نوع:
//        text · image · video · audio · voice(ptt) · document · sticker · location · contact
//        · reaction · reply · edit · buttons · select · cta · carousel · code · rich
//   ③ Build → Validate → Relay → Transport Result → Known Failure → Deterministic Fallback
//      (لا ينتظر ACK ليقرّر البديل؛ الحمولة غير الصالحة تسقط فوراً إلى نص بنفس المحتوى).
//
// كل بلوقن قديم يستعمل sock.sendMessage/relayMessage يمر بالضمانات نفسها لأن الأغلفة
// مثبّتة على المقبس ذاته — Transport هو الواجهة الجديدة لا مساراً بديلاً.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import { installWhatsAppCompat } from "./terboo-wa-compat.js";
import { installCodeRenderer } from "./terboo-code-renderer.js";
import { installLocalization } from "./terboo-i18n/runtime.js";
import { installMenuDelivery, quotedOf, recordDelivery } from "./terboo-menu-delivery.js";
import { installIdentity, sendableJid } from "./terboo-identity.js";
import { button, carousel as carouselContent, nativeFlow } from "./terboo-interactive-builder.js";
import { allowsPrimary, validateMessage } from "./terboo-wa-capabilities.js";

/** ترتيب الأغلفة من الداخل للخارج — مرجع واحد يقرؤه الاختبار أيضاً */
const LAYER_ORDER = ["installWhatsAppCompat", "installCodeRenderer", "extendSocket", "installLocalization", "installMenuDelivery", "installIdentity"];

const stats = { sent: 0, failed: 0, fallback: 0, byKind: {} };

function count(kind, outcome) {
  const row = (stats.byKind[kind] ||= { sent: 0, failed: 0, fallback: 0 });
  row[outcome] += 1;
  stats[outcome] += 1;
}

// ═══════════════════════════════════════════════
// الحمولة ⇒ محتوى واتساب
// ═══════════════════════════════════════════════

/** نوع الحمولة بالمفتاح الذي يحمله المستدعي */
function kindOf(payload = {}) {
  for (const kind of ["react", "edit", "carousel", "select", "buttons", "cta", "code", "rich", "voice", "image", "video", "audio", "document", "sticker", "location", "contact", "text"]) {
    if (payload[kind] !== undefined && payload[kind] !== null) return kind;
  }
  return "unknown";
}

/** نص احتياطي حتمي لأي حمولة تفاعلية: المتن + كل زر/صف كسطر أمر قابل للكتابة */
function fallbackText(payload) {
  const lines = [payload.text || payload.caption || ""].filter(Boolean);
  for (const b of payload.buttons || []) lines.push(`› ${b.text || b.id} — ${b.id}`);
  for (const section of payload.select?.sections || []) {
    if (section.title) lines.push(`\n*${section.title}*`);
    for (const row of section.rows || []) lines.push(`› ${row.title} — ${row.id}`);
  }
  for (const c of payload.cta || []) lines.push(`› ${c.text}: ${c.value}`);
  for (const card of payload.carousel?.cards || []) lines.push(`› ${card.title || ""} ${card.body || ""}`.trim());
  if (payload.footer) lines.push(`\n_${payload.footer}_`);
  return lines.join("\n").trim();
}

function ctaButton(c) {
  if (c.type === "copy") return button.copy(c.text, c.value);
  if (c.type === "call") return button.call(c.text, c.value);
  return button.url(c.text, c.value);
}

/**
 * يبني محتوى sendMessage (أو محتوى relay للتفاعلي) من حمولة Terboo.
 * @returns {{mode:"send"|"relay", content:Object}}
 */
function buildContent(payload, kind) {
  const mentions = payload.mentions?.length ? { mentions: payload.mentions } : {};
  switch (kind) {
    case "text": return { mode: "send", content: { text: String(payload.text), ...mentions } };
    case "image": return { mode: "send", content: { image: payload.image, caption: payload.caption || payload.text || "", ...mentions } };
    case "video": return { mode: "send", content: { video: payload.video, caption: payload.caption || payload.text || "", ...(payload.gif ? { gifPlayback: true } : {}), ...mentions } };
    case "audio": return { mode: "send", content: { audio: payload.audio, mimetype: payload.mimetype || "audio/mpeg", ptt: false } };
    case "voice": return { mode: "send", content: { audio: payload.voice, mimetype: payload.mimetype || "audio/ogg; codecs=opus", ptt: true } };
    case "document": return { mode: "send", content: { document: payload.document, mimetype: payload.mimetype || "application/octet-stream", fileName: payload.fileName || "file", caption: payload.caption || "" } };
    case "sticker": return { mode: "send", content: { sticker: payload.sticker } };
    case "location": return { mode: "send", content: { location: { degreesLatitude: payload.location.lat, degreesLongitude: payload.location.lng, name: payload.location.name || "", address: payload.location.address || "" } } };
    case "contact": return { mode: "send", content: { contacts: { displayName: payload.contact.name, contacts: [{ vcard: payload.contact.vcard || `BEGIN:VCARD\nVERSION:3.0\nFN:${payload.contact.name}\nTEL;type=CELL;waid=${String(payload.contact.number || "").replace(/\D/g, "")}:+${String(payload.contact.number || "").replace(/\D/g, "")}\nEND:VCARD` }] } } };
    case "react": return { mode: "send", content: { react: { text: payload.react, key: payload.key } } };
    case "edit": return { mode: "send", content: { text: String(payload.text || ""), edit: payload.edit } };
    case "code": return { mode: "send", content: { code: payload.code, language: payload.language || "", fileName: payload.fileName || "", title: payload.title || "", text: payload.text || "", footer: payload.footer || "", ...(payload.image ? { image: payload.image } : {}), ...(payload.imageText ? { imageText: payload.imageText } : {}), ...(payload.tapLinkUrl ? { tapLinkUrl: payload.tapLinkUrl } : {}), ...(payload.sourceUrl ? { sourceUrl: payload.sourceUrl } : {}) } };
    case "rich": return { mode: "rich", content: payload.rich };
    case "buttons": return { mode: "relay", content: nativeFlow({ text: payload.text, footer: payload.footer, header: payload.header || null, buttons: payload.buttons.map((b) => button.quickReply(b.id, b.text)) }) };
    case "select": return { mode: "relay", content: nativeFlow({ text: payload.text, footer: payload.footer, header: payload.header || null, buttons: [button.select(payload.select.title, payload.select.sections), ...(payload.buttons || []).map((b) => button.quickReply(b.id, b.text))] }) };
    case "cta": return { mode: "relay", content: nativeFlow({ text: payload.text, footer: payload.footer, header: payload.header || null, buttons: payload.cta.map(ctaButton) }) };
    case "carousel": return { mode: "relay", content: carouselContent({ text: payload.carousel.text || payload.text || "", footer: payload.carousel.footer || payload.footer || "", cards: payload.carousel.cards.map((card) => ({ ...card, buttons: (card.buttons || []).map((b) => (b.name ? b : b.url ? button.url(b.text, b.url) : button.quickReply(b.id, b.text))) })) }) };
    default: return { mode: "unknown", content: null };
  }
}

// ═══════════════════════════════════════════════
// الإرسال
// ═══════════════════════════════════════════════

/**
 * @typedef {{ok:boolean, kind:string, target:string, messageId:string|null, stage:string, fallback:boolean, error:string|null, ms:number}} TransportResult
 */

/**
 * إرسال موحّد. `to` = رسالة مُسلسلة (رد في نفس الدردشة) أو JID.
 * @param {Object} sock
 * @param {Object|string} to
 * @param {Object} payload  مثل {text} · {image, caption} · {buttons:[{id,text}], text} · {select:{title,sections}, text} · {cta:[{type,text,value}], text} · {carousel:{cards}} · {code, language} · {voice} · {react, key} · {edit:key, text}
 * @param {{quoted?:Object|boolean, mentions?:string[]}} [options]
 * @returns {Promise<TransportResult>}
 */
async function send(sock, to, payload = {}, options = {}) {
  const started = Date.now();
  const kind = kindOf(payload);
  const m = typeof to === "object" && to ? to : null;
  const target = sendableJid(m ? m.chat : String(to || ""));
  const quoted = options.quoted === true && m ? quotedOf(m) : options.quoted && typeof options.quoted === "object" ? options.quoted : undefined;
  const result = (extra) => ({ kind, target, messageId: null, fallback: false, error: null, ms: Date.now() - started, ...extra });

  if (!target) return result({ ok: false, stage: "build", error: "no-target" });
  const built = buildContent({ ...payload, mentions: options.mentions || payload.mentions }, kind);
  if (built.mode === "unknown") return result({ ok: false, stage: "build", error: ["unknown-payload", ...Object.keys(payload)].join(":") });

  try {
    if (built.mode === "rich") {
      const { sendRich } = await import("./terboo-code-renderer.js");
      const sent = await sendRich(sock, target, built.content, { quoted: quoted || null });
      count(kind, "sent");
      return result({ ok: true, stage: "rich", messageId: sent?.key?.id || sent?.messageId || null });
    }
    if (built.mode === "send") {
      const sent = await sock.sendMessage(target, built.content, quoted ? { quoted } : {});
      count(kind, "sent");
      return result({ ok: true, stage: "send", messageId: sent?.key?.id || null });
    }
    // تفاعلي: Validate قبل Relay — فشل معروف ⇒ نص فوري (لا ACK ننتظره)
    const check = validateMessage(built.content);
    if (!check.ok || !allowsPrimary(kind === "carousel" ? "carousel" : "interactiveMessage")) {
      const sent = await sock.sendMessage(target, { text: fallbackText(payload) }, quoted ? { quoted } : {});
      count(kind, "fallback");
      recordDelivery({ menuId: `transport:${kind}`, stage: "text", payloadType: "text", target, messageId: sent?.key?.id || null, outcome: "sent", fallbackFrom: `invalid:${check.error || "policy"}` });
      return result({ ok: true, stage: "text", fallback: true, messageId: sent?.key?.id || null, error: check.error || null });
    }
    const { generateWAMessageFromContent } = await import("@whiskeysockets/baileys");
    const msg = generateWAMessageFromContent(target, built.content, { userJid: sock.user?.jid || sock.user?.id, ...(quoted ? { quoted } : {}) });
    await sock.relayMessage(target, msg.message, { messageId: msg.key.id });
    count(kind, "sent");
    return result({ ok: true, stage: "relay", messageId: msg.key.id });
  } catch (error) {
    noteFailure("transport", error, { where: "src/lib/terboo-transport.js:send", stage: built.mode, target, payload: kind });
    // فشل نقل لحمولة تفاعلية ⇒ بديل نصي حتمي واحد
    if (built.mode === "relay") {
      try {
        const sent = await sock.sendMessage(target, { text: fallbackText(payload) }, quoted ? { quoted } : {});
        count(kind, "fallback");
        return result({ ok: true, stage: "text", fallback: true, messageId: sent?.key?.id || null, error: String(error?.message || error).slice(0, 200) });
      } catch (fallbackError) {
        noteFailure("transport", fallbackError, { where: "src/lib/terboo-transport.js:send", stage: "fallback-text", target, payload: kind });
      }
    }
    count(kind, "failed");
    return result({ ok: false, stage: built.mode, error: String(error?.message || error).slice(0, 200) });
  }
}

// ═══════════════════════════════════════════════
// التثبيت
// ═══════════════════════════════════════════════

/**
 * يثبّت طبقات النقل كلها على مقبس (رئيسي أو Jadibot) بالترتيب المعتمد، مرة واحدة.
 * @param {Object} sock
 * @param {{langOf?:Function, getDatabase?:Function, codeDatabase?:Function, isOwner?:Function, extend?:Function}} deps
 *   codeDatabase: قاعدة إعدادات مسار الكود إن اختلفت عن قاعدة الترجمة (Jadibot)
 */
function installTransport(sock, { langOf = () => "ar", getDatabase = () => null, codeDatabase = null, isOwner = () => false, extend = null } = {}) {
  if (!sock || sock.__terbooTransport) return sock;
  installWhatsAppCompat(sock, { langOf });
  installCodeRenderer(sock, { getDatabase: codeDatabase || getDatabase });
  if (typeof extend === "function") extend(sock);
  installLocalization(sock, { getDatabase, isOwner });
  installMenuDelivery(sock);
  installIdentity(sock);
  sock.terboo = {
    send: (to, payload, options) => send(sock, to, payload, options),
    stats: () => JSON.parse(JSON.stringify(stats)),
  };
  sock.__terbooTransport = true;
  return sock;
}

function transportStats() {
  return JSON.parse(JSON.stringify(stats));
}

export { LAYER_ORDER, buildContent, fallbackText, installTransport, kindOf, send, transportStats };
export default { installTransport, send, transportStats, LAYER_ORDER };
