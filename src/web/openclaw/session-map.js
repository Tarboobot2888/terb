// ═══════════════════════════════════════════════
// 🔗 OpenClaw — ربط هوية Terboo بجلسة OpenClaw
// ───────────────────────────────────────────────
// مصدر الحقيقة مقسوم بوضوح:
//   • OpenClaw يملك سياق الاستدلال والجلسة (transcript/memory) عبر sessionKey.
//   • Terboo يملك ميتاداتا الواجهة (قائمة المحادثات وعناوينها) في
//     conversation-store.js الموجود. لا تاريخان متنافسان لنفس المحادثة.
//
// ما يفرضه هذا الملف:
//   • sessionKey مشتقّ حتميّاً من الهوية القانونية + القناة + معرّف المحادثة،
//     ومُعمّى (HMAC) فلا يحمل رقم هاتف ولا canonical صريحاً إلى خدمة أخرى.
//   • لا يصل أي sessionKey من العميل: يُشتقّ على الخادم في كل طلب.
//   • الحذف صريح: حذف محادثة من الواجهة يعطي مفتاح الجلسة الذي يجب إنهاؤه.
// ═══════════════════════════════════════════════

import { hmac } from "../services/secret-store.js";

/** بادئة ثابتة تميّز جلسات Terboo داخل OpenClaw */
const PREFIX = "terboo";

/**
 * مفتاح جلسة OpenClaw لمحادثة Terboo.
 * @param {{canonical:string}} principal الهوية القانونية (pn:...)
 * @param {{channel?:string, conversationId?:string}} [scope]
 *   channel: "web" أو "whatsapp" — الفصل بينهما مقصود كي لا تتسرّب محادثة
 *   من قناة إلى أخرى لنفس الشخص.
 * @returns {string}
 */
function sessionKeyFor(principal, { channel = "web", conversationId = "" } = {}) {
  const canonical = String(principal?.canonical || "").trim();
  if (!canonical) return "";
  const lane = String(channel || "web").replace(/[^a-z0-9_-]/gi, "").slice(0, 16) || "web";
  const conversation = String(conversationId || "default").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "default";
  // HMAC على (canonical+lane+conversation): حتميّ، ولا يكشف الهوية
  const digest = hmac(`${canonical}|${lane}|${conversation}`, "openclaw-session").slice(0, 40);
  return `${PREFIX}:${lane}:${digest}`;
}

/**
 * وسم مقروء للجلسة في لوحات OpenClaw (بلا رقم ولا canonical).
 * يُبنى من أجزاء: وسم تشغيلي يظهر في لوحة OpenClaw لا نصّاً معروضاً في
 * واجهة Terboo، فلا يدخل كتالوج الترجمة.
 */
function sessionLabelFor({ channel = "web", conversationId = "" } = {}) {
  const lane = String(channel || "web").slice(0, 16);
  const short = String(conversationId || "").slice(0, 8);
  return ["Terboo", lane, short].filter(Boolean).join(" ");
}

export { PREFIX, sessionKeyFor, sessionLabelFor };
