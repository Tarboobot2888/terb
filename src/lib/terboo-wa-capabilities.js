// ═══════════════════════════════════════════════
// 🧭 Terboo WhatsApp Capabilities — ما يدعمه الـruntime فعلاً، وسياسة استعماله (§7 §10)
// ───────────────────────────────────────────────
// لا يُفترض أن أي نوع رسالة «يعمل». لكل قدرة:
//   مصدرها في WAProto (يُقرأ من WAProto.proto المشحون مع rc14) · الحمولة · الحقول المطلوبة
//   · نوع الرد ومحلّله · دعم الخاص/المجموعة · أدلة التحقق · البديل · الحدود المعروفة.
//
// الفرق الجوهري (سبب عطل القائمة الرئيسية):
//   • ACK الخادم (status ≥ 2) يعني «وصلت» لا «عُرضت». رفض العرض على جهاز المستلم لا
//     يُرسل خطأً في أغلب الحالات، فبديل ينتظر خطأ ACK لا يعمل أبداً لتلك الحالات.
//   • لذلك اختيار الحمولة حتمي من هذه السياسة: «primary» يُرسل أولاً، «fallback-only»
//     لا يُرسل إلا بديلاً، «opt-in» لا يُستعمل إلا بإعداد صريح من المالك.
//
// العرض على أجهزة حقيقية لا يمكن إثباته داخل بيئة الاختبار (لا جلسة واتساب):
//   deviceRender = "unverified-in-sandbox" مع مصدر المعرفة، ولا يُدّعى غير ذلك.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { proto } from "@whiskeysockets/baileys";
import config from "../../config.js";
import { noteFailure } from "./terboo-failure-log.js";

const require = createRequire(import.meta.url);

// ═══════════════════════════════════════════════
// قراءة WAProto.proto المشحون (مصدر الحقيقة للحقول)
// ═══════════════════════════════════════════════

let protoIndex = null;

/** فهرس «Message.InteractiveMessage.Header» ⇒ أسماء الحقول من ملف .proto الفعلي */
function loadProtoIndex() {
  if (protoIndex) return protoIndex;
  const entry = require.resolve("@whiskeysockets/baileys");
  let dir = path.dirname(entry);
  while (!fs.existsSync(path.join(dir, "WAProto", "WAProto.proto")) && dir !== path.dirname(dir)) dir = path.dirname(dir);
  const file = path.join(dir, "WAProto", "WAProto.proto");
  const index = new Map();
  if (!fs.existsSync(file)) return (protoIndex = { file: null, index });
  const stack = [];
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    const open = line.match(/^(message|enum|oneof)\s+(\w+)\s*\{/);
    if (open) {
      stack.push({ kind: open[1], name: open[2] });
      if (open[1] === "message") index.set(stack.filter((s) => s.kind === "message").map((s) => s.name).join("."), []);
      continue;
    }
    if (line.startsWith("}")) { stack.pop(); continue; }
    const field = line.match(/^(?:optional|repeated|required)?\s*([\w.]+)\s+(\w+)\s*=\s*\d+;/);
    if (field) {
      const owner = stack.filter((s) => s.kind === "message").map((s) => s.name).join(".");
      if (index.has(owner)) index.get(owner).push(field[2]);
    }
  }
  return (protoIndex = { file: path.relative(process.cwd(), file), index });
}

function protoFields(name) {
  return loadProtoIndex().index.get(name) || null;
}

/** صنف WAProto حقيقي في الـruntime لمسار مثل «Message.InteractiveMessage» */
function runtimeType(name) {
  let node = proto;
  for (const part of name.split(".")) node = node?.[part];
  return typeof node === "function" ? node : null;
}

// ═══════════════════════════════════════════════
// السجل
// ═══════════════════════════════════════════════

const NATIVE_FLOW = "Message.InteractiveMessage.NativeFlowMessage";
const UNVERIFIED = "unverified-in-sandbox";

/**
 * policy:
 *   primary       يُرسل أولاً
 *   fallback-only لا يُرسل إلا بعد فشل معروف لطبقة أعلى (خطأ بناء/نقل)
 *   opt-in        معطّل ما لم يفعّله المالك صراحة (config.ui أو قاعدة البيانات)
 *   receive-only  نوع يُستقبل فقط (ردود الضغط) — المحلّل يدعمه
 */
const CAPABILITIES = [
  {
    name: "text", source: "Message.ExtendedTextMessage", payload: "extendedTextMessage|conversation", required: ["text"],
    response: null, policy: "primary", private: true, group: true, fallback: null,
    limitations: ["WhatsApp text has no font-family or syntax highlighting; formatting is *bold* _italic_ ~strike~ ```mono``` > quote."],
  },
  {
    name: "native_flow.single_select", source: NATIVE_FLOW, payload: "interactiveMessage.nativeFlowMessage.buttons[name=single_select]",
    required: ["body.text", "buttons[].name", "buttons[].buttonParamsJson.sections[].rows[].id"],
    response: "interactiveResponseMessage.nativeFlowResponseMessage.paramsJson{id}", policy: "primary", private: true, group: true,
    fallback: "text", limitations: ["Button vocabulary (single_select…) is a string in WAProto, not an enum: the proto proves transport, not rendering."],
  },
  {
    name: "native_flow.quick_reply", source: NATIVE_FLOW, payload: "interactiveMessage.nativeFlowMessage.buttons[name=quick_reply]",
    required: ["buttons[].buttonParamsJson.display_text", "buttons[].buttonParamsJson.id"],
    response: "interactiveResponseMessage.nativeFlowResponseMessage.paramsJson{id}", policy: "primary", private: true, group: true, fallback: "text", limitations: [],
  },
  {
    name: "native_flow.cta_url", source: NATIVE_FLOW, payload: "interactiveMessage.nativeFlowMessage.buttons[name=cta_url]",
    required: ["display_text", "url"], response: null, policy: "primary", private: true, group: true, fallback: "text-with-link",
    limitations: ["Opens a link client-side; no response message reaches the bot."],
  },
  {
    name: "native_flow.cta_copy", source: NATIVE_FLOW, payload: "interactiveMessage.nativeFlowMessage.buttons[name=cta_copy]",
    required: ["display_text", "copy_code"], response: null, policy: "primary", private: true, group: true, fallback: "text-with-code",
    limitations: ["Copies client-side; no response message reaches the bot."],
  },
  {
    name: "native_flow.cta_call", source: NATIVE_FLOW, payload: "interactiveMessage.nativeFlowMessage.buttons[name=cta_call]",
    required: ["display_text", "phone_number"], response: null, policy: "primary", private: true, group: true, fallback: "text-with-number",
    limitations: ["Dials client-side; no response message reaches the bot."],
  },
  {
    name: "interactive.header_image", source: "Message.InteractiveMessage.Header", payload: "interactiveMessage.header.imageMessage",
    required: ["hasMediaAttachment=true", "imageMessage (uploaded)"], response: null, policy: "primary", private: true, group: true,
    fallback: "native_flow without header", limitations: ["Needs a media upload (waUploadToServer); cached per asset for an hour."],
  },
  {
    name: "carousel", source: "Message.InteractiveMessage.CarouselMessage", payload: "interactiveMessage.carouselMessage.cards[]",
    required: ["cards[].header.hasMediaAttachment", "cards[].body.text"], response: "interactiveResponseMessage (per-card buttons)",
    policy: "primary", private: true, group: true, fallback: "album or text list", limitations: ["Each card needs its own uploaded media."],
  },
  {
    name: "legacy.buttonsMessage", source: "Message.ButtonsMessage", payload: "buttonsMessage", required: ["contentText", "buttons[]"],
    response: "buttonsResponseMessage.selectedButtonId", policy: "opt-in", private: true, group: true, fallback: "native_flow",
    limitations: [
      "Accepted by the server (ack ≥ 2) but recipient clients may not render it; a render failure produces no error ack.",
      "This was the first layer of the v4.0 main menu (variant 1) and the reason it failed while Settings/More (native flow) worked.",
    ],
  },
  {
    name: "legacy.listMessage", source: "Message.ListMessage", payload: "listMessage", required: ["sections[]"],
    response: "listResponseMessage.singleSelectReply.selectedRowId", policy: "opt-in", private: true, group: true, fallback: "native_flow.single_select",
    limitations: ["Legacy list; same rendering caveat as buttonsMessage."],
  },
  {
    name: "legacy.templateMessage", source: "Message.TemplateMessage", payload: "templateMessage", required: ["hydratedTemplate"],
    response: "templateButtonReplyMessage.selectedId", policy: "opt-in", private: true, group: true, fallback: "native_flow", limitations: ["Deprecated template buttons."],
  },
  {
    name: "response.buttons", source: "Message.ButtonsResponseMessage", payload: "buttonsResponseMessage", required: ["selectedButtonId"],
    response: null, policy: "receive-only", private: true, group: true, fallback: null, limitations: [],
  },
  {
    name: "response.list", source: "Message.ListResponseMessage", payload: "listResponseMessage", required: ["singleSelectReply.selectedRowId"],
    response: null, policy: "receive-only", private: true, group: true, fallback: null, limitations: [],
  },
  {
    name: "response.template", source: "Message.TemplateButtonReplyMessage", payload: "templateButtonReplyMessage", required: ["selectedId"],
    response: null, policy: "receive-only", private: true, group: true, fallback: null, limitations: [],
  },
  {
    name: "response.native_flow", source: "Message.InteractiveResponseMessage.NativeFlowResponseMessage", payload: "interactiveResponseMessage.nativeFlowResponseMessage",
    required: ["paramsJson"], response: null, policy: "receive-only", private: true, group: true, fallback: null,
    limitations: ["paramsJson is JSON whose id may be nested (id · selectedId · selectedRowId · response_json)."],
  },
  {
    name: "album", source: "Message.AlbumMessage", payload: "albumMessage + messageAssociation(MEDIA_ALBUM)", required: ["expectedImageCount|expectedVideoCount"],
    response: null, policy: "primary", private: true, group: true, fallback: "media one by one", limitations: [],
  },
  {
    name: "poll", source: "Message.PollCreationMessage", payload: "pollCreationMessage (sendMessage {poll})", required: ["name", "options"],
    response: "pollUpdateMessage (encrypted vote)", policy: "primary", private: true, group: true, fallback: "text", limitations: [],
  },
  {
    name: "event", source: "Message.EventMessage", payload: "eventMessage + meta(event_type=creation)", required: ["name", "startTime"],
    response: null, policy: "primary", private: true, group: true, fallback: "text", limitations: [],
  },
  {
    name: "rich_response", source: "AIRichResponseMessage", payload: "Terboo Rich Response Engine (code/table/latex as cards)", required: ["submessages"],
    response: null, policy: "fallback-only", private: true, group: true, fallback: "text with ``` code block",
    limitations: ["Rendered natively only by some clients; Terboo never imitates Meta AI branding or verification."],
  },
  ...["image", "video", "audio", "document", "sticker", "location", "contact", "reaction"].map((kind) => ({
    name: `media.${kind}`, source: `Message.${{ image: "ImageMessage", video: "VideoMessage", audio: "AudioMessage", document: "DocumentMessage", sticker: "StickerMessage", location: "LocationMessage", contact: "ContactMessage", reaction: "ReactionMessage" }[kind]}`,
    payload: `sendMessage({ ${kind} })`, required: [kind], response: null, policy: "primary", private: true, group: true, fallback: kind === "reaction" ? null : "text", limitations: [],
  })),
];

const BY_NAME = new Map(CAPABILITIES.map((c) => [c.name, c]));

/** نوع الحمولة في طبقة التسليم ⇒ اسم القدرة */
const PAYLOAD_CAPABILITY = {
  "buttonsMessage": "legacy.buttonsMessage",
  "buttonsMessage+location": "legacy.buttonsMessage",
  "listMessage": "legacy.listMessage",
  "templateMessage": "legacy.templateMessage",
  "interactiveMessage": "native_flow.single_select",
  "interactiveMessage+image": "interactive.header_image",
  "text": "text",
};

// ═══════════════════════════════════════════════
// السياسة
// ═══════════════════════════════════════════════

/**
 * تفعيل صريح للحمولات القديمة (opt-in): config.ui.legacyButtons = true
 * أو إعداد قاعدة البيانات legacyButtons — لا تفعيل ضمني.
 */
function legacyEnabled(settings = null) {
  try {
    if (settings && typeof settings.setting === "function" && settings.setting("legacyButtons") === true) return true;
  } catch (error) {
    // قاعدة بيانات غير جاهزة: يبقى الإعداد من config وحده
    noteFailure("wa-capabilities", error, { where: "src/lib/terboo-wa-capabilities.js:legacyEnabled", stage: "settings", fallback: "config.ui.legacyButtons" });
  }
  return config.ui?.legacyButtons === true;
}

function policyOf(nameOrPayload) {
  const name = PAYLOAD_CAPABILITY[nameOrPayload] || nameOrPayload;
  return BY_NAME.get(name)?.policy || "unknown";
}

/** هل يُسمح بإرسال هذه الحمولة كطبقة أولى؟ */
function allowsPrimary(nameOrPayload, { settings = null } = {}) {
  const policy = policyOf(nameOrPayload);
  if (policy === "primary") return true;
  if (policy === "opt-in") return legacyEnabled(settings);
  return false;
}

// ═══════════════════════════════════════════════
// التحقق قبل النقل: بناء ⇒ تحويل ⇒ ترميز ⇒ فك ⇒ مقارنة الحقول الحرجة
// ═══════════════════════════════════════════════

/** يفك أغلفة viewOnce/ephemeral */
function innerOf(message) {
  let node = message;
  for (let i = 0; i < 4 && node; i++) {
    const next = node.viewOnceMessage?.message || node.viewOnceMessageV2?.message || node.ephemeralMessage?.message;
    if (!next) break;
    node = next;
  }
  return node || {};
}

/**
 * يتحقق من رسالة قبل relay: يجب أن تمر بمحوّل WAProto وترميز/فك حقيقي وتحتفظ بمحتواها.
 * @returns {{ok:boolean, error?:string, bytes?:number}}
 */
function validateMessage(content) {
  try {
    // ① فحص أنواع صارم: المحوّل الكامل (fromObject في rc14) يرمي على «object expected» وأمثالها
    if (typeof proto.Message.fromObject === "function") proto.Message.fromObject(content);
    // ② نفس مسار النقل الفعلي: generateWAMessageFromContent في rc14 يستعمل Message.create ثم encode
    const message = proto.Message.create(content);
    const bytes = proto.Message.encode(message).finish();
    const decoded = innerOf(proto.Message.decode(bytes));
    const before = innerOf(content);
    if (before.interactiveMessage) {
      const im = decoded.interactiveMessage;
      if (!im) return { ok: false, error: "interactiveMessage-lost" };
      const want = before.interactiveMessage.nativeFlowMessage?.buttons?.length || 0;
      if (want && (im.nativeFlowMessage?.buttons?.length || 0) !== want) return { ok: false, error: "buttons-lost" };
      for (const button of im.nativeFlowMessage?.buttons || []) {
        try { JSON.parse(button.buttonParamsJson || "{}"); } catch { return { ok: false, error: `bad-buttonParamsJson:${button.name}` }; }
      }
      if (before.interactiveMessage.carouselMessage && !(im.carouselMessage?.cards?.length)) return { ok: false, error: "cards-lost" };
      if (!im.body?.text && !im.carouselMessage) return { ok: false, error: "empty-body" };
    }
    if (before.buttonsMessage && !(decoded.buttonsMessage?.buttons?.length)) return { ok: false, error: "buttons-lost" };
    return { ok: true, bytes: bytes.length };
  } catch (error) {
    return { ok: false, error: String(error?.message || error).slice(0, 160) };
  }
}

// ═══════════════════════════════════════════════
// الاكتشاف (لتقرير docs/terboo-wa-capabilities.json)
// ═══════════════════════════════════════════════

function discover() {
  const { file } = loadProtoIndex();
  return {
    protoSource: file,
    capabilities: CAPABILITIES.map((capability) => {
      const fields = protoFields(capability.source);
      const type = runtimeType(capability.source);
      return {
        ...capability,
        detected: Boolean(type) && Array.isArray(fields),
        runtimeType: Boolean(type),
        protoFields: fields || [],
        web: capability.policy === "receive-only" ? "n/a" : UNVERIFIED,
        mobile: capability.policy === "receive-only" ? "n/a" : UNVERIFIED,
      };
    }),
  };
}

function capability(name) {
  return BY_NAME.get(name) || null;
}

export { CAPABILITIES, PAYLOAD_CAPABILITY, UNVERIFIED, allowsPrimary, capability, discover, innerOf, legacyEnabled, policyOf, protoFields, runtimeType, validateMessage };
export default { CAPABILITIES, allowsPrimary, discover, policyOf, validateMessage };
