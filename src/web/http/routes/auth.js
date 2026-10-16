// تسجيل الدخول: طلب رمز · تحقق · خروج · إدارة الجلسات
import { apiError } from "../../errors.js";
import { identityFromInput } from "../../services/identity-service.js";
import { requestCode, verifyCode } from "../../services/otp-service.js";
import { webPrincipal } from "../../services/permission-service.js";
import { ensureUser } from "../../services/user-service.js";
import { audit } from "../../services/audit-service.js";
import * as limits from "../../services/rate-limit-service.js";
import {
  createSession, csrfTokenFor, destroySession, listSessions, readSession,
  revokeAllSessions, revokeSessionByRef, sessionCookie,
} from "../../services/session-service.js";

const LANGS = new Set(["ar", "en", "es"]);

function register(router) {
  /**
   * ① طلب رمز.
   * الرد لا يكشف هل الرقم مسجّل أو موجود على واتساب — إلا بفشل التسليم الصريح
   * (رد موحّد لا يميّز «غير موجود» من «تعذّر الإرسال»).
   */
  router.post("/auth/otp/request", async (ctx) => {
    const identity = identityFromInput(ctx.body.phone);
    if (!identity) {
      throw apiError("INVALID_INPUT", {
        message: "Enter the number in international format, for example +201012345678.",
        details: { field: "phone" },
      });
    }
    const lang = LANGS.has(ctx.body.lang) ? ctx.body.lang : "ar";
    const challenge = await requestCode({ identity, ip: ctx.ip, lang });
    audit({ actor: identity.canonical, action: "web.auth.otp.request", outcome: "sent", requestId: ctx.requestId, targetPhone: identity.digits });
    // لا الرمز ولا الرقم الكامل في الرد
    ctx.json(200, challenge);
  }, { auth: false, csrfExempt: true });

  /** ② تحقق ⇒ جلسة جديدة (معرّف مدوَّر، كوكي HttpOnly، رمز CSRF) */
  router.post("/auth/otp/verify", async (ctx) => {
    await limits.otpVerifyPerIp(ctx.ip);
    const proven = verifyCode({ challengeId: ctx.body.challengeId, code: ctx.body.code, ip: ctx.ip });

    const { identityFromCanonical } = await import("../../services/identity-service.js");
    const identity = identityFromCanonical(proven.canonical);
    if (!identity) throw apiError("INVALID_INPUT");

    const principal = webPrincipal(identity);
    if (principal.isBanned) {
      audit({ actor: identity.canonical, action: "web.auth.login", outcome: "denied-banned", requestId: ctx.requestId });
      throw apiError("ACCOUNT_BANNED");
    }

    // تسجيل أساسي بعد الإثبات فقط، بلا أي دور أو رصيد
    const created = ensureUser(identity, { name: "" });

    const session = createSession({
      canonical: identity.canonical,
      digits: identity.digits,
      lang: proven.lang,
      ip: ctx.ip,
      userAgent: ctx.req.headers["user-agent"] || "",
    });
    ctx.setCookie(sessionCookie(session.id));
    audit({ actor: identity.canonical, action: "web.auth.login", outcome: created.created ? "ok-new-user" : "ok", requestId: ctx.requestId });

    ctx.json(200, {
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
      newAccount: created.created,
      role: principal.isOwner ? "owner" : principal.isPremium ? "premium" : "user",
    });
  }, { auth: false, csrfExempt: true });

  /** رمز CSRF للجلسة الحالية (بعد تحديث الصفحة) */
  router.get("/auth/csrf", (ctx) => {
    if (!ctx.session) throw apiError("UNAUTHENTICATED");
    ctx.json(200, { csrfToken: csrfTokenFor(ctx.session) });
  });

  router.post("/auth/logout", (ctx) => {
    destroySession(ctx.sessionId);
    ctx.setCookie(sessionCookie("", { clear: true }));
    audit({ actor: ctx.principal.canonical, action: "web.auth.logout", outcome: "ok", requestId: ctx.requestId });
    ctx.json(200, { signedOut: true });
  });

  router.get("/auth/sessions", (ctx) => {
    ctx.json(200, { sessions: listSessions(ctx.principal.canonical, ctx.sessionId) });
  });

  /** إلغاء جلسة بمرجعها المعروض — جلسات صاحب الحساب وحده */
  router.delete("/auth/sessions/:ref", (ctx) => {
    const removed = revokeSessionByRef(ctx.principal.canonical, ctx.params.ref);
    if (!removed) throw apiError("NOT_FOUND");
    audit({ actor: ctx.principal.canonical, action: "web.session.revoke", outcome: "ok", requestId: ctx.requestId });
    ctx.json(200, { revoked: true });
  });

  /** خروج من كل الأجهزة */
  router.post("/auth/sessions/revoke-all", (ctx) => {
    const removed = revokeAllSessions(ctx.principal.canonical, { exceptId: ctx.sessionId });
    audit({ actor: ctx.principal.canonical, action: "web.session.revoke-all", outcome: "ok", requestId: ctx.requestId, details: { removed } });
    ctx.json(200, { revoked: removed });
  });
}

export { register };
