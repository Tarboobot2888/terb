// ═══════════════════════════════════════════════
// 🛡️ Terboo Web — خدمة الصلاحيات (محرّك واحد، جدول أفعال للويب)
// ───────────────────────────────────────────────
// المبادئ التي يفرضها هذا الملف:
//   • الدور يُقرأ وقت التنفيذ من config.isOwner/isPremium/isPartner/isBanned
//     (وهي تقرأ config + قاعدة البيانات لحظياً) ومن الهوية القانونية — لا من
//     role/userId/jid/isOwner في جسم الطلب أو الكوكي أبداً.
//   • القرار يصدر من decide() في terboo-permissions.js نفسه، بسياسة محقونة
//     لأفعال الويب ⇒ لا محرّك قرار ثانٍ.
//   • مشرف المجموعة ليس مالك الموقع: WEB_ACTIONS لا تمنح group-admin أي فعل إدارة عامة.
//   • المحظور لا يُخدَم حتى لو حمل جلسة سابقة: الفحص في كل طلب.
// ═══════════════════════════════════════════════

import config from "../../../config.js";
import { DECISION, LEVEL, decide } from "../../lib/terboo-permissions.js";
import { apiError, permissionError } from "../errors.js";

/**
 * أفعال الويب بنفس شكل سياسة المحرّك:
 *   min · scope(group|global) · target · destructive · confirm · bulk · ownerBypass · botAdmin · provider
 * ما ليس هنا مرفوض تلقائياً (unknown-action) — لا يوجد «افتراضياً مسموح».
 */
const WEB_ACTIONS = Object.freeze({
  // ── الحساب ──
  "web.me.read": { min: LEVEL.USER, scope: "global" },
  "web.me.preferences.write": { min: LEVEL.USER, scope: "global" },
  "web.me.memory.read": { min: LEVEL.USER, scope: "global" },
  "web.me.memory.forget": { min: LEVEL.USER, scope: "global", destructive: true, confirm: true },
  "web.sessions.read": { min: LEVEL.USER, scope: "global" },
  "web.sessions.revoke": { min: LEVEL.USER, scope: "global", destructive: true },

  // ── السجل والقدرات ──
  "web.catalog.read": { min: LEVEL.USER, scope: "global" },

  // ── الذكاء الاصطناعي ──
  "web.ai.converse": { min: LEVEL.USER, scope: "global" },
  "web.ai.conversation.read": { min: LEVEL.USER, scope: "global" },
  "web.ai.conversation.write": { min: LEVEL.USER, scope: "global" },
  "web.ai.conversation.delete": { min: LEVEL.USER, scope: "global", destructive: true },

  // ── الوسائط والأدوات ──
  "web.media.upload": { min: LEVEL.USER, scope: "global" },
  "web.tool.run": { min: LEVEL.USER, scope: "global" },
  "web.tool.run.premium": { min: LEVEL.USER, scope: "global" },   // يُفحص premium فوق القرار
  "web.tool.run.owner": { min: LEVEL.OWNER, scope: "global" },
  "web.artifact.read": { min: LEVEL.USER, scope: "global" },

  // ── المهام ──
  "web.task.read": { min: LEVEL.USER, scope: "global" },
  "web.task.cancel": { min: LEVEL.USER, scope: "global" },

  // ── الألعاب ──
  "web.game.read": { min: LEVEL.USER, scope: "global" },
  "web.game.play": { min: LEVEL.USER, scope: "global" },

  // ── البوتات الفرعية (ملكية صاحب الحساب) ──
  "web.subbot.read": { min: LEVEL.USER, scope: "global" },
  // تنصيب بوت فرعي من الموقع: يصبح الحساب اتصال واتساب مستقلاً ⇒ تأكيد صريح
  "web.subbot.provision": { min: LEVEL.USER, scope: "global", confirm: true },

  // ── لوحة المالك ──
  "web.owner.overview": { min: LEVEL.OWNER, scope: "global" },
  "web.owner.users.read": { min: LEVEL.OWNER, scope: "global" },
  "web.owner.users.ban": { min: LEVEL.OWNER, scope: "global", target: true, destructive: true, confirm: true, ownerBypass: true },
  "web.owner.users.unban": { min: LEVEL.OWNER, scope: "global", target: true },
  "web.owner.users.premium": { min: LEVEL.OWNER, scope: "global", target: true, confirm: true, ownerBypass: true },
  "web.owner.jobs.read": { min: LEVEL.OWNER, scope: "global" },
  "web.owner.providers.read": { min: LEVEL.OWNER, scope: "global" },
  "web.owner.audit.read": { min: LEVEL.OWNER, scope: "global" },
  "web.owner.website.read": { min: LEVEL.OWNER, scope: "global" },
  "web.owner.website.write": { min: LEVEL.OWNER, scope: "global", destructive: true, confirm: true, ownerBypass: true },
  "web.owner.domain.verify": { min: LEVEL.OWNER, scope: "global" },
});

/**
 * الأفعال الأساسية في terboo-permissions.js التي يستعملها الويب كما هي
 * (لا تُعاد تعريفها هنا: الويب يطلبها بالاسم فيقرأ المحرّك سياستها الأصلية).
 */
const CORE_ACTIONS_USED_BY_WEB = Object.freeze([
  "group.members.list", "group.admins.list", "group.settings.get",
  "group.member.kick", "group.member.promote", "group.member.demote",
  "group.members.kickSelected", "group.members.promoteSelected", "group.members.demoteSelected",
  "group.settings.lock", "group.settings.unlock", "group.subject.set",
  "group.description.set", "group.invite.get", "group.invite.revoke",
  "childbots.list", "task.cancel",
]);

/**
 * الهوية الفعلية لصاحب الجلسة وقت التنفيذ.
 * كل علم يُحسب الآن من المصدر الحقيقي — لا شيء منه يأتي من الطلب.
 * @param {{canonical:string, digits:string, pn:string}} identity
 * @param {{groupId?:string, isGroupAdmin?:boolean, botIsAdmin?:boolean}} [groupContext]
 *   سياق المجموعة يُملأ من بيانات المجموعة الحيّة في GroupService، لا من العميل.
 */
function webPrincipal(identity, groupContext = null) {
  const pn = identity?.pn || "";
  const isOwner = Boolean(pn && config.isOwner(pn));
  const principal = {
    canonical: identity?.canonical || "",
    sender: pn,
    number: identity?.digits || "",
    channel: "web",
    isOwner,
    isPartner: Boolean(pn && config.isPartner(pn)),
    isPremium: Boolean(pn && config.isPremium(pn)),
    // المالك لا يُحظر (نفس قاعدة config.isBanned)
    isBanned: Boolean(pn && config.isBanned(pn)),
    inGroup: false,
    groupId: "",
    isGroupAdmin: false,
    isGroupOwner: false,
    botIsAdmin: null,
  };
  if (groupContext?.groupId) {
    principal.inGroup = true;
    principal.groupId = String(groupContext.groupId);
    principal.isGroupAdmin = Boolean(groupContext.isGroupAdmin);
    principal.isGroupOwner = Boolean(groupContext.isGroupOwner);
    principal.botIsAdmin = typeof groupContext.botIsAdmin === "boolean" ? groupContext.botIsAdmin : null;
  }
  principal.level = principal.isOwner
    ? LEVEL.OWNER
    : principal.isGroupAdmin
      ? LEVEL.GROUP_ADMIN
      : LEVEL.USER;
  return principal;
}

/**
 * قرار صلاحية لفعل ويب أو فعل أساسي.
 * @returns {{decision:string, allowed:boolean, reason:string, action:string}}
 */
function decideWeb({ principal, action, targets = null, confirmed = false, explicit = false, resource = {} }) {
  // الحظر يسبق كل شيء ولا يُتجاوز بجلسة قديمة
  if (principal?.isBanned) return { decision: DECISION.DENIED, allowed: false, reason: "banned", action };

  const override = WEB_ACTIONS[action] || null;
  if (!override && !CORE_ACTIONS_USED_BY_WEB.includes(action)) {
    return { decision: DECISION.DENIED, allowed: false, reason: "unknown-action", action };
  }
  return decide({ principal, action, targets, confirmed, explicit, resource, policy: override });
}

/** يرمي ApiError المناسب إن لم يكن الفعل مسموحاً؛ وإلا يعيد القرار */
function requirePermission(input) {
  const principal = input?.principal;
  if (principal?.isBanned) throw apiError("ACCOUNT_BANNED");
  const decision = decideWeb(input);
  if (!decision.allowed) throw permissionError(decision);
  return decision;
}

/**
 * سياق تصريح للأدوات: الحقلان الوحيدان الذي يقرأهما checkPermission في
 * terboo-scraper-registry.js. يُحسبان هنا من الهوية الحقيقية، فلا يصل شيء
 * من المتصفح إلى مسار التنفيذ. ليس رسالة واتساب: لا id ولا key ولا reply ولا chat.
 */
function toolAuthContext(principal) {
  return Object.freeze({
    isOwner: principal?.isOwner === true,
    isPremium: principal?.isPremium === true || principal?.isOwner === true,
  });
}

/** مصفوفة صلاحيات الويب للتوثيق (docs/web-platform) */
function webPermissionMatrix() {
  const sample = (level) => ({
    canonical: `pn:${level}`,
    isOwner: level === LEVEL.OWNER,
    isPremium: false,
    isBanned: false,
    inGroup: true,
    isGroupAdmin: level === LEVEL.GROUP_ADMIN,
    botIsAdmin: true,
    level,
  });
  const levels = [LEVEL.OWNER, LEVEL.GROUP_ADMIN, LEVEL.USER];
  const rows = Object.entries(WEB_ACTIONS).map(([action, policy]) => ({
    action,
    source: "web",
    ...policy,
    decisions: Object.fromEntries(levels.map((l) => [l, decideWeb({ principal: sample(l), action }).decision])),
  }));
  const core = CORE_ACTIONS_USED_BY_WEB.map((action) => ({
    action,
    source: "core:terboo-permissions.js",
    decisions: Object.fromEntries(levels.map((l) => [l, decideWeb({ principal: sample(l), action }).decision])),
  }));
  return [...rows, ...core];
}

export {
  CORE_ACTIONS_USED_BY_WEB,
  WEB_ACTIONS,
  decideWeb,
  requirePermission,
  toolAuthContext,
  webPermissionMatrix,
  webPrincipal,
};
