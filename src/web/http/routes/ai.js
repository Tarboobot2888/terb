// مساحة الذكاء: محادثات قناة الويب ورسائلها
import { apiError } from "../../errors.js";
import { requirePermission } from "../../services/permission-service.js";
import { converse, providerStatus } from "../../services/ai-service.js";
import {
  archiveConversation, createConversation, deleteAllConversations, deleteConversation,
  listConversations, readConversation, renameConversation,
} from "../../services/conversation-store.js";
import { readArtifactBuffer } from "../../services/upload-service.js";
import { audit } from "../../services/audit-service.js";

function register(router) {
  router.get("/ai/providers", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.ai.converse" });
    const status = await providerStatus();
    // أسماء المزوّدات للمالك فقط؛ غيره يرى القدرة والعدد
    ctx.json(200, ctx.principal.isOwner
      ? status
      : { available: status.available, count: status.count, vision: status.vision.length > 0 });
  });

  router.get("/ai/conversations", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.ai.conversation.read" });
    ctx.json(200, {
      conversations: listConversations(ctx.principal.canonical, {
        includeArchived: ctx.query.get("archived") === "1",
      }),
    });
  });

  router.post("/ai/conversations", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.ai.conversation.write" });
    const created = createConversation(ctx.principal.canonical, {
      title: String(ctx.body.title || "").slice(0, 80),
      lang: ctx.session?.lang || "ar",
    });
    ctx.json(201, { id: created.id, prunedOldest: created.pruned });
  });

  router.get("/ai/conversations/:id", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.ai.conversation.read" });
    ctx.json(200, { conversation: readConversation(ctx.principal.canonical, ctx.params.id) });
  });

  router.patch("/ai/conversations/:id", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.ai.conversation.write" });
    if (typeof ctx.body.title === "string") {
      ctx.json(200, renameConversation(ctx.principal.canonical, ctx.params.id, ctx.body.title));
      return;
    }
    if (typeof ctx.body.archived === "boolean") {
      ctx.json(200, archiveConversation(ctx.principal.canonical, ctx.params.id, ctx.body.archived));
      return;
    }
    throw apiError("INVALID_INPUT", { message: "Provide title or archived." });
  });

  router.delete("/ai/conversations/:id", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.ai.conversation.delete" });
    const removed = deleteConversation(ctx.principal.canonical, ctx.params.id);
    if (!removed) throw apiError("NOT_FOUND");
    audit({ actor: ctx.principal.canonical, action: "web.ai.conversation.delete", target: ctx.params.id, outcome: "ok", requestId: ctx.requestId });
    ctx.json(200, { deleted: true });
  });

  router.post("/ai/conversations/purge", (ctx) => {
    requirePermission({
      principal: ctx.principal,
      action: "web.ai.conversation.delete",
      confirmed: ctx.body.confirm === true,
    });
    const removed = deleteAllConversations(ctx.principal.canonical);
    audit({ actor: ctx.principal.canonical, action: "web.ai.conversation.purge", outcome: "ok", requestId: ctx.requestId, details: { removed } });
    ctx.json(200, { deleted: removed });
  });

  /**
   * رسالة جديدة. مرفق صورة يُشار إليه بمعرّف ملف مرفوع مملوك (لا بايتات في JSON).
   * الإلغاء يمرّ عبر AbortSignal الحقيقي للطلب.
   */
  router.post("/ai/conversations/:id/messages", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.ai.converse" });

    let image = null;
    if (ctx.body.attachmentId) {
      const { record, buffer } = readArtifactBuffer(ctx.principal, String(ctx.body.attachmentId));
      if (record.kind !== "image") {
        throw apiError("INVALID_INPUT", {
          message: "Only an image attachment can be sent with a message here.",
          details: { kind: record.kind },
        });
      }
      image = buffer;
    }

    const answer = await converse({
      principal: ctx.principal,
      conversationId: ctx.params.id,
      text: String(ctx.body.text || ""),
      image,
      lang: ctx.body.lang || ctx.session?.lang || "",
      signal: ctx.controller.signal,
    });
    ctx.json(200, answer);
  });
}

export { register };
