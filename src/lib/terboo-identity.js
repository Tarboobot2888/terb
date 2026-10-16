// ═══════════════════════════════════════════════
// 🪪 Terboo Identity Resolver — هوية قانونية واحدة لكل شخص (§5 §6 §106)
// ───────────────────────────────────────────────
// الهدف «Canonical Identity» لا «تحويل كل شيء إلى رقم هاتف»:
//   • PN  (رقم@s.whatsapp.net)  و LID (رقم@lid)  هويتان لنفس الشخص متى عُرف الربط.
//   • الربط يُتعلَّم من مصادر Baileys 7 الحقيقية فقط:
//       key.remoteJidAlt · key.participantAlt · participant.{id,lid,phoneNumber}
//       · حدث lid-mapping.update · signalRepository.lidMapping.getPNForLID/getLIDForPN
//   • لا يُختلق رقم هاتف من أرقام LID أبداً: هوية غير محلولة تبقى LID (قابلة للإرسال في rc14).
//   • المقارنة دقيقة: PN=PN أو LID=LID أو ربط معروف — بلا مطابقة لاحقة/جزئية للأرقام.
//
// المخزن واحد: ذاكرة terboo-lid.js (lidCache) — لا نسخة ثانية من الربط.
// الدوال القديمة تُعاد تصديرها كما كانت للتوافق الخلفي.
// ═══════════════════════════════════════════════

import { jidDecode } from "@whiskeysockets/baileys";
import { parsePhoneNumber, getRegionCodeForCountryCode } from "awesome-phonenumber";
import { noteFailure } from "./terboo-failure-log.js";
import {
  isLid,
  isLidConverted,
  lidToJid,
  lidToJidSafe,
  extractNumber,
  resolveLidFromParticipants,
  resolveAnyLidToJid,
  convertLidArray,
  decodeAndNormalize,
  resolveParticipant,
  getParticipantJid as legacyParticipantJid,
  getParticipantJids as legacyParticipantJids,
  findParticipantByNumber,
  cacheParticipantLids,
  getCachedJid,
  normalizeToPhoneNumber,
  cacheLidJid,
  resolveFromSock,
  getLidCacheSize,
  getCachedLid,
  savePersistentCache,
} from "./terboo-lid.js";

const PN_SERVER = "s.whatsapp.net";
const LID_SERVER = "lid";

// ═══════════════════════════════════════════════
// الأشكال
// ═══════════════════════════════════════════════

/** المعرّف بلا جهاز (:12) وبلا وكيل (_1) وبحروف صغيرة */
function bareJid(jid) {
  const value = String(jid || "").trim();
  if (!value.includes("@")) return value;
  const decoded = jidDecode(value);
  if (decoded?.user && decoded.server) {
    const server = decoded.server === "c.us" ? PN_SERVER : decoded.server;
    return `${decoded.user}@${server}`;
  }
  const [user, server] = value.split("@");
  return `${user.split(":")[0]}@${server}`;
}

function digitsOf(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
}

/** نوع المعرّف كما هو — لا يخمّن من طول الأرقام */
function jidKind(jid) {
  const value = bareJid(jid);
  if (!value) return "unknown";
  if (value.endsWith(`@${LID_SERVER}`)) return "lid";
  if (value.endsWith(`@${PN_SERVER}`)) return "pn";
  if (value.endsWith("@g.us")) return "group";
  if (value.endsWith("@newsletter")) return "newsletter";
  if (value.endsWith("@broadcast")) return "broadcast";
  if (value.endsWith("@bot")) return "bot";
  if (/^\d{6,}$/.test(value)) return "number";
  return "unknown";
}

const isPnJid = (jid) => jidKind(jid) === "pn";
const isLidJid = (jid) => jidKind(jid) === "lid";

// ═══════════════════════════════════════════════
// تعلّم الربط LID ⇄ PN من مصادر موثوقة فقط
// ═══════════════════════════════════════════════

/** يربط LID برقم PN حقيقي (يتجاهل أي PN مختلق أو أي زوج غير مكتمل) */
function learn(lid, pn, source = "") {
  const l = bareJid(lid);
  const p = bareJid(pn);
  if (!isLidJid(l) || !isPnJid(p)) return false;
  // PN مختلق من أرقام LID ليس رقماً حقيقياً
  if (digitsOf(l) === digitsOf(p)) return false;
  if (getCachedJid(l) === p) return false;
  cacheLidJid(l, p);
  // التوافق مع المسار القديم: مفتاح الشكل المختلق يُحلّ أيضاً إلى الرقم الحقيقي
  cacheLidJid(`${digitsOf(l)}@${PN_SERVER}`, p);
  if (source) learned.set(source, (learned.get(source) || 0) + 1);
  return true;
}
const learned = new Map();

/** من مفتاح رسالة Baileys 7: remoteJid/remoteJidAlt و participant/participantAlt */
function learnFromKey(key = {}) {
  let count = 0;
  for (const [a, b] of [[key.remoteJid, key.remoteJidAlt], [key.participant, key.participantAlt]]) {
    if (!a || !b) continue;
    if (isLidJid(a) && isPnJid(b)) count += learn(a, b, "key") ? 1 : 0;
    else if (isPnJid(a) && isLidJid(b)) count += learn(b, a, "key") ? 1 : 0;
  }
  return count;
}

/** هوية مشارك مجموعة بحقول rc14 (id · lid · phoneNumber) وحقل jid القديم */
function participantIdentity(p = {}) {
  const fields = [p.id, p.lid, p.phoneNumber, p.jid].filter(Boolean).map(bareJid);
  const lid = fields.find(isLidJid) || "";
  const pn = fields.find(isPnJid) || (lid ? getCachedJid(lid) || "" : "");
  return { lid, pn: pn && digitsOf(pn) !== digitsOf(lid) ? pn : "", admin: p.admin || (p.isSuperAdmin ? "superadmin" : p.isAdmin ? "admin" : null) };
}

function learnFromParticipants(participants = []) {
  let count = 0;
  for (const p of participants || []) {
    const { lid, pn } = participantIdentity(p);
    if (lid && pn) count += learn(lid, pn, "participants") ? 1 : 0;
  }
  return count;
}

/** جهة اتصال (contacts.upsert/update): id · lid · phoneNumber */
function learnFromContact(contact = {}) {
  const { lid, pn } = participantIdentity(contact);
  return lid && pn ? learn(lid, pn, "contacts") : false;
}

// ═══════════════════════════════════════════════
// الحل
// ═══════════════════════════════════════════════

/** الطرف الآخر المعروف لهوية (PN ⇒ LID أو LID ⇒ PN) من المخزن الواحد، أو "" */
function counterpart(jid) {
  const value = bareJid(jid);
  if (isLidJid(value)) {
    const pn = getCachedJid(value);
    return pn && isPnJid(pn) && digitsOf(pn) !== digitsOf(value) ? bareJid(pn) : "";
  }
  if (isPnJid(value)) return getCachedLid(value) || "";
  return "";
}

/**
 * هوية قانونية من أي معرّف.
 * @param {string} jid PN أو LID أو شكل مختلق قديم أو رقم
 * @param {{participants?:Array}} [options]
 * @returns {{input:string, kind:string, pn:string, lid:string, number:string, canonical:string, resolved:boolean}}
 */
function identityOf(jid, { participants = null } = {}) {
  let value = bareJid(jid);
  if (participants?.length) learnFromParticipants(participants);
  // شكل قديم مختلق (أرقام LID@s.whatsapp.net) ⇒ نعامله كـLID إن ثبت أنه ليس رقماً حقيقياً
  if (isPnJid(value) && isLidConverted(value)) {
    const real = getCachedJid(value);
    value = real && isPnJid(real) && !isLidConverted(real) ? bareJid(real) : `${digitsOf(value)}@${LID_SERVER}`;
  }
  if (jidKind(value) === "number") value = `${value}@${PN_SERVER}`;
  const kind = jidKind(value);
  let pn = "";
  let lid = "";
  if (kind === "pn") { pn = value; lid = counterpart(value); }
  if (kind === "lid") { lid = value; pn = counterpart(value); }
  const canonical = pn ? `pn:${digitsOf(pn)}` : lid ? `lid:${digitsOf(lid)}` : value;
  return { input: String(jid || ""), kind, pn, lid, number: pn ? digitsOf(pn) : "", canonical, resolved: Boolean(pn && (kind === "pn" || lid)) };
}

/**
 * حل غير متزامن: الذاكرة ← المشاركون ← signalRepository.lidMapping الرسمي.
 * @returns {Promise<ReturnType<typeof identityOf>>}
 */
async function resolveIdentity(jid, sock = null, { participants = null } = {}) {
  const first = identityOf(jid, { participants });
  if (first.pn && first.lid) return first;
  const mapping = sock?.signalRepository?.lidMapping;
  try {
    if (first.lid && !first.pn && typeof mapping?.getPNForLID === "function") {
      const pn = await mapping.getPNForLID(first.lid);
      if (pn) learn(first.lid, pn, "signal");
    } else if (first.pn && !first.lid && typeof mapping?.getLIDForPN === "function") {
      const lid = await mapping.getLIDForPN(first.pn);
      if (lid) learn(lid, first.pn, "signal");
    }
  } catch (error) {
    noteFailure("identity", error, { where: "src/lib/terboo-identity.js:resolveIdentity", stage: "lidMapping", target: first.input, fallback: "cache-only" });
  }
  return identityOf(first.lid || first.pn || jid);
}

/**
 * أرقام بلا لاحقة (من نص المستخدم أو قرار الذكاء) إلى معرّف حقيقي:
 * LID معروف ⇒ رقمه الحقيقي · PN معروف ⇒ نفسه · أرقام لا تصلح رقماً دولياً ⇒ LID · وإلا PN.
 */
function jidFromDigits(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  const asLid = `${digits}@${LID_SERVER}`;
  const asPn = `${digits}@${PN_SERVER}`;
  const pn = counterpart(asLid);
  if (pn) return pn;
  if (getCachedLid(asPn)) return asPn;
  return isLidConverted(asPn) ? asLid : asPn;
}

/** نفس الشخص؟ مطابقة دقيقة عبر أي هوية معروفة — لا مطابقة لاحقة للأرقام */
function sameUser(a, b, options = {}) {
  if (!a || !b) return false;
  const x = identityOf(a, options);
  const y = identityOf(b, options);
  if (x.canonical && x.canonical === y.canonical) return true;
  if (x.pn && y.pn) return x.pn === y.pn;
  if (x.lid && y.lid) return x.lid === y.lid;
  return false;
}

/** أفضل معرّف للإرسال/الإشارة: PN الحقيقي إن عُرف، وإلا LID كما هو (لا PN مختلق) */
function sendableJid(jid, options = {}) {
  const id = identityOf(jid, options);
  if (id.kind === "group" || id.kind === "newsletter" || id.kind === "broadcast" || id.kind === "bot") return bareJid(jid);
  return id.pn || id.lid || bareJid(jid);
}

/** مشارك المجموعة المطابق لهوية (أو null) */
function findParticipant(participants = [], jid) {
  const target = identityOf(jid, { participants });
  for (const p of participants || []) {
    const { lid, pn } = participantIdentity(p);
    if ((target.pn && pn && target.pn === pn) || (target.lid && lid && target.lid === lid)) return p;
  }
  return null;
}

/** هل الهوية مشرف في هذه المجموعة؟ (مطابقة دقيقة) */
function isAdminIn(participants = [], jid) {
  const p = findParticipant(participants, jid);
  return Boolean(p && (p.admin || p.isAdmin || p.isSuperAdmin));
}

/** معرّف قابل للإشارة لمشارك: phoneNumber/PN الحقيقي ثم LID — لا PN مختلق */
function participantJid(p) {
  const { lid, pn } = participantIdentity(p);
  return pn || lid || legacyParticipantJid(p);
}

function participantJids(participants = []) {
  return (participants || []).map(participantJid).filter(Boolean);
}

/** هوية البوت نفسه (PN و LID من sock.user) */
function botIdentity(sock) {
  const user = sock?.user || {};
  const pn = user.id ? bareJid(user.id) : "";
  const lid = user.lid ? bareJid(user.lid) : "";
  if (pn && lid) learn(lid, pn, "self");
  return identityOf(pn || lid);
}

function isBot(jid, sock) {
  const bot = botIdentity(sock);
  return Boolean(jid) && (sameUser(jid, bot.pn || bot.lid) || (bot.lid && sameUser(jid, bot.lid)));
}

// ═══════════════════════════════════════════════
// أرقام الهاتف: مطابقة E.164 دقيقة (§6 — لا includes ولا endsWith)
// ═══════════════════════════════════════════════

/**
 * رقم مُدخل يدوياً (config/قاعدة بيانات) إلى أرقام E.164 بلا «+».
 * يقبل: «+20 101 234 5678» · «00201012345678» · «201012345678»
 *       · الصيغة المحلية «01012345678» إذا عُرفت دولة البوت (defaultRegion أو رقمه).
 * @returns {string} "" إن تعذّر التطبيع بثقة
 */
function normalizePhone(value, { defaultRegion = "", referenceNumber = "" } = {}) {
  let raw = String(value ?? "").split("@")[0].split(":")[0].trim();
  if (!raw) return "";
  raw = raw.replace(/[\s().-]/g, "");
  if (raw.startsWith("+")) raw = raw.slice(1);
  else if (raw.startsWith("00")) raw = raw.slice(2);
  else if (raw.startsWith("0")) {
    const region = defaultRegion || regionOf(referenceNumber);
    if (!region) return "";
    try {
      const parsed = parsePhoneNumber(raw, { regionCode: region });
      return parsed?.valid ? parsed.number.e164.slice(1) : "";
    } catch (error) {
      // رقم محلي غير قابل للتحليل ⇒ لا مطابقة (رفض آمن) مع سجل للتشخيص
      noteFailure("identity", error, { where: "src/lib/terboo-identity.js:normalizePhone", stage: "parsePhoneNumber", fallback: "no-match" });
      return "";
    }
  }
  return /^\d{6,15}$/.test(raw) ? raw : "";
}

function regionOf(number) {
  const digits = String(number || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  try {
    const parsed = parsePhoneNumber(`+${digits}`);
    return parsed?.regionCode || getRegionCodeForCountryCode(Number(digits.slice(0, 3))) || "";
  } catch (error) {
    // دولة غير معروفة ⇒ الصيغ المحلية («010…») لا تُطابق (رفض آمن)
    noteFailure("identity", error, { where: "src/lib/terboo-identity.js:regionOf", stage: "parsePhoneNumber", fallback: "no-region" });
    return "";
  }
}

/**
 * هل المرسل (أي شكل: PN · LID محلول · رقم) هو نفس رقم القائمة؟
 * مطابقة كاملة للأرقام بعد التطبيع فقط.
 */
function samePhone(candidate, listed, options = {}) {
  const id = identityOf(candidate);
  const subject = id.pn ? digitsOf(id.pn) : id.kind === "lid" ? "" : digitsOf(candidate);
  const wanted = normalizePhone(listed, options);
  return Boolean(subject && wanted && subject === wanted);
}

/** هل الرقم ضمن قائمة؟ */
function phoneInList(candidate, list = [], options = {}) {
  return (Array.isArray(list) ? list : []).some((entry) => samePhone(candidate, typeof entry === "object" && entry ? entry.id || entry.number || entry.jid || "" : entry, options));
}

// ═══════════════════════════════════════════════
// التثبيت على المقبس: التعلّم من الأحداث الرسمية
// ═══════════════════════════════════════════════

function installIdentity(sock) {
  if (!sock?.ev?.on || sock.__terbooIdentity) return sock;
  sock.__terbooIdentity = true;
  sock.ev.on("lid-mapping.update", (mapping) => {
    for (const pair of Array.isArray(mapping) ? mapping : [mapping]) learn(pair?.lid, pair?.pn, "lid-mapping.update");
  });
  for (const event of ["contacts.upsert", "contacts.update"]) {
    sock.ev.on(event, (contacts) => { for (const c of contacts || []) learnFromContact(c); });
  }
  sock.ev.on("group-participants.update", (update) => learnFromParticipants((update?.participants || []).map((p) => (typeof p === "string" ? { id: p } : p))));
  sock.ev.on("messages.upsert", ({ messages } = {}) => { for (const msg of messages || []) learnFromKey(msg?.key); });
  botIdentity(sock);
  return sock;
}

function identityStats() {
  return { cacheSize: getLidCacheSize(), learnedBySource: Object.fromEntries(learned) };
}

export {
  // الجديد
  bareJid,
  botIdentity,
  digitsOf,
  findParticipant,
  identityOf,
  identityStats,
  installIdentity,
  isAdminIn,
  isBot,
  isLidJid,
  isPnJid,
  jidFromDigits,
  jidKind,
  learn,
  learnFromContact,
  learnFromKey,
  learnFromParticipants,
  normalizePhone,
  participantIdentity,
  participantJid,
  participantJids,
  phoneInList,
  regionOf,
  resolveIdentity,
  samePhone,
  sameUser,
  sendableJid,
  // التوافق الخلفي (نفس الأسماء التي كان هذا الملف يصدّرها)
  isLid,
  isLidConverted,
  lidToJid,
  lidToJidSafe,
  extractNumber,
  resolveLidFromParticipants,
  resolveAnyLidToJid,
  convertLidArray,
  decodeAndNormalize,
  resolveParticipant,
  participantJid as getParticipantJid,
  participantJids as getParticipantJids,
  findParticipantByNumber,
  cacheParticipantLids,
  getCachedJid,
  normalizeToPhoneNumber,
  cacheLidJid,
  resolveFromSock,
  getLidCacheSize,
  savePersistentCache,
  legacyParticipantJid,
  legacyParticipantJids,
};
