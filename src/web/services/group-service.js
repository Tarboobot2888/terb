// ═══════════════════════════════════════════════
// 👥 Terboo Web — المجموعات (قراءة، وإجراءات بتحقق حيّ)
// ───────────────────────────────────────────────
// • قائمة المجموعات تُقرأ من بيانات واتساب الحيّة عبر terboo-group-directory.js،
//   ولا تُعرض إلا المجموعات التي يثبت أن المستخدم عضو فيها.
// • كل إجراء يُعاد التحقق من شروطه لحظة التنفيذ: المجموعة · العضو الهدف ·
//   دور الطالب · دور البوت (مشرف أم لا) — من البيانات الحيّة لا من الطلب.
// • الفعل يمرّ على ACTIONS الأصلية في terboo-permissions.js (group.member.kick…)
//   بسياستها كما هي: تأكيد المدمّر، والجماعي لا يُتجاوَز تأكيده أبداً.
// • بغير مقبس حيّ لا إجراء: يُعاد BOT_OFFLINE صريحاً لا نجاح مزيّف.
// • أي إجراء يحتاج رسالة واتساب (إرسال/بث) غير متاح من الموقع.
// ═══════════════════════════════════════════════

import { apiError } from "../errors.js";
import { requirePermission } from "./permission-service.js";
import { maskPhone } from "./identity-service.js";

/** المقبس الحيّ أو null — تحميل متأخر (استيراد connection.js له أثر جانبي) */
let socketProvider = null;
function setSocketProvider(provider) {
  socketProvider = typeof provider === "function" ? provider : null;
}
async function currentSocket() {
  if (socketProvider) return socketProvider();
  const mod = await import("../../connection.js");
  return mod.isConnected() ? mod.getSocket() : null;
}

/** دليل المجموعة الحيّ */
async function directoryOf(sock, groupId, { refresh = false } = {}) {
  const { getDirectory } = await import("../../lib/terboo-group-directory.js");
  return getDirectory(sock, groupId, { refresh });
}

/**
 * سياق المجموعة لهذا المستخدم، محسوب من البيانات الحيّة.
 * @returns {{groupId:string, isMember:boolean, isGroupAdmin:boolean,
 *            isGroupOwner:boolean, botIsAdmin:boolean|null, subject:string, size:number}}
 */
async function groupContext(principal, groupId) {
  const sock = await currentSocket();
  if (!sock) throw apiError("BOT_OFFLINE");
  const id = String(groupId || "");
  if (!/^\d+@g\.us$/.test(id)) throw apiError("INVALID_INPUT", { details: { field: "groupId" } });

  const directory = await directoryOf(sock, id, { refresh: true });
  if (!directory) throw apiError("NOT_FOUND");

  const { memberByJid } = await import("../../lib/terboo-group-directory.js");
  const me = memberByJid(directory, principal.sender);
  // ليس عضواً ⇒ 404: لا يكشف وجود المجموعة ولا بياناتها
  if (!me) throw apiError("NOT_FOUND");

  const { isBot } = await import("../../lib/terboo-identity.js");
  const botMember = [sock?.user?.id, sock?.user?.lid]
    .filter(Boolean)
    .map((jid) => memberByJid(directory, jid))
    .find(Boolean)
    || [...directory.members.values()].find((member) => isBot(member.pn || member.lid || member.id, sock))
    || null;

  return {
    groupId: id,
    isMember: true,
    isGroupAdmin: Boolean(me.admin),
    isGroupOwner: me.admin === "superadmin",
    botIsAdmin: botMember ? Boolean(botMember.admin) : null,
    subject: directory.subject || "",
    size: directory.members?.size || 0,
    directory,
  };
}

/** المجموعات التي يثبت أن المستخدم عضو فيها */
async function myGroups(principal) {
  const sock = await currentSocket();
  if (!sock) throw apiError("BOT_OFFLINE");
  let all = {};
  try {
    all = typeof sock.groupFetchAllParticipating === "function" ? await sock.groupFetchAllParticipating() : {};
  } catch (error) {
    throw apiError("BOT_OFFLINE", { details: { reason: "group-list-unavailable" } });
  }
  const rows = [];
  for (const [groupId, meta] of Object.entries(all || {})) {
    const participants = meta?.participants || [];
    const { identityOf } = await import("../../lib/terboo-identity.js");
    const me = participants.find((participant) => {
      const id = identityOf(participant.id || participant.jid || "");
      return id.number && id.number === principal.number;
    });
    if (!me) continue;                   // غير عضو ⇒ لا تُعرض أصلاً
    rows.push({
      groupId,
      subject: meta?.subject || "",
      size: participants.length,
      isGroupAdmin: Boolean(me.admin),
      isGroupOwner: me.admin === "superadmin",
      // الإجراءات تُفعَّل في الواجهة بحسب هذين العلمين فقط
      botIsAdmin: participants.some((participant) => {
        const id = identityOf(participant.id || participant.jid || "");
        return id.number && sock.user?.id?.includes(id.number) && Boolean(participant.admin);
      }),
    });
  }
  return rows;
}

/** أعضاء مجموعة — أرقام مُقنَّعة دائماً */
async function members(principal, groupId) {
  const context = await groupContext(principal, groupId);
  requirePermission({
    principal: { ...principal, inGroup: true, groupId: context.groupId, isGroupAdmin: context.isGroupAdmin, botIsAdmin: context.botIsAdmin, level: principal.isOwner ? "owner" : context.isGroupAdmin ? "group-admin" : "user" },
    action: "group.members.list",
  });
  return {
    groupId: context.groupId,
    subject: context.subject,
    size: context.size,
    members: [...context.directory.members.values()].slice(0, 500).map((member) => ({
      ref: member.canonical || member.id || "",
      label: member.name || maskPhone(String(member.pn || member.id || "").replace(/\D/g, "")),
      admin: member.admin || null,
    })),
  };
}

/** فعل الصلاحية ⇒ عملية المشاركين في terboo-group-actions.js */
const OP_OF_ACTION = Object.freeze({
  "group.member.kick": "kick",
  "group.member.promote": "promote",
  "group.member.demote": "demote",
  "group.members.kickSelected": "kick",
  "group.members.promoteSelected": "promote",
  "group.members.demoteSelected": "demote",
});

/**
 * إجراء على أعضاء محددين.
 * المسار: تحقق حيّ ⇒ محرّك الصلاحيات ⇒ planMembers (حماية الأهداف
 * واللاإعادة) ⇒ participantsBulk (دفعات + تحقق بعد كل دفعة).
 * participantsBulk يعيد verified=false إن تعذّر إثبات النتيجة، فلا يُعلَن
 * نجاح بلا دليل، ولا يُعاد «أُلغيت/نُفِّذت» من تخمين.
 */
async function memberAction({ principal, groupId, action, targetRefs = [], confirmed = false, signal = null }) {
  const op = OP_OF_ACTION[action];
  if (!op) throw apiError("INVALID_INPUT", { details: { field: "action" } });

  const context = await groupContext(principal, groupId);
  const sock = await currentSocket();
  if (!sock) throw apiError("BOT_OFFLINE");

  const groupPrincipal = {
    ...principal,
    inGroup: true,
    groupId: context.groupId,
    isGroupAdmin: context.isGroupAdmin,
    isGroupOwner: context.isGroupOwner,
    botIsAdmin: context.botIsAdmin,
    level: principal.isOwner ? "owner" : context.isGroupAdmin ? "group-admin" : "user",
  };

  // الأهداف تُحلّ من الدليل الحيّ: لا jid من العميل يصل إلى واتساب
  const selected = [];
  for (const ref of Array.isArray(targetRefs) ? targetRefs.slice(0, 50) : []) {
    const member = [...context.directory.members.values()].find((m) => (m.canonical || m.id) === String(ref));
    if (member) selected.push({ jid: member.pn || member.lid || member.id, id: member.id, canonical: member.canonical });
  }
  if (!selected.length) throw apiError("NEEDS_TARGET");

  // الصلاحية والسياسة (تأكيد المدمّر · الجماعي لا يُتجاوَز) من المحرّك الأصلي
  requirePermission({ principal: groupPrincipal, action, targets: selected, confirmed });

  const { planMembers, participantsBulk } = await import("../../lib/terboo-group-actions.js");
  const plan = await planMembers({
    sock,
    groupId: context.groupId,
    principal: groupPrincipal,
    action,
    op,
    mode: "selected",
    selected,
  });
  if (!plan?.ok) throw apiError("SERVICE_UNAVAILABLE", { details: { reason: plan?.code || "plan-failed" } });

  const excluded = (plan.excluded || []).map((x) => ({ ref: x.target?.canonical || "", reason: x.reason }));
  const already = (plan.already || []).map((x) => x.canonical || "");
  const missing = (plan.missing || []).map((x) => x.canonical || x.jid || "");

  if (!plan.targets.length) {
    // لا هدف قابل للتنفيذ: يُقال السبب بوضوح بدل نجاح فارغ
    return { ok: false, op, applied: [], failed: [], excluded, already, missing, verified: true, reason: "no-eligible-target" };
  }

  const report = await participantsBulk({ sock, groupId: context.groupId, targets: plan.targets, op, signal });

  return {
    ok: report.failed.length === 0 && report.succeeded.length > 0,
    op,
    applied: report.succeeded,
    failed: report.failed.map((entry) => (typeof entry === "string" ? { ref: entry, reason: "" } : { ref: entry.key || "", reason: entry.code || "" })),
    excluded,
    already,
    missing,
    // الحقيقة كما يعيدها المنفّذ: لا ادّعاء نجاح بلا تحقق
    verified: report.verified !== false,
    cancelled: Boolean(report.cancelled),
    rateLimited: report.rateLimited || 0,
  };
}

export { OP_OF_ACTION, currentSocket, groupContext, memberAction, members, myGroups, setSocketProvider };
