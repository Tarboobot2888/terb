// ═══════════════════════════════════════════════
// 🔗 Terboo Web — باني الروابط المركزي (مصدر حقيقة واحد)
// ───────────────────────────────────────────────
// كل رابط للموقع (زر القائمة · رسائل البوت · الإشعارات · الواجهة) يأتي من هنا.
// القواعد التي يفرضها هذا الملف وحده:
//   • المصدر هو config.website.publicBaseUrl حصراً — لا ترويسة Host ولا X-Forwarded-*.
//   • دومين غير متحقَّق (requireDomainVerification) ⇒ لا رابط. لا زر مكسور ولا وعد كاذب.
//   • الموقع معطَّل ⇒ لا رابط.
//   • websiteState() يقول الحقيقة: HTTP غير مشفَّر يُعلَن كذلك ولا يُسوَّق كـHTTPS.
// ═══════════════════════════════════════════════

import { noteFailure } from "../lib/terboo-failure-log.js";
import { websiteConfig } from "./config.js";
import { readDomainState } from "./store/web-store.js";

/** حالات الموقع المعروضة للمالك والواجهة — نتائج فعلية فقط */
const STATE = Object.freeze({
  DISABLED: "disabled",
  DOMAIN_PENDING: "domain-pending-verification",
  TLS_MISSING: "tls-missing",
  NO_PUBLIC_ADDRESS: "no-public-address",
  READY_INSECURE: "ready-insecure-http",
  READY: "ready",
});

/** هل الدومين المُعدّ متحقَّق فعلاً الآن؟ */
function domainVerified(site = websiteConfig()) {
  if (!site.domain) return false;
  if (!site.requireDomainVerification) return true;
  const state = readDomainState();
  return Boolean(state?.verified && state.domain && state.domain === site.domain);
}

/**
 * الرابط القانوني الحالي، أو "" إن لم يوجد عنوان عام صالح.
 * لا يُستنتج أي جزء منه من طلب HTTP.
 */
function publicBaseUrl(site = websiteConfig()) {
  if (!site.enabled) return "";

  // ① عنوان صريح من المالك: يُقدَّم على أي استنتاج، لكن لا يتجاوز شرط تحقّق الدومين
  if (site.publicBaseUrl) {
    let host = "";
    try {
      host = new URL(site.publicBaseUrl).hostname.toLowerCase();
    } catch (error) {
      // عنوان معطوب في الإعداد ⇒ لا زر ولا رابط (لا نرسل رابطاً مكسوراً أبداً)
      noteFailure("web-url", error, { where: "src/web/url-builder.js:publicBaseUrl", stage: "parse", fallback: "no-url" });
      return "";
    }
    // العنوان يحمل الدومين المُعدّ ⇒ يلزم إثبات ملكيته
    if (site.domain && host === site.domain && !domainVerified(site)) return "";
    return site.publicBaseUrl;
  }

  // ② دومين متحقَّق ⇒ https عليه
  if (domainVerified(site) && site.tlsMode !== "disabled") return `https://${site.domain}`;

  // ③ عنوان IP عام حدّده المالك ⇒ http صريح على المنفذ (يُعلَن كغير مشفَّر)
  if (site.publicIp) {
    const host = site.publicIp.includes(":") ? `[${site.publicIp}]` : site.publicIp;
    return `http://${host}:${site.port}`;
  }

  return "";
}

/** رابط الموقع للعرض في القوائم/الرسائل، أو "" حين لا يصلح أن يُرسل زر */
function websiteUrl(site = websiteConfig()) {
  return publicBaseUrl(site);
}

/** رابط مسار داخلي (يُستعمل للروابط العميقة في الرسائل) */
function websitePath(pathname = "/", site = websiteConfig()) {
  const base = publicBaseUrl(site);
  if (!base) return "";
  const clean = `/${String(pathname || "").replace(/^\/+/, "")}`;
  // لا استعلامات ولا أجزاء من مدخل غير موثوق
  if (/[?#\s]/.test(clean)) return base;
  return `${base}${clean === "/" ? "" : clean}`;
}

/** هل الرابط الحالي مشفَّر فعلاً؟ */
function isSecure(site = websiteConfig()) {
  return publicBaseUrl(site).startsWith("https://");
}

/**
 * حالة الموقع كما هي — لعرضها للمالك وفي /health وللواجهة.
 * @param {{listening?:boolean}} [runtime] هل المنفذ مفتوح فعلاً الآن
 */
function websiteState(runtime = {}, site = websiteConfig()) {
  const url = publicBaseUrl(site);
  const verified = domainVerified(site);
  const base = {
    enabled: site.enabled,
    listening: Boolean(runtime.listening),
    url,
    secure: url.startsWith("https://"),
    domain: site.domain,
    domainVerified: verified,
    tlsMode: site.tlsMode,
    port: site.port,
  };

  if (!site.enabled) return { ...base, state: STATE.DISABLED };
  if (site.domain && !verified) return { ...base, state: STATE.DOMAIN_PENDING };
  if (site.tlsMode === "direct" && !(site.tls.certPath && site.tls.keyPath)) {
    return { ...base, state: STATE.TLS_MISSING };
  }
  if (!url) return { ...base, state: STATE.NO_PUBLIC_ADDRESS };
  if (!base.secure) return { ...base, state: STATE.READY_INSECURE };
  return { ...base, state: STATE.READY };
}

export { STATE, domainVerified, isSecure, publicBaseUrl, websitePath, websiteState, websiteUrl };
export default { websiteUrl, publicBaseUrl, websitePath, websiteState, isSecure, STATE };
