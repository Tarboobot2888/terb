// ═══════════════════════════════════════════════
// 🌐 Terboo Web — خادم HTTP (node:http، بلا إطار خارجي)
// ───────────────────────────────────────────────
// لماذا بلا إطار؟ كل حاجة أمنية هنا مغطّاة باعتمادية موجودة أصلاً
// (rate-limiter-flexible · file-type · mime-types) أو بـnode:http نفسه،
// فلا نضيف سطح اعتمادية جديداً لمشروع يحمل أكثر من مئة اعتمادية.
// ما يفرضه هذا الملف على كل طلب:
//   • معرّف طلب · عنوان المصدر (لا يُقرأ X-Forwarded-* إلا من proxy موثوق مُدرج)
//   • ترويسات أمان + CSP · حدود معدّل · حجم جسم مقيّد · JSON صارم
//   • جلسة من كوكي HttpOnly · CSRF على كل ما يغيّر حالة · فحص Origin
//   • مغلّف خطأ واحد بلا stack · إلغاء عند قطع العميل
//   • ملفات ثابتة من web/dist فقط، بحماية من اجتياز المسار
// خطأ HTTP واحد لا يُسقط البوت: كل طلب معزول وكل استثناء يُحوّل إلى رد.
// ═══════════════════════════════════════════════

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { noteFailure } from "../../lib/terboo-failure-log.js";
import { websiteConfig } from "../config.js";
import { ApiError, apiError, errorBody, errorStatus } from "../errors.js";
import * as sessions from "../services/session-service.js";
import * as limits from "../services/rate-limit-service.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MAX_URL_LENGTH = 2048;

// ── العنوان الحقيقي للمصدر ───────────────────────

/**
 * عنوان العميل. X-Forwarded-For لا يُقرأ إلا إذا trustProxy=true
 * **و** كان الاتصال نفسه من عنوان مُدرج في proxyAllowlist.
 * بغير ذلك تُتجاهل الترويسة تماماً (منع انتحال العنوان لتجاوز الحدود).
 */
function clientIp(req, site) {
  const direct = req.socket?.remoteAddress || "";
  if (!site.trustProxy) return direct;
  const normalized = direct.replace(/^::ffff:/, "");
  if (!site.proxyAllowlist.includes(direct) && !site.proxyAllowlist.includes(normalized)) return direct;
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || direct;
}

// ── ترويسات الأمان ───────────────────────────────

/**
 * CSP صارمة: لا تنفيذ inline ولا مصادر خارجية.
 * الخطوط والصور من نفس الأصل (نخدم خطوط assets/fonts محلياً، بلا Google Fonts).
 */
function securityHeaders(site, { nonce = "" } = {}) {
  const csp = [
    "default-src 'self'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""}`,
    "style-src 'self' 'unsafe-inline'",     // أنماط مضمّنة في الواجهة فقط؛ لا سكربت مضمّن
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ];
  if (site.tlsMode !== "disabled") csp.push("upgrade-insecure-requests");

  const headers = {
    "Content-Security-Policy": csp.join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "X-Permitted-Cross-Domain-Policies": "none",
  };
  // HSTS فقط حين يكون العنوان العام https فعلاً
  if (site.publicBaseUrl.startsWith("https://")) {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return headers;
}

/** الأصول المسموحة: العنوان العام وحده (و localhost في التطوير) */
function allowedOrigins(site) {
  const origins = new Set();
  if (site.publicBaseUrl) origins.add(site.publicBaseUrl);
  if (site.tlsMode === "disabled") {
    origins.add(`http://localhost:${site.port}`);
    origins.add(`http://127.0.0.1:${site.port}`);
  }
  return origins;
}

// ── الموجّه ──────────────────────────────────────

/** مسار إلى نمط: "/tools/:id/run" ⇒ تعبير مع أسماء المعاملات */
function compile(pattern) {
  const names = [];
  const source = pattern
    .split("/")
    .map((segment) => {
      if (!segment.startsWith(":")) return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      names.push(segment.slice(1));
      return "([^/]+)";
    })
    .join("/");
  return { re: new RegExp(`^${source}$`), names };
}

function createRouter() {
  const routes = [];
  const add = (method, pattern, handler, options = {}) => {
    routes.push({ method, pattern, ...compile(pattern), handler, options });
  };
  return {
    get: (p, h, o) => add("GET", p, h, o),
    post: (p, h, o) => add("POST", p, h, o),
    patch: (p, h, o) => add("PATCH", p, h, o),
    put: (p, h, o) => add("PUT", p, h, o),
    delete: (p, h, o) => add("DELETE", p, h, o),
    routes,
    /** يطابق المسار؛ يميّز «غير موجود» من «طريقة غير مسموحة» */
    match(method, pathname) {
      let pathExists = false;
      for (const route of routes) {
        const hit = route.re.exec(pathname);
        if (!hit) continue;
        pathExists = true;
        if (route.method !== method) continue;
        const params = {};
        route.names.forEach((name, index) => { params[name] = decodeURIComponent(hit[index + 1]); });
        return { route, params };
      }
      return pathExists ? { methodMismatch: true } : null;
    },
  };
}

// ── قراءة الجسم ──────────────────────────────────

/**
 * يقرأ الجسم بحدٍّ صارم للبايتات.
 * التجاوز يُرفض بـ413 **ويُرَد على العميل**: لا يُقطع المقبس قبل الرد
 * (القطع يظهر للمتصفح كفشل شبكة بلا سبب). الجسم المتبقي يُوقَف عن القراءة
 * فلا يُحمَّل في الذاكرة، ويُتلَف الطلب بعد إرسال الرد.
 */
function readBody(req, maxBytes) {
  // طول معلَن أكبر من الحد ⇒ رفض قبل قراءة أي بايت
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.reject(apiError("PAYLOAD_TOO_LARGE", { details: { maxBytes } }));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const finish = (fn, value) => { if (!settled) { settled = true; fn(value); } };

    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        chunks.length = 0;
        req.pause();
        finish(reject, apiError("PAYLOAD_TOO_LARGE", { details: { maxBytes } }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(resolve, Buffer.concat(chunks)));
    req.on("error", (error) => finish(reject, error));
    req.on("aborted", () => finish(reject, apiError("CANCELLED")));
  });
}

function parseJson(buffer) {
  if (!buffer.length) return {};
  let value;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw apiError("MALFORMED_JSON", { details: { at: error.message.slice(0, 80) } });
  }
  // كائن عادي فقط: لا مصفوفة ولا قيمة مفردة ولا prototype pollution
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw apiError("INVALID_INPUT", { message: "The request body must be a JSON object." });
  }
  for (const key of ["__proto__", "constructor", "prototype"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      throw apiError("INVALID_INPUT", { message: "The request body contains a reserved field name." });
    }
  }
  return value;
}

// ── الملفات الثابتة ──────────────────────────────

const STATIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

/**
 * يحلّ مساراً داخل جذر ثابت بأمان.
 * يرفض: الاجتياز (..) · البايت الصفري · الوصلات الرمزية الخارجة · الامتدادات غير المعروفة.
 */
function resolveStatic(root, pathname) {
  if (!root) return null;
  const clean = decodeURIComponent(pathname).split("?")[0].split("#")[0];
  if (clean.includes("\0")) return null;
  const target = path.resolve(root, `.${clean.endsWith("/") ? `${clean}index.html` : clean}`);
  const rootReal = fs.realpathSync(root);
  if (target !== rootReal && !target.startsWith(rootReal + path.sep)) return null;
  let stat;
  try {
    stat = fs.statSync(target);
  } catch (error) {
    // الملف غير موجود هو الحالة الطبيعية لأي مسار تطبيق صفحة واحدة.
    // ما ليس ENOENT (صلاحيات · وصلة مكسورة) يُسجَّل ثم يُرفض كذلك.
    if (error?.code !== "ENOENT") {
      noteFailure("web-http", error, { where: "src/web/http/server.js:resolveStatic", stage: "stat", fallback: "not-found" });
    }
    return null;
  }
  if (stat.isDirectory()) return resolveStatic(root, `${clean.replace(/\/$/, "")}/index.html`);
  if (!stat.isFile()) return null;
  // الوصلة الرمزية تُحلّ ويُعاد فحص الجذر
  const real = fs.realpathSync(target);
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) return null;
  const ext = path.extname(real).toLowerCase();
  if (!STATIC_TYPES[ext]) return null;
  return { file: real, type: STATIC_TYPES[ext], size: stat.size, mtime: stat.mtimeMs };
}

// ── الخادم ───────────────────────────────────────

/**
 * ينشئ خادم الموقع.
 * @param {{router:Object, staticRoot?:string, onReady?:Function}} input
 */
function createWebServer({ router, staticRoot = "" }) {
  const site = websiteConfig();
  const origins = allowedOrigins(site);

  async function handle(req, res) {
    const requestId = crypto.randomBytes(9).toString("base64url");
    const started = Date.now();
    const ip = clientIp(req, site);
    const nonce = crypto.randomBytes(12).toString("base64");

    for (const [name, value] of Object.entries(securityHeaders(site, { nonce }))) res.setHeader(name, value);
    res.setHeader("X-Request-Id", requestId);

    const ctx = {
      req, res, requestId, ip, nonce, site,
      method: req.method || "GET",
      url: null, params: {}, query: null, body: {},
      session: null, sessionId: "", principal: null,
      // مهلة/إلغاء: ينقطع العميل ⇒ تُلغى الأعمال الطويلة
      controller: new AbortController(),
      setCookie: (value) => {
        const existing = res.getHeader("Set-Cookie");
        const list = Array.isArray(existing) ? existing : existing ? [existing] : [];
        res.setHeader("Set-Cookie", [...list, value]);
      },
      json(status, payload) {
        const text = JSON.stringify(payload);
        res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        res.end(this.method === "HEAD" ? undefined : text);
      },
      fail(error) {
        const status = errorStatus(error);
        const body = errorBody(error, requestId);
        if (error instanceof ApiError && error.code === "RATE_LIMITED" && error.details?.retryAfterSeconds) {
          res.setHeader("Retry-After", String(error.details.retryAfterSeconds));
        }
        this.json(status, body);
      },
    };

    req.on("close", () => {
      if (!res.writableEnded) ctx.controller.abort("client-closed");
    });
    // طلب أُوقفت قراءته (تجاوز الحد) يُتلَف بعد تسليم الرد، لا قبله
    res.on("finish", () => {
      if (req.isPaused()) req.destroy();
    });

    try {
      if ((req.url || "").length > MAX_URL_LENGTH) throw apiError("INVALID_INPUT", { message: "The request URL is too long." });
      ctx.url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      ctx.query = ctx.url.searchParams;
      const pathname = ctx.url.pathname.replace(/\/{2,}/g, "/");

      if (ctx.method === "OPTIONS") {
        // لا CORS عبر الأصول: الواجهة من نفس الأصل. الرد يوضّح ذلك بلا السماح بشيء.
        res.writeHead(204, { Allow: "GET, HEAD, POST, PATCH, DELETE", "Content-Length": "0" });
        res.end();
        return;
      }

      // ① حد المعدّل العام لكل عنوان
      await limits.perMinuteRequests(`ip:${ip}`);

      // ② مسارات الـAPI
      if (pathname === "/api/v1" || pathname.startsWith("/api/v1/")) {
        const route = pathname.slice("/api/v1".length) || "/";
        const matched = router.match(ctx.method === "HEAD" ? "GET" : ctx.method, route);
        if (!matched) throw apiError("NOT_FOUND");
        if (matched.methodMismatch) throw apiError("METHOD_NOT_ALLOWED");

        ctx.params = matched.params;
        const options = matched.route.options || {};

        // ③ الجسم: JSON بحدٍّ، أو بايتات خام للرفع (الحد يُفرض في معالج الرفع)
        if (!SAFE_METHODS.has(ctx.method)) {
          if (options.rawBody) {
            ctx.rawBody = () => readBody(req, options.maxBytes || site.limits.uploadBytes);
          } else {
            ctx.body = parseJson(await readBody(req, site.limits.jsonBodyBytes));
          }
        }

        // ④ الجلسة من الكوكي (لا هوية من الجسم أبداً)
        ctx.sessionId = sessions.readSessionCookie(req.headers.cookie);
        const live = ctx.sessionId ? sessions.readSession(ctx.sessionId) : null;
        ctx.session = live?.record || null;

        // ⑤ فحص المصدر + CSRF على كل ما يغيّر حالة.
        // فحص المصدر يُطبَّق دائماً — حتى على مسارات الدخول قبل وجود جلسة —
        // فصفحة أجنبية لا تستطيع إطلاق طلب رمز أو تحقق بالنيابة عن زائر.
        if (!SAFE_METHODS.has(ctx.method)) {
          const origin = req.headers.origin || "";
          const fetchSite = req.headers["sec-fetch-site"] || "";
          const sameSite = fetchSite === "same-origin" || fetchSite === "none" || fetchSite === "";
          if (origin && origins.size && !origins.has(origin)) throw apiError("CSRF_FAILED");
          if (!sameSite && fetchSite !== "same-site") throw apiError("CSRF_FAILED");
          // رمز CSRF يُطلب حين توجد جلسة. مسارات ما قبل الجلسة (طلب الرمز
          // والتحقق) تحميها حدود العنوان والرقم والنظام وتهدئة إعادة الإرسال.
          if (ctx.session && !options.csrfExempt && !sessions.csrfValid(ctx.session, req.headers["x-csrf-token"])) {
            throw apiError("CSRF_FAILED");
          }
        }

        // ⑥ المصادقة والصلاحية المطلوبة للمسار
        if (options.auth !== false) {
          if (!ctx.session) throw apiError("UNAUTHENTICATED");
          const { identityFromCanonical } = await import("../services/identity-service.js");
          const { webPrincipal } = await import("../services/permission-service.js");
          const identity = identityFromCanonical(ctx.session.canonical);
          if (!identity) throw apiError("SESSION_EXPIRED");
          ctx.identity = identity;
          // الدور والحظر يُقرآن الآن من المصدر الحقيقي — في كل طلب
          ctx.principal = webPrincipal(identity);
          if (ctx.principal.isBanned) {
            const { revokeAllSessions } = sessions;
            revokeAllSessions(identity.canonical);
            ctx.setCookie(sessions.sessionCookie("", { clear: true }));
            throw apiError("ACCOUNT_BANNED");
          }
        }

        await matched.route.handler(ctx);
        // معالج بثّ (تنزيل ملف) يكتب الترويسات ويتولّى الرد بنفسه:
        // headersSent هو الدليل، لا writableEnded (البثّ لم ينتهِ بعد).
        if (!res.headersSent) ctx.json(204, {});
        return;
      }

      // ⑦ ملفات الواجهة
      if (ctx.method !== "GET" && ctx.method !== "HEAD") throw apiError("METHOD_NOT_ALLOWED");
      const asset = resolveStatic(staticRoot, pathname);
      if (asset) {
        const etag = `W/"${asset.size.toString(16)}-${Math.floor(asset.mtime).toString(16)}"`;
        if (req.headers["if-none-match"] === etag) {
          res.writeHead(304, { ETag: etag });
          res.end();
          return;
        }
        const immutable = /\.[0-9a-f]{8,}\.(js|css|woff2?|png|jpe?g|webp|svg)$/i.test(asset.file);
        res.writeHead(200, {
          "Content-Type": asset.type,
          "Content-Length": String(asset.size),
          ETag: etag,
          "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
        });
        if (ctx.method === "HEAD") { res.end(); return; }
        fs.createReadStream(asset.file).on("error", () => res.end()).pipe(res);
        return;
      }

      // ⑧ تطبيق صفحة واحدة: أي مسار غير معروف ⇒ index.html (لا مسارات /api)
      const shell = resolveStatic(staticRoot, "/index.html");
      if (shell) {
        res.writeHead(200, { "Content-Type": shell.type, "Cache-Control": "no-cache" });
        if (ctx.method === "HEAD") { res.end(); return; }
        fs.createReadStream(shell.file).pipe(res);
        return;
      }
      throw apiError("NOT_FOUND");
    } catch (error) {
      if (res.headersSent || res.writableEnded) return;
      if (!(error instanceof ApiError)) {
        noteFailure("web-http", error, {
          where: "src/web/http/server.js:handle",
          stage: `${ctx.method} ${ctx.url?.pathname || req.url || ""}`,
          requestId,
          fallback: "500",
        });
      }
      ctx.fail(error);
    } finally {
      if (site.tlsMode === "disabled" && process.env.NODE_ENV !== "production") {
        const ms = Date.now() - started;
        if (ms > 2000) console.warn(`[web] slow ${ctx.method} ${ctx.url?.pathname || ""} ${ms}ms`);
      }
    }
  }

  // مستمع واحد لا يرمي أبداً إلى حلقة البوت
  const listener = (req, res) => {
    handle(req, res).catch((error) => {
      noteFailure("web-http", error, { where: "src/web/http/server.js:listener", fallback: "destroy-response" });
      if (!res.headersSent && !res.writableEnded) {
        try {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: { code: "INTERNAL", message: "Something went wrong on our side.", requestId: "" } }));
        } catch (writeError) {
          noteFailure("web-http", writeError, { where: "src/web/http/server.js:listener", stage: "write-500", fallback: "ignore" });
        }
      }
    });
  };

  // HTTPS مباشر فقط حين توجد شهادة فعلاً؛ غير ذلك HTTP خلف proxy
  if (site.tlsMode === "direct" && site.tls.certPath && site.tls.keyPath) {
    const credentials = { cert: fs.readFileSync(site.tls.certPath), key: fs.readFileSync(site.tls.keyPath) };
    return https.createServer(credentials, listener);
  }
  return http.createServer(listener);
}

export { allowedOrigins, clientIp, createRouter, createWebServer, parseJson, readBody, resolveStatic, securityHeaders };
