// ═══════════════════════════════════════════════
// 🧭 Terboo — نمط الاستخدام وملف القدرات
// ───────────────────────────────────────────────
// المستخدم يختار مرة واحدة كيف سيستخدم البوت (ويغيّره متى شاء بـ .usage):
//   general (الاستخدام العام) · panel (إدارة لوحة) · vps (إدارة VPS) · أي مزيج · أو «لاحقاً».
// ملف القدرات يحدد ما يظهر له:
//   • العام فقط ⇒ لا لوحات ولا VPS في القوائم.
//   • panel ⇒ «لوحاتي» (وأدوات اللوحة بعد إضافة لوحة).
//   • vps ⇒ لوحة التحكم إن كانت لديه صلاحية VPS فعّالة، وإلا الباقات والتواصل مع المالك.
//   • المالك يرى كل شيء.
// التخزين: user.profile = { usage: ["general", ...], usageSetAt }
// ═══════════════════════════════════════════════

import { getDatabase } from "./terboo-database.js";

const MODES = Object.freeze(["general", "panel", "vps"]);

function db() {
  return getDatabase();
}

/** الأنماط المحفوظة أو null إن لم يختر بعد */
function usageOf(user) {
  const usage = user?.profile?.usage;
  return Array.isArray(usage) ? usage.filter((x) => MODES.includes(x)) : null;
}

/**
 * يحفظ نمط الاستخدام.
 * @param {string} jid
 * @param {string[]|"later"} modes
 */
function setUsage(jid, modes) {
  const user = db().getUser(jid) || {};
  const clean = modes === "later" ? [] : [...new Set((modes || []).filter((x) => MODES.includes(x)))];
  db().setUser(jid, { profile: { ...(user.profile || {}), usage: clean, usageDeferred: modes === "later", usageSetAt: new Date().toISOString() } });
  return clean;
}

/** مسودة الاختيار المخصص (قبل الحفظ) */
const drafts = new Map();

function draftOf(jid, initial = []) {
  if (!drafts.has(jid)) drafts.set(jid, new Set(initial));
  return drafts.get(jid);
}

function toggleDraft(jid, mode, initial = []) {
  const draft = draftOf(jid, initial);
  if (!MODES.includes(mode)) return draft;
  if (draft.has(mode)) draft.delete(mode);
  else draft.add(mode);
  return draft;
}

function clearDraft(jid) {
  drafts.delete(jid);
}

/**
 * ملف القدرات.
 * @param {Object} user سجل المستخدم
 * @param {{isOwner?:boolean, hasPanels?:boolean, hasActiveVps?:boolean}} facts
 */
function capabilityProfile(user, { isOwner = false, hasPanels = false, hasActiveVps = false } = {}) {
  const usage = usageOf(user);
  const modes = new Set(usage?.length ? usage : ["general"]);
  if (isOwner) for (const m of MODES) modes.add(m);
  // من يملك VPS فعّالاً أو لوحة مضافة يراها دائماً حتى لو اختار «عام» (لا نخفي ما يملكه)
  if (hasActiveVps) modes.add("vps");
  if (hasPanels) modes.add("panel");
  return {
    configured: Boolean(usage) || Boolean(user?.profile?.usageDeferred),
    modes: [...modes],
    general: modes.has("general"),
    panel: modes.has("panel"),
    vps: modes.has("vps"),
    hasPanels,
    hasActiveVps,
    owner: isOwner,
  };
}

/** هل يظهر قسم «cloud» لهذا الملف؟ */
function showsCloud(profile) {
  return Boolean(profile?.panel || profile?.vps || profile?.owner);
}

export { MODES, capabilityProfile, clearDraft, draftOf, setUsage, showsCloud, toggleDraft, usageOf };
export default { MODES, usageOf, setUsage, capabilityProfile, showsCloud, toggleDraft, draftOf, clearDraft };
