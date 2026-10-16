// البوتات الفرعية: عرض الحالة + تنصيب آمن من الموقع.
// التنصيب يستدعي نفس نواة terboo-jadibot-manager (startJadibot) التي يستدعيها
// مسار واتساب؛ كود الاقتران الحقيقي يُسلَّم للطالب الموثَّق وحده عبر تدفق محمي،
// ولا يُسجَّل ولا يُحفظ. «TARBOOV6» وسم تدفق فقط، ليس رمزاً.
import { requirePermission } from "../../services/permission-service.js";
import { mySubBots } from "../../services/subbot-service.js";
import { cancelProvision, getProvision, startProvision } from "../../services/subbot-provision.js";

function register(router) {
  router.get("/subbots", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.subbot.read" });
    ctx.json(200, await mySubBots(ctx.principal));
  });

  // بدء تنصيب: تأكيد صريح مطلوب (الحساب يصبح اتصال واتساب مستقلاً)
  router.post("/subbots/pair", async (ctx) => {
    requirePermission({
      principal: ctx.principal,
      action: "web.subbot.provision",
      confirmed: ctx.body?.confirm === true,
    });
    const result = await startProvision({
      principal: ctx.principal,
      sessionId: ctx.sessionId,
      ip: ctx.ip,
    });
    ctx.json(201, result);
  });

  // استعلام حالة طلب — يُعاد التحقق من الملكية في كل مرة (requestId وحده لا يكفي)
  router.get("/subbots/pair/:requestId", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.subbot.read" });
    const result = await getProvision({
      principal: ctx.principal,
      sessionId: ctx.sessionId,
      requestId: ctx.params.requestId,
    });
    ctx.json(200, result);
  });

  // إلغاء طلب
  router.post("/subbots/pair/:requestId/cancel", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.subbot.read" });
    const result = await cancelProvision({
      principal: ctx.principal,
      sessionId: ctx.sessionId,
      requestId: ctx.params.requestId,
    });
    ctx.json(200, result);
  });
}

export { register };
