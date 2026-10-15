// الرفع والملفات الناتجة والتنزيل المحمي
import fs from "node:fs";
import { apiError } from "../../errors.js";
import { websiteConfig } from "../../config.js";
import { requirePermission } from "../../services/permission-service.js";
import { listArtifacts, openArtifact, removeArtifact, storeUpload } from "../../services/upload-service.js";
import { audit } from "../../services/audit-service.js";

function register(router) {
  /**
   * رفع ملف واحد كبايتات خام.
   * لا multipart: المتصفح يرسل الملف مباشرة مع X-File-Name،
   * فلا محلّل multipart جديد ولا سطح هجوم إضافي.
   */
  router.post("/media/uploads", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.media.upload" });
    const buffer = await ctx.rawBody();
    const artifact = await storeUpload({
      principal: ctx.principal,
      buffer,
      fileName: String(ctx.req.headers["x-file-name"] || "").slice(0, 200),
      declaredType: String(ctx.req.headers["content-type"] || ""),
    });
    audit({
      actor: ctx.principal.canonical, action: "web.media.upload", target: artifact.id,
      outcome: "ok", requestId: ctx.requestId,
      details: { kind: artifact.kind, mime: artifact.mime, bytes: artifact.bytes },
    });
    ctx.json(201, { file: artifact });
  }, { rawBody: true, maxBytes: websiteConfig().limits.uploadBytes });

  router.get("/artifacts", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.artifact.read" });
    ctx.json(200, { files: listArtifacts(ctx.principal) });
  });

  /**
   * تنزيل ملف مملوك. غير مملوك أو منتهٍ ⇒ 404 بلا تمييز.
   * التنزيل دائماً attachment بنوع محدد: لا تنفيذ HTML من أصل الموقع.
   */
  router.get("/artifacts/:id", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.artifact.read" });
    const record = openArtifact(ctx.principal, ctx.params.id);
    const safeName = record.name.replace(/["\\\r\n]/g, "_");
    ctx.res.writeHead(200, {
      "Content-Type": record.mime,
      "Content-Length": String(record.bytes),
      // دائماً تنزيل، وبلا تخزين وسيط مشترك
      "Content-Disposition": `attachment; filename="${encodeURIComponent(safeName)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (ctx.method === "HEAD") {
      ctx.res.end();
      return;
    }
    fs.createReadStream(record.file).on("error", () => ctx.res.end()).pipe(ctx.res);
  });

  router.delete("/artifacts/:id", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.artifact.read" });
    openArtifact(ctx.principal, ctx.params.id);         // الملكية قبل الحذف
    const removed = removeArtifact(ctx.params.id);
    if (!removed) throw apiError("NOT_FOUND");
    audit({ actor: ctx.principal.canonical, action: "web.artifact.delete", target: ctx.params.id, outcome: "ok", requestId: ctx.requestId });
    ctx.json(200, { deleted: true });
  });
}

export { register };
