// الألعاب: جلسة · حالة · حركة · مغادرة — كل انتقال في المحرّك على الخادم
import { requirePermission } from "../../services/permission-service.js";
import { act, createSession, leave, listGames, sessionState } from "../../services/game-service.js";

function register(router) {
  router.get("/games", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.game.read" });
    ctx.json(200, { games: await listGames(ctx.session?.lang || "ar") });
  });

  router.post("/games/:gameId/session", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.game.play" });
    const view = await createSession({
      principal: ctx.principal,
      gameId: ctx.params.gameId,
      // الخصم الآلي هو الافتراضي في نطاق الويب الخاص
      vsAI: ctx.body.vsAI !== false,
      difficulty: ["easy", "normal", "hard", "expert"].includes(ctx.body.difficulty) ? ctx.body.difficulty : "normal",
      lang: ctx.session?.lang || "ar",
    });
    ctx.json(201, { session: view });
  });

  router.get("/games/sessions/:roomId", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.game.read" });
    ctx.json(200, { session: await sessionState({ principal: ctx.principal, roomId: ctx.params.roomId, lang: ctx.session?.lang || "ar" }) });
  });

  /** حركة: العميل يرسل نيّة فقط؛ القواعد والنقاط والاقتصاد في المحرّك */
  router.post("/games/sessions/:roomId/action", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.game.play" });
    const view = await act({
      principal: ctx.principal,
      roomId: ctx.params.roomId,
      action: {
        type: ctx.body.type,
        value: ctx.body.value,
        nonce: ctx.body.nonce,
      },
      lang: ctx.session?.lang || "ar",
    });
    ctx.json(200, { session: view });
  });

  router.post("/games/sessions/:roomId/leave", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.game.play" });
    ctx.json(200, await leave({ principal: ctx.principal, roomId: ctx.params.roomId }));
  });
}

export { register };
