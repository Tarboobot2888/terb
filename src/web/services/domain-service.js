// ═══════════════════════════════════════════════
// 🌍 Terboo Web — الدومين وإثبات الملكية و TLS
// ───────────────────────────────────────────────
// ما يفعله هذا الملف فعلاً:
//   • يقبل دوماً بعد تحقق نحوي صارم (punycode · بلا مخطَّط/منفذ/مسار).
//   • يولّد رمز إثبات ويطلب سجل TXT على _terboo-verify.<domain>، ثم يتحقق
//     بـdns.resolveTxt الحقيقي. لا يُعتمد الدومين بمجرد كتابته.
//   • يفحص A/AAAA/CNAME ويقارنها بـpublicIp المُعدّ (إن وُجد) ليقول للمالك
//     إن كان التوجيه صحيحاً — ويظل TXT هو شرط الاعتماد.
//   • يقرأ حالة الشهادة من الملفات المُعدّة (انتهاء · تطابق الاسم) بلا إعادة
//     المفتاح ولا محتوى الشهادة في أي رد.
// ما لا يفعله (ويُعلنه بوضوح بدل الوعد):
//   • لا يصدر شهادة ولا يشغّل ACME ولا يعدّل nginx/caddy/systemd/جدار الحماية،
//     ولا ينفّذ أي سلسلة shell مبنية من مدخل. إصدار TLS يتم خارج البوت
//     (reverse proxy) وفق docs/web-platform/DOMAIN_AND_TLS.md.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import { X509Certificate } from "node:crypto";
import { noteFailure } from "../../lib/terboo-failure-log.js";
import { validDomain, websiteConfig } from "../config.js";
import { apiError } from "../errors.js";
import { STATE, websiteState } from "../url-builder.js";
import { readDomainState, writeDomainState } from "../store/web-store.js";

const TXT_PREFIX = "_terboo-verify";

/** يضبط الدومين المطلوب ويولّد رمز إثبات جديد (لا يعتمده) */
function setDomain(domain) {
  const clean = validDomain(domain);
  if (!clean) {
    throw apiError("INVALID_INPUT", {
      message: "That is not a valid domain name. Use a bare hostname such as bot.example.com.",
      details: { field: "domain" },
    });
  }
  const token = crypto.randomBytes(24).toString("base64url");
  writeDomainState({ domain: clean, verified: false, token, method: "dns-txt", checkedAt: 0, lastError: "" });
  return instructions(clean, token);
}

/** تعليمات الإثبات التي يراها المالك */
function instructions(domain, token) {
  return {
    domain,
    method: "dns-txt",
    record: { type: "TXT", name: `${TXT_PREFIX}.${domain}`, value: token },
    note: "Add this TXT record at your DNS provider, then run the verify step. The domain is not used for any link until it verifies.",
  };
}

/** حالة الإثبات الحالية (بلا كشف الرمز لغير المالك — المسار يفحص الصلاحية) */
function domainStatus() {
  const site = websiteConfig();
  const state = readDomainState();
  return {
    configuredDomain: site.domain,
    pendingDomain: state.domain || "",
    verified: Boolean(state.verified),
    method: state.method || "",
    checkedAt: state.checkedAt || 0,
    lastError: state.lastError || "",
    requireVerification: site.requireDomainVerification,
    record: state.domain && state.token ? instructions(state.domain, state.token).record : null,
  };
}

/** يتحقق فعلاً من سجل TXT */
async function verifyDomain() {
  const state = readDomainState();
  if (!state.domain || !state.token) {
    throw apiError("INVALID_INPUT", { message: "Set a domain first." });
  }
  const name = `${TXT_PREFIX}.${state.domain}`;
  let records = [];
  try {
    records = await dns.resolveTxt(name);
  } catch (error) {
    const reason = error?.code === "ENOTFOUND" || error?.code === "ENODATA" ? "record-not-found" : "dns-error";
    writeDomainState({ verified: false, checkedAt: Date.now(), lastError: reason });
    noteFailure("web-domain", error, { where: "src/web/services/domain-service.js:verifyDomain", stage: "resolveTxt", fallback: "not-verified" });
    return { verified: false, reason, record: instructions(state.domain, state.token).record };
  }
  const flat = records.map((chunks) => chunks.join("")).map((value) => value.trim());
  const matched = flat.some((value) => value === state.token);
  writeDomainState({ verified: matched, checkedAt: Date.now(), lastError: matched ? "" : "token-mismatch" });
  return {
    verified: matched,
    reason: matched ? "" : "token-mismatch",
    found: flat.length,
    record: matched ? null : instructions(state.domain, state.token).record,
  };
}

/** توجيه الدومين: A/AAAA/CNAME مقابل publicIp المُعدّ */
async function routingCheck() {
  const site = websiteConfig();
  const state = readDomainState();
  const domain = state.domain || site.domain;
  if (!domain) return { domain: "", checked: false };
  const out = { domain, checked: true, a: [], aaaa: [], cname: [], matchesPublicIp: null };
  for (const [key, fn] of [["a", dns.resolve4], ["aaaa", dns.resolve6], ["cname", dns.resolveCname]]) {
    try {
      out[key] = await fn(domain);
    } catch (error) {
      // غياب نوع سجل أمر طبيعي ⇒ يبقى فارغاً مع سبب مسجّل
      noteFailure("web-domain", error, { where: "src/web/services/domain-service.js:routingCheck", stage: key, fallback: "empty" });
      out[key] = [];
    }
  }
  if (site.publicIp) out.matchesPublicIp = out.a.includes(site.publicIp) || out.aaaa.includes(site.publicIp);
  return out;
}

/** حالة الشهادة من ملفاتها — بلا إعادة أي مفتاح أو محتوى */
function tlsStatus() {
  const site = websiteConfig();
  const base = { mode: site.tlsMode, configured: false, readable: false };
  if (site.tlsMode !== "direct") {
    return {
      ...base,
      configured: site.tlsMode === "proxy",
      note: site.tlsMode === "proxy"
        ? "TLS terminates at the reverse proxy in front of this service; the bot process holds no certificate."
        : "TLS is disabled: traffic is plain HTTP and must not be treated as secure.",
    };
  }
  if (!site.tls.certPath || !site.tls.keyPath) return { ...base, note: "tlsMode is direct but certPath/keyPath are not set." };
  try {
    const cert = new X509Certificate(fs.readFileSync(site.tls.certPath));
    const keyStat = fs.statSync(site.tls.keyPath);
    const now = Date.now();
    const validTo = Date.parse(cert.validTo);
    const domain = readDomainState().domain || site.domain;
    return {
      mode: "direct",
      configured: true,
      readable: true,
      subject: cert.subject?.replace(/\n/g, " ").slice(0, 120) || "",
      validFrom: cert.validFrom,
      validTo: cert.validTo,
      expired: Number.isFinite(validTo) ? validTo <= now : null,
      daysLeft: Number.isFinite(validTo) ? Math.floor((validTo - now) / 86_400_000) : null,
      // تطابق الاسم شرط لاعتبار HTTPS صحيحاً
      matchesDomain: domain ? cert.checkHost(domain) !== undefined : null,
      // صلاحيات المفتاح: تحذير إن كان مقروءاً للعالم
      keyPermissions: (keyStat.mode & 0o777).toString(8),
      keyTooOpen: Boolean(keyStat.mode & 0o077),
    };
  } catch (error) {
    noteFailure("web-domain", error, { where: "src/web/services/domain-service.js:tlsStatus", stage: "read-cert", fallback: "unreadable" });
    return { ...base, configured: true, readable: false, note: "The certificate or key could not be read." };
  }
}

/** إصدار/تجديد TLS: غير مدعوم من داخل البوت — يُقال بصراحة */
function issueTls() {
  throw apiError("NOT_AVAILABLE_IN_WEB", {
    message: "Issuing or renewing a certificate is done by the reverse proxy or ACME client outside the bot process. See docs/web-platform/DOMAIN_AND_TLS.md.",
    details: { reason: "tls-issuance-is-out-of-process" },
  });
}

/** ملخّص كامل للمالك والواجهة */
async function overview({ listening = false } = {}) {
  return {
    site: websiteState({ listening }),
    domain: domainStatus(),
    routing: await routingCheck(),
    tls: tlsStatus(),
    states: Object.values(STATE),
  };
}

export { TXT_PREFIX, domainStatus, instructions, issueTls, overview, routingCheck, setDomain, tlsStatus, verifyDomain };
