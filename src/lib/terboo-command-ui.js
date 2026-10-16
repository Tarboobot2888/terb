// ═══════════════════════════════════════════════
// 🎛️ Terboo Command UI Capability Engine (Smart Button Engine)
// ───────────────────────────────────────────────
// لكل أمر وصف واجهة واحد يُشتق من بيانات البلوقن نفسها (usage · example · الصلاحيات)
// ويمكن للبلوقن تجاوزه صراحةً بـ config.ui:
//   ui: { eligible, mode, actionKind, requiresText, requiresTarget, requiresMedia, destructive,
//         ownerOnly, adminOnly, interactiveSafe, supportsQuickReply, supportsSelect, supportsConfirm }
//
// قواعد الزر: إجراء محدد · مُدخلاته معروفة · بلا نص حر · هدف معروف · يقلل الاحتكاك · حتمي.
// لا زر: نص حر · رابط لم يُعطَ · ملف/وسيط · كود · هدف عشوائي · قيم متعددة مجهولة.
// المدمّر (طرد · حظر · حذف · إعادة تثبيت · استعادة …): لا زر مباشر أبداً ⇒ تأكيد ثم تنفيذ.
// الذكاء يقترح responseMode؛ القرار النهائي لهذه السياسة، ولا زر لأمر لا يملك المستخدم صلاحيته.
// ═══════════════════════════════════════════════

import { buildIndex, findEntry, isAvailable, normalize } from "./terboo-command-index.js";
import { getPlugin } from "./terboo-plugins.js";
import { visibleAliases } from "./terboo-brand.js";

/** معامل إلزامي «<…>» واختياري «[…]» في الاستعمال */
const REQUIRED_PARAM = /<([^<>]{1,120})>/g;
const OPTIONAL_PARAM = /\[([^[\]]{1,120})\]/g;
/** «(رد على رسالة)» · «reply to image» */
const REPLY_HINT = /(?:^|[\s(])(?:رد|بالرد|ريبلاي|reply|responde)(?:\s|$)/i;
const TARGET_WORDS = /@|منشن|mention|مستخدم|عضو|شخص|user|member|usuario|miembro|رقم|number|n[uú]mero/i;
const MEDIA_WORDS = /صوره|صورة|فيديو|ملصق|استيكر|صوت|ملف|مقطع|image|photo|video|sticker|audio|file|imagen|archivo/i;
const LINK_WORDS = /رابط|لينك|link|url|enlace|https?:/i;
const CODE_WORDS = /كود|code|c[oó]digo|script/i;
/** أوامر تنقّل/معلومات (زر مفيد دائماً حين لا مدخلات) */
const NAVIGATE_CATEGORIES = new Set(["main", "info", "user", "cloud"]);
/** كلمات أسماء الأوامر المدمّرة (عربي · إنجليزي · إسباني) — تُطابق كلمة كاملة من الاسم أو المرادف */
// «ازالة الخلفية» ليست مدمّرة؛ «leave» مرادف لرسالة الوداع أيضاً ⇒ لا تُعدّ هنا («اخرج» تكفي للمغادرة)
const DESTRUCTIVE_WORDS = new Set([
  "طرد", "حظر", "بان", "حذف", "مسح", "تصفير", "ريست", "خفض", "بلوك", "خروج", "اخرج", "اطلع", "غادر", "تعليق",
  "kick", "ban", "delete", "del", "reset", "clear", "purge", "wipe", "demote", "block", "unassign", "revoke",
  "suspend", "reinstall", "restore", "logout", "kill", "expulsar", "borrar", "eliminar",
]);
/** أسماء أنواع مدخلات حرة — «<سؤال/كود>» ليست قائمة خيارات بل نص يكتبه المستخدم */
const FREE_INPUT_WORDS = /^(?:سؤال|نص|كود|رابط|اسم|رقم|وصف|رساله|رسالة|كلمه|كلمة|موضوع|بحث|text|query|question|code|prompt|name|message|word|pregunta|texto|nombre|mensaje)$/iu;

const cache = { at: 0, size: 0, byName: new Map() };

/** خيارات محدودة داخل معامل: «<تشغيل/إيقاف>» · «<on|off>» · «[settings|language|ai]» */
function optionList(param) {
  const parts = String(param || "").split(/[/|،,]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 10) return [];
  if (parts.some((p) => FREE_INPUT_WORDS.test(p))) return [];
  return parts.every((p) => p.length <= 20 && !/\s{2,}/.test(p) && !TARGET_WORDS.test(p) && !LINK_WORDS.test(p)) ? parts : [];
}

/** كلمة مدمّرة داخل اسم واحد */
function hasDestructiveWord(name) {
  return normalize(String(name)).split(" ").some((word) => DESTRUCTIVE_WORDS.has(word));
}

/** الاسم الأساسي، والمرادفات البسيطة فقط (كلمة/كلمتان) — لا أسماء ملفات مثل «ganti-…-demote.jpg» */
function isDestructive(entry) {
  if (hasDestructiveWord(entry.name)) return true;
  return (entry.aliases || []).some((alias) => !/[.]/.test(alias) && String(alias).split(/[\s_-]+/).length <= 2 && hasDestructiveWord(alias));
}

/**
 * وصف الواجهة لأمر واحد (مشتق + تجاوز صريح من config.ui).
 * @param {Object|string} entryOrName مدخل فهرس الأوامر أو اسم/مرادف
 * @returns {Object|null}
 */
function uiOf(entryOrName) {
  const entry = typeof entryOrName === "string" ? findEntry(entryOrName) : entryOrName;
  if (!entry) return null;
  const fresh = cache.size === buildIndex().length && Date.now() - cache.at < 10 * 60 * 1000;
  if (!fresh) { cache.byName.clear(); cache.size = buildIndex().length; cache.at = Date.now(); }
  if (cache.byName.has(entry.name)) return cache.byName.get(entry.name);

  const usage = String(entry.usage || "");
  const required = [...usage.matchAll(REQUIRED_PARAM)].map((m) => m[1].trim());
  const optional = [...usage.matchAll(OPTIONAL_PARAM)].map((m) => m[1].trim());
  const options = required.map(optionList).find((list) => list.length) || [];
  const optionalChoices = optional.map(optionList).find((list) => list.length) || [];
  const free = required.filter((p) => !optionList(p).length);
  const requiresReply = REPLY_HINT.test(usage);
  const requiresTarget = Boolean(entry.requirements?.target) || free.some((p) => TARGET_WORDS.test(p));
  const requiresMedia = free.some((p) => MEDIA_WORDS.test(p)) || (requiresReply && MEDIA_WORDS.test(usage));
  const requiresLink = free.some((p) => LINK_WORDS.test(p));
  const requiresCode = free.some((p) => CODE_WORDS.test(p));
  const requiresText = free.some((p) => !TARGET_WORDS.test(p) && !MEDIA_WORDS.test(p) && !LINK_WORDS.test(p));
  const destructive = isDestructive(entry);
  const freeForm = requiresText || requiresLink || requiresCode;
  const eligible = !freeForm && !requiresTarget && !requiresMedia && !requiresReply;
  const choices = options.length ? options : optionalChoices;
  // خيارات فرعية مدمّرة («حذف» · «مسح») لا تصير صفاً مباشراً في قائمة اختيار
  const safeChoices = choices.filter((choice) => !hasDestructiveWord(choice));

  const derived = {
    eligible,
    mode: eligible
      ? destructive ? "confirm" : safeChoices.length >= 2 ? "select" : "button"
      : requiresTarget && !freeForm && !requiresMedia ? (destructive ? "confirm-after-target" : "after-target") : "none",
    actionKind: safeChoices.length >= 2 && eligible ? "choice"
      : freeForm ? "input"
      : requiresTarget ? "target-action"
      : requiresMedia || requiresReply ? "media-action"
      : NAVIGATE_CATEGORIES.has(entry.category) ? "navigate" : "action",
    requiresText,
    requiresLink,
    requiresCode,
    requiresTarget,
    requiresMedia,
    requiresReply,
    destructive,
    freeForm,
    options: choices,
    selectOptions: safeChoices,
    ownerOnly: Boolean(entry.permissions?.isOwner),
    adminOnly: Boolean(entry.permissions?.isAdmin),
    premiumOnly: Boolean(entry.permissions?.isPremium),
    groupOnly: Boolean(entry.permissions?.isGroup && !entry.permissions?.isPrivate),
    privateOnly: Boolean(entry.permissions?.isPrivate && !entry.permissions?.isGroup),
    interactiveSafe: eligible && !destructive,
    supportsQuickReply: eligible && !destructive,
    supportsSelect: eligible && !destructive && safeChoices.length >= 2,
    supportsConfirm: destructive,
    source: "derived",
  };
  const declared = getPlugin(entry.name)?.config?.ui;
  const ui = declared && typeof declared === "object" ? { ...derived, ...declared, source: "declared" } : derived;
  cache.byName.set(entry.name, ui);
  return ui;
}

/** هدف صريح في الوسائط: @رقم أو رقم هاتف */
const HAS_TARGET = /@\d{6,}|(?:^|\s)\+?\d{8,15}(?:\s|$)/;

/**
 * هل يُعرض زر مباشر لهذا الأمر بهذه المدخلات لهذا المستخدم؟
 * @param {{command:string, args?:string, m?:Object}} input
 * @returns {{allowed:boolean, mode:"button"|"confirm"|"none", reason:string, command?:string, args?:string}}
 */
function buttonFor({ command, args = "", m = null }) {
  const entry = findEntry(command);
  if (!entry) return { allowed: false, mode: "none", reason: "unknown-command" };
  // لا زر لما لا يملك المستخدم صلاحيته (الصلاحية تُفحص مرة أخرى عند التنفيذ)
  if (m && !isAvailable(entry, m)) return { allowed: false, mode: "none", reason: "permission" };
  const ui = uiOf(entry);
  const given = String(args || "").trim();
  if (ui.requiresMedia || ui.requiresReply) return { allowed: false, mode: "none", reason: "needs-media" };
  if (ui.requiresTarget && !HAS_TARGET.test(given)) return { allowed: false, mode: "none", reason: "needs-target" };
  if ((ui.requiresText || ui.requiresLink || ui.requiresCode) && !given) return { allowed: false, mode: "none", reason: "needs-text" };
  return { allowed: true, mode: ui.destructive ? "confirm" : "button", reason: ui.destructive ? "destructive" : "ok", command: entry.name, args: given };
}

/** responseMode المقبولة من النموذج */
const RESPONSE_MODES = new Set(["text", "buttons", "confirm"]);

/**
 * سياسة الرد التفاعلي: الذكاء يقترح، والسياسة تقرر.
 * @param {{proposed?:string, options:Array<{command:string,args?:string}>, m?:Object}} input
 * @returns {{mode:"text"|"buttons"|"confirm", allowed:Array, dropped:Array}}
 *   buttons: خيارات آمنة (≤3) أزرار اختيار · confirm: خيار واحد كامل المدخلات (مدمّر أو غير مؤكد) بنعم/لا
 */
function resolveResponseMode({ proposed = "", options = [], m = null }) {
  const wanted = RESPONSE_MODES.has(String(proposed)) ? String(proposed) : "";
  const verdicts = options.map((option) => ({ option, verdict: buttonFor({ command: option.command, args: option.args, m }) }));
  const allowed = verdicts.filter((v) => v.verdict.allowed);
  const dropped = verdicts.filter((v) => !v.verdict.allowed).map((v) => ({ command: v.option.command, reason: v.verdict.reason }));
  if (wanted === "text" || !allowed.length) return { mode: "text", allowed: [], dropped };
  // خيار واحد كامل: تأكيد (نعم/لا) — المدمّر لا يُعرض إلا هكذا
  if (options.length === 1 && allowed.length === 1) return { mode: "confirm", allowed, dropped };
  // عدة خيارات: المدمّر لا يصير زراً مباشراً بين خيارات؛ يبقى نصاً
  const safe = allowed.filter((v) => v.verdict.mode === "button");
  if (!safe.length || safe.length !== options.length) return { mode: "text", allowed: [], dropped: [...dropped, ...allowed.filter((v) => v.verdict.mode !== "button").map((v) => ({ command: v.option.command, reason: "destructive" }))] };
  return { mode: "buttons", allowed: safe.slice(0, 3), dropped };
}

/** مصفوفة واجهة كل الأوامر (docs/terboo-command-ui-matrix.json) */
function uiMatrix() {
  return buildIndex().map((entry) => {
    const ui = uiOf(entry);
    return {
      command: entry.name,
      category: entry.category,
      // مرادفات التوافق القديمة لا تُعرض (نفس قاعدة القوائم والذكاء)
      aliases: visibleAliases(entry.aliases).slice(0, 4),
      usage: entry.usage,
      buttonType: ui.mode === "select" ? "select" : ui.mode === "button" ? "quick-reply" : ui.mode === "confirm" || ui.mode === "confirm-after-target" ? "confirm" : ui.mode === "after-target" ? "after-target-resolution" : "none",
      ui,
      permission: ui.ownerOnly ? "owner" : ui.adminOnly ? "group-admin" : ui.premiumOnly ? "premium" : "public",
      target: ui.requiresTarget,
      destructive: ui.destructive,
      freeForm: ui.freeForm,
      expectedResponse: expectedResponse(entry, ui),
    };
  });
}

/** نوع الرد المتوقع (تقريبي من الفئة والمتطلبات — للمراجعة لا للتنفيذ) */
function expectedResponse(entry, ui) {
  if (["downloader", "asupan", "cecan", "random", "anime", "photo", "ephoto", "canvas"].includes(entry.category)) return "media";
  if (["sticker", "convert", "media"].includes(entry.category)) return ui.requiresMedia ? "media-from-media" : "media";
  if (ui.actionKind === "navigate" || entry.category === "cloud") return "card";
  if (ui.requiresTarget && ["group", "owner"].includes(entry.category)) return "action-result";
  if (entry.category === "ai") return "text";
  return "text-or-card";
}

function _resetCommandUi() {
  cache.byName.clear();
  cache.at = 0;
  cache.size = 0;
}

export { DESTRUCTIVE_WORDS, RESPONSE_MODES, _resetCommandUi, buttonFor, optionList, resolveResponseMode, uiMatrix, uiOf };
export default { uiOf, buttonFor, resolveResponseMode, uiMatrix };
