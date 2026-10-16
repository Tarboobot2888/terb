// ═══════════════════════════════════════════════
// 🎯 Terboo Member Resolver — من المقصود؟
// ───────────────────────────────────────────────
// يحدد العضو المقصود بطلب طبيعي، بالترتيب:
//   إشارة @ · الرد على رسالته (quoted) · رقم صريح · «اللي ضفته/طردته آخر مرة»
//   · ضمير متصل/منفصل («اطرده» · «هو») ⇒ آخر عضو في سياق الجلسة · اسم ⇒ دليل المجموعة
//   (الأعضاء، ثم الخارجون للإعادة) ⇒ جهات الاتصال المعروفة.
// LID وPN وparticipantAlt وremoteJidAlt كلها تُوحَّد بهوية واحدة (terboo-identity).
// لا تخمين: اسم يطابق أكثر من شخص ⇒ «ambiguous» بخيارات؛ لا مطابقة ⇒ «not-found»؛
// تطابق ضعيف (بادئة/نطق بلغة أخرى) ⇒ «weak» يحتاج تأكيداً قبل التنفيذ.
// ═══════════════════════════════════════════════

import { getDatabase } from "./terboo-database.js";
import { noteFailure } from "./terboo-failure-log.js";
import { bareJid, identityOf, isBot } from "./terboo-identity.js";
import { recall } from "./terboo-context-engine.js";
import { displayName, findByName, getDirectory, memberByJid, namesOf, summary } from "./terboo-group-directory.js";
import { rankByName } from "./terboo-name-match.js";

const LAST_ADDED = /(?:اللي|الي|الى|اللى)\s+(?:ضفته|ضفتها|اضفته|أضفته|ضفناه|اتضاف|انضاف|دخل)\s*(?:اخر|آخر)?\s*(?:مره|مرة)?|(?:اخر|آخر)\s+(?:واحد|عضو|حد)\s+(?:اتضاف|انضاف|ضفته|دخل)|(?:the )?(?:one|person|member) (?:i|you|we) (?:just )?added|last (?:one )?added|(?:el )?[úu]ltimo (?:que )?(?:añad|agreg)/iu;
const LAST_REMOVED = /(?:اللي|الي|اللى)\s+(?:طردته|طردتها|شلته|اتطرد|خرج|طلع)|(?:اخر|آخر)\s+(?:واحد|عضو|حد)\s+(?:اتطرد|خرج|طلع)|(?:the )?(?:one|person|member) (?:i|you|we) (?:just )?(?:kicked|removed)|last (?:one )?(?:kicked|removed)|(?:el )?[úu]ltimo (?:que )?(?:expuls|sac)/iu;
/** ضمير مفعول متصل بفعل الإجراء («اطرده» · «رجعها» · «خليه») أو منفصل */
const PRONOUN = /(?:^|[\s،,])(?:هو|هي|ده|دا|دي|نفسه|نفسها|him|her|them|that (?:guy|user|person|one)|él|ella|ese|esa)(?=$|[\s،,.!؟?])|[ء-ي](?:ه|ها|هم)(?=$|[\s،,.!؟?])/u;

function digits(value) {
  return String(value || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

/** مرشح موحّد للعرض والتنفيذ */
function candidateOf(member, source) {
  return {
    canonical: member.canonical,
    id: member.id || member.pn || member.lid,
    jid: member.pn || member.lid || member.id,
    pn: member.pn || "",
    lid: member.lid || "",
    number: member.number || digits(member.pn),
    name: displayName(member),
    admin: member.admin || null,
    inGroup: member.status === "member",
    source,
  };
}

/** عضو من معرّف (PN أو LID) — داخل الدليل إن وُجد، وإلا هوية خام بلا اسم مختلق */
function fromJid(directory, jid, source) {
  const member = memberByJid(directory, jid);
  if (member) return candidateOf(member, source);
  const departed = directory ? [...directory.departed.values()].find((d) => d.canonical === identityOf(jid).canonical) : null;
  if (departed) return candidateOf(departed, source);
  const id = identityOf(jid);
  return { canonical: id.canonical, id: bareJid(jid), jid: id.pn || id.lid || bareJid(jid), pn: id.pn, lid: id.lid, number: id.number, name: id.number ? `+${id.number}` : "", admin: null, inGroup: directory ? false : null, source };
}

/** جهات اتصال معروفة (contacts المحفوظة) بالاسم — لإضافة شخص ليس في المجموعة */
function contactsByName(query) {
  try {
    const contacts = getDatabase()?.setting?.("contacts") || {};
    const pool = Object.values(contacts)
      .filter((c) => c?.jid && c?.name)
      .map((c) => ({ member: { canonical: identityOf(c.jid).canonical, id: c.jid, pn: identityOf(c.jid).pn, lid: identityOf(c.jid).lid, number: identityOf(c.jid).number, status: "contact", name: c.name }, names: [c.name] }));
    const ranked = rankByName(query, pool);
    return { ...ranked, best: ranked.best?.member, options: ranked.options.map((o) => o.member) };
  } catch (error) {
    noteFailure("member-resolver", error, { where: "terboo-member-resolver:contactsByName", fallback: "directory-only" });
    return { status: "not-found", options: [] };
  }
}

/**
 * يحدد العضو المقصود.
 * @param {{m:Object, sock:Object, name?:string, purpose?:"add"|"member"|"any", text?:string}} input
 *   name: الاسم المستخرج من الطلب (إن وُجد) · purpose: add ⇒ يبحث في الخارجين وجهات الاتصال أيضاً
 * @returns {Promise<{status:"resolved"|"ambiguous"|"not-found"|"none", target?:Object, weak?:boolean, options?:Array, source?:string}>}
 */
async function resolveMember({ m, sock, name = "", purpose = "member", text = "" }) {
  // الدليل من واتساب؛ وإن تعذّر: مشاركو الرسالة نفسها (serialize قرأهم بالفعل)
  let directory = m?.isGroup ? await getDirectory(sock, m.chat) : null;
  if (!directory && m?.isGroup && m.groupMetadata?.participants) directory = await getDirectory(sock, m.chat, { metadata: m.groupMetadata });
  const notBot = (jid) => jid && !isBot(jid, sock) && digits(jid) !== digits(m?.sender);

  // ① إشارة @
  const mentioned = (m?.mentionedJid || []).find(notBot);
  if (mentioned) return { status: "resolved", target: fromJid(directory, mentioned, "mention"), source: "mention" };
  // ② رد على رسالة العضو (لا على البوت)
  if (m?.quoted?.sender && !m.quoted.key?.fromMe && notBot(m.quoted.sender)) {
    return { status: "resolved", target: fromJid(directory, m.quoted.sender, "quoted"), source: "quoted" };
  }
  // ③ رقم صريح في الطلب
  const number = String(text || "").match(/(?:^|\s)\+?(\d[\d\s-]{7,17}\d)(?=\s|$)/);
  if (number) {
    const value = number[1].replace(/\D/g, "");
    if (value.length >= 8 && value.length <= 15) return { status: "resolved", target: fromJid(directory, `${value}@s.whatsapp.net`, "number"), source: "number" };
  }
  // ④ «اللي ضفته آخر مرة» · «آخر واحد اتطرد»
  if (LAST_ADDED.test(text)) {
    const remembered = recall(m, "added");
    const fromEvents = summary(directory)?.lastAdded;
    const pick = remembered?.jid ? fromJid(directory, remembered.jid, "last-added") : fromEvents ? candidateOf(fromEvents, "last-added") : null;
    return pick ? { status: "resolved", target: pick, source: "last-added" } : { status: "not-found", source: "last-added" };
  }
  if (LAST_REMOVED.test(text)) {
    const remembered = recall(m, "removed");
    const fromEvents = summary(directory)?.lastRemoved;
    const pick = remembered?.jid ? fromJid(directory, remembered.jid, "last-removed") : fromEvents ? candidateOf(fromEvents, "last-removed") : null;
    return pick ? { status: "resolved", target: pick, source: "last-removed" } : { status: "not-found", source: "last-removed" };
  }
  // ⑤ اسم صريح ⇒ الدليل (ثم الخارجون وجهات الاتصال للإضافة)
  const query = String(name || "").trim();
  if (query) {
    const inGroup = findByName(directory, query, { includeDeparted: purpose === "any" });
    if (inGroup.status === "resolved") return { status: "resolved", target: candidateOf(inGroup.best, "name"), weak: inGroup.weak, source: "name" };
    if (inGroup.status === "ambiguous") return { status: "ambiguous", options: inGroup.options.map((o) => candidateOf(o, "name")), source: "name" };
    if (purpose === "add") {
      const departed = findByName(directory, query, { onlyDeparted: true });
      if (departed.status === "resolved") return { status: "resolved", target: candidateOf(departed.best, "departed"), weak: departed.weak, source: "departed" };
      if (departed.status === "ambiguous") return { status: "ambiguous", options: departed.options.map((o) => candidateOf(o, "departed")), source: "departed" };
      const contacts = contactsByName(query);
      if (contacts.status === "resolved") return { status: "resolved", target: candidateOf(contacts.best, "contact"), weak: contacts.weak, source: "contact" };
      if (contacts.status === "ambiguous") return { status: "ambiguous", options: contacts.options.map((o) => candidateOf(o, "contact")), source: "contact" };
    }
    return { status: "not-found", source: "name", query };
  }
  // ⑥ ضمير أو فعل بلا هدف ⇒ آخر عضو في سياق هذه الجلسة
  const last = recall(m, "member");
  if (last?.jid) return { status: "resolved", target: fromJid(directory, last.jid, "context"), source: "context" };
  return { status: "none" };
}

/** هل في الطلب ضمير يشير لشخص سابق؟ */
function hasPronoun(text) {
  return PRONOUN.test(String(text || ""));
}

export { LAST_ADDED, LAST_REMOVED, candidateOf, hasPronoun, namesOf, resolveMember };
export default { resolveMember, hasPronoun };
