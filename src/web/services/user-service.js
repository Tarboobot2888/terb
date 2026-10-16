// ═══════════════════════════════════════════════
// 👤 Terboo Web — ملف المستخدم من مصدر الحقيقة الواحد
// ───────────────────────────────────────────────
// يقرأ ويكتب عبر getDatabase() المركزي فقط (نفس المثيل الذي يستعمله البوت)
// بالمفتاح المعتمد (أرقام بلا لاحقة، كما يفعل Database.getUser/setUser).
// لا مثيل Database ثانٍ ولا lowdb ثانٍ ولا كتابة مباشرة في database/main/*.json.
//
// ما لا يفعله هذا الملف أبداً:
//   • لا يمنح ولا يغيّر دوراً (owner/partner/premium) ولا رصيداً ولا طاقة ولا XP.
//     الأدوار تُقرأ من config.is* وقت التنفيذ، والاقتصاد يملكه محرّك البوت.
//   • لا ينشئ حساباً مكرراً: المفتاح واحد مشتق من الهوية القانونية.
//   • لا يكتب حقولاً غير معروفة في سجل المستخدم (منع mass assignment).
// ═══════════════════════════════════════════════

import config from "../../../config.js";
import { getDatabase } from "../../lib/terboo-database.js";
import { getUserLanguage, normalizeLanguage } from "../../lib/terboo-localization.js";
import { websiteConfig } from "../config.js";
import { maskPhone } from "./identity-service.js";
import { hmac } from "./secret-store.js";

/** الحقول الوحيدة التي يسمح الموقع بتعديلها على سجل المستخدم */
const WRITABLE_PREFERENCES = Object.freeze({
  // التطبيع من محرّك اللغات الرسمي: لا قائمة لغات ثانية في الموقع
  language: (value) => normalizeLanguage(value, null),
});

function db() {
  return getDatabase();
}

/**
 * ملف المستخدم للعرض. الأرقام المالية والطاقة تُقرأ كما هي من قاعدة البوت،
 * ولا تُخترع قيمة حين لا يوجد حقل: يُعاد null ليعرض الموقع «غير معروف».
 */
function profileOf(identity, principal) {
  const record = db().getUser(identity.dbKey);
  return {
    // مرجع حساب معتم وثابت: يكفي الواجهة ولا يحمل أرقاماً.
    // الهوية القانونية (pn:<digits>) تبقى داخل الخادم ولا تُرسل للمتصفح.
    accountRef: hmac(identity.canonical, "account-ref").slice(0, 24),
    phoneMasked: maskPhone(identity.digits),
    name: record?.regName || record?.name || null,
    registered: Boolean(record?.isRegistered),
    // الدور من المحرّك الحقيقي لا من السجل
    role: principal.isOwner ? "owner" : principal.isPartner ? "partner" : principal.isPremium ? "premium" : "user",
    isOwner: principal.isOwner,
    isPremium: principal.isPremium,
    isPartner: principal.isPartner,
    language: getUserLanguage(record),
    // اقتصاد البوت: يُعرض فقط إن وُجد الحقل فعلاً
    economy: record
      ? {
        level: record.level ?? null,
        exp: record.exp ?? null,
        energi: record.energi ?? null,
        koin: record.koin ?? null,
        saldo: record.saldo ?? null,
        unlimited: record.energi === -1,
      }
      : null,
    createdAt: record?.registeredAt || null,
    lastSeen: record?.lastSeen || null,
    // الحساب غير موجود في قاعدة البوت بعد: الموقع يعرض الحالة بصدق
    existsInBotDatabase: Boolean(record),
  };
}

/**
 * يضمن وجود سجل أساسي بعد نجاح إثبات الرقم.
 * لا يمنح أي دور ولا رصيد ولا طاقة إضافية: setUser يملأ الافتراضيات المعتمدة
 * في محرّك قاعدة البيانات نفسه (نفس ما يحدث لمستخدم جديد على واتساب).
 * @returns {{created:boolean}}
 */
function ensureUser(identity, { name = "" } = {}) {
  const site = websiteConfig();
  const existing = db().getUser(identity.dbKey);
  if (existing) return { created: false };
  if (!site.allowSignupOnFirstLogin) return { created: false };
  db().setUser(identity.dbKey, { name: String(name || "").slice(0, 60) || "Unknown" });
  return { created: true };
}

/** يحدّث التفضيلات المسموحة فقط */
function updatePreferences(identity, patch = {}) {
  const changes = {};
  for (const [key, normalize] of Object.entries(WRITABLE_PREFERENCES)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = normalize(patch[key]);
    if (value !== null) changes[key] = value;
  }
  if (!Object.keys(changes).length) return { updated: [], profileChanged: false };
  // setUser يدمج فوق السجل الحالي بنفس المفتاح — لا سجل ثانٍ
  db().setUser(identity.dbKey, changes);
  return { updated: Object.keys(changes), profileChanged: true };
}

/** قائمة المستخدمين للمالك: أرقام مُقنَّعة وبلا ذاكرة أو محتوى خاص */
function listUsersForOwner({ limit = 50, offset = 0, query = "" } = {}) {
  const all = db().getAllUsers() || {};
  const needle = String(query || "").replace(/[^0-9a-zA-Z؀-ۿ]/g, "").toLowerCase();
  const rows = Object.entries(all)
    .filter(([digits, record]) => {
      if (!needle) return true;
      return digits.includes(needle) || String(record?.regName || record?.name || "").toLowerCase().includes(needle);
    })
    .sort((a, b) => String(b[1]?.lastSeen || "").localeCompare(String(a[1]?.lastSeen || "")))
    .slice(offset, offset + Math.min(limit, 200))
    .map(([digits, record]) => ({
      // المالك يرى مرجعاً داخلياً ورقماً مُقنَّعاً؛ الرقم الكامل لا يُعاد في قائمة
      ref: digits,
      phoneMasked: maskPhone(digits),
      name: record?.regName || record?.name || null,
      level: record?.level ?? null,
      energi: record?.energi ?? null,
      isPremium: Boolean(record?.isPremium),
      isBanned: Boolean(record?.isBanned),
      registered: Boolean(record?.isRegistered),
      lastSeen: record?.lastSeen || null,
    }));
  return { total: Object.keys(all).length, matched: rows.length, users: rows };
}

/** إحصاءات عامة للوحة المالك */
function userStats() {
  const all = db().getAllUsers() || {};
  const values = Object.values(all);
  return {
    total: values.length,
    registered: values.filter((u) => u?.isRegistered).length,
    premium: values.filter((u) => u?.isPremium).length,
    banned: values.filter((u) => u?.isBanned).length,
    ownersConfigured: Array.isArray(config.owner?.number) ? config.owner.number.length : 0,
  };
}

export { WRITABLE_PREFERENCES, ensureUser, listUsersForOwner, profileOf, updatePreferences, userStats };
