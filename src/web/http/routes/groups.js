// المجموعات: قراءة وإجراءات بتحقق حيّ من واتساب
import { requirePermission } from "../../services/permission-service.js";
import { groupContext, memberAction, members, myGroups } from "../../services/group-service.js";
import { audit } from "../../services/audit-service.js";
import { apiError } from "../../errors.js";

/** الأفعال المسموح طلبها من الموقع (كل منها فعل حقيقي في محرّك الصلاحيات) */
const ALLOWED_ACTIONS = new Set([
  "group.member.kick", "group.member.promote", "group.member.demote",
  "group.members.kickSelected", "group.members.promoteSelected", "group.members.demoteSelected",
]);

function register(router) {
  router.get("/groups", async (ctx) => {
    ctx.json(200, { groups: await myGroups(ctx.principal) });
  });

  router.get("/groups/:groupId", async (ctx) => {
    const context = await groupContext(ctx.principal, ctx.params.groupId);
    ctx.json(200, {
      group: {
        groupId: context.groupId,
        subject: context.subject,
        size: context.size,
        isGroupAdmin: context.isGroupAdmin,
        isGroupOwner: context.isGroupOwner,
        botIsAdmin: context.botIsAdmin,
        // الواجهة تعطّل الأزرار بحسب هذه الحقيقة لا بحسب تخمين
        actionsAvailable: context.isGroupAdmin && context.botIsAdmin === true,
        actionsBlockedReason: !context.isGroupAdmin
          ? "you-are-not-a-group-admin"
          : context.botIsAdmin === true ? "" : "bot-is-not-a-group-admin",
      },
    });
  });

  router.get("/groups/:groupId/members", async (ctx) => {
    ctx.json(200, await members(ctx.principal, ctx.params.groupId));
  });

  /**
   * إجراء على أعضاء. الجماعي يحتاج confirm=true ولا يُتجاوَز،
   * والنتيجة تُعاد كما أثبتها المنفّذ (verified) بلا ادّعاء.
   */
  router.post("/groups/:groupId/members/action", async (ctx) => {
    const action = String(ctx.body.action || "");
    if (!ALLOWED_ACTIONS.has(action)) throw apiError("INVALID_INPUT", { details: { field: "action" } });

    const result = await memberAction({
      principal: ctx.principal,
      groupId: ctx.params.groupId,
      action,
      targetRefs: Array.isArray(ctx.body.targets) ? ctx.body.targets : [],
      confirmed: ctx.body.confirm === true,
      signal: ctx.controller.signal,
    });
    audit({
      actor: ctx.principal.canonical, action: `web.${action}`, target: ctx.params.groupId,
      outcome: result.ok ? "ok" : "partial-or-refused", requestId: ctx.requestId,
      details: { applied: result.applied.length, failed: result.failed.length, verified: result.verified },
    });
    ctx.json(200, result);
  });
}

export { ALLOWED_ACTIONS, register };
