// ═══════════════════════════════════════════════
// ✉️ Terboo Messaging — message.send_to_contact (§12)
// ───────────────────────────────────────────────
// إرسال رسالة لرقم/جهة اتصال بطلب المالك فقط (القرار من محرّك الصلاحيات قبل الوصول هنا):
//   تطبيع الرقم (E.164 · الصيغة المحلية بدولة البوت) ← تحقق أنه على واتساب ← منع التكرار (نفس النص لنفس
//   الشخص خلال دقيقتين لا يُرسل مرتين) ← حد معدّل لكل مُرسِل ← إرسال من البوت المطلوب ← سجل تدقيق
//   (بلا نص الرسالة: طوله وبصمته فقط) ← نتيجة صادقة: «أُرسلت» = واتساب قبلها برقم رسالة، لا «وصلت».
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import config from "../../config.js";
import { appendAuditEvent } from "./terboo-agent-audit.js";
import { noteFailure } from "./terboo-failure-log.js";
import { identityOf, normalizePhone } from "./terboo-identity.js";

const LIMITS = Object.freeze({ perMinute: 20, dedupeMs: 2 * 60 * 1000, maxText: 4000 });
const recent = new Map();   // jid|بصمة ⇒ وقت الإرسال
const windows = new Map();  // مُرسِل ⇒ أوقات آخر الإرسالات

const fail = (code, extra = {}) => ({ ok: false, code, ...extra });
const fingerprint = (text) => crypto.createHash("sha256").update(String(text)).digest("hex").slice(0, 16);
const masked = (number) => (number ? `…${String(number).slice(-4)}` : "");

function botNumber(sock) {
  return String(sock?.user?.id || config.bot?.primaryNumber || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

/**
 * هدف ⇒ معرّف قابل للإرسال. أرقام: تطبيع E.164 (الصيغة المحلية بدولة رقم البوت). معرّف PN/LID من المحلل: كما هو.
 * @returns {{ok:boolean, code?:string, jid?:string, number?:string}}
 */
function normalizeTarget(raw, sock) {
  const value = String(raw || "").trim();
  if (/@(?:s\.whatsapp\.net|lid)$/.test(value)) {
    const id = identityOf(value);
    return { ok: true, jid: id.pn || id.lid, number: id.number };
  }
  const number = normalizePhone(value, { referenceNumber: botNumber(sock) });
  if (!number) return fail("invalid-number");
  return { ok: true, jid: `${number}@s.whatsapp.net`, number };
}

function rateLimited(actor) {
  const now = Date.now();
  const list = (windows.get(actor) || []).filter((at) => now - at < 60_000);
  if (list.length >= LIMITS.perMinute) {
    windows.set(actor, list);
    return true;
  }
  list.push(now);
  windows.set(actor, list);
  while (windows.size > 2000) windows.delete(windows.keys().next().value);
  return false;
}

function audit(actor, status, extra) {
  try {
    appendAuditEvent({ type: "message.send_to_contact", actor, tool: "message.send_to_contact", status, metadata: extra });
  } catch (error) {
    noteFailure("messaging", error, { where: "terboo-messaging:audit", fallback: "no-audit" });
  }
}

/**
 * يرسل رسالة نصية لجهة اتصال.
 * @param {{sock:Object, to:string, text:string, actor:string, via?:string, checkExists?:boolean}} input
 *   to: رقم كما كتبه المالك أو معرّف من المحلل · actor: الهوية القانونية للمالك · via: اسم البوت المرسِل (للتقرير)
 * @returns {Promise<{ok:boolean, code:string, jid?:string, number?:string, messageId?:string}>}
 */
async function sendToContact({ sock, to, text, actor, via = "main", checkExists = true }) {
  const body = String(text || "").trim();
  if (!body) return fail("empty");
  if ([...body].length > LIMITS.maxText) return fail("too-long", { limit: LIMITS.maxText });
  if (typeof sock?.sendMessage !== "function") return fail("sender-offline");
  const target = normalizeTarget(to, sock);
  if (!target.ok) return target;
  let jid = target.jid;
  if (checkExists && target.number && typeof sock.onWhatsApp === "function") {
    try {
      const [row] = (await sock.onWhatsApp(target.number)) || [];
      if (!row?.exists) {
        audit(actor, "not-on-whatsapp", { to: masked(target.number), via });
        return fail("not-on-whatsapp", { number: target.number });
      }
      if (row.jid) jid = row.jid;
    } catch (error) {
      // تعذّر الفحص لا يعني أن الرقم غير موجود: نكمل ونقول ذلك في النتيجة
      noteFailure("messaging", error, { where: "terboo-messaging:onWhatsApp", fallback: "send-unchecked" });
    }
  }
  const key = `${identityOf(jid).canonical}|${fingerprint(body)}`;
  const last = recent.get(key);
  if (last && Date.now() - last < LIMITS.dedupeMs) return fail("duplicate", { jid, number: target.number });
  if (rateLimited(actor)) return fail("rate-limit");
  let sent;
  try {
    sent = await sock.sendMessage(jid, { text: body });
  } catch (error) {
    noteFailure("messaging", error, { where: "terboo-messaging:sendMessage", fallback: "report" });
    audit(actor, "failed", { to: masked(target.number), via, length: body.length });
    return fail("send-failed", { jid, number: target.number });
  }
  const messageId = sent?.key?.id || "";
  if (!messageId) {
    audit(actor, "unconfirmed", { to: masked(target.number), via, length: body.length });
    return fail("unconfirmed", { jid, number: target.number });
  }
  recent.set(key, Date.now());
  while (recent.size > 5000) recent.delete(recent.keys().next().value);
  audit(actor, "sent", { to: masked(target.number), via, length: body.length, hash: fingerprint(body), messageId });
  return { ok: true, code: "sent", jid, number: target.number, messageId };
}

/** للاختبارات */
function _resetMessaging() {
  recent.clear();
  windows.clear();
}

export { LIMITS, _resetMessaging, normalizeTarget, sendToContact };
export default { sendToContact, normalizeTarget };
