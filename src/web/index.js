// ═══════════════════════════════════════════════
// 🚀 Terboo Web — دورة حياة الموقع داخل عملية البوت
// ───────────────────────────────────────────────
// يُشغَّل **بعد** تهيئة قاعدة البيانات والإضافات، لأن الخدمات تقرأ من
// getDatabase() المركزي والسجلّات المحمّلة في الذاكرة.
//
// عزل صريح عن البوت:
//   • فشل تهيئة الموقع لا يرمي إلى حلقة البوت: يُسجَّل ويُعاد {ok:false}
//     والبوت يكمل عمله كما هو (website.enabled=false هو الافتراضي أصلاً).
//   • خطأ في أي طلب HTTP يُحوَّل إلى رد، ولا يصل أبداً إلى معالج الرسائل.
//   • عند الإغلاق: يُغلق المنفذ أولاً، تُنهى الاتصالات الحيّة بمهلة، ثم
//     يُفرَّغ مخزن الموقع. لا يؤخّر إغلاق الموقع حفظ بيانات البوت.
//   • readiness حقيقي: listening لا يصبح true إلا بعد فتح المنفذ فعلاً.
// ═══════════════════════════════════════════════

import path from "node:path";
import { noteFailure } from "../lib/terboo-failure-log.js";
import { logger } from "../lib/terboo-logger.js";
import { websiteConfig } from "./config.js";
import { websiteState } from "./url-builder.js";
import { createWebServer } from "./http/server.js";
import { buildRouter } from "./http/routes/index.js";
import { flushWebStore, initWebStore, pruneSessions } from "./store/web-store.js";
import { pruneArtifacts } from "./services/upload-service.js";

const STORE_DIR = path.join(process.cwd(), "data", "web");
const STATIC_DIR = path.join(process.cwd(), "web", "dist");
const SHUTDOWN_GRACE_MS = 5000;

const runtime = { listening: false, startedAt: 0, server: null, sockets: new Set(), cleaner: null };

/** تنظيف دوري: جلسات منتهية وملفات انتهت صلاحيتها */
function startCleaner() {
  if (runtime.cleaner) return;
  runtime.cleaner = setInterval(() => {
    try {
      pruneSessions();
      pruneArtifacts();
    } catch (error) {
      noteFailure("web", error, { where: "src/web/index.js:cleaner", fallback: "retry-next-tick" });
    }
  }, 10 * 60_000);
  if (runtime.cleaner.unref) runtime.cleaner.unref();
}

/**
 * يشغّل الموقع. لا يرمي أبداً.
 * @returns {Promise<{ok:boolean, reason?:string, url?:string, port?:number}>}
 */
async function startWebServer() {
  const site = websiteConfig();
  if (!site.enabled) return { ok: false, reason: "disabled" };
  if (runtime.listening) return { ok: true, reason: "already-listening", port: site.port };

  try {
    const store = initWebStore(STORE_DIR);
    const router = buildRouter(runtime);
    const server = createWebServer({ router, staticRoot: STATIC_DIR });
    runtime.server = server;

    // تتبّع الاتصالات لإغلاق نظيف
    server.on("connection", (socket) => {
      runtime.sockets.add(socket);
      socket.on("close", () => runtime.sockets.delete(socket));
    });
    // مهلة على الطلب الخامل: لا يبقى اتصال مفتوحاً للأبد
    server.headersTimeout = 20_000;
    server.requestTimeout = 300_000;
    server.keepAliveTimeout = 15_000;

    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off("listening", onListening); reject(error); };
      const onListening = () => { server.off("error", onError); resolve(); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(site.port, site.host);
    });

    // الجاهزية تُعلَن بعد فتح المنفذ فعلاً — لا قبله
    runtime.listening = true;
    runtime.startedAt = Date.now();
    startCleaner();

    const state = websiteState({ listening: true });
    logger.success("web", `الموقع يستمع على ${site.host}:${site.port} · الحالة: ${state.state}${state.url ? ` · ${state.url}` : " · بلا عنوان عام بعد"}`);
    if (!state.secure && state.url) logger.warn("web", "العنوان العام الحالي HTTP غير مشفَّر — استعمل reverse proxy بشهادة قبل النشر");
    logger.info("web", `مخزن الموقع: ${path.relative(process.cwd(), store.dir)} (schema v${store.schemaVersion})`);

    return { ok: true, port: site.port, url: state.url, state: state.state };
  } catch (error) {
    runtime.listening = false;
    runtime.server = null;
    // خطأ شائع ومفهوم: المنفذ مشغول أو ممنوع
    const reason = error?.code === "EADDRINUSE"
      ? `port-in-use:${site.port}`
      : error?.code === "EACCES"
        ? `port-not-permitted:${site.port}`
        : String(error?.code || error?.message || "start-failed");
    noteFailure("web", error, { where: "src/web/index.js:startWebServer", stage: "listen", fallback: "bot-continues-without-website" });
    logger.error("web", `تعذّر تشغيل الموقع (${reason}) — البوت يكمل عمله بلا موقع`);
    return { ok: false, reason };
  }
}

/** يغلق الموقع بأمان. لا يرمي، ولا يؤخّر حفظ بيانات البوت. */
async function stopWebServer() {
  if (runtime.cleaner) {
    clearInterval(runtime.cleaner);
    runtime.cleaner = null;
  }
  const server = runtime.server;
  runtime.listening = false;
  runtime.server = null;

  if (server) {
    await new Promise((resolve) => {
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(); } };
      server.close(finish);
      // الاتصالات الحيّة تُنهى بعد مهلة قصيرة حتى لا يتعطّل الإغلاق
      const timer = setTimeout(() => {
        for (const socket of runtime.sockets) {
          try {
            socket.destroy();
          } catch (error) {
            noteFailure("web", error, { where: "src/web/index.js:stopWebServer", stage: "socket-destroy", fallback: "ignore" });
          }
        }
        runtime.sockets.clear();
        finish();
      }, SHUTDOWN_GRACE_MS);
      if (timer.unref) timer.unref();
    });
  }

  try {
    flushWebStore();
  } catch (error) {
    noteFailure("web", error, { where: "src/web/index.js:stopWebServer", stage: "flush", fallback: "data-may-lag" });
  }
  return { stopped: true };
}

/** حالة التشغيل الحقيقية (يُستعملها البوت والمالك) */
function webStatus() {
  return {
    ...websiteState({ listening: runtime.listening }),
    startedAt: runtime.startedAt || null,
    uptimeMs: runtime.startedAt ? Date.now() - runtime.startedAt : null,
    openConnections: runtime.sockets.size,
    staticRoot: STATIC_DIR,
  };
}

const isWebListening = () => runtime.listening;

export { STATIC_DIR, STORE_DIR, isWebListening, startWebServer, stopWebServer, webStatus };
