// ═══════════════════════════════════════════════
// 📬 Terboo Menu Delivery Layer — طبقة تسليم واحدة لكل القوائم (§28–§32 §58 §59)
// ───────────────────────────────────────────────
// سبب العطل المُشخَّص في القائمة الرئيسية والأقسام مقابل الإعدادات و«المزيد»:
//   1) الهدف: m.reply يحلّ دردشات LID إلى رقم الهاتف (ensureResolved) بينما كانت
//      القوائم ترسل relayMessage إلى m.chat كما هو ⇒ تذهب لعنوان مختلف عن الردود العادية.
//   2) الحمولة: الإعدادات و«المزيد» هما وحدهما من يستعمل Native Flow التفاعلي الصافي؛
//      القائمة الرئيسية (الشكل 1) كانت buttonsMessage قديماً برأس موقع، والأقسام
//      تضيف externalAdReply داخل interactiveMessage — شكلان يعرضهما جهاز المرسل
//      ولا يعرضهما جهاز المستلم.
//   3) الفشل الصامت: catch فارغ، والنجاح يُفترض لمجرد أن relayMessage لم يرمِ خطأ.
//
// السبب الجذري المتبقي في v4.0 (v5 §7 §11):
//   4) الشكل 1 للقائمة الرئيسية كان يبدأ بـ buttonsMessage قديم (+بطاقة موقع). الخادم يقبله
//      (ACK ≥ 2) لكن جهاز المستلم قد لا يعرضه، وعدم العرض لا يُرسل خطأ ACK ⇒ البديل المبني
//      على انتظار الرفض لا يعمل أبداً. الإعدادات/«المزيد»/اللغة كانت تبدأ بـ Native Flow فتعمل.
//   الحل حتمي: سياسة القدرات (terboo-wa-capabilities.js) تقرّر الطبقة الأولى قبل الإرسال —
//   الحمولات القديمة opt-in فقط — وكل طبقة تُتحقَّق (تحويل + ترميز + فك) قبل relay.
//   ورسائل البلوقنات القديمة (buttons/list/template) تتحوّل إلى Native Flow بنفس المعرّفات.
//
// الطبقة هنا:
//   • هدف محلول دائماً (LID ⇒ رقم) ولا يكون رقم البوت نفسه إلا في دردشة البوت مع نفسه.
//   • اقتباس رسالة المستخدم الحقيقية، userJid البوت، messageId مسجّل.
//   • طبقات: [أزرار عائمة كلاسيكية + بطاقة موقع — حين يطلبها شكل القائمة]
//     → Native Flow (+صورة رأس) → Native Flow صافٍ → أزرار → نص بنفس التصميم.
//   • رفض الخادم/الجهاز («device could not display the message») يصل كـ messages.update
//     بحالة ERROR ⇒ تُرسل الطبقة التالية تلقائياً ولو وصل الرفض متأخراً — بلا انتظار
//     يبطّئ كل قائمة، وبلا تكرار حين لا يوجد رفض.
//   • كل مرحلة تُسجَّل: النوع، الخطأ، الهدف، معرّف الرسالة، القائمة، نوع الحمولة، مرحلة البديل.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import { isLid, isLidConverted, resolveFromSock } from "./terboo-lid.js";
import { allowsPrimary, legacyEnabled, validateMessage } from "./terboo-wa-capabilities.js";
import { getDatabase } from "./terboo-database.js";
import { button, carousel as carouselOf, header as headerOf, legacyKind, legacyToNativeFlow, nativeFlow } from "./terboo-interactive-builder.js";

const STATUS_ERROR = 0;
const PENDING_TTL_MS = 2 * 60 * 1000;
const LOG_SIZE = 200;
const MEDIA_CACHE_MS = 60 * 60 * 1000;

if (!global.terbooMenuDelivery) global.terbooMenuDelivery = { log: [], pending: new Map(), socks: new WeakSet(), media: new Map() };
const state = global.terbooMenuDelivery;

// ═══════════════════════════════════════════════
// السجل (لا صمت: كل مرحلة مكتوبة)
// ═══════════════════════════════════════════════

function record(entry) {
  const row = { at: Date.now(), ...entry };
  state.log.push(row);
  if (state.log.length > LOG_SIZE) state.log.splice(0, state.log.length - LOG_SIZE);
  if (row.outcome === "error" || row.outcome === "rejected") {
    console.warn(`[MenuDelivery] ${row.menuId} · ${row.stage} · ${row.payloadType} · ${row.outcome} · target=${row.target} · id=${row.messageId || "-"} · ${row.error || ""}`);
  }
  return row;
}

function deliveryLog(count = 50) {
  return state.log.slice(-count);
}

// ═══════════════════════════════════════════════
// الهدف
// ═══════════════════════════════════════════════

/** مخزن الإعدادات (لتفعيل الحمولات القديمة opt-in) — غيابه يعني إعداد config وحده */
function currentSettings() {
  try {
    const db = getDatabase();
    return db?.ready === false ? null : db;
  } catch (error) {
    noteFailure("menu-delivery", error, { where: "src/lib/terboo-menu-delivery.js:currentSettings", stage: "getDatabase", fallback: "config.ui" });
    return null;
  }
}

function bareJid(jid) {
  const value = String(jid || "");
  const [user, server] = value.split("@");
  return server ? `${user.split(":")[0]}@${server}` : value;
}

/** رقم البوت الحقيقي */
function botJid(sock) {
  return bareJid(sock?.user?.jid || sock?.user?.id || "");
}

/**
 * هدف القائمة: دردشة المستخدم نفسها، محلولة من LID كما يفعل m.reply.
 * إن انتهى الحل إلى رقم البوت ولم تكن دردشة البوت مع نفسه ⇒ خاص المرسل.
 */
async function resolveTarget(m, sock) {
  let target = m?.chat || m?.key?.remoteJid || "";
  if (target && (isLid(target) || isLidConverted(target))) {
    try {
      const pn = await resolveFromSock(target, sock);
      if (pn && !isLid(pn) && !isLidConverted(pn)) target = pn;
    } catch (error) { noteFailure("menu-delivery", error, { where: "src/lib/terboo-menu-delivery.js:78", stage: "resolve-target", target, menu: "menu", fallback: "raw-jid" }); }
  }
  const self = botJid(sock);
  if (!m?.isGroup && self && bareJid(target) === self && !m?.fromMe) {
    let sender = m?.sender || "";
    if (isLid(sender) || isLidConverted(sender)) {
      try { sender = (await resolveFromSock(sender, sock)) || sender; } catch (error) { noteFailure("menu-delivery", error, { where: "src/lib/terboo-menu-delivery.js:83", stage: "resolve-target", target: sender || m?.chat, fallback: "raw-jid" }); }
    }
    if (sender && bareJid(sender) !== self) target = bareJid(sender);
  }
  return target;
}

/** رسالة المستخدم الحقيقية كاقتباس (WAMessage كامل بمفتاح ومحتوى) */
function quotedOf(m) {
  const raw = m?.raw || m?.msg || null;
  if (raw?.key && raw?.message) return raw;
  if (m?.key && m?.message) return { key: m.key, message: m.message };
  return undefined;
}

// ═══════════════════════════════════════════════
// الحمولات
// ═══════════════════════════════════════════════

function nativeFlowButtons({ sections, title, quickReplies, extraButtons }) {
  return [
    ...(sections?.length ? [button.select(title, sections)] : []),
    ...(quickReplies || []),
    ...(extraButtons || []),
  ];
}

function nativeContent({ text, footer, buttons, header = null, mentions = [] }) {
  return nativeFlow({ text, footer, buttons, header, contextInfo: mentions?.length ? { mentionedJid: mentions } : null });
}

/**
 * أزرار كلاسيكية (buttonsMessage) — «الأزرار العائمة» تحت الرسالة.
 * @param {{location?:{thumbnail?:Buffer, name?:string, address?:string}, buttonText?:string}} [options]
 *   location ⇒ رأس بطاقة موقع بصورة مصغّرة (شكل القائمة الرئيسية الأول كما كان)
 */
function buttonsContent({ text, footer, sections, title, legacyButtons, location = null, buttonText = "" }) {
  const header = location?.thumbnail
    ? { locationMessage: { jpegThumbnail: location.thumbnail, name: location.name || "", address: location.address || "" }, headerType: 6 }
    : { headerType: 1 };
  return {
    buttonsMessage: {
      contentText: text,
      footerText: footer || "",
      ...header,
      buttons: [
        ...(sections?.length ? [{
          buttonId: "menu",
          buttonText: { displayText: buttonText || title },
          type: 1,
          nativeFlowInfo: { name: "single_select", paramsJson: JSON.stringify({ title, sections }) },
        }] : []),
        ...(legacyButtons || []),
      ],
    },
  };
}

/** صورة رأس مرفوعة مرة واحدة وتُعاد لمدة ساعة (بلا رفع مع كل قائمة) */
async function headerImage(sock, key, buffer) {
  if (!buffer) return null;
  const cached = state.media.get(key);
  if (cached && Date.now() - cached.at < MEDIA_CACHE_MS) return cached.header;
  const { prepareWAMessageMedia } = await import("@whiskeysockets/baileys");
  const media = await prepareWAMessageMedia({ image: buffer }, { upload: sock.waUploadToServer });
  const header = { imageMessage: media.imageMessage, hasMediaAttachment: true };
  state.media.set(key, { at: Date.now(), header });
  return header;
}

/** رأس وسيط غير الصورة (فيديو/GIF/مستند) — يُرفع مرة لكل رسالة (محتواه خاص بها غالباً) */
async function headerMedia(sock, media) {
  const { prepareWAMessageMedia } = await import("@whiskeysockets/baileys");
  const kind = media.type === "video" ? "video" : media.type === "document" ? "document" : "image";
  // المصدر: Buffer، أو رابط https عام (يُبث للرفع مباشرة بلا تنزيل كامل في الذاكرة — للفيديو خصوصاً)
  const source = media.buffer || (/^https:\/\//i.test(String(media.url || "")) ? { url: String(media.url) } : null);
  if (!source) throw new Error("media_source_missing");
  const input = kind === "video"
    ? { video: source, ...(media.gifPlayback ? { gifPlayback: true } : {}) }
    : kind === "document"
      ? { document: source, mimetype: media.mimetype || "application/octet-stream", fileName: media.fileName || "file" }
      : { image: source };
  const prepared = await prepareWAMessageMedia(input, { upload: sock.waUploadToServer });
  return { hasMediaAttachment: true, title: media.title || "", [`${kind}Message`]: prepared[`${kind}Message`] };
}

// ═══════════════════════════════════════════════
// الرفض المتأخر ⇒ الطبقة التالية
// ═══════════════════════════════════════════════

function watchSocket(sock) {
  // المفتاح هو مُصدِر الأحداث نفسه: مستمع واحد لكل ev (المقبس الرسمي يدمّر ev عند الإغلاق)
  if (!sock?.ev?.on || state.socks.has(sock.ev)) return;
  state.socks.add(sock.ev);
  sock.ev.on("messages.update", (updates) => {
    for (const { key, update } of updates || []) {
      const pending = key?.id && state.pending.get(key.id);
      if (!pending) continue;
      if (update?.status === STATUS_ERROR) {
        state.pending.delete(key.id);
        const code = update.messageStubParameters?.[0] || "error-ack";
        record({ ...pending.meta, outcome: "rejected", error: `ack:${code}` });
        pending.next(`ack:${code}`).catch((error) => record({ ...pending.meta, outcome: "error", error: String(error?.message || error) }));
      } else if (Number.isFinite(update?.status) && update.status >= 2) {
        // وصل للخادم/الجهاز: لم يعد هناك داعٍ للمراقبة
        state.pending.delete(key.id);
        record({ ...pending.meta, outcome: "acknowledged", ack: update.status });
      }
    }
  });
}

function expectAck(messageId, meta, next) {
  if (!messageId) return;
  state.pending.set(messageId, { meta, next, at: Date.now() });
  for (const [id, entry] of state.pending) {
    if (Date.now() - entry.at > PENDING_TTL_MS) state.pending.delete(id);
  }
}

/**
 * تتبّع عام لأي رسالة مرسلة (قائمة، كود غني…): رفض الجهاز/الخادم لاحقاً ⇒ onRejected(reason).
 * @param {Object} sock
 * @param {string} messageId
 * @param {Object} meta تفاصيل السجل (menuId/stage/payloadType/target)
 * @param {(reason:string)=>Promise<any>} onRejected
 */
function trackDelivery(sock, messageId, meta, onRejected) {
  watchSocket(sock);
  expectAck(messageId, { ...meta, messageId }, onRejected);
}

// ═══════════════════════════════════════════════
// التسليم
// ═══════════════════════════════════════════════

/**
 * يسلّم قائمة لدردشة المستخدم بطبقات موثّقة.
 * @param {Object} sock
 * @param {Object} m
 * @param {{menuId:string, text:string, footer?:string, title?:string, sections?:Array,
 *          quickReplies?:Array, extraButtons?:Array, legacyButtons?:Array, fallbackText?:string,
 *          image?:{key:string, buffer:Buffer},
 *          floating?:{thumbnail?:Buffer, name?:string, address?:string, buttonText?:string}}} menu
 *   floating ⇒ الأزرار العائمة الكلاسيكية كأول طبقة (مع بطاقة موقع إن وُجدت صورة مصغّرة)
 * @returns {Promise<{stage:string, payloadType:string, target:string, messageId:string|null, outcome:string}>}
 */
async function deliverMenu(sock, m, menu) {
  const target = await resolveTarget(m, sock);
  const quoted = quotedOf(m);
  const userJid = sock?.user?.jid || sock?.user?.id;
  const title = menu.title || "";
  const buttons = nativeFlowButtons({ sections: menu.sections, title, quickReplies: menu.quickReplies, extraButtons: menu.extraButtons });
  watchSocket(sock);

  const layers = [];
  // بطاقات Carousel (نية «عرض نتائج بصور») ⇒ أول طبقة، ثم Native Flow بأول صورة، ثم النص
  if (menu.carousel?.cards?.length) layers.push({ stage: "carousel", payloadType: "interactiveMessage+carousel" });
  const hasButtons = Boolean(menu.sections?.length || menu.legacyButtons?.length);
  // الطبقة الأولى من سياسة القدرات لا من انتظار رفض قد لا يأتي (§7):
  // الأزرار العائمة القديمة opt-in فقط (config.ui.legacyButtons / إعداد legacyButtons)
  const settings = menu.settings || currentSettings();
  const floatingLayer = { stage: "floating", payloadType: menu.floating?.thumbnail ? "buttonsMessage+location" : "buttonsMessage" };
  if (menu.floating && hasButtons && allowsPrimary(floatingLayer.payloadType, { settings })) layers.push(floatingLayer);
  // بطاقة البوت (الشكل 1) بلا أزرار قديمة: رأس Native Flow بصورة البوت أو بطاقة الموقع
  if ((menu.image?.buffer || menu.media?.buffer || menu.media?.url || menu.floating?.thumbnail) && buttons.length) layers.push({ stage: "native-image", payloadType: menu.media?.buffer || menu.media?.url ? `interactiveMessage+${menu.media.type || "image"}` : "interactiveMessage+image" });
  if (buttons.length) layers.push({ stage: "native", payloadType: "interactiveMessage" });
  if (hasButtons && !menu.floating && legacyEnabled(settings)) layers.push({ stage: "buttons", payloadType: "buttonsMessage" });
  layers.push({ stage: "text", payloadType: "text" });

  const run = async (index, reason = "") => {
    const layer = layers[index];
    const meta = { menuId: menu.menuId, stage: layer.stage, payloadType: layer.payloadType, target, fallbackFrom: reason || "" };
    try {
      if (layer.stage === "text") {
        const body = [menu.text, menu.fallbackText].filter(Boolean).join("\n\n");
        const sent = await sock.sendMessage(target, { text: body, ...(menu.mentions?.length ? { mentions: menu.mentions } : {}) }, quoted ? { quoted } : {});
        return record({ ...meta, messageId: sent?.key?.id || null, outcome: "sent" });
      }
      const { generateWAMessageFromContent } = await import("@whiskeysockets/baileys");
      let content;
      if (layer.stage === "carousel") {
        const cards = [];
        for (const card of menu.carousel.cards) {
          // بطاقة لا يُرفع وسيطها تُسقط وحدها (لا تُسقط الرسالة كلها)
          let head = null;
          try {
            head = card.media?.buffer || card.media?.url ? await headerMedia(sock, card.media) : card.image?.buffer ? await headerMedia(sock, { type: "image", buffer: card.image.buffer }) : null;
          } catch (error) {
            noteFailure("menu-delivery", error, { where: "terboo-menu-delivery:carousel", stage: "card-media", menu: menu.menuId, fallback: "skip-card" });
            continue;
          }
          cards.push({ title: card.title, body: card.body, footer: card.footer, imageMessage: head?.imageMessage, videoMessage: head?.videoMessage, buttons: card.buttons || [] });
        }
        if (!cards.length) throw new Error("carousel_no_cards");
        content = carouselOf({ text: menu.text, footer: menu.footer, cards });
      } else if (layer.stage === "native-image") {
        const header = menu.media?.buffer || menu.media?.url
          ? await headerMedia(sock, menu.media)
          : menu.image?.buffer
            ? await headerImage(sock, menu.image.key, menu.image.buffer)
            : headerOf.location(menu.floating, "");
        content = nativeContent({ text: menu.text, footer: menu.footer, buttons, header, mentions: menu.mentions });
      } else if (layer.stage === "native") {
        content = nativeContent({ text: menu.text, footer: menu.footer, buttons, mentions: menu.mentions });
      } else if (layer.stage === "floating") {
        content = buttonsContent({
          text: menu.text, footer: menu.footer, sections: menu.sections, title, legacyButtons: menu.legacyButtons,
          location: menu.floating.thumbnail ? menu.floating : null, buttonText: menu.floating.buttonText,
        });
      } else {
        content = buttonsContent({ text: menu.text, footer: menu.footer, sections: menu.sections, title, legacyButtons: menu.legacyButtons });
      }
      // Validate قبل Relay: حمولة لا تمر بالتحويل/الترميز/الفك ⇒ فشل معروف ⇒ الطبقة التالية فوراً
      const check = validateMessage(content);
      if (!check.ok) throw new Error(`invalid_payload:${check.error}`);
      const msg = generateWAMessageFromContent(target, content, { userJid, ...(quoted ? { quoted } : {}) });
      if (bareJid(msg.key?.remoteJid) !== bareJid(target)) throw new Error(`key_target_mismatch:${msg.key?.remoteJid}`);
      await sock.relayMessage(target, msg.message, { messageId: msg.key.id, terbooDelivery: true });
      const row = record({ ...meta, messageId: msg.key.id, outcome: "sent" });
      // رفض لاحق من الخادم/الجهاز ⇒ الطبقة التالية تلقائياً
      if (index + 1 < layers.length) expectAck(msg.key.id, { ...meta, messageId: msg.key.id }, (why) => run(index + 1, why));
      return row;
    } catch (error) {
      record({ ...meta, outcome: "error", error: String(error?.message || error).slice(0, 200) });
      if (index + 1 < layers.length) return run(index + 1, `${layer.stage}:error`);
      throw error;
    }
  };

  return run(0);
}

// ═══════════════════════════════════════════════
// محوّل على حدود المقبس: كل رسالة تفاعلية من أي بلوقن تمر بنفس الضمانات (§30)
// ═══════════════════════════════════════════════

/** نوع الرسالة التفاعلية داخل أغلفة viewOnce/ephemeral، أو null */
function interactiveKind(message) {
  let node = message;
  for (let depth = 0; depth < 4 && node; depth++) {
    if (node.interactiveMessage) return "interactiveMessage";
    if (node.buttonsMessage) return "buttonsMessage";
    if (node.listMessage) return "listMessage";
    if (node.templateMessage) return "templateMessage";
    node = node.viewOnceMessage?.message || node.viewOnceMessageV2?.message
      || node.ephemeralMessage?.message || node.documentWithCaptionMessage?.message || null;
  }
  return null;
}

function unwrap(message) {
  let node = message;
  for (let depth = 0; depth < 4 && node; depth++) {
    const inner = node.viewOnceMessage?.message || node.viewOnceMessageV2?.message || node.ephemeralMessage?.message;
    if (!inner) break;
    node = inner;
  }
  return node || {};
}

/** نص احتياطي من أي رسالة تفاعلية: المتن + كل صف/زر كسطر أمر يمكن كتابته */
function textFromInteractive(message) {
  const node = unwrap(message);
  const lines = [];
  const im = node.interactiveMessage;
  if (im) {
    if (im.body?.text) lines.push(im.body.text);
    for (const button of im.nativeFlowMessage?.buttons || []) {
      let params = {};
      try { params = JSON.parse(button.buttonParamsJson || "{}"); } catch (error) { noteFailure("menu-delivery", error, {where: "src/lib/terboo-menu-delivery.js:326",stage: "JSON.parse"}); }
      if (button.name === "single_select") {
        for (const section of params.sections || []) {
          if (section.title) lines.push(`\n*${section.title}*`);
          for (const row of section.rows || []) lines.push(`› ${row.title}${row.id ? ` — ${row.id}` : ""}`);
        }
      } else if (params.display_text) {
        lines.push(`› ${params.display_text}${params.id ? ` — ${params.id}` : params.url ? ` — ${params.url}` : ""}`);
      }
    }
    if (im.footer?.text) lines.push(`\n_${im.footer.text}_`);
  }
  const bm = node.buttonsMessage;
  if (bm) {
    if (bm.contentText) lines.push(bm.contentText);
    for (const button of bm.buttons || []) lines.push(`› ${button.buttonText?.displayText || ""}${button.buttonId ? ` — ${button.buttonId}` : ""}`);
    if (bm.footerText) lines.push(`\n_${bm.footerText}_`);
  }
  const lm = node.listMessage;
  if (lm) {
    if (lm.description) lines.push(lm.description);
    for (const section of lm.sections || []) {
      if (section.title) lines.push(`\n*${section.title}*`);
      for (const row of section.rows || []) lines.push(`› ${row.title}${row.rowId ? ` — ${row.rowId}` : ""}`);
    }
  }
  return lines.filter(Boolean).join("\n").trim();
}

/**
 * يلفّ relayMessage مرة واحدة: الرسائل التفاعلية تُرسل لهدف محلول (LID ⇒ رقم)،
 * وتُسجَّل، ورفض عرضها من الخادم/الجهاز يُرسل بديلاً نصياً بنفس المحتوى.
 */
function installMenuDelivery(sock) {
  if (!sock || sock.__terbooMenuDelivery || typeof sock.relayMessage !== "function") return sock;
  const relay = sock.relayMessage.bind(sock);
  sock.relayMessage = async (jid, message, options = {}) => {
    const kind = interactiveKind(message);
    if (!kind || options?.terbooDelivery) return relay(jid, message, options);
    let target = jid;
    if (isLid(jid) || isLidConverted(jid)) {
      try {
        const pn = await resolveFromSock(jid, sock);
        if (pn && !isLid(pn) && !isLidConverted(pn)) target = pn;
      } catch (error) { noteFailure("menu-delivery", error, { where: "src/lib/terboo-menu-delivery.js:370", stage: "resolve-target", target: jid, menu: "plugin", payload: kind, fallback: "raw-jid" }); }
    }
    // رسالة بلوقن بشكل قديم (buttons/list/template) ⇒ Native Flow بنفس المعرّفات (حتمي، §7)
    let payload = message;
    let payloadType = kind;
    const legacy = legacyKind(message);
    if (legacy && !legacyEnabled(currentSettings())) {
      const converted = legacyToNativeFlow(message);
      if (converted && validateMessage(converted).ok) {
        payload = converted;
        payloadType = `interactiveMessage<${legacy}`;
      }
    }
    const meta = { menuId: "plugin", stage: "native", payloadType, target };
    // فشل معروف قبل النقل ⇒ بديل نصي فوري بنفس المحتوى بدل إرسال حمولة معطوبة
    const check = validateMessage(payload);
    if (!check.ok) {
      const fallback = textFromInteractive(message);
      record({ ...meta, outcome: "invalid", error: check.error });
      if (!fallback) throw new Error(`invalid_payload:${check.error}`);
      const sent = await sock.sendMessage(target, { text: fallback });
      record({ ...meta, stage: "text", payloadType: "text", messageId: sent?.key?.id || null, outcome: "sent", fallbackFrom: `invalid:${check.error}` });
      return sent?.key?.id || null;
    }
    try {
      const id = await relay(target, payload, options);
      const messageId = options?.messageId || id || null;
      record({ ...meta, messageId, outcome: "sent", resolvedFrom: target !== jid ? jid : "" });
      watchSocket(sock);
      const fallback = textFromInteractive(message);
      if (messageId && fallback) {
        expectAck(messageId, { ...meta, messageId }, async (why) => {
          const sent = await sock.sendMessage(target, { text: fallback });
          record({ ...meta, stage: "text", payloadType: "text", messageId: sent?.key?.id || null, outcome: "sent", fallbackFrom: why });
        });
      }
      return id;
    } catch (error) {
      record({ ...meta, outcome: "error", error: String(error?.message || error).slice(0, 200) });
      throw error;
    }
  };
  sock.__terbooMenuDelivery = true;
  return sock;
}

/** للاختبارات فقط */
function _resetDelivery() {
  state.log.length = 0;
  state.pending.clear();
  state.media.clear();
}

export { STATUS_ERROR, deliverMenu, deliveryLog, installMenuDelivery, interactiveKind, quotedOf, record as recordDelivery, resolveTarget, textFromInteractive, trackDelivery, _resetDelivery };
export default { deliverMenu, deliveryLog, installMenuDelivery, resolveTarget };
