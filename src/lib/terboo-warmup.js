// ═══════════════════════════════════════════════
// 🔥 Terboo Warm Start (§87 §88)
// ───────────────────────────────────────────────
// عند الإقلاع فقط ما هو محلي ورخيص — بلا أي طلب شبكة:
//   فهرس الأوامر · سجل الأدوات · فهرس WAProto/القدرات · بوابة النوايا · حدود التزامن
//   · استعادة المهام التي قطعها الإيقاف (تصبح waiting) وتسجيل دوال استئنافها.
// كل خطوة مقيسة؛ فشل خطوة لا يوقف الإقلاع (يُسجَّل).
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";

async function step(name, fn, report) {
  const t0 = performance.now();
  try {
    const value = await fn();
    report[name] = { ok: true, ms: Math.round(performance.now() - t0), ...(value && typeof value === "object" ? value : value !== undefined ? { value } : {}) };
  } catch (error) {
    report[name] = { ok: false, ms: Math.round(performance.now() - t0), error: String(error?.message || error).slice(0, 160) };
    noteFailure("warmup", error, { where: "src/lib/terboo-warmup.js:step", stage: name });
  }
}

/**
 * @param {Object} config
 * @returns {Promise<Object>} تقرير لكل خطوة (ok · ms · أعداد)
 */
async function warmStart(config = {}) {
  const report = {};
  await step("commandIndex", async () => {
    const { allEntries } = await import("./terboo-command-index.js");
    return { commands: allEntries().length };
  }, report);
  await step("toolRegistry", async () => {
    const { allTools, categories } = await import("./terboo-tool-registry.js");
    return { tools: allTools().length, categories: Object.keys(categories()).length };
  }, report);
  await step("waCapabilities", async () => {
    const { discover } = await import("./terboo-wa-capabilities.js");
    return { capabilities: discover().capabilities.length };
  }, report);
  await step("intentGate", async () => {
    const { classify } = await import("./terboo-intent-gate.js");
    classify({ text: "warmup" });
  }, report);
  await step("http", async () => {
    // مهلة/قاطع دائرة/حد حجم/أخطاء بلا أسرار لكل طلبات axios في البلوقنات (لا يمس fetch الذي تستعمله Baileys)
    const { installAxiosDefaults } = await import("./terboo-http-client.js");
    const axios = (await import("axios")).default;
    return { axios: installAxiosDefaults(axios) };
  }, report);
  await step("concurrency", async () => {
    const { configure } = await import("./terboo-concurrency.js");
    return configure(config.ai?.concurrency || {});
  }, report);
  await step("tasks", async () => {
    const { restoreInterrupted } = await import("./terboo-task-queue.js");
    // دوال التنفيذ قبل أي استئناف: «كملها» بعد الإيقاف يجد runner نوع المهمة
    const { installTaskRunners } = await import("./terboo-task-runners.js");
    const { getSocket } = await import("../connection.js");
    const { tools } = installTaskRunners({ getSocket });
    const restored = restoreInterrupted();
    // جدولة قفل/فتح المجموعات قاطعها الإيقاف ⇒ تعود بموعدها الأصلي (أو فوراً مع إشعار تأخير صادق)
    const { installGroupActions } = await import("./terboo-group-actions.js");
    const { resumed } = installGroupActions({ getSocket });
    // الإذاعة: منفّذها مسجّل لاستئناف صريح («كمل الإذاعة») يكمل بلا إعادة ما أُرسل
    const { installBroadcast } = await import("./terboo-broadcast.js");
    installBroadcast({ getSocket });
    // نشر المشاريع عبر SSH: استئناف صريح يكمل من آخر خطوة ناجحة
    const { installRemoteWorkspace } = await import("./terboo-remote-workspace.js");
    installRemoteWorkspace();
    return { restored, runners: tools, groupSchedules: resumed };
  }, report);
  return report;
}

export { warmStart };
export default { warmStart };
