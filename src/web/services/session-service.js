// ═══════════════════════════════════════════════
// 🎫 Terboo Web — الجلسات والكوكي و CSRF
// ───────────────────────────────────────────────
// • معرّف الجلسة عشوائي معتم (32 بايت) ولا يحمل أي بيانات: لا JWT في الكوكي،
//   ولا access/refresh token في localStorage. الكوكي يحمل المعرّف فقط.
// • المحفوظ على القرص هو بصمة المعرّف (HMAC) لا المعرّف نفسه: نسخة مخزن
//   مسروقة لا تكفي لانتحال جلسة.
// • تدوير المعرّف بعد المصادقة (منع session fixation) وعند ترقية الصلاحية.
// • انتهاء خمول + انتهاء مطلق + إلغاء صريح + حد جلسات لكل مستخدم.
// • الصلاحية تُقرأ في كل طلب لا عند الدخول: الحظر أو تغيير الدور يسري فوراً.
// • CSRF: رمز مرتبط بالجلسة (double submit) + فحص Origin/Sec-Fetch-Site
//   على كل طلب يغيّر حالة.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { cookieSecure, websiteConfig } from "../config.js";
import { apiError } from "../errors.js";
import { dropSession, getSession, pruneSessions, putSession, sessionsOf } from "../store/web-store.js";
import { hmac, safeEqualHex } from "./secret-store.js";

/** بصمة المعرّف كما تُخزَّن (المعرّف الصريح لا يُكتب على القرص أبداً) */
const sessionKey = (id) => hmac(id, "session");

const newId = () => crypto.randomBytes(32).toString("base64url");

/**
 * ينشئ جلسة جديدة لهوية مُثبتة.
 * @param {{canonical:string, digits:string, lang?:string, ip?:string, userAgent?:string}} input
 * @returns {{id:string, csrfToken:string, expiresAt:number}}
 */
function createSession({ canonical, digits, lang = "ar", ip = "", userAgent = "" }) {
  const site = websiteConfig().session;
  const now = Date.now();
  pruneSessions(now);

  const id = newId();
  const record = {
    canonical,
    // الأرقام تلزم لقراءة سجل المستخدم من قاعدة البوت بالمفتاح المعتمد
    digits,
    lang,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now + site.idleMinutes * 60_000,
    absoluteExpiresAt: now + site.absoluteHours * 3_600_000,
    // سرّ CSRF للجلسة: الرمز المُعاد للعميل مشتق منه
    csrfSecret: crypto.randomBytes(24).toString("base64url"),
    // بصمة مختصرة للعميل (لعرض الجلسات)، لا للمطابقة الأمنية
    ipHash: ip ? hmac(ip, "ip").slice(0, 16) : "",
    agent: String(userAgent || "").slice(0, 120),
  };
  putSession(sessionKey(id), record);

  // حد الجلسات لكل مستخدم: الأقدم يُلغى
  const mine = sessionsOf(canonical).sort((a, b) => a.createdAt - b.createdAt);
  while (mine.length > site.maxPerUser) {
    const oldest = mine.shift();
    if (oldest) dropSession(oldest.id);
  }

  return { id, csrfToken: csrfTokenFor(record), expiresAt: record.expiresAt };
}

/**
 * يقرأ جلسة من معرّف الكوكي ويمدّد الخمول.
 * @returns {{key:string, record:Object}|null}
 */
function readSession(id) {
  if (!id || typeof id !== "string" || id.length < 20 || id.length > 128) return null;
  const key = sessionKey(id);
  const record = getSession(key);
  if (!record) return null;

  const now = Date.now();
  if (record.expiresAt <= now || record.absoluteExpiresAt <= now) {
    dropSession(key);
    return null;
  }

  // تمديد الخمول بلا تجاوز العمر المطلق
  const site = websiteConfig().session;
  record.lastSeenAt = now;
  record.expiresAt = Math.min(now + site.idleMinutes * 60_000, record.absoluteExpiresAt);
  putSession(key, record);
  return { key, record };
}

/**
 * يدوّر معرّف الجلسة محافظاً على محتواها (بعد المصادقة أو ترقية الصلاحية).
 * @returns {{id:string, csrfToken:string, expiresAt:number}}
 */
function rotateSession(oldId) {
  const current = readSession(oldId);
  if (!current) throw apiError("SESSION_EXPIRED");
  dropSession(current.key);
  const id = newId();
  const record = { ...current.record, csrfSecret: crypto.randomBytes(24).toString("base64url"), rotatedAt: Date.now() };
  putSession(sessionKey(id), record);
  return { id, csrfToken: csrfTokenFor(record), expiresAt: record.expiresAt };
}

function destroySession(id) {
  const key = sessionKey(id);
  return dropSession(key);
}

/** يلغي كل جلسات هوية (حظر · تغيير دور · خروج من كل الأجهزة) */
function revokeAllSessions(canonical, { exceptId = "" } = {}) {
  const keep = exceptId ? sessionKey(exceptId) : "";
  let removed = 0;
  for (const session of sessionsOf(canonical)) {
    if (session.id === keep) continue;
    if (dropSession(session.id)) removed++;
  }
  return removed;
}

/** جلسات الهوية للعرض — بلا أسرار ولا معرّفات قابلة لإعادة الاستخدام */
function listSessions(canonical, currentId = "") {
  const currentKey = currentId ? sessionKey(currentId) : "";
  return sessionsOf(canonical).map((session) => ({
    // المعرّف المعروض هو بصمة البصمة: يُستعمل للإلغاء فقط ولا يصلح ككوكي
    id: hmac(session.id, "session-ref").slice(0, 24),
    current: session.id === currentKey,
    createdAt: session.createdAt,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt,
    agent: session.agent,
  }));
}

/** يلغي جلسة بمعرّفها المعروض (من listSessions) */
function revokeSessionByRef(canonical, ref) {
  for (const session of sessionsOf(canonical)) {
    if (hmac(session.id, "session-ref").slice(0, 24) === ref) return dropSession(session.id);
  }
  return false;
}

// ── CSRF ─────────────────────────────────────────

/** رمز CSRF مشتق من سرّ الجلسة (double submit) */
function csrfTokenFor(record) {
  return hmac(record.csrfSecret, "csrf");
}

/** يتحقق من رمز CSRF مقابل الجلسة — مقارنة ثابتة الوقت */
function csrfValid(record, supplied) {
  if (!record?.csrfSecret || !supplied) return false;
  return safeEqualHex(csrfTokenFor(record), String(supplied));
}

// ── الكوكي ───────────────────────────────────────

/** ترويسة Set-Cookie للجلسة */
function sessionCookie(id, { clear = false } = {}) {
  const site = websiteConfig();
  const { cookieName, sameSite } = site.session;
  const parts = [
    `${cookieName}=${clear ? "" : id}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
  ];
  if (cookieSecure(site)) parts.push("Secure");
  if (clear) parts.push("Max-Age=0");
  else parts.push(`Max-Age=${Math.floor(site.session.absoluteHours * 3600)}`);
  return parts.join("; ");
}

/** يقرأ كوكي الجلسة من ترويسة Cookie */
function readSessionCookie(header) {
  const name = websiteConfig().session.cookieName;
  for (const pair of String(header || "").split(";")) {
    const index = pair.indexOf("=");
    if (index === -1) continue;
    if (pair.slice(0, index).trim() !== name) continue;
    return decodeURIComponent(pair.slice(index + 1).trim());
  }
  return "";
}

function sessionStats() {
  return { idleMinutes: websiteConfig().session.idleMinutes, absoluteHours: websiteConfig().session.absoluteHours };
}

export {
  createSession,
  csrfTokenFor,
  csrfValid,
  destroySession,
  listSessions,
  readSession,
  readSessionCookie,
  revokeAllSessions,
  revokeSessionByRef,
  rotateSession,
  sessionCookie,
  sessionStats,
};
