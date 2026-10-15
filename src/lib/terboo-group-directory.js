// ═══════════════════════════════════════════════
// 👥 Terboo Group Directory — دليل أعضاء المجموعة
// ───────────────────────────────────────────────
// المصدر الأول: بيانات واتساب نفسها (groupMetadata.participants: id · lid · phoneNumber · admin
// · notify/name/verifiedName) — لا يشترط تسجيل العضو في قاعدة Terboo.
// مصادر الأسماء الإضافية (أفضل جهد): pushName من رسائله في المجموعة · جهات اتصال واتساب ·
// سجل contacts المحفوظ · الاسم المسجّل إن وُجد.
//
// الأداء: نسخة مخزّنة لكل مجموعة (TTL 5 دقائق) · طلب metadata واحد مهما تزامنت الطلبات ·
// تحديث تدريجي من group-participants.update (إضافة/خروج/ترقية/خفض) بلا قراءة كاملة ·
// تحديث عند الطلب (refresh) · الأعضاء الذين خرجوا يبقون في «departed» لإعادتهم بالاسم.
// ═══════════════════════════════════════════════

import { getDatabase } from "./terboo-database.js";
import { noteFailure } from "./terboo-failure-log.js";
import { bareJid, identityOf, learnFromParticipants, participantIdentity } from "./terboo-identity.js";
import { rankByName } from "./terboo-name-match.js";

const TTL_MS = 5 * 60 * 1000;
const MAX_GROUPS = 300;
const MAX_DEPARTED = 200;
const MAX_EVENTS = 50;

if (!global.terbooGroupDirectory) global.terbooGroupDirectory = { groups: new Map(), inflight: new Map(), seen: new Map() };
const state = global.terbooGroupDirectory;

/** مفتاح ثابت للعضو: هويته القانونية (pn:… أو lid:…) */
function keyOf(jid) {
  return identityOf(jid).canonical || bareJid(jid);
}

function emptyGroup(id) {
  return { id, subject: "", owner: "", fetchedAt: 0, members: new Map(), departed: new Map(), events: [] };
}

function group(id) {
  let g = state.groups.get(id);
  if (!g) {
    g = emptyGroup(id);
    state.groups.set(id, g);
    if (state.groups.size > MAX_GROUPS) state.groups.delete(state.groups.keys().next().value);
  }
  return g;
}

/** أسماء عضو من كل المصادر المتاحة (بلا تكرار) */
function namesOf(member) {
  return [...new Set([member.name, member.pushName, member.verifiedName, member.notify, member.regName].map((x) => String(x || "").trim()).filter(Boolean))];
}

/** عضو من مشارك واتساب */
function memberFrom(p, extra = {}) {
  const { lid, pn, admin } = participantIdentity(p);
  const id = bareJid(p.id || p.jid || pn || lid);
  const canonical = keyOf(pn || lid || id);
  return {
    canonical,
    id,
    lid,
    pn,
    number: pn ? pn.split("@")[0] : "",
    admin: admin || null,
    notify: String(p.notify || "").trim(),
    name: String(p.name || "").trim(),
    verifiedName: String(p.verifiedName || "").trim(),
    pushName: "",
    regName: "",
    status: "member",
    ...extra,
  };
}

/** كل مفاتيح هوية شخص (القانونية + LID + PN) — اسم شوهد بهوية LID يلحق صاحبه حين يُعرف رقمه */
function identityKeys(jid, extra = []) {
  const id = identityOf(jid);
  const digits = (value) => String(value || "").split("@")[0].split(":")[0];
  return [...new Set([id.canonical, id.pn ? `pn:${digits(id.pn)}` : "", id.lid ? `lid:${digits(id.lid)}` : "", ...extra].filter(Boolean))];
}

/** أسماء إضافية: pushName شوهد في المجموعة · سجل contacts · اسم مسجل — أفضل جهد */
function enrich(member, groupId, sources = {}) {
  const keys = identityKeys(member.pn || member.lid || member.id, [member.canonical, member.lid ? `lid:${member.lid.split("@")[0]}` : "", member.pn ? `pn:${member.pn.split("@")[0]}` : ""]);
  const seen = keys.map((k) => state.seen.get(`${groupId}|${k}`)).find(Boolean) || keys.map((k) => state.seen.get(`*|${k}`)).find(Boolean);
  if (seen?.pushName) member.pushName = seen.pushName;
  const contacts = sources.contacts || {};
  for (const jid of [member.pn, member.lid, member.id].filter(Boolean)) {
    const entry = contacts[jid] || contacts[jid.split("@")[0]];
    if (entry?.name && !member.pushName) member.pushName = String(entry.name);
  }
  const user = sources.getUser?.(member.pn || member.lid || member.id);
  if (user?.regName) member.regName = String(user.regName);
  if (!member.pushName && user?.name && !/^(unknown|user|~ user)$/i.test(user.name)) member.pushName = String(user.name);
  return member;
}

function nameSources() {
  try {
    const db = getDatabase();
    return db?.ready ? { contacts: db.setting?.("contacts") || {}, getUser: (jid) => db.getUser?.(jid) } : {};
  } catch (error) {
    noteFailure("group-directory", error, { where: "terboo-group-directory:nameSources", fallback: "metadata-only" });
    return {};
  }
}

/** يبني الدليل من metadata كاملة (يحافظ على الخارجين وأحداثهم) */
function ingestMetadata(groupId, metadata) {
  const g = group(groupId);
  const participants = metadata?.participants || [];
  learnFromParticipants(participants);
  const sources = nameSources();
  const next = new Map();
  for (const p of participants) {
    const member = enrich(memberFrom(p), groupId, sources);
    next.set(member.canonical, member);
    g.departed.delete(member.canonical);
  }
  // من كان عضواً ولم يعد موجوداً ⇒ خرج (للإعادة بالاسم لاحقاً)
  for (const [key, old] of g.members) if (!next.has(key)) g.departed.set(key, { ...old, status: "left", leftAt: Date.now() });
  g.members = next;
  g.subject = String(metadata?.subject || g.subject || "");
  g.owner = metadata?.owner ? keyOf(metadata.owner) : g.owner;
  g.fetchedAt = Date.now();
  return g;
}

/**
 * الدليل الحالي (من الذاكرة إن كان حديثاً، وإلا من واتساب).
 * @param {Object} sock
 * @param {string} groupId
 * @param {{refresh?:boolean, metadata?:Object}} options
 */
async function getDirectory(sock, groupId, { refresh = false, metadata = null } = {}) {
  if (!String(groupId || "").endsWith("@g.us")) return null;
  if (metadata) return ingestMetadata(groupId, metadata);
  const g = state.groups.get(groupId);
  if (g && !refresh && Date.now() - g.fetchedAt < TTL_MS && g.members.size) return g;
  if (state.inflight.has(groupId)) return state.inflight.get(groupId);
  const job = (async () => {
    try {
      // refresh ⇒ قراءة حديثة من واتساب (تتجاوز المخزن المشترك وتحدّثه)
      const meta = await sock.groupMetadata(groupId, refresh ? { fresh: true } : undefined);
      return ingestMetadata(groupId, meta);
    } catch (error) {
      noteFailure("group-directory", error, { where: "terboo-group-directory:getDirectory", stage: "groupMetadata", target: groupId, fallback: "cached" });
      return state.groups.get(groupId) || null;
    } finally {
      state.inflight.delete(groupId);
    }
  })();
  state.inflight.set(groupId, job);
  return job;
}

/** تحديث تدريجي من group-participants.update — بلا قراءة metadata كاملة */
function applyParticipantsUpdate({ id, participants = [], action, author = "" } = {}) {
  if (!id) return null;
  const g = group(id);
  learnFromParticipants(participants.filter((p) => typeof p === "object"));
  const sources = nameSources();
  for (const raw of participants) {
    const p = typeof raw === "string" ? { id: raw } : raw || {};
    const member = enrich(memberFrom(p), id, sources);
    const key = member.canonical;
    if (action === "add") {
      const previous = g.departed.get(key) || g.members.get(key);
      g.members.set(key, { ...previous, ...member, pushName: member.pushName || previous?.pushName || "", status: "member", admin: null, addedAt: Date.now() });
      g.departed.delete(key);
    } else if (action === "remove" || action === "leave") {
      const previous = g.members.get(key) || member;
      g.members.delete(key);
      g.departed.set(key, { ...previous, status: author && keyOf(author) !== key ? "removed" : "left", leftAt: Date.now() });
      if (g.departed.size > MAX_DEPARTED) g.departed.delete(g.departed.keys().next().value);
    } else if (action === "promote" || action === "demote") {
      const current = g.members.get(key);
      if (current) current.admin = action === "promote" ? "admin" : null;
    }
    g.events.push({ action, key, author: author ? keyOf(author) : "", at: Date.now() });
  }
  if (g.events.length > MAX_EVENTS) g.events.splice(0, g.events.length - MAX_EVENTS);
  return g;
}

/** يسجل pushName عضو كتب في المجموعة (بلا أي طلب شبكة) */
function noteSeen(groupId, jid, pushName) {
  const name = String(pushName || "").trim();
  if (!jid || !name || /^(user|unknown|~ user)$/i.test(name)) return;
  const entry = { pushName: name.slice(0, 60), at: Date.now() };
  for (const key of identityKeys(jid)) {
    state.seen.set(`${groupId || "*"}|${key}`, entry);
    state.seen.set(`*|${key}`, entry);
  }
  while (state.seen.size > 20000) state.seen.delete(state.seen.keys().next().value);
  const member = memberByJid(state.groups.get(groupId), jid);
  if (member) member.pushName = name.slice(0, 60);
}

function invalidate(groupId) {
  const g = state.groups.get(groupId);
  if (g) g.fetchedAt = 0;
}

/** العضو المطابق لهوية (PN/LID) أو null */
function memberByJid(g, jid) {
  if (!g || !jid) return null;
  const target = identityOf(jid);
  for (const member of g.members.values()) {
    if (member.canonical === target.canonical) return member;
    if ((target.pn && member.pn === target.pn) || (target.lid && member.lid === target.lid)) return member;
  }
  return null;
}

/** عرض عضو للمستخدم (اسم مفهوم أو رقم/معرّف بلا اختراع) */
function displayName(member) {
  return namesOf(member)[0] || (member.number ? `+${member.number}` : member.lid ? member.lid.split("@")[0] : "?");
}

/**
 * بحث بالاسم داخل الأعضاء (والخارجين إن طُلب) — لا تخمين عند الغموض.
 * @returns {{status:string, best?:Object, weak?:boolean, options:Array}}
 */
function findByName(g, query, { includeDeparted = false, onlyDeparted = false } = {}) {
  if (!g) return { status: "not-found", options: [] };
  const pool = [
    ...(onlyDeparted ? [] : [...g.members.values()]),
    ...(includeDeparted || onlyDeparted ? [...g.departed.values()] : []),
  ].map((member) => ({ member, names: namesOf(member) }));
  const ranked = rankByName(query, pool);
  return { ...ranked, best: ranked.best?.member, options: ranked.options.map((o) => o.member) };
}

/** ملخص للأداة group.members ولأسئلة «مين الأدمن؟ · كام عضو؟ · مين آخر واحد اتضاف؟» */
function summary(g) {
  if (!g) return null;
  const members = [...g.members.values()];
  const admins = members.filter((m) => m.admin);
  const lastAdd = [...g.events].reverse().find((e) => e.action === "add");
  const lastRemove = [...g.events].reverse().find((e) => e.action === "remove" || e.action === "leave");
  const pick = (key) => (key ? g.members.get(key) || g.departed.get(key) || null : null);
  return {
    subject: g.subject,
    count: members.length,
    admins,
    owner: g.owner ? pick(g.owner) : admins.find((m) => m.admin === "superadmin") || null,
    named: members.filter((m) => namesOf(m).length).length,
    lastAdded: pick(lastAdd?.key),
    lastRemoved: pick(lastRemove?.key),
    members,
    fetchedAt: g.fetchedAt,
  };
}

/** ملخص فوري من المخزن فقط (بلا أي طلب شبكة) — لسياق النموذج */
function peek(groupId) {
  const g = state.groups.get(groupId);
  if (!g || !g.members.size) return null;
  const admins = [...g.members.values()].filter((m) => m.admin).map(displayName);
  return { count: g.members.size, admins: admins.slice(0, 6), adminCount: admins.length };
}

function _resetDirectory() {
  state.groups.clear();
  state.inflight.clear();
  state.seen.clear();
}

export { TTL_MS, _resetDirectory, applyParticipantsUpdate, displayName, findByName, getDirectory, ingestMetadata, invalidate, memberByJid, namesOf, noteSeen, peek, summary };
export default { getDirectory, applyParticipantsUpdate, noteSeen, invalidate, memberByJid, findByName, summary, displayName, namesOf };
