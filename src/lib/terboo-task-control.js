// ═══════════════════════════════════════════════
// 🎛️ Terboo Task Control (§20 §47 §85 §97) — التحكم بالمهام بكلام طبيعي
// ───────────────────────────────────────────────
// «إيه حالة المهمة؟» · «وقفها» · «كمل» · «ارجع للنتيجة» · «أعد المحاولة» · «هات آخر نتيجة»
// · «كمل من حيث وقفت» · «مهامي» · رقم مهمة صريح (TASK-…).
// انتقالات حالة حقيقية على Task Control Plane — لا ردود شكلية.
// المالك = الهوية القانونية للمرسل، النطاق = الدردشة: لا يرى أحد مهام غيره ولا يوقفها.
// ═══════════════════════════════════════════════

import { cancelTask, getTask, latestTask, listTasks, resumeTask, retryTask } from "./terboo-task-queue.js";
import { cancelActive, hasActive } from "./terboo-concurrency.js";
import { identityOf } from "./terboo-identity.js";
import { t } from "./terboo-localization.js";
import * as UI from "./terboo-ui-theme.js";

const ACTIVE = ["queued", "planning", "running", "waiting", "retrying", "paused"];

/** مالك/نطاق مهام هذه الرسالة */
function taskOwner(m) {
  return { owner: identityOf(m?.sender).canonical || String(m?.sender || ""), scope: String(m?.chat || "") };
}

function stateLabel(lang, status) {
  return t(lang, ["tasks", "states", status].join(".")) || status;
}

function line(lang, task) {
  return t(lang, "tasks.statusLine", { title: task.title, state: stateLabel(lang, task.status), progress: task.progress ?? 0 });
}

/**
 * نوع المهمة من كلام الإيقاف: «وقف التنصيب» لا يوقف تحميلاً أبداً.
 * يطابق نوع المهمة أو عنوانها (العنوان باللغة التي أُنشئت بها).
 */
const TASK_HINTS = [
  { word: /تنصيب|تثبيت|install|instalaci/i, task: /install|reinstall|deploy|theme|تنصيب|تثبيت/i },
  { word: /طرد|kick|expulsi/i, task: /^group\.bulk$|طرد|kick|expuls/i },
  { word: /[اإ]ذاع|برودكاست|broadcast|difusi/i, task: /broadcast|اذاع|إذاع/i },
  { word: /مؤقت|جدول|timer|schedul|programaci|temporizador/i, task: /^group\.schedule$/i },
  { word: /تحميل|download|descarga/i, task: /download|^tool:|تحميل/i },
  { word: /رفع|upload|subida/i, task: /upload|رفع/i },
  { word: /بناء|build|compilaci/i, task: /build|project\.|بناء/i },
  { word: /نشر|deploy/i, task: /deploy|project\.|نشر/i },
  { word: /[اإ]رسال|\bsend\b|env[ií]o/i, task: /^message\.|broadcast|ارسال|إرسال/i },
  { word: /بحث|search|b[uú]squeda/i, task: /search|^tool:|بحث/i },
];

function hintOf(text) {
  const value = String(text || "");
  return TASK_HINTS.find((hint) => hint.word.test(value)) || null;
}

/** المهمة المقصودة: رقم صريح ⇒ هي، وإلا الأحدث النشطة (من نوع الكلام إن ذُكر)، وإلا الأحدث عموماً */
function targetTask(m, { taskId = "", activeOnly = false, hint = null } = {}) {
  const who = taskOwner(m);
  if (taskId) {
    const task = getTask(taskId);
    return task && task.owner === who.owner ? task : null;
  }
  if (hint) {
    const matches = (rows) => rows.filter((task) => hint.task.test(task.type) || hint.task.test(task.title || ""));
    // نفس الدردشة أولاً، ثم مهام نفس الشخص في أي دردشة (المالك يوقف تنصيباً بدأه من الخاص)
    return matches(listTasks({ ...who, status: ACTIVE, limit: 50 }))[0] || matches(listTasks({ owner: who.owner, status: ACTIVE, limit: 50 }))[0] || null;
  }
  return latestTask({ ...who, status: ACTIVE }) || (activeOnly ? null : latestTask(who));
}

/** سبب رفض الاستئناف/الإعادة ⇒ رسالة صادقة (ملف لم يُحفظ ⇒ أرسله مجدداً) */
function refusalKey(reason, fallback) {
  if (reason === "not-owner") return "tasks.notOwner";
  if (reason === "not-replayable") return "tasks.needsResend";
  return fallback;
}

/**
 * ينفّذ عملية تحكّم ويُرجع كتل الرد (أو null إن لم يوجد ما يُتحكَّم به).
 * @param {{m:Object, lang:string, op:"status"|"cancel"|"resume"|"retry"|"result"|"list", taskId?:string}} input
 * @returns {{icon:string, blocks:string[], op:string, taskId?:string, ok:boolean, title?:string, done?:Promise}}
 *   done: نتيجة المهمة المستأنفة/المعادة — المستدعي يسلّمها (لا تضيع بصمت)
 */
function controlTask({ m, lang = "ar", op, taskId = "", text = "" }) {
  const who = taskOwner(m);
  const requester = { owner: who.owner, scope: who.scope };

  if (op === "list") {
    const rows = listTasks({ ...who, limit: 6 });
    if (!rows.length) return { ok: false, op, icon: "🗂️", blocks: [t(lang, "tasks.none")] };
    return { ok: true, op, icon: "🗂️", blocks: [UI.section(t(lang, "tasks.listTitle"), lang), rows.map((task) => UI.bullet(line(lang, task), lang)).join("\n")] };
  }

  if (op === "cancel") {
    const hint = taskId ? null : hintOf(text);
    const task = targetTask(m, { taskId, activeOnly: true, hint });
    if (task) {
      const result = cancelTask(task.id, { owner: who.owner }, "user");
      if (result.ok) return { ok: true, op, taskId: task.id, icon: "⏹️", blocks: [t(lang, "tasks.cancelled", { title: task.title })] };
      if (result.reason === "not-owner") return { ok: false, op, icon: "⛔", blocks: [t(lang, "tasks.notOwner")] };
      // سجل محفوظ بلا مهمة حيّة (قاطعه إعادة التشغيل ولم يُستأنف) ⇒ لا شيء يجري فعلاً
      if (result.reason === "not-active") return { ok: false, op, taskId: task.id, icon: "🗂️", blocks: [t(lang, "tasks.notRunning", { title: task.title })] };
    }
    // نوع محدد ولا مهمة منه: صدق بدل إيقاف شيء آخر
    if (hint) return { ok: false, op, icon: "🗂️", blocks: [t(lang, "tasks.noMatching")] };
    // لا مهمة خلفية: قرار ذكاء جارٍ لنفس الشخص؟ يُلغى فعلياً (AbortSignal)
    if (hasActive(m) && cancelActive(m, "user-cancel")) return { ok: true, op, icon: "⏹️", blocks: [t(lang, "tasks.cancelledReply")] };
    return { ok: false, op, icon: "🗂️", blocks: [t(lang, "tasks.cancelledNothing")] };
  }

  // «كمل الإذاعة» ⇒ آخر مهمة إذاعة (نشطة أو موقوفة) لا آخر مهمة أياً كانت
  const hint = !taskId && op === "resume" ? hintOf(text) : null;
  const matching = hint ? listTasks({ owner: who.owner, limit: 50 }).filter((row) => (hint.task.test(row.type) || hint.task.test(row.title || "")) && !String(row.note || "").startsWith("resumed-as:")) : [];
  const task = hint ? matching.find((row) => ["cancelled", "failed", "waiting", "expired", "paused"].includes(row.status)) || matching[0] || null : targetTask(m, { taskId });
  if (!task) return { ok: false, op, icon: "🗂️", blocks: [t(lang, hint ? "tasks.noMatching" : op === "result" ? "tasks.resultNone" : "tasks.none")] };

  if (op === "status") {
    return { ok: true, op, taskId: task.id, icon: "📊", blocks: [UI.section(t(lang, "tasks.statusTitle"), lang), line(lang, task), task.note && task.status !== "completed" ? UI.quote(task.note, lang) : ""] };
  }
  if (op === "result") {
    if (task.status !== "completed") {
      return { ok: false, op, taskId: task.id, icon: "⏳", blocks: [t(lang, "tasks.resultPending", { state: stateLabel(lang, task.status), progress: task.progress ?? 0 })] };
    }
    const artifacts = (task.artifacts || []).slice(0, 5).map((a) => UI.bullet(typeof a === "string" ? a : a.url || a.title || a.type || "", lang));
    return { ok: true, op, taskId: task.id, icon: "📦", blocks: [UI.section(t(lang, "tasks.resultTitle", { title: task.title }), lang), task.summary || "", ...artifacts] };
  }
  if (op === "resume") {
    const result = resumeTask(task.id, requester);
    if (result.ok) return { ok: true, op, taskId: result.id, title: task.title, done: result.done, icon: "▶️", blocks: [t(lang, "tasks.resumed", { title: task.title })] };
    return { ok: false, op, taskId: task.id, icon: "🗂️", blocks: [t(lang, refusalKey(result.reason, "tasks.notResumable"))] };
  }
  if (op === "retry") {
    const result = retryTask(task.id, requester);
    if (result.ok) return { ok: true, op, taskId: result.id, title: task.title, done: result.done, icon: "🔁", blocks: [t(lang, "tasks.retried", { title: task.title })] };
    return { ok: false, op, taskId: task.id, icon: "🗂️", blocks: [t(lang, refusalKey(result.reason, "tasks.notRetryable"))] };
  }
  return { ok: false, op, icon: "🗂️", blocks: [t(lang, "tasks.none")] };
}

export { ACTIVE, controlTask, targetTask, taskOwner };
export default { controlTask, taskOwner };
