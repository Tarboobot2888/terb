// ═══════════════════════════════════════════════
// ⚠️ Terboo Web — مغلّف أخطاء واحد لكل الـAPI
// ───────────────────────────────────────────────
// شكل ثابت: { error: { code, message, requestId, details? } }
// لا stack trace ولا مسار ملف ولا اسم مضيف داخلي ولا أي قيمة سرّية في أي رد.
// التمييز صريح بين: مدخل غير صالح · غير مصرَّح · ممنوع · غير موجود ·
// تجاوز الحد · مزوّد غير متاح · غير متاح على الويب · خطأ داخلي.
// ═══════════════════════════════════════════════

const CODES = Object.freeze({
  INVALID_INPUT: { status: 400, message: "The request body or query is not valid." },
  MALFORMED_JSON: { status: 400, message: "The request body is not valid JSON." },
  PAYLOAD_TOO_LARGE: { status: 413, message: "The request payload is larger than the allowed limit." },
  UNAUTHENTICATED: { status: 401, message: "Sign in to continue." },
  SESSION_EXPIRED: { status: 401, message: "Your session has expired. Sign in again." },
  CSRF_FAILED: { status: 403, message: "The request could not be verified. Reload the page and try again." },
  FORBIDDEN: { status: 403, message: "You do not have permission to do that." },
  OWNER_ONLY: { status: 403, message: "This action is restricted to the bot owner." },
  ACCOUNT_BANNED: { status: 403, message: "This account cannot use the web service." },
  NEEDS_CONFIRMATION: { status: 409, message: "This action needs an explicit confirmation." },
  NEEDS_TARGET: { status: 400, message: "This action needs a target." },
  NOT_FOUND: { status: 404, message: "Not found." },
  METHOD_NOT_ALLOWED: { status: 405, message: "Method not allowed." },
  RATE_LIMITED: { status: 429, message: "Too many requests. Try again later." },
  PROVIDER_UNAVAILABLE: { status: 503, message: "The provider for this capability is not configured or not reachable." },
  NOT_AVAILABLE_IN_WEB: { status: 501, message: "This capability needs WhatsApp and is not available from the web." },
  BOT_OFFLINE: { status: 503, message: "The WhatsApp connection is not available right now." },
  SERVICE_UNAVAILABLE: { status: 503, message: "The service is not ready yet." },
  CANCELLED: { status: 499, message: "The request was cancelled." },
  TIMEOUT: { status: 504, message: "The operation took too long and was stopped." },
  INTERNAL: { status: 500, message: "Something went wrong on our side." },
});

class ApiError extends Error {
  /**
   * @param {keyof typeof CODES} code
   * @param {{message?:string, details?:Object, status?:number}} [options]
   *   message: نص آمن للعرض — لا يحمل أي تفصيل داخلي
   *   details: حقول آمنة فقط (أسماء حقول غير صالحة، ثوانٍ حتى إعادة المحاولة…)
   */
  constructor(code, { message = "", details = null, status = 0 } = {}) {
    const known = CODES[code] || CODES.INTERNAL;
    super(message || known.message);
    this.name = "ApiError";
    this.code = CODES[code] ? code : "INTERNAL";
    this.status = status || known.status;
    this.details = details;
    this.expose = true;
  }
}

const apiError = (code, options) => new ApiError(code, options);

/** جسم الخطأ المُرسَل — بلا أي شيء غير مقصود */
function errorBody(error, requestId = "") {
  const known = error instanceof ApiError;
  const code = known ? error.code : "INTERNAL";
  const message = known ? error.message : CODES.INTERNAL.message;
  const body = { error: { code, message, requestId } };
  if (known && error.details && typeof error.details === "object") body.error.details = error.details;
  return body;
}

const errorStatus = (error) => (error instanceof ApiError ? error.status : 500);

/** قرار محرّك الصلاحيات ⇒ خطأ API مكافئ (بلا كشف السياسة الداخلية) */
function permissionError(decision) {
  switch (decision?.decision) {
    case "needs-owner": return apiError("OWNER_ONLY");
    case "needs-confirmation": return apiError("NEEDS_CONFIRMATION", { details: { reason: decision.reason } });
    case "needs-target": return apiError("NEEDS_TARGET");
    case "provider-not-available": return apiError("PROVIDER_UNAVAILABLE", { details: { provider: decision.reason } });
    default: return apiError("FORBIDDEN", { details: decision?.reason ? { reason: decision.reason } : null });
  }
}

export { ApiError, CODES, apiError, errorBody, errorStatus, permissionError };
