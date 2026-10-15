// تشغيل الأدوات والـscrapers: فوري للسريع، ومهمة خلفية للطويل
import { apiError } from "../../errors.js";
import { getTool } from "../../../lib/terboo-tool-registry.js";
import { requirePermission } from "../../services/permission-service.js";
import { run as runTool } from "../../services/tool-service.js";
import { startTask } from "../../services/task-service.js";
import { readArtifactBuffer } from "../../services/upload-service.js";
import { audit } from "../../services/audit-service.js";

/** حقول المخطّط التي تعني «بايتات وسيط» */
const BINARY_FIELDS = Object.freeze(["image", "audio", "video", "file"]);

/** يحوّل مراجع الملفات المرفوعة إلى بايتات مملوكة */
function resolveAttachments(principal, input) {
  const out = { ...input };
  for (const field of BINARY_FIELDS) {
    const ref = out[field];
    if (!ref || typeof ref !== "string") continue;
    const { record, buffer } = readArtifactBuffer(principal, ref);
    out[field] = buffer;
    if (!out.fileName && record.name) out.fileName = record.name;
    if (!out.mimetype && record.mime) out.mimetype = record.mime;
  }
  return out;
}

function register(router) {
  /**
   * تشغيل مباشر: يُعاد الناتج في نفس الطلب.
   * أدوات طويلة (أكبر من 20 ثانية مهلة) تُنصح بالمسار الخلفي.
   */
  router.post("/tools/:toolId/run", async (ctx) => {
    const tool = getTool(ctx.params.toolId);
    if (!tool) throw apiError("NOT_FOUND");

    const input = resolveAttachments(ctx.principal, ctx.body.input && typeof ctx.body.input === "object" ? ctx.body.input : {});
    const result = await runTool({
      principal: ctx.principal,
      toolId: ctx.params.toolId,
      input,
      lang: ctx.session?.lang || "ar",
      signal: ctx.controller.signal,
    });
    audit({
      actor: ctx.principal.canonical, action: "web.tool.run", target: tool.id,
      outcome: result.ok ? "ok" : "failed", requestId: ctx.requestId,
      details: { latencyMs: result.latencyMs, error: result.error },
    });
    ctx.json(result.ok ? 200 : 502, { result });
  });

  /** تشغيل خلفي: يُعاد معرّف مهمة تُتابع من /me/tasks */
  router.post("/tools/:toolId/jobs", (ctx) => {
    const tool = getTool(ctx.params.toolId);
    if (!tool) throw apiError("NOT_FOUND");
    // الصلاحية تُفحص الآن، لا عند تشغيل المهمة
    requirePermission({ principal: ctx.principal, action: tool.permission === "owner" ? "web.tool.run.owner" : tool.permission === "premium" ? "web.tool.run.premium" : "web.tool.run" });

    const input = resolveAttachments(ctx.principal, ctx.body.input && typeof ctx.body.input === "object" ? ctx.body.input : {});
    const principal = ctx.principal;
    const lang = ctx.session?.lang || "ar";

    const task = startTask({
      principal,
      type: `web.tool:${tool.id}`,
      title: tool.id,
      tool: tool.id,
      timeoutMs: (tool.timeoutMs || 60_000) + 15_000,
      run: async ({ signal } = {}) => runTool({ principal, toolId: tool.id, input, lang, signal }),
    });
    audit({ actor: principal.canonical, action: "web.tool.job", target: tool.id, outcome: "queued", requestId: ctx.requestId, details: { taskId: task.id } });
    ctx.json(202, { taskId: task.id, status: task.status, poll: `/api/v1/me/tasks/${task.id}` });
  });

  /** مسار مكافئ للـscrapers بمعرّفها في السجل المركزي */
  router.post("/scrapers/:scraperId/run", async (ctx) => {
    const toolId = `scraper:${ctx.params.scraperId}`;
    const tool = getTool(toolId) || getTool(ctx.params.scraperId);
    if (!tool) throw apiError("NOT_FOUND");
    const input = resolveAttachments(ctx.principal, ctx.body.input && typeof ctx.body.input === "object" ? ctx.body.input : {});
    const result = await runTool({
      principal: ctx.principal,
      toolId: tool.id,
      input,
      lang: ctx.session?.lang || "ar",
      signal: ctx.controller.signal,
    });
    ctx.json(result.ok ? 200 : 502, { result });
  });
}

export { BINARY_FIELDS, register, resolveAttachments };
