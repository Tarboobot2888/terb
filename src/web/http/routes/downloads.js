// مركز التنزيلات: كتالوج منصات حقيقي · فحص رابط · مهمة خلفية · تاريخ.
// التشغيل يمرّ على tool-service (صلاحيات · SSRF · حدود · مهلة) والطابور الحقيقي.
import { requirePermission } from "../../services/permission-service.js";
import { downloadHistory, platformCatalog, resolveTarget, startDownloadJob } from "../../services/download-service.js";
import { audit } from "../../services/audit-service.js";

function register(router) {
  /** المنصات المدعومة فعلاً (من حقل platforms لأدوات kind=download) */
  router.get("/downloads/platforms", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.catalog.read" });
    ctx.json(200, { platforms: platformCatalog() });
  });

  /** فحص رابط: المنصة والأدوات والتوفّر — بلا أي طلب شبكي */
  router.post("/downloads/resolve", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.catalog.read" });
    ctx.json(200, { target: resolveTarget(ctx.body?.url) });
  });

  /** مهمة تنزيل: يُعاد معرّف مهمة يُتابع من /me/tasks/:id ويُلغى منه */
  router.post("/downloads/jobs", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.tool.run" });
    const target = resolveTarget(ctx.body?.url);
    const scraperId = ctx.body?.scraperId ? String(ctx.body.scraperId) : "";
    const job = startDownloadJob({
      principal: ctx.principal,
      target,
      scraperId,
      lang: ctx.session?.lang || "ar",
    });
    audit({
      actor: ctx.principal.canonical, action: "web.download.job", target: target.platform || target.host,
      outcome: "queued", requestId: ctx.requestId, details: { taskId: job.taskId, scraperId },
    });
    ctx.json(202, job);
  });

  /** تاريخ تنزيلات هذا المستخدم (من الطابور نفسه، لا سجل ثانٍ) */
  router.get("/downloads/history", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.task.read" });
    ctx.json(200, { downloads: downloadHistory(ctx.principal, { limit: Number(ctx.query.get("limit")) || 20 }) });
  });
}

export { register };
