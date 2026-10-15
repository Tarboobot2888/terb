// ═══════════════════════════════════════════════
// ⏳ Terboo Web — المهام الخلفية (نفس الطابور، بملكية صريحة)
// ───────────────────────────────────────────────
// يستعمل terboo-task-queue.js الحقيقي. ما يفرضه هذا الملف:
//   • كل مهمة تُنشأ بـ owner = الهوية القانونية و scope = "web:<canonical>"
//     فلا تخلط مهام الموقع بمهام محادثات واتساب لنفس الشخص.
//   • كل قراءة/إلغاء تمرّ بـrequester {owner, scope} — لا يُمرَّر null أبداً.
//     (owns() في الطابور يعتبر requester=null «يملك كل شيء»، فتمريره من HTTP
//      يفتح IDOR على مهام الآخرين.)
//   • أزرار التحكم تُعلَن بحسب ما يدعمه الطابور فعلاً لهذه المهمة: لا زر
//     استئناف لمهمة بلا runner مسجَّل، ولا «أُلغيت» قبل نتيجة حقيقية.
// ═══════════════════════════════════════════════

import { cancelTask, enqueueTask, getTaskStatus, listTasks } from "../../lib/terboo-task-queue.js";
import { websiteConfig } from "../config.js";
import { apiError } from "../errors.js";

const scopeOf = (principal) => `web:${principal.canonical}`;

/** هوية الطالب كما يفهمها الطابور */
function requesterOf(principal) {
  return { owner: principal.canonical, scope: scopeOf(principal), isOwner: principal.isOwner === true };
}

/** الشكل المعروض: حالة حقيقية وأزرار مدعومة فقط */
function shapeTask(task) {
  const terminal = ["completed", "failed", "cancelled", "expired"].includes(task.status);
  return {
    id: task.id,
    type: task.type,
    title: task.title || "",
    status: task.status,
    note: task.note || "",
    createdAt: task.createdAt,
    startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null,
    // تقدّم حقيقي فقط: لا نسبة تجميلية حين لا يرسل الـrunner مراحل
    progress: typeof task.progress === "number" ? task.progress : null,
    stage: task.stage || "",
    controls: {
      cancel: !terminal,
      // الاستئناف يحتاج runner مسجَّلاً للنوع + مهمة قابلة للاستئناف
      resume: Boolean(task.resumable) && task.status === "interrupted",
      retry: task.status === "failed" && Number(task.maxRetries || 0) > 0,
    },
    error: task.error ? String(task.error).slice(0, 200) : "",
    result: task.summary || null,
  };
}

/** مهام المستخدم وحده */
function myTasks(principal, { status = null, limit = 20 } = {}) {
  const requester = requesterOf(principal);
  return listTasks({ owner: requester.owner, scope: requester.scope, status, limit: Math.min(limit, 100) })
    .map(shapeTask);
}

/** مهمة واحدة بعد التحقق من الملكية */
function myTask(principal, id) {
  const task = getTaskStatus(String(id || ""));
  const requester = requesterOf(principal);
  // ليست له ⇒ 404 لا 403: لا يكشف وجود مهمة لغيره
  if (!task || task.owner !== requester.owner || task.scope !== requester.scope) throw apiError("NOT_FOUND");
  return shapeTask(task);
}

/** إلغاء مهمة يملكها — لا يُعلَن النجاح إلا بنتيجة حقيقية من الطابور */
function cancelMyTask(principal, id) {
  const task = myTask(principal, id);
  const outcome = cancelTask(String(id), requesterOf(principal), "web-user");
  if (!outcome?.ok) {
    if (outcome?.reason === "not-active") throw apiError("INVALID_INPUT", { message: "That task has already finished." });
    throw apiError("FORBIDDEN", { details: { reason: outcome?.reason || "cancel-refused" } });
  }
  return { id: task.id, cancelled: true };
}

/**
 * يضيف مهمة خلفية للموقع، بحد مهام متزامنة لكل مستخدم.
 * @param {{principal:Object, type:string, title:string, run:Function, timeoutMs?:number}} input
 */
function startTask({ principal, type, title, run, timeoutMs = 0, tool = null }) {
  const requester = requesterOf(principal);
  const active = listTasks({ owner: requester.owner, scope: requester.scope, status: ["queued", "running", "waiting"], limit: 50 });
  const max = websiteConfig().limits.tasksPerUser;
  if (active.length >= max) {
    throw apiError("RATE_LIMITED", { message: "You already have the maximum number of running tasks.", details: { running: active.length, max } });
  }
  const task = enqueueTask({
    type: String(type || "web"),
    title: String(title || "").slice(0, 120),
    owner: requester.owner,
    scope: requester.scope,
    timeoutMs,
    tool,
    run,
  });
  return { id: task.id, status: getTaskStatus(task.id)?.status || "queued", done: task.done };
}

export { cancelMyTask, myTask, myTasks, requesterOf, scopeOf, shapeTask, startTask };
