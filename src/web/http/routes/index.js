// تجميع كل مسارات /api/v1 في موجّه واحد
import { createRouter } from "../server.js";
import { register as health } from "./health.js";
import { register as auth } from "./auth.js";
import { register as me } from "./me.js";
import { register as catalog } from "./catalog.js";
import { register as ai } from "./ai.js";
import { register as media } from "./media.js";
import { register as tools } from "./tools.js";
import { register as downloads } from "./downloads.js";
import { register as search } from "./search.js";
import { register as games } from "./games.js";
import { register as groups } from "./groups.js";
import { register as subbots } from "./subbots.js";
import { register as owner } from "./owner.js";

/**
 * @param {{listening:boolean}} runtime حالة تشغيل حقيقية تُقرأ في /health/ready
 */
function buildRouter(runtime = { listening: false }) {
  const router = createRouter();
  health(router, runtime);
  auth(router);
  me(router);
  catalog(router);
  ai(router);
  media(router);
  tools(router);
  downloads(router);
  search(router);
  games(router);
  groups(router);
  subbots(router);
  owner(router, runtime);
  return router;
}

export { buildRouter };
