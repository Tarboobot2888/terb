// لوحة المالك: إجراءات محددة من قائمة بيضاء، كلها بتدقيق.
// لا shell ولا eval ولا قراءة ملفات ولا أسرار — بأي صورة.
import { apiError } from "../../errors.js";
import { requirePermission, webPermissionMatrix } from "../../services/permission-service.js";
import { listUsersForOwner, userStats } from "../../services/user-service.js";
import { audit, auditTrail } from "../../services/audit-service.js";
import { providerStatus } from "../../services/ai-service.js";
import { domainStatus, overview as domainOverview, issueTls, setDomain, tlsStatus, verifyDomain } from "../../services/domain-service.js";
import { webStoreStats } from "../../store/web-store.js";
import { websiteState } from "../../url-builder.js";
import { otpStats } from "../../services/otp-service.js";

function register(router, runtime) {
  router.get("/owner/overview", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.overview" });
    const { getQueueSummary } = await import("../../../lib/terboo-task-queue.js");
    const { getPluginCount, getCategories } = await import("../../../lib/terboo-plugins.js");
    const { allTools } = await import("../../../lib/terboo-tool-registry.js");
    let bot = { connected: false, ready: false, uptimeMs: null };
    try {
      const mod = await import("../../../connection.js");
      bot = { connected: Boolean(mod.isConnected?.()), ready: Boolean(mod.getConnectionState?.()?.isReady), uptimeMs: mod.getUptime?.() || null };
    } catch (error) {
      // اتصال واتساب غير محمّل في هذا السياق ⇒ يُعرض كغير متصل بصدق
      bot = { connected: false, ready: false, uptimeMs: null, unavailable: true };
    }
    ctx.json(200, {
      site: websiteState({ listening: Boolean(runtime.listening) }),
      whatsapp: bot,
      users: userStats(),
      registry: { plugins: getPluginCount(), categories: getCategories().length, tools: allTools().length },
      queue: getQueueSummary(),
      store: webStoreStats(),
      auth: otpStats(),
      process: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        rssBytes: process.memoryUsage().rss,
      },
    });
  });

  router.get("/owner/users", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.users.read" });
    ctx.json(200, listUsersForOwner({
      limit: Number(ctx.query.get("limit")) || 50,
      offset: Number(ctx.query.get("offset")) || 0,
      query: (ctx.query.get("q") || "").slice(0, 60),
    }));
  });

  /** حظر/رفع حظر عبر الإعداد الرسمي في قاعدة البيانات، مع إبطال جلسات الموقع */
  router.post("/owner/users/:ref/ban", async (ctx) => {
    requirePermission({
      principal: ctx.principal,
      action: "web.owner.users.ban",
      targets: [{ jid: ctx.params.ref }],
      confirmed: ctx.body.confirm === true,
      explicit: ctx.body.explicit === true,
    });
    const digits = String(ctx.params.ref).replace(/\D/g, "");
    if (!digits) throw apiError("INVALID_INPUT", { details: { field: "ref" } });

    const { identityFromDigits } = await import("../../services/identity-service.js");
    const target = identityFromDigits(digits);
    if (!target) throw apiError("NOT_FOUND");
    // المالك لا يُحظر (نفس قاعدة config.isBanned)
    const config = (await import("../../../../config.js")).default;
    if (config.isOwner(target.pn)) throw apiError("FORBIDDEN", { details: { reason: "owner-cannot-be-banned" } });

    const { getDatabase } = await import("../../../lib/terboo-database.js");
    const db = getDatabase();
    const current = new Set((db.setting("bannedUsers") || []).map(String));
    current.add(digits);
    db.setting("bannedUsers", [...current]);
    db.setUser(target.dbKey, { isBanned: true });
    await db.save();

    // الجلسات القائمة لا تبقى صالحة بعد الحظر
    const { revokeAllSessions } = await import("../../services/session-service.js");
    const revoked = revokeAllSessions(target.canonical);

    audit({ actor: ctx.principal.canonical, action: "web.owner.users.ban", outcome: "ok", requestId: ctx.requestId, targetPhone: digits, details: { sessionsRevoked: revoked } });
    ctx.json(200, { banned: true, sessionsRevoked: revoked });
  });

  router.post("/owner/users/:ref/unban", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.users.unban", targets: [{ jid: ctx.params.ref }] });
    const digits = String(ctx.params.ref).replace(/\D/g, "");
    if (!digits) throw apiError("INVALID_INPUT", { details: { field: "ref" } });
    const { getDatabase } = await import("../../../lib/terboo-database.js");
    const db = getDatabase();
    const remaining = (db.setting("bannedUsers") || []).map(String).filter((value) => value !== digits);
    db.setting("bannedUsers", remaining);
    db.setUser(digits, { isBanned: false });
    await db.save();
    audit({ actor: ctx.principal.canonical, action: "web.owner.users.unban", outcome: "ok", requestId: ctx.requestId, targetPhone: digits });
    ctx.json(200, { banned: false });
  });

  router.get("/owner/jobs", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.jobs.read" });
    const { getQueueSummary, listTasks } = await import("../../../lib/terboo-task-queue.js");
    ctx.json(200, {
      summary: getQueueSummary(),
      // المالك يرى الطابور كله (الملكية تظهر كهوية قانونية لا كرقم)
      tasks: listTasks({ limit: Number(ctx.query.get("limit")) || 50 }).map((task) => ({
        id: task.id, type: task.type, status: task.status, owner: task.owner,
        scope: task.scope, createdAt: task.createdAt, finishedAt: task.finishedAt || null,
      })),
    });
  });

  router.get("/owner/providers", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.providers.read" });
    const { registrySnapshot } = await import("../../../lib/terboo-tool-registry.js");
    ctx.json(200, {
      ai: await providerStatus(),
      // لقطة صحة السجل: بلا مفاتيح وبلا روابط تحمل أسراراً
      tools: registrySnapshot(),
    });
  });

  router.get("/owner/audit", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.audit.read" });
    ctx.json(200, {
      entries: auditTrail({
        limit: Number(ctx.query.get("limit")) || 100,
        action: (ctx.query.get("action") || "").slice(0, 60),
      }),
    });
  });

  router.get("/owner/permissions", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.overview" });
    ctx.json(200, { matrix: webPermissionMatrix() });
  });

  // ── الموقع والدومين و TLS ──
  router.get("/owner/website", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.website.read" });
    ctx.json(200, await domainOverview({ listening: Boolean(runtime.listening) }));
  });

  router.post("/owner/domain", (ctx) => {
    requirePermission({
      principal: ctx.principal,
      action: "web.owner.website.write",
      confirmed: ctx.body.confirm === true,
      explicit: ctx.body.explicit === true,
    });
    const result = setDomain(ctx.body.domain);
    audit({ actor: ctx.principal.canonical, action: "web.owner.domain.set", target: result.domain, outcome: "pending-verification", requestId: ctx.requestId });
    ctx.json(200, result);
  });

  router.post("/owner/domain/verify", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.domain.verify" });
    const result = await verifyDomain();
    audit({ actor: ctx.principal.canonical, action: "web.owner.domain.verify", outcome: result.verified ? "verified" : `failed:${result.reason}`, requestId: ctx.requestId });
    ctx.json(200, result);
  });

  router.get("/owner/domain", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.website.read" });
    ctx.json(200, domainStatus());
  });

  router.get("/owner/tls", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.website.read" });
    ctx.json(200, tlsStatus());
  });

  // الإصدار غير مدعوم من داخل البوت: يُقال بصراحة بدل وعد كاذب
  router.post("/owner/tls/issue", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.owner.website.write", confirmed: true });
    issueTls();
  });
}

export { register };
