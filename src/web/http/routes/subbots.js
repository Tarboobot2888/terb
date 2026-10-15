// البوتات الفرعية: عرض فقط. الاقتران يبقى على واتساب حيث يُسلَّم الرمز خاصاً.
import { requirePermission } from "../../services/permission-service.js";
import { mySubBots, pairingNotAvailable } from "../../services/subbot-service.js";

function register(router) {
  router.get("/subbots", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.subbot.read" });
    ctx.json(200, await mySubBots(ctx.principal));
  });

  // المسار موجود ليعطي سبباً واضحاً بدل 404 غامض أو زر لا يعمل
  router.post("/subbots/pair", () => pairingNotAvailable());
}

export { register };
