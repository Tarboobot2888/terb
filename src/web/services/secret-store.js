// ═══════════════════════════════════════════════
// 🔑 Terboo Web — سر توقيع الجلسات والرموز
// ───────────────────────────────────────────────
// الترتيب: config.website.session.secret ← WEBSITE_SESSION_SECRET من البيئة
//          ← ملف data/secure/website-session.key (يُولَّد مرة واحدة بصلاحية 600).
// السر يُسجَّل في مُعتِّم الأسرار فلا يظهر في أي سجل أو رسالة خطأ.
// تغييره يُبطل كل الجلسات والتحديات القائمة (وهذا سلوك مقصود).
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { registerSecret } from "../../lib/terboo-secrets.js";
import { noteFailure } from "../../lib/terboo-failure-log.js";
import { websiteConfig } from "../config.js";

const KEY_FILE = path.join(process.cwd(), "data", "secure", "website-session.key");
let cached = "";

function fromFile() {
  try {
    if (fs.existsSync(KEY_FILE)) {
      const value = fs.readFileSync(KEY_FILE, "utf8").trim();
      if (value.length >= 32) return value;
    }
  } catch (error) {
    noteFailure("web-secret", error, { where: "src/web/services/secret-store.js:fromFile", stage: "read", fallback: "generate" });
  }
  return "";
}

function generate() {
  const value = crypto.randomBytes(48).toString("base64url");
  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true, mode: 0o700 });
    fs.writeFileSync(KEY_FILE, value, { encoding: "utf8", mode: 0o600 });
  } catch (error) {
    // تعذّر الحفظ ⇒ سر لهذه العملية فقط: الجلسات تُبطل عند إعادة التشغيل
    noteFailure("web-secret", error, { where: "src/web/services/secret-store.js:generate", stage: "write", fallback: "in-memory-only" });
  }
  return value;
}

/** سر التوقيع الحالي (يُحسب مرة واحدة لكل عملية) */
function sessionSecret() {
  if (cached) return cached;
  const configured = websiteConfig().session.secret || process.env.WEBSITE_SESSION_SECRET || "";
  cached = configured.length >= 32 ? configured : fromFile() || generate();
  registerSecret(cached);
  return cached;
}

/** HMAC-SHA256 ثابت الوقت للمقارنة (hex) */
function hmac(value, namespace = "") {
  return crypto.createHmac("sha256", sessionSecret()).update(`${namespace}\u0000${value}`).digest("hex");
}

/** مقارنة ثابتة الوقت لسلسلتين hex */
function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

/** للاختبارات: يُنسي السر المحفوظ في الذاكرة */
function _resetSecret() {
  cached = "";
}

export { _resetSecret, hmac, safeEqualHex, sessionSecret };
