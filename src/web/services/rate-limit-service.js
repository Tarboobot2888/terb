// ═══════════════════════════════════════════════
// 🚦 Terboo Web — حدود الاستخدام متعددة المستويات
// ───────────────────────────────────────────────
// يستعمل rate-limiter-flexible (اعتمادية موجودة أصلاً) بمخزن ذاكرة داخل العملية.
// المستويات مستقلة: لكل عنوان · لكل رقم · لكل جلسة · حد عام للنظام.
// تجاوز أي مستوى يعيد خطأ 429 مع ثوانٍ حتى إعادة المحاولة (بلا كشف سبب داخلي).
// ملاحظة تشغيلية: المخزن داخل العملية ⇒ الحدود لكل عملية بوت واحدة (وهي الحالة
// المعتمدة: الموقع يُستضاف داخل عملية البوت). عند التوسّع لعدة عمليات يلزم مخزن مشترك.
// ═══════════════════════════════════════════════

import { RateLimiterMemory } from "rate-limiter-flexible";
import { apiError } from "../errors.js";
import { websiteConfig } from "../config.js";

const limiters = new Map();

/** يبني (أو يعيد) محدِّداً مسمّى */
function limiter(name, points, durationSeconds, blockSeconds = 0) {
  const key = `${name}:${points}:${durationSeconds}:${blockSeconds}`;
  if (!limiters.has(key)) {
    limiters.set(key, new RateLimiterMemory({ points, duration: durationSeconds, blockDuration: blockSeconds }));
  }
  return limiters.get(key);
}

/**
 * يستهلك نقطة واحدة من محدِّد، ويرمي 429 عند التجاوز.
 * @param {string} name اسم المستوى (للتشخيص فقط — لا يُعاد للعميل)
 * @param {string} key المفتاح (عنوان · رقم مُعمّى · معرّف جلسة)
 */
async function consume(name, key, { points, durationSeconds, blockSeconds = 0, cost = 1 } = {}) {
  if (!key) return;
  try {
    await limiter(name, points, durationSeconds, blockSeconds).consume(String(key), cost);
  } catch (rejection) {
    // الرفض من المكتبة يحمل msBeforeNext، لا خطأ تشغيلي
    const retryAfter = Math.max(1, Math.ceil((rejection?.msBeforeNext || 1000) / 1000));
    throw apiError("RATE_LIMITED", { details: { retryAfterSeconds: retryAfter } });
  }
}

/** يقرأ المتبقي بلا استهلاك (لعرض حالة في الواجهة) */
async function peek(name, key, { points, durationSeconds, blockSeconds = 0 } = {}) {
  if (!key) return null;
  const result = await limiter(name, points, durationSeconds, blockSeconds).get(String(key));
  if (!result) return { remaining: points, resetSeconds: 0 };
  return {
    remaining: Math.max(0, points - result.consumedPoints),
    resetSeconds: Math.ceil((result.msBeforeNext || 0) / 1000),
  };
}

// ── المستويات المعتمدة ──────────────────────────

const perMinuteRequests = (key) => {
  const { requestsPerMinute } = websiteConfig().limits;
  return consume("requests", key, { points: requestsPerMinute, durationSeconds: 60 });
};

const otpPerPhone = (phoneHash) => {
  const { perPhonePerHour } = websiteConfig().limits.otp;
  return consume("otp-phone", phoneHash, { points: perPhonePerHour, durationSeconds: 3600 });
};

const otpPerIp = (ip) => {
  const { perIpPerHour } = websiteConfig().limits.otp;
  return consume("otp-ip", ip, { points: perIpPerHour, durationSeconds: 3600 });
};

const otpGlobal = () => {
  const { globalPerHour } = websiteConfig().limits.otp;
  return consume("otp-global", "global", { points: globalPerHour, durationSeconds: 3600 });
};

const otpVerifyPerIp = (ip) => consume("otp-verify-ip", ip, { points: 30, durationSeconds: 3600, blockSeconds: 900 });

const aiMessages = (canonical) => {
  const { aiMessagesPerHour } = websiteConfig().limits;
  return consume("ai", canonical, { points: aiMessagesPerHour, durationSeconds: 3600 });
};

const toolRuns = (canonical) => {
  const { toolRunsPerHour } = websiteConfig().limits;
  return consume("tool", canonical, { points: toolRunsPerHour, durationSeconds: 3600 });
};

const uploads = (canonical) => {
  const { uploadsPerHour } = websiteConfig().limits;
  return consume("upload", canonical, { points: uploadsPerHour, durationSeconds: 3600 });
};

/** حد لكل مضيف خارجي: يحمي المزوّدات من إساءة الاستخدام عبر الموقع */
const perExternalHost = (host) => consume("external-host", host, { points: 120, durationSeconds: 3600 });

/** للاختبارات: يصفّر كل المحدِّدات */
function _resetRateLimits() {
  limiters.clear();
}

export {
  _resetRateLimits,
  aiMessages,
  consume,
  otpGlobal,
  otpPerIp,
  otpPerPhone,
  otpVerifyPerIp,
  peek,
  perExternalHost,
  perMinuteRequests,
  toolRuns,
  uploads,
};
