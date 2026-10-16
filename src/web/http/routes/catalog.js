// السجل: التصنيفات · الأدوات · الـscrapers · أوامر واتساب (مرجع) · الألعاب
import fs from "node:fs";
import path from "node:path";
import { noteFailure } from "../../../lib/terboo-failure-log.js";
import { requirePermission } from "../../services/permission-service.js";
import { capabilitySummary, categoryRows, commandRows, scraperRows, toolRows } from "../../services/catalog-service.js";
import { listGames } from "../../services/game-service.js";

/** صورة التصنيف تُفحص على القرص: لا نشير إلى ملف غير موجود */
const assetExists = (relative) => {
  try {
    return fs.existsSync(path.join(process.cwd(), relative));
  } catch (error) {
    // تعذّر فحص القرص ⇒ لا صورة في الرد (أفضل من الإشارة إلى ملف غير مؤكَّد)
    noteFailure("web-catalog", error, { where: "src/web/http/routes/catalog.js:assetExists", stage: relative, fallback: "no-image" });
    return false;
  }
};

function register(router) {
  router.get("/catalog/summary", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.catalog.read" });
    ctx.json(200, capabilitySummary(ctx.principal));
  });

  router.get("/catalog/categories", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.catalog.read" });
    ctx.json(200, { categories: categoryRows(ctx.principal, { imageExists: assetExists }) });
  });

  router.get("/catalog/tools", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.catalog.read" });
    ctx.json(200, {
      tools: toolRows(ctx.principal, {
        category: ctx.query.get("category") || "",
        search: (ctx.query.get("q") || "").slice(0, 120),
      }),
    });
  });

  router.get("/catalog/scrapers", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.catalog.read" });
    ctx.json(200, { scrapers: scraperRows(ctx.principal) });
  });

  /** أوامر واتساب كمرجع: webRunnable=false مع السبب */
  router.get("/catalog/commands", (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.catalog.read" });
    const result = commandRows(ctx.principal, {
      category: ctx.query.get("category") || "",
      limit: Number(ctx.query.get("limit")) || 200,
      offset: Number(ctx.query.get("offset")) || 0,
    });
    ctx.json(200, { total: result.total, commands: result.rows });
  });

  router.get("/catalog/games", async (ctx) => {
    requirePermission({ principal: ctx.principal, action: "web.game.read" });
    ctx.json(200, { games: await listGames(ctx.session?.lang || "ar") });
  });
}

export { register };
