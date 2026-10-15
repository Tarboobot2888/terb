// ═══════════════════════════════════════════════
// 🧰 Terboo Web — تشغيل الأدوات والـscrapers من الموقع
// ───────────────────────────────────────────────
// ينفّذ عبر runTool() في terboo-tool-registry.js نفسه — لا تنفيذ scraper ثانٍ
// ولا موجّه أوامر ثانٍ. ما يضيفه هذا الملف هو ما يلزم قناة HTTP:
//   • تصريح قبل التنفيذ من PermissionService (لا من جسم الطلب).
//   • m=null و sock=null و deliver=false ⇒ لا مسار تسليم واتساب أصلاً.
//     سياق التصريح المُمرَّر لـcheckPermission محسوب على الخادم (isOwner/isPremium)
//     ولا يحمل أي حقل رسالة (لا id ولا key ولا reply ولا chat).
//   • أي URL من المستخدم يمرّ على حماية SSRF المعتمدة (terboo-net-guard) قبل
//     أن يراه أي scraper: مضيف داخلي · عنوان خاص · ميتاداتا ⇒ رفض.
//   • حد لكل مستخدم وحد لكل مضيف خارجي + مهلة + إلغاء عبر AbortSignal.
//   • نتائج الـscraper بيانات غير موثوقة: تُعاد كقيم موصوفة، ولا يُنفَّذ HTML
//     ولا يُقدَّم رابط خارجي كملف محلي.
// ═══════════════════════════════════════════════

import { noteFailure } from "../../lib/terboo-failure-log.js";
import { NetGuardError, checkUrl, resolvePublic } from "../../lib/terboo-net-guard.js";
import { getTool, runTool } from "../../lib/terboo-tool-registry.js";
import { apiError } from "../errors.js";
import { requirePermission, toolAuthContext } from "./permission-service.js";
import * as limits from "./rate-limit-service.js";

/** أدوات تحتاج سياق مجموعة/مقبس ⇒ غير متاحة من الويب */
const NEEDS_WHATSAPP = new Set(["group.members"]);

/** الفعل المكافئ في مصفوفة صلاحيات الويب */
function actionFor(tool) {
  if (tool.permission === "owner") return "web.tool.run.owner";
  if (tool.permission === "premium") return "web.tool.run.premium";
  return "web.tool.run";
}

/**
 * يفحص مدخلات الأداة مقابل مخطّطها الحقيقي، ويحمي كل رابط.
 * @returns {Object} مدخلات نظيفة جاهزة للسجل
 */
function sanitizeInput(tool, raw = {}) {
  const schema = tool.input || {};
  const properties = schema.properties || {};
  const out = {};

  for (const [key, value] of Object.entries(raw)) {
    // حقل غير معروف في المخطّط ⇒ يُهمل (منع mass assignment على مدخلات الأدوات)
    if (!Object.prototype.hasOwnProperty.call(properties, key)) continue;
    if (value === null || value === undefined) continue;
    const spec = properties[key] || {};

    if (spec.type === "number") {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      out[key] = n;
      continue;
    }
    if (spec.type === "boolean") {
      out[key] = Boolean(value);
      continue;
    }
    if (Buffer.isBuffer(value)) {
      out[key] = value;
      continue;
    }
    const text = String(value);
    if (text.length > 2000) throw apiError("INVALID_INPUT", { details: { field: key, reason: "too-long" } });
    out[key] = text;
  }

  // كل رابط يقدّمه المستخدم يمرّ على الفحص النحوي لحماية SSRF قبل أي استعمال.
  // checkUrl يعيد URL أو يرمي NetGuardError (مخطَّط · بيانات دخول · منفذ ·
  // مضيف داخلي · عنوان خاص) — ولا يحلّ DNS، لذلك يتبعه guardUrls غير المتزامن.
  for (const key of URL_FIELDS) {
    if (!out[key]) continue;
    try {
      out[key] = String(checkUrl(out[key]));
    } catch (error) {
      if (!(error instanceof NetGuardError)) throw error;
      throw apiError("INVALID_INPUT", {
        message: "That link cannot be fetched.",
        details: { field: key, reason: error.code },
      });
    }
  }

  // الحقول المطلوبة
  for (const required of schema.required || []) {
    const present = out[required] !== undefined && out[required] !== "" ;
    if (!present) throw apiError("INVALID_INPUT", { details: { field: required, reason: "required" } });
  }
  return out;
}

/** الحقول التي قد تحمل رابطاً من المستخدم */
const URL_FIELDS = Object.freeze(["url", "link", "target"]);

/**
 * فحص DNS لكل رابط: الاسم يجب أن يحلّ إلى عنوان عام فقط.
 * يمنع «مضيف عام يشير إلى 127.0.0.1/10.x/169.254.169.254».
 *
 * حدّ معروف ومسجَّل في THREAT_MODEL: الـscraper يجلب بنفسه ولا يثبّت العنوان
 * الذي فُحص، فنافذة DNS rebinding بين الفحص والجلب تبقى نظرياً مفتوحة.
 * ما يُلغيها هو تمرير كل جلب خارجي عبر guardedRequest، وهو تحويل داخل
 * الـscrapers خارج نطاق هذه الطبقة.
 */
async function guardUrls(input) {
  for (const key of URL_FIELDS) {
    if (!input[key]) continue;
    let host = "";
    try {
      host = new URL(String(input[key])).hostname;
    } catch (error) {
      throw apiError("INVALID_INPUT", { details: { field: key, reason: "invalid-url" } });
    }
    try {
      await resolvePublic(host);
    } catch (error) {
      if (!(error instanceof NetGuardError)) throw error;
      throw apiError("INVALID_INPUT", {
        message: "That link cannot be fetched.",
        details: { field: key, reason: error.code },
      });
    }
  }
}

/** المضيف الخارجي لحدّ المعدّل لكل مضيف */
function hostOf(input) {
  for (const key of URL_FIELDS) {
    if (!input[key]) continue;
    try {
      return new URL(String(input[key])).hostname.toLowerCase();
    } catch (error) {
      // الرابط مرّ أصلاً على checkUrl، فوصولنا هنا غير متوقع:
      // يُسجَّل ويُسقط حدّ المضيف دون إسقاط الطلب (حدّ المستخدم قائم).
      noteFailure("web-tool", error, { where: "src/web/services/tool-service.js:hostOf", stage: key, fallback: "skip-host-limit" });
      return "";
    }
  }
  return "";
}

/** نتيجة مطبّعة وآمنة للعرض: بلا مسار محلي وبلا بايتات خام */
function shapeResult(outcome) {
  const items = Array.isArray(outcome.items) ? outcome.items.slice(0, 40) : [];
  return {
    ok: Boolean(outcome.ok),
    id: outcome.id,
    category: outcome.category || "",
    source: outcome.source || "",
    kind: outcome.kind || "data",
    // نص النتيجة محتوى غير موثوق: تعرضه الواجهة كنص لا كـHTML
    text: typeof outcome.text === "string" ? outcome.text.slice(0, 20_000) : "",
    items: items.map((item) => ({
      type: item.type || "",
      // روابط خارجية تُعلَن كخارجية ولا تُقدَّم كملف محلي
      url: typeof item.url === "string" ? item.url.slice(0, 2000) : "",
      external: true,
      title: typeof item.title === "string" ? item.title.slice(0, 200) : "",
      mimetype: item.mimetype || "",
      sizeBytes: Number(item.size || item.sizeBytes || 0) || null,
      durationSeconds: Number(item.duration || 0) || null,
    })),
    error: outcome.error ? String(outcome.error).slice(0, 200) : "",
    latencyMs: outcome.latencyMs || 0,
    attempts: Array.isArray(outcome.attempts)
      ? outcome.attempts.map((a) => ({ id: a.id, via: a.via, ok: Boolean(a.ok), latencyMs: a.latencyMs || 0, skipped: a.skipped || "" }))
      : [],
  };
}

/**
 * يشغّل أداة من الموقع.
 * @param {{principal:Object, toolId:string, input?:Object, lang?:string, signal?:AbortSignal}} request
 */
async function run({ principal, toolId, input = {}, lang = "ar", signal = null }) {
  const tool = getTool(String(toolId || ""));
  if (!tool) throw apiError("NOT_FOUND");
  if (NEEDS_WHATSAPP.has(tool.id)) {
    throw apiError("NOT_AVAILABLE_IN_WEB", { details: { toolId: tool.id, reason: "needs-whatsapp-group-context" } });
  }

  // ① التصريح من محرّك الصلاحيات — قبل أي عمل
  requirePermission({ principal, action: actionFor(tool) });
  // أدوات premium لغير المميّز/المالك: المحرّك الأساسي سيرفض أيضاً، لكن نرفض هنا بوضوح
  if (tool.permission === "premium" && !(principal.isPremium || principal.isOwner)) {
    throw apiError("FORBIDDEN", { details: { reason: "premium-only" } });
  }

  // ② الحدود
  await limits.toolRuns(principal.canonical);
  const clean = sanitizeInput(tool, input);
  await guardUrls(clean);
  const host = hostOf(clean);
  if (host) await limits.perExternalHost(host);

  // ③ التنفيذ عبر السجل الحقيقي، بلا قناة واتساب
  const outcome = await runTool({
    id: tool.id,
    input: clean,
    m: toolAuthContext(principal),   // سياق تصريح محسوب على الخادم — ليس رسالة
    sock: null,                      // لا مقبس ⇒ لا مسار بلوقن ولا تسليم
    deliver: false,                  // لا إرسال واتساب من الموقع أبداً
    lang,
    signal,
  });

  if (signal?.aborted) throw apiError("CANCELLED");
  return shapeResult(outcome);
}

export { URL_FIELDS, actionFor, guardUrls, hostOf, run, sanitizeInput, shapeResult };
