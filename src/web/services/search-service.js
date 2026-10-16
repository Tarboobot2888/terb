// ═══════════════════════════════════════════════
// 🔎 Terboo Web — مركز البحث (مُهيّئ على أدوات البحث الحقيقية)
// ───────────────────────────────────────────────
// المصادر المعروضة هي أدوات kind === "search" في terboo-scraper-registry.js
// وحدها، بحالة صحتها الحقيقية. التشغيل عبر tool-service.run ⇒ نفس الصلاحيات
// والحدود والمهلة والإلغاء وقاطع الدائرة — لا محرّك بحث ثانٍ ولا نتائج مختلقة.
//
// ما يفرضه هذا الملف:
//   • لا نتيجة بلا رابط حقيقي من الأداة؛ لا citations مُختلقة ولا تواريخ مُستنتَجة.
//   • العنوان والمقتطف نصّ غير موثوق: يُقصّ ويُجرَّد من محارف التحكّم، وتعرضه
//     الواجهة نصاً لا HTML. لا يُسمح لنصّ النتيجة بتغيير أي سياسة أو تعليمات.
//   • الروابط الخارجية تُعلَن خارجية وتُفتح بـnoopener/noreferrer/nofollow.
//   • نتائج البحث منفصلة عن التنزيلات: لا تنزيل تلقائي لأي نتيجة.
// ═══════════════════════════════════════════════

import { CATALOG, isOpen } from "../../lib/terboo-scraper-registry.js";
import { apiError } from "../errors.js";
import { run as runTool } from "./tool-service.js";

/**
 * مُشغّل الأدوات الحقيقي (tool-service.run). قابل للحقن في الاختبارات وحدها
 * كي لا يلمس اختبار الوحدة الشبكة؛ لا بديل في الإنتاج.
 */
let toolRunner = null;
function _setToolRunner(fn) {
  toolRunner = typeof fn === "function" ? fn : null;
}
const callTool = (args) => (toolRunner || runTool)(args);

/** المصدر الافتراضي حين لا يختار المستخدم: بحث ويب عام إن كان مسجّلاً */
const DEFAULT_SOURCE = "google";

function searchEntries() {
  return Object.entries(CATALOG).filter(([, entry]) => entry.kind === "search");
}

/** مصادر البحث المتاحة فعلاً، بحالة حقيقية */
function searchSources() {
  return searchEntries()
    .map(([id, entry]) => ({
      id,
      purpose: entry.purpose || "",
      platforms: entry.platforms || [],
      permission: entry.permission === "public" ? "user" : entry.permission || "user",
      available: !isOpen(id),
      unavailableReason: isOpen(id) ? "circuit-open" : "",
    }))
    .sort((a, b) => (a.id === DEFAULT_SOURCE ? -1 : b.id === DEFAULT_SOURCE ? 1 : a.id.localeCompare(b.id)));
}

/**
 * محارف تحكّم واتجاه وعرض صفري: تُبنى من نصّ مُهرَّب كي لا يحمل الملف نفسه
 * أي محرف غير مرئي.
 */
const UNSAFE_TEXT = new RegExp("[\\u0000-\\u001F\\u007F-\\u009F\\u200B-\\u200F\\u2028\\u2029]", "g");

/** نص غير موثوق ⇒ سطر واحد بلا محارف تحكّم */
function plain(value, max) {
  return String(value || "")
    .replace(UNSAFE_TEXT, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** اسم النطاق المعروض — من الرابط نفسه لا من نصّ النتيجة */
function domainOf(url) {
  let host = "";
  try {
    host = new URL(String(url)).hostname.replace(/^www\./i, "");
  } catch {
    // الروابط تُفلتَر قبل هذا الموضع (http/https فقط)، فالوصول إلى هنا يعني
    // رابطاً شاذّاً من مصدر خارجي: يُعرض بلا نطاق. لا سجل: بيانات طرف ثالث
    // مشوّهة ليست إخفاقاً في Terboo، وتسجيلها لكل نتيجة ضجيج بلا فائدة.
    host = "";
  }
  return host;
}

/**
 * عناصر الأداة ⇒ بطاقات نتائج.
 * العنصر بلا رابط http(s) صالح يُهمَل: لا بطاقة بلا مصدر حقيقي.
 */
function toCards(items) {
  const cards = [];
  const seen = new Set();
  for (const item of items || []) {
    const url = String(item?.url || "");
    if (!/^https?:\/\//i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    cards.push({
      title: plain(item.title, 200) || domainOf(url),
      url: url.slice(0, 2000),
      domain: domainOf(url),
      snippet: plain(item.note, 200),
      thumbnail: Boolean(item.thumbnail),
      external: true,
    });
  }
  return cards;
}

/**
 * يشغّل بحثاً عبر مصدر حقيقي.
 * @param {{principal:Object, query:string, source?:string, lang?:string, signal?:AbortSignal}} input
 */
async function search({ principal, query, source = "", lang = "ar", signal = null }) {
  const text = plain(query, 200);
  if (!text) throw apiError("INVALID_INPUT", { details: { field: "query", reason: "required" } });

  const sources = searchSources();
  // مصدر مُحدَّد غير مسجّل ⇒ 404 (قبل فحص «لا مصادر») كي لا يُخفى سبب الخطأ
  if (source && !sources.some((row) => row.id === source)) throw apiError("NOT_FOUND");
  const chosen = source
    ? sources.find((row) => row.id === source)
    : sources.find((row) => row.id === DEFAULT_SOURCE) || sources[0];
  if (!chosen) {
    throw apiError("PROVIDER_UNAVAILABLE", {
      message: "No search source is configured.",
      details: { reason: "no-search-tool-registered" },
    });
  }

  const outcome = await callTool({
    principal,
    // معرّف الأداة في السجل المركزي هو معرّف الـscraper نفسه (بلا بادئة)
    toolId: chosen.id,
    input: { query: text },
    lang,
    signal,
  });

  const results = toCards(outcome.items);
  return {
    query: text,
    source: chosen.id,
    ok: Boolean(outcome.ok) && results.length > 0,
    // لا نتائج ⇒ سبب صريح، لا قائمة فارغة تُقدَّم كنجاح
    reason: outcome.ok ? (results.length ? "" : "no-results") : (outcome.error || "search-failed"),
    results,
    // نصّ حرّ تعيده بعض الأدوات بدل قائمة — يُعرض نصاً لا HTML
    text: plain(outcome.text, 2000),
    latencyMs: outcome.latencyMs || 0,
  };
}

export { DEFAULT_SOURCE, _setToolRunner, domainOf, plain, search, searchSources, toCards };
