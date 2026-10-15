// صحة الخدمة وقدراتها العامة — بلا أسرار ولا مضيفات داخلية ولا أرقام
import { getQueueSummary } from "../../../lib/terboo-task-queue.js";
import { websiteState } from "../../url-builder.js";
import { providerStatus } from "../../services/ai-service.js";
import { webStoreStats } from "../../store/web-store.js";

/** هل اتصال واتساب حيّ الآن؟ (تحميل متأخر: استيراد connection.js له أثر جانبي) */
async function botConnection() {
  try {
    const mod = await import("../../../connection.js");
    const state = mod.getConnectionState?.() || {};
    return { connected: Boolean(mod.isConnected?.()), ready: Boolean(state.isReady), uptimeMs: mod.getUptime?.() || null };
  } catch {
    return { connected: false, ready: false, uptimeMs: null };
  }
}

function register(router, runtime) {
  // حيّ: يجيب ما دامت العملية تستجيب
  router.get("/health/live", (ctx) => ctx.json(200, { status: "live", at: Date.now() }), { auth: false });

  // جاهز: لا يُقال «جاهز» قبل فتح المنفذ فعلاً وتهيئة المخزن
  router.get("/health/ready", async (ctx) => {
    const listening = Boolean(runtime.listening);
    const store = webStoreStats();
    const bot = await botConnection();
    const ready = listening && store.ready === true;
    ctx.json(ready ? 200 : 503, {
      status: ready ? "ready" : "not-ready",
      listening,
      store: { ready: Boolean(store.ready), schemaVersion: store.schemaVersion || null },
      whatsapp: { connected: bot.connected, ready: bot.ready },
      at: Date.now(),
    });
  }, { auth: false });

  // قدرات عامة مختارة: ما يصحّ لزائر غير مسجّل أن يعرفه
  router.get("/public/capabilities", async (ctx) => {
    const providers = await providerStatus();
    const site = websiteState({ listening: Boolean(runtime.listening) });
    const bot = await botConnection();
    ctx.json(200, {
      site: { state: site.state, secure: site.secure },
      whatsapp: { connected: bot.connected },
      ai: {
        // أسماء المزوّدات لا تُنشر للعامة: العدد والقدرة وحدهما
        available: providers.available,
        providerCount: providers.count,
        vision: providers.vision.length > 0,
      },
      features: {
        aiWorkspace: providers.available,
        toolsAndDownloads: true,
        mediaStudio: true,
        games: true,
        groupModeration: bot.connected,
        subBots: false,
      },
      queue: { depth: getQueueSummary()?.waiting ?? null },
      at: Date.now(),
    });
  }, { auth: false });
}

export { register };
