// ═══════════════════════════════════════════════
// 🛡️ Terboo Permission Engine — محرّك الصلاحيات المركزي
// ───────────────────────────────────────────────
// المستويات: owner · group-admin (في نطاق مجموعته) · user
// كل أداة/إجراء يمر من decide() بقرار صريح:
//   allowed · denied · needs-confirmation · needs-target · needs-owner · provider-not-available
// الهوية تُحسب وقت التنفيذ من المرسل نفسه (PN/LID ⇒ هوية قانونية) وبيانات المجموعة الحيّة،
// لا من اسم أو JID يمرره النموذج. النموذج لا يمنح صلاحية ولا يتجاوزها.
// التأكيد مركزي: المدمّر يحتاج تأكيداً؛ المالك فقط يتجاوزه حين يكون الطلب صريحاً والسياسة تسمح (لا للجماعي أبداً).
// ═══════════════════════════════════════════════

import { isOwner as configIsOwner, isPartner, isPremium } from "../../config.js";
import { noteFailure } from "./terboo-failure-log.js";
import { identityOf, isBot } from "./terboo-identity.js";

const LEVEL = Object.freeze({ OWNER: "owner", GROUP_ADMIN: "group-admin", USER: "user" });
const DECISION = Object.freeze({
  ALLOWED: "allowed", DENIED: "denied", NEEDS_CONFIRMATION: "needs-confirmation", NEEDS_TARGET: "needs-target",
  NEEDS_OWNER: "needs-owner", PROVIDER_NOT_AVAILABLE: "provider-not-available",
});

/**
 * سياسة كل إجراء:
 *  min: أدنى مستوى · scope: group|global|resource · botAdmin: البوت يجب أن يكون مشرفاً
 *  target: يحتاج هدفاً · destructive (يغيّر/يزيل) · confirm: يحتاج تأكيداً قبل التنفيذ · bulk (تأكيد دائماً، بلا تجاوز)
 *  · ownerBypass: المالك يتجاوز التأكيد بطلب صريح
 *  طرد/تنزيل عضو واحد محدد بوضوح: مدمّر لكن بلا تأكيد (هدف واحد مُتحقق منه + زر تراجع)؛ الغامض يُسأل عنه في المحلل.
 *  provider: مزوّد يجب أن يكون مُعداً (SSH فقط)
 */
const ACTIONS = Object.freeze({
  // ── المجموعات ──
  "group.members.list": { min: LEVEL.USER, scope: "group" },
  "group.admins.list": { min: LEVEL.USER, scope: "group" },
  "group.member.presence": { min: LEVEL.USER, scope: "group" },
  "group.settings.get": { min: LEVEL.USER, scope: "group" },
  "group.member.add": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true, target: true },
  "group.member.readd": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true, target: true },
  "group.member.kick": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true, target: true, destructive: true },
  "group.member.promote": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true, target: true },
  "group.member.demote": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true, target: true, destructive: true },
  "group.member.warn": { min: LEVEL.GROUP_ADMIN, scope: "group", target: true },
  "group.member.mute": { min: LEVEL.GROUP_ADMIN, scope: "group", target: true },
  "group.member.unmute": { min: LEVEL.GROUP_ADMIN, scope: "group", target: true },
  "group.members.kickAll": { min: LEVEL.OWNER, scope: "group", botAdmin: true, destructive: true, confirm: true, bulk: true },
  // عدة أعضاء محددين بالاسم/المنشن: المشرف يقدر عليهم فرداً فرداً أصلاً ⇒ نفس المستوى، مع تأكيد جماعي إلزامي
  "group.members.kickSelected": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true, target: true, destructive: true, confirm: true, bulk: true },
  "group.members.promoteSelected": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true, target: true, confirm: true, bulk: true },
  "group.members.demoteSelected": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true, target: true, destructive: true, confirm: true, bulk: true },
  "group.settings.lock": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true },
  "group.settings.schedule": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true },
  "group.settings.unlock": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true },
  "group.settings.restrict": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true },
  "group.settings.unrestrict": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true },
  "group.subject.set": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true },
  "group.description.set": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true },
  "group.invite.get": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true },
  "group.invite.revoke": { min: LEVEL.GROUP_ADMIN, scope: "group", botAdmin: true, destructive: true, confirm: true, ownerBypass: true },
  // ── حساب البوت والرسائل ──
  "contact.block": { min: LEVEL.OWNER, scope: "global", target: true, destructive: true, confirm: true, ownerBypass: true },
  "contact.unblock": { min: LEVEL.OWNER, scope: "global", target: true },
  "message.send_to_contact": { min: LEVEL.OWNER, scope: "global", target: true },
  "broadcast.run": { min: LEVEL.OWNER, scope: "global", bulk: true, confirm: true },
  "childbots.list": { min: LEVEL.OWNER, scope: "global" },
  "task.cancel": { min: LEVEL.USER, scope: "global" },
  // ── SSH / المشاريع ──
  "ssh.read": { min: LEVEL.OWNER, scope: "global", provider: "ssh" },
  "ssh.exec": { min: LEVEL.OWNER, scope: "global", provider: "ssh" },
  "ssh.write": { min: LEVEL.OWNER, scope: "global", provider: "ssh", destructive: true, confirm: true, ownerBypass: true },
  "project.read": { min: LEVEL.OWNER, scope: "global" },
  "project.write": { min: LEVEL.OWNER, scope: "global", destructive: true, confirm: true, ownerBypass: true },
  "project.deploy": { min: LEVEL.OWNER, scope: "global", provider: "ssh", destructive: true, confirm: true, ownerBypass: true },
});

/** المزوّدات المُعدّة فعلاً (لا أزرار ولا أدوات لما لم يُعدّ) */
function providerAvailable(name) {
  try {
    if (name === "ssh") return Boolean(global.terbooSshHostCount?.() > 0);
  } catch (error) {
    noteFailure("permissions", error, { where: "terboo-permissions:providerAvailable", stage: name, fallback: "unavailable" });
  }
  return false;
}

/** رقم هاتف المرسل الحقيقي (LID ⇒ PN عبر الهوية) — لأنظمة الأدوار القديمة التي تحفظ أرقاماً */
function phoneOf(jid) {
  const id = identityOf(String(jid || ""));
  return id.number || "";
}

/**
 * لا أنظمة أدوار قديمة بعد إزالة إدارة VPS واللوحات: لا فئة تُحجب هنا.
 * تبقى الدالة والمجموعة للتوافق مع المستوردين، وتعيد السماح دائماً.
 */
const LEGACY_ROLE_CATEGORIES = new Set();
function legacyRoleAccess() {
  return true;
}

/** المالك: المرسل (PN أو مقابل LID) في قائمة المالكين، أو البوت نفسه */
function ownerByIdentity(m) {
  if (m?.fromMe) return true;
  const id = identityOf(String(m?.sender || ""));
  // LID بلا رقم معروف بعد: لا يمكن المطابقة هنا ⇒ علم serialize (يقرأ participantAlt) هو الدليل الوحيد
  return Boolean((id.pn && configIsOwner(id.pn)) || (id.number && configIsOwner(id.number)) || (id.lid && !id.pn && m?.isOwner === true));
}

/**
 * الهوية الفعلية وقت التنفيذ.
 * @param {{m:Object, sock?:Object, fresh?:boolean}} input
 */
async function principalOf({ m, sock = null, fresh = false }) {
  const id = identityOf(String(m?.sender || ""));
  const principal = {
    canonical: id.canonical, sender: m?.sender || "", number: id.number || "",
    isOwner: ownerByIdentity(m),
    isPartner: Boolean(id.pn && isPartner(id.pn)),
    isPremium: Boolean(id.pn && isPremium(id.pn)),
    inGroup: Boolean(m?.isGroup), groupId: m?.isGroup ? m.chat : "",
    isGroupAdmin: false, isGroupOwner: false, botIsAdmin: null,
  };
  if (m?.isGroup) {
    let member = null;
    let botMember = null;
    try {
      const { getDirectory, memberByJid } = await import("./terboo-group-directory.js");
      const dir = await getDirectory(sock, m.chat, { refresh: fresh });
      if (dir) {
        member = memberByJid(dir, m.sender);
        const botJids = [sock?.user?.id, sock?.user?.lid].filter(Boolean);
        botMember = botJids.map((j) => memberByJid(dir, j)).find(Boolean) || [...dir.members.values()].find((x) => isBot(x.pn || x.lid || x.id, sock)) || null;
      }
    } catch (error) {
      noteFailure("permissions", error, { where: "terboo-permissions:principalOf", stage: "directory", fallback: "message-flags" });
    }
    // بيانات المجموعة الحيّة أولاً؛ أعلام الرسالة (من serialize) فقط حين لا يتوفر الدليل
    principal.isGroupAdmin = member ? Boolean(member.admin) : Boolean(m.isAdmin);
    principal.isGroupOwner = member ? member.admin === "superadmin" : false;
    principal.botIsAdmin = botMember ? Boolean(botMember.admin) : (typeof m.isBotAdmin === "boolean" ? m.isBotAdmin : null);
  }
  principal.level = principal.isOwner ? LEVEL.OWNER : principal.isGroupAdmin ? LEVEL.GROUP_ADMIN : LEVEL.USER;
  return principal;
}

const result = (decision, reason, extra = {}) => ({ decision, allowed: decision === DECISION.ALLOWED, reason, ...extra });

/**
 * قرار صلاحية لإجراء واحد.
 * @param {{principal:Object, action:string, resource?:{vpsId?:string, panelId?:string}, targets?:Array,
 *          confirmed?:boolean, explicit?:boolean}} input
 *   explicit: طلب المالك صريح ومباشر («اطرده بدون تأكيد») — يسمح بتجاوز التأكيد حيث تسمح السياسة فقط
 */
function decide({ principal, action, resource = {}, targets = null, confirmed = false, explicit = false }) {
  const policy = ACTIONS[action];
  if (!policy) return result(DECISION.DENIED, "unknown-action", { action });
  if (policy.provider && !providerAvailable(policy.provider)) return result(DECISION.PROVIDER_NOT_AVAILABLE, policy.provider, { action });
  if (policy.scope === "group" && !principal.inGroup) return result(DECISION.DENIED, "group-only", { action });
  const owner = principal.isOwner === true;
  if (!owner) {
    if (policy.min === LEVEL.OWNER) return result(DECISION.NEEDS_OWNER, "owner-only", { action });
    if (policy.min === LEVEL.GROUP_ADMIN && !principal.isGroupAdmin) return result(DECISION.DENIED, "needs-group-admin", { action });
  }
  if (policy.botAdmin && principal.botIsAdmin === false) return result(DECISION.DENIED, "bot-not-admin", { action });
  if (policy.target && Array.isArray(targets) && targets.length === 0) return result(DECISION.NEEDS_TARGET, "target", { action });
  if (policy.confirm && !confirmed) {
    const bypass = owner && explicit && policy.ownerBypass && !policy.bulk;
    if (!bypass) return result(DECISION.NEEDS_CONFIRMATION, policy.bulk ? "bulk" : "destructive", { action });
  }
  return result(DECISION.ALLOWED, owner ? "owner" : principal.level, { action });
}

/**
 * حماية الأهداف: من لا يُمس ولماذا (يُذكر في التقرير بدل تجاهل صامت).
 * @param {{principal:Object, action:string, targets:Array<{jid:string, admin?:string|null, canonical?:string}>, sock?:Object,
 *          allowAdmins?:boolean}} input
 * @returns {{allowed:Array, excluded:Array<{target:Object, reason:string}>}}
 */
function protectTargets({ principal, action, targets, sock = null, allowAdmins = false }) {
  const allowed = [];
  const excluded = [];
  const removal = /kick|demote|block/.test(action);
  for (const target of targets || []) {
    const jid = target.jid || target.pn || target.lid || target.id || "";
    const canonical = target.canonical || identityOf(jid).canonical;
    if (isBot(jid, sock) || (target.lid && isBot(target.lid, sock))) { excluded.push({ target, reason: "bot-itself" }); continue; }
    if (removal && canonical && canonical === principal.canonical) { excluded.push({ target, reason: "requester-self" }); continue; }
    if (removal && target.admin === "superadmin") { excluded.push({ target, reason: "group-creator" }); continue; }
    const targetIsOwner = Boolean(identityOf(jid).pn && configIsOwner(identityOf(jid).pn));
    if (removal && targetIsOwner) { excluded.push({ target, reason: "bot-owner-protected" }); continue; }
    // المشرفون محميون في «الكل» فقط (لم يُسمَّ أحد)؛ من سُمّي صراحةً بالاسم/المنشن مقصود (وتنزيل المشرف يستهدف مشرفاً أصلاً)
    if (removal && /kickAll/.test(action) && target.admin && !allowAdmins) { excluded.push({ target, reason: "admin-protected" }); continue; }
    allowed.push(target);
  }
  return { allowed, excluded };
}

/** مصفوفة الصلاحيات (docs/terboo-permission-matrix.json) */
function permissionMatrix() {
  const levels = [LEVEL.OWNER, LEVEL.GROUP_ADMIN, LEVEL.USER];
  const sample = (level) => ({
    canonical: `pn:${level}`, isOwner: level === LEVEL.OWNER, inGroup: true, isGroupAdmin: level === LEVEL.GROUP_ADMIN,
    botIsAdmin: true, level,
  });
  return Object.entries(ACTIONS).map(([action, policy]) => ({
    action,
    ...policy,
    decisions: Object.fromEntries(levels.map((level) => [level, decide({ principal: sample(level), action }).decision])),
  }));
}

export { ACTIONS, DECISION, LEGACY_ROLE_CATEGORIES, LEVEL, decide, legacyRoleAccess, ownerByIdentity, permissionMatrix, phoneOf, principalOf, protectTargets, providerAvailable };
export default { decide, principalOf, protectTargets, permissionMatrix, providerAvailable, phoneOf, LEVEL, DECISION, ACTIONS };
