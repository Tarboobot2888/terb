// ═══════════════════════════════════════════════
// ⬇️ Terboo Web — مركز التنزيلات (مُهيّئ على السجل الحقيقي)
// ───────────────────────────────────────────────
// لا محرّك تنزيل ثانٍ ولا قائمة منصات مختلقة. كل ما يُعرض مشتقّ من
// terboo-scraper-registry.js فعلاً: المنصات من حقل platforms لأدوات
// kind === "download" وحدها، والتشغيل عبر tool-service.run ⇒ نفس
// الصلاحيات وحماية SSRF (terboo-net-guard) والحدود والمهلة والإلغاء
// وقاطع الدائرة. المهام الطويلة على طابور terboo-task-queue الحقيقي.
//
// ما يفرضه هذا الملف:
//   • اكتشاف المنصة من اسم المضيف فقط، ومقابل أسماء منصات موجودة في السجل.
//     مضيف غير معروف ⇒ «غير مدعوم» صريح، لا محاولة عمياء ولا وعد كاذب.
//   • لا نجاح قبل ناتج حقيقي: الفشل يُعاد بسببه، وترتيب البدائل من السجل.
//   • البايتات تُحفَظ أثراً مملوكاً وتُنزَّل من endpoint محمي، بلا مسار قرص.
// ═══════════════════════════════════════════════

import { CATALOG, isOpen } from "../../lib/terboo-scraper-registry.js";
import { NetGuardError, checkUrl } from "../../lib/terboo-net-guard.js";
import { apiError } from "../errors.js";
import { run as runTool } from "./tool-service.js";
import { myTasks, startTask } from "./task-service.js";

/**
 * مُشغّل الأدوات الحقيقي (tool-service.run). قابل للحقن في الاختبارات وحدها
 * كي لا يلمس اختبار الوحدة الشبكة؛ لا بديل في الإنتاج.
 */
let toolRunner = null;
function _setToolRunner(fn) {
  toolRunner = typeof fn === "function" ? fn : null;
}
const callTool = (args) => (toolRunner || runTool)(args);

/** أدوات التنزيل الحقيقية في السجل */
function downloadEntries() {
  return Object.entries(CATALOG).filter(([, entry]) => entry.kind === "download");
}

/**
 * اسم المضيف ⇒ اسم منصة كما يسمّيها السجل.
 * القائمة للاكتشاف فقط: لا تضيف منصة غير موجودة في platforms لأي أداة تنزيل.
 */
const HOST_PLATFORM = Object.freeze([
  [/(^|\.)tiktok\.com$/i, "tiktok"],
  [/(^|\.)douyin\.com$/i, "douyin"],
  [/(^|\.)instagram\.com$/i, "instagram"],
  [/(^|\.)(twitter\.com|x\.com)$/i, "twitter"],
  [/(^|\.)reddit\.com$/i, "reddit"],
  [/(^|\.)redd\.it$/i, "reddit"],
  [/(^|\.)youtube\.com$/i, "youtube"],
  [/(^|\.)youtu\.be$/i, "youtube"],
  [/(^|\.)spotify\.com$/i, "spotify"],
  [/(^|\.)soundcloud\.com$/i, "soundcloud"],
  [/(^|\.)mediafire\.com$/i, "mediafire"],
  [/(^|\.)terabox[a-z0-9-]*\.(com|app|fun|link)$/i, "terabox"],
  [/(^|\.)1024terabox\.com$/i, "terabox"],
  [/(^|\.)sfile\.mobi$/i, "sfile"],
  [/(^|\.)dailymotion\.com$/i, "dailymotion"],
  [/(^|\.)dai\.ly$/i, "dailymotion"],
  [/(^|\.)likee\.video$/i, "likee"],
  [/(^|\.)xiaohongshu\.com$/i, "rednote"],
  [/(^|\.)xhslink\.com$/i, "rednote"],
  [/(^|\.)pinterest\.[a-z.]+$/i, "pinterest"],
  [/(^|\.)pin\.it$/i, "pinterest"],
  [/(^|\.)facebook\.com$/i, "facebook"],
  [/(^|\.)fb\.watch$/i, "facebook"],
  [/(^|\.)threads\.(net|com)$/i, "threads"],
  [/(^|\.)capcut\.com$/i, "capcut"],
]);

/** كل أسماء المنصات التي تدّعيها أدوات التنزيل فعلاً */
function registryPlatforms() {
  const set = new Set();
  for (const [, entry] of downloadEntries()) {
    for (const platform of entry.platforms || []) set.add(String(platform));
  }
  return set;
}

/**
 * أدوات منصة ما، مرتّبة: المتخصّصة أولاً ثم الشاملة (aio) كبديل أخير.
 * الأدوات ذات الدائرة المفتوحة تُؤخَّر ولا تُحذف (قد تُغلق الدائرة لحظة التشغيل).
 */
function scrapersForPlatform(platform) {
  const rows = downloadEntries()
    .filter(([, entry]) => (entry.platforms || []).includes(platform))
    .map(([id, entry]) => ({ id, specificity: (entry.platforms || []).length, output: entry.output || "", open: isOpen(id) }));
  rows.sort((a, b) => Number(a.open) - Number(b.open) || a.specificity - b.specificity || a.id.localeCompare(b.id));
  return rows;
}

/** كتالوج المنصات المعروض في الواجهة — حقيقي بالكامل */
function platformCatalog() {
  const known = registryPlatforms();
  return [...known]
    .map((platform) => {
      const scrapers = scrapersForPlatform(platform);
      return {
        platform,
        scrapers: scrapers.map((row) => row.id),
        outputs: [...new Set(scrapers.map((row) => row.output).filter(Boolean))],
        // متاح = أداة واحدة على الأقل بدائرة مغلقة
        available: scrapers.some((row) => !row.open),
      };
    })
    .sort((a, b) => a.platform.localeCompare(b.platform));
}

/** اسم المضيف ⇒ منصة معروفة في السجل، أو "" */
function platformOfHost(hostname) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const known = registryPlatforms();
  for (const [pattern, platform] of HOST_PLATFORM) {
    if (pattern.test(host) && known.has(platform)) return platform;
  }
  return "";
}

/**
 * فحص رابط وتحديد المنصة — بلا أي طلب شبكي.
 * الرابط يمرّ على الفحص النحوي لحماية SSRF قبل أي استعمال أو عرض.
 */
function resolveTarget(rawUrl) {
  let url;
  try {
    url = checkUrl(String(rawUrl || ""));
  } catch (error) {
    if (!(error instanceof NetGuardError)) throw error;
    throw apiError("INVALID_INPUT", {
      message: "That link cannot be fetched.",
      details: { field: "url", reason: error.code },
    });
  }
  const platform = platformOfHost(url.hostname);
  const scrapers = platform ? scrapersForPlatform(platform) : [];
  return {
    url: String(url),
    host: url.hostname,
    platform,
    supported: scrapers.length > 0,
    scrapers: scrapers.map((row) => row.id),
    outputs: [...new Set(scrapers.map((row) => row.output).filter(Boolean))],
    available: scrapers.some((row) => !row.open),
    // سبب صريح بدل محاولة فاشلة
    reason: scrapers.length ? "" : platform ? "no-scraper-for-platform" : "unsupported-host",
  };
}

/**
 * ينفّذ سلسلة الأدوات بالترتيب حتى أول ناتج حقيقي.
 * لا يُعلن النجاح إلا بـok من السجل، ويعيد محاولات كل أداة كما هي.
 */
async function fetchWithChain({ principal, target, scraperId = "", lang = "ar", signal = null }) {
  const chain = scraperId
    ? (target.scrapers.includes(scraperId) ? [scraperId] : [])
    : target.scrapers;
  if (!chain.length) {
    throw apiError("INVALID_INPUT", {
      message: "No downloader supports that link.",
      details: { reason: scraperId ? "scraper-not-for-platform" : target.reason || "unsupported-host" },
    });
  }

  const tried = [];
  let last = null;
  for (const id of chain) {
    const outcome = await callTool({
      principal,
      // معرّف الأداة في السجل المركزي هو معرّف الـscraper نفسه (بلا بادئة)
      toolId: id,
      input: { url: target.url },
      lang,
      signal,
      // بايتات بلا رابط ⇒ أثر مملوك يُنزَّل من endpoint محمي
      persistBuffers: true,
    });
    tried.push({ id, ok: outcome.ok, error: outcome.error || "", latencyMs: outcome.latencyMs || 0 });
    last = outcome;
    if (outcome.ok) break;
  }
  return {
    platform: target.platform,
    host: target.host,
    result: last,
    tried,
    ok: Boolean(last?.ok),
  };
}

/** مهمة تنزيل خلفية على الطابور الحقيقي؛ التتابع عبر /me/tasks/:id */
function startDownloadJob({ principal, target, scraperId = "", lang = "ar" }) {
  const label = `${target.platform || target.host}`;
  const task = startTask({
    principal,
    type: `web.download:${target.platform || "link"}`,
    title: label,
    tool: scraperId || target.scrapers[0] || "",
    timeoutMs: 120_000,
    run: async ({ signal } = {}) => fetchWithChain({ principal, target, scraperId, lang, signal }),
  });
  return {
    taskId: task.id,
    status: task.status,
    platform: target.platform,
    // يُبنى من أجزاء: مسار API ثابت وليس نصاً معروضاً للمستخدم
    poll: ["/api/v1/me/tasks", task.id].join("/"),
  };
}

/** تاريخ تنزيلات هذا المستخدم من الطابور نفسه (بلا سجل ثانٍ) */
function downloadHistory(principal, { limit = 20 } = {}) {
  return myTasks(principal, { limit: 100 })
    .filter((task) => String(task.type || "").startsWith("web.download:"))
    .slice(0, Math.min(limit, 50));
}

export {
  HOST_PLATFORM,
  _setToolRunner,
  downloadHistory,
  fetchWithChain,
  platformCatalog,
  platformOfHost,
  resolveTarget,
  scrapersForPlatform,
  startDownloadJob,
};
