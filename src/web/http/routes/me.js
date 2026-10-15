// الحساب: الملف · التفضيلات · الذاكرة (قراءة/نسيان) · المهام
import { apiError } from "../../errors.js";
import { requirePermission } from "../../services/permission-service.js";
import { profileOf, updatePreferences } from "../../services/user-service.js";
import { audit } from "../../services/audit-service.js";
import { cancelMyTask, myTask, myTasks } from "../../services/task-service.js";
import { listArtifacts } from "../../services/upload-service.js";

function register(router) {
  router.get("/me", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.me.read" });
    ctx.json(200, { profile: profileOf(ctx.identity, ctx.principal) });
  });

  router.patch("/me/preferences", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.me.preferences.write" });
    const result = updatePreferences(ctx.identity, ctx.body);
    if (!result.updated.length) throw apiError("INVALID_INPUT", { message: "No supported preference was provided." });
    audit({ actor: ctx.principal.canonical, action: "web.me.preferences", outcome: "ok", requestId: ctx.requestId, details: { fields: result.updated } });
    ctx.json(200, { updated: result.updated, profile: profileOf(ctx.identity, ctx.principal) });
  });

  /**
   * استخدام/حصص: تُعاد الحدود المُعدّة والمتبقّي الحقيقي من المحدِّدات.
   * لا إحصاءات مخترعة: ما لا مصدر له يبقى null.
   */
  router.get("/me/usage", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.me.read" });
    const limits = await import("../../services/rate-limit-service.js");
    const { websiteConfig } = await import("../../config.js");
    const configured = websiteConfig().limits;
    const canonical = ctx.principal.canonical;
    ctx.json(200, {
      ai: { ...(await limits.peek("ai", canonical, { points: configured.aiMessagesPerHour, durationSeconds: 3600 })), limit: configured.aiMessagesPerHour, window: "1h" },
      tools: { ...(await limits.peek("tool", canonical, { points: configured.toolRunsPerHour, durationSeconds: 3600 })), limit: configured.toolRunsPerHour, window: "1h" },
      uploads: { ...(await limits.peek("upload", canonical, { points: configured.uploadsPerHour, durationSeconds: 3600 })), limit: configured.uploadsPerHour, window: "1h" },
      tasks: { running: myTasks(ctx.principal, { status: ["queued", "running", "waiting"], limit: 50 }).length, limit: configured.tasksPerUser },
      // لا يوجد مصدر حقيقة لاستخدام تاريخي لكل مستخدم في المشروع ⇒ لا نخترعه
      history: null,
    });
  });

  router.get("/me/tasks", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.task.read" });
    ctx.json(200, { tasks: myTasks(ctx.principal, { limit: Number(ctx.query.get("limit")) || 20 }) });
  });

  router.get("/me/tasks/:id", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.task.read" });
    ctx.json(200, { task: myTask(ctx.principal, ctx.params.id) });
  });

  router.post("/me/tasks/:id/cancel", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.task.cancel" });
    const result = cancelMyTask(ctx.principal, ctx.params.id);
    audit({ actor: ctx.principal.canonical, action: "web.task.cancel", target: result.id, outcome: "ok", requestId: ctx.requestId });
    ctx.json(200, result);
  });

  router.get("/me/files", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.artifact.read" });
    ctx.json(200, { files: listArtifacts(ctx.principal, { limit: Number(ctx.query.get("limit")) || 50 }) });
  });

  /** ذاكرة الذكاء التي يملكها المستخدم — قراءة فقط */
  router.get("/me/memory", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.me.memory.read" });
    const memory = await import("../../../lib/terboo-ai-memory.js");
    try {
      const descriptor = memory.scopeOf("user", { userJid: ctx.identity.pn });
      const facts = memory.factsOf(descriptor) || [];
      ctx.json(200, {
        facts: facts.slice(0, 200).map((fact) => ({
          text: fact.text,
          type: fact.type,
          confidence: fact.confidence,
          at: fact.at,
          key: fact.key || "",
        })),
        count: facts.length,
      });
    } catch (error) {
      // الذاكرة غير مهيّأة في هذا البناء ⇒ حالة فارغة صادقة
      ctx.json(200, { facts: [], count: 0, unavailable: true });
    }
  });

  /** نسيان ذاكرة المستخدم — يحتاج تأكيداً صريحاً */
  router.post("/me/memory/forget", async (ctx) => {
    requirePermission({
      principal: ctx.principal,
      action: "web.me.memory.forget",
      confirmed: ctx.body.confirm === true,
    });
    const memory = await import("../../../lib/terboo-ai-memory.js");
    const scopeOnly = ctx.body.scope === "user";
    let removed = 0;
    if (scopeOnly) {
      const descriptor = memory.scopeOf("user", { userJid: ctx.identity.pn });
      removed = memory.forget(descriptor) ? 1 : 0;
    } else {
      // كل مواضع هذا المستخدم عبر الدالة الرسمية
      removed = memory.forgetUserEverywhere(ctx.identity.digits) || 0;
    }
    audit({ actor: ctx.principal.canonical, action: "web.me.memory.forget", outcome: "ok", requestId: ctx.requestId, details: { scope: scopeOnly ? "user" : "everywhere", removed } });
    ctx.json(200, { forgotten: removed });
  });
}

export { register };
