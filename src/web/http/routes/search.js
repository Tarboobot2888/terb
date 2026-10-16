// مركز البحث: مصادر حقيقية من السجل + تنفيذ عبر tool-service.
// منفصل عن التنزيلات: لا تنزيل تلقائي لأي نتيجة.
import { requirePermission } from "../../services/permission-service.js";
import { search, searchSources } from "../../services/search-service.js";

function register(router) {
  /** مصادر البحث المسجّلة فعلاً وحالتها */
  router.get("/search/sources", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.catalog.read" });
    ctx.json(200, { sources: searchSources() });
  });

  /** تنفيذ بحث — الإلغاء عبر AbortSignal الحقيقي للطلب */
  router.post("/search", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.tool.run" });
    const outcome = await search({
      principal: ctx.principal,
      query: String(ctx.body?.query || ""),
      source: ctx.body?.source ? String(ctx.body.source) : "",
      lang: ctx.session?.lang || "ar",
      signal: ctx.controller.signal,
    });
    ctx.json(200, outcome);
  });
}

export { register };
