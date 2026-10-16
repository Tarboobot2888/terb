// ═══════════════════════════════════════════════
// 🗂️ Terboo Task Control Plane (§19 §20 §21 §47 §48 §49 §96 §97 §111)
// ───────────────────────────────────────────────
// تطوير في المكان لـ terboo-task-queue.js — نفس الواجهة القديمة تعمل كما هي:
//   enqueueTask({type, owner, run, cleanupMs}) ⇒ {id, status, done} · getTaskStatus · getQueueSummary
//
// كل مهمة: taskId · owner · scope · type · priority · status · progress · createdAt · startedAt
//   · finishedAt · result · error · retryCount · parentTask · childTasks · provider · tool · cancellation
// الحالات: queued · planning · running · waiting · retrying · paused · cancelled · completed · failed · expired
// الأولويات: P0 محادثة · P1 أمر بسيط · P2 وسائط · P3 مستند · P4 بحث عميق · P5 مالك/مشروع
//   — المهام الثقيلة (P2+) محدودة التزامن حتى لا تجمّد أي شيء؛ المحادثة لا تمر من هنا أصلاً.
//
// الإلغاء حقيقي (AbortSignal يصل للمهمة)، وإعادة المحاولة محدودة، والتقدّم يُبلَّغ بلا إغراق،
// والنتيجة تُحفظ (ملخص + مراجع) حين persist:true — «هات نتيجة مهمة إمبارح» تعمل بعد إعادة التشغيل.
// الاستئناف: مهمة لها runner مسجّل بنوعها + checkpoint ⇒ تُكمل من آخر نقطة.
// المؤجّلة (notBefore): تبقى في الطابور بلا خانة تنفيذ حتى موعدها (قفل مجدول…)، تُلغى وتُعرض كأي مهمة.
// الخصوصية: كل استعلام مقيّد بالمالك والنطاق؛ لا يرى أحد مهام غيره.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { noteFailure } from "./terboo-failure-log.js";

const PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };
const STATUS = ["queued", "planning", "running", "waiting", "retrying", "paused", "cancelled", "completed", "failed", "expired"];
const TERMINAL = new Set(["cancelled", "completed", "failed", "expired"]);
const DEFAULT_CLEANUP_MS = 5 * 60 * 1000;
const LIMITS = { maxActive: 2, maxActiveLight: 4, queuedExpireMs: 30 * 60 * 1000, historySize: 500, historyTtlMs: 7 * 24 * 60 * 60 * 1000, progressMinGapMs: 8_000 };

const tasks = new Map();        // المهام الحيّة (تُزال بعد cleanupMs كما في الواجهة القديمة)
const waiting = [];
const runners = new Map();      // نوع ⇒ دالة تنفيذ قابلة للاستئناف بعد إعادة التشغيل
const listeners = new Set();
let activeHeavy = 0;
let activeLight = 0;

// ═══════════════════════════════════════════════
// التخزين الدائم (ملخصات فقط — بلا أسرار ولا محتوى خام)
// ═══════════════════════════════════════════════

function storePath() {
  return process.env.TERBOO_TASKS_PATH || path.join(process.cwd(), "database", "tasks.json");
}

let history = null;
function loadHistory() {
  if (history) return history;
  history = new Map();
  try {
    const file = storePath();
    if (fs.existsSync(file)) {
      for (const record of JSON.parse(fs.readFileSync(file, "utf8")) || []) history.set(record.id, record);
    }
  } catch (error) {
    noteFailure("task-queue", error, { where: "src/lib/terboo-task-queue.js:loadHistory", stage: "read", fallback: "empty-history" });
  }
  return history;
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveHistory(); }, 1000);
  saveTimer.unref?.();
}

function saveHistory() {
  if (!history) return;
  try {
    const cutoff = Date.now() - LIMITS.historyTtlMs;
    const rows = [...history.values()].filter((r) => (r.finishedAt || r.createdAt) >= cutoff).slice(-LIMITS.historySize);
    const file = storePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(rows));
    fs.renameSync(`${file}.tmp`, file);
  } catch (error) {
    noteFailure("task-queue", error, { where: "src/lib/terboo-task-queue.js:saveHistory", stage: "write", fallback: "memory-only" });
  }
}
process.on("exit", saveHistory);

/** صورة المهمة القابلة للحفظ/العرض (بلا دوال ولا كائنات خام) */
function snapshot(task) {
  return {
    id: task.id, type: task.type, title: task.title, owner: task.owner, scope: task.scope, priority: task.priority,
    status: task.status, progress: task.progress, note: task.note, createdAt: task.createdAt, startedAt: task.startedAt || null,
    finishedAt: task.finishedAt || null, error: task.error || null, retryCount: task.retryCount, maxRetries: task.maxRetries,
    parentTask: task.parentTask || null, childTasks: [...task.childTasks], provider: task.provider || null, tool: task.tool || null,
    cancellation: task.cancellation || null, resumable: Boolean(task.resumable && runners.has(task.type)), checkpoint: task.checkpoint ?? null,
    summary: task.summary || null, artifacts: task.artifacts || [], input: task.input ?? null, notBefore: task.notBefore || 0,
  };
}

function persist(task) {
  if (!task.persist) return;
  loadHistory().set(task.id, snapshot(task));
  scheduleSave();
}

function emit(event, task) {
  for (const listener of listeners) {
    try { listener(event, snapshot(task)); } catch (error) { noteFailure("task-queue", error, { where: "src/lib/terboo-task-queue.js:emit", stage: event }); }
  }
}

function setStatus(task, status, note = "") {
  if (!STATUS.includes(status)) throw new Error(["unknown_task_status", status].join(":"));
  task.status = status;
  if (note) task.note = String(note).slice(0, 200);
  task.updatedAt = Date.now();
  persist(task);
  emit("status", task);
}

// ═══════════════════════════════════════════════
// الجدولة
// ═══════════════════════════════════════════════

const isHeavy = (task) => task.priority >= PRIORITY.P2;

function canStart(task) {
  return isHeavy(task) ? activeHeavy < LIMITS.maxActive : activeLight < LIMITS.maxActiveLight;
}

function expireStale() {
  const now = Date.now();
  for (let i = waiting.length - 1; i >= 0; i -= 1) {
    const task = waiting[i];
    // المؤجّلة تُحسب مهلتها من موعدها لا من إنشائها
    if (now - Math.max(task.createdAt, task.notBefore || 0) > (task.expireMs || LIMITS.queuedExpireMs)) {
      waiting.splice(i, 1);
      task.finishedAt = now;
      setStatus(task, "expired");
      task.reject(Object.assign(new Error("task_expired"), { code: "TASK_EXPIRED" }));
      scheduleCleanup(task);
    }
  }
}

let wakeTimer = null;
let wakeAt = 0;
/** مؤقت واحد لأقرب مهمة مؤجّلة (لا مؤقت لكل مهمة، ولا يُبقي العملية حيّة) */
function armWake() {
  const next = waiting.filter((task) => task.notBefore > Date.now() && task.status !== "paused").reduce((min, task) => Math.min(min, task.notBefore), Infinity);
  if (next === Infinity) return;
  if (wakeTimer && wakeAt <= next) return;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeAt = next;
  // setTimeout يقبل حتى ~24.8 يوماً؛ الأبعد يُعاد تسليحه عند الاستيقاظ
  wakeTimer = setTimeout(() => { wakeTimer = null; wakeAt = 0; runNext(); }, Math.min(2 ** 31 - 1, Math.max(0, next - Date.now())));
  wakeTimer.unref?.();
}

function runNext() {
  expireStale();
  // الأعلى أولوية (الرقم الأصغر) أولاً، ثم الأقدم
  waiting.sort((a, b) => a.priority - b.priority || a.createdAt - b.createdAt);
  const now = Date.now();
  for (let i = 0; i < waiting.length; i += 1) {
    const task = waiting[i];
    if (task.status === "paused") continue;
    if (task.notBefore > now) continue;
    if (!canStart(task)) continue;
    waiting.splice(i, 1);
    i -= 1;
    start(task);
  }
  armWake();
}

function scheduleCleanup(task) {
  const timer = setTimeout(() => tasks.delete(task.id), task.cleanupMs);
  timer.unref?.();
}

function context(task) {
  let lastProgressAt = 0;
  return {
    id: task.id,
    type: task.type,
    owner: task.owner,
    scope: task.scope,
    signal: task.controller.signal,
    input: task.input,
    checkpointData: task.checkpoint ?? null,
    /** تقدّم 0..100 مع ملاحظة قصيرة — الإشعارات مخنوقة (لا spam) */
    progress(pct, note = "") {
      task.progress = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
      if (note) task.note = String(note).slice(0, 200);
      persist(task);
      const now = Date.now();
      if (now - lastProgressAt >= LIMITS.progressMinGapMs || task.progress === 100) {
        lastProgressAt = now;
        emit("progress", task);
      }
    },
    status(status, note = "") { setStatus(task, status, note); },
    /** نقطة استئناف (بيانات صغيرة قابلة للتسلسل) */
    checkpoint(data) { task.checkpoint = data; persist(task); },
    setProvider(name) { task.provider = name; },
    setTool(name) { task.tool = name; },
    artifact(ref) { task.artifacts.push(ref); persist(task); },
    child(spec) { return enqueueTask({ ...spec, parentTask: task.id, owner: spec.owner || task.owner, scope: spec.scope || task.scope }); },
    throwIfCancelled() { if (task.controller.signal.aborted) throw Object.assign(new Error("task_cancelled"), { code: "TASK_CANCELLED" }); },
  };
}

function start(task) {
  if (isHeavy(task)) activeHeavy += 1; else activeLight += 1;
  task.startedAt = task.startedAt || Date.now();
  setStatus(task, task.retryCount ? "retrying" : "running");
  if (task.retryCount) setStatus(task, "running");
  let timer = null;
  const work = Promise.resolve().then(() => task.run(context(task)));
  const guarded = task.timeoutMs > 0
    ? Promise.race([work, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("task_timeout"), { code: "TASK_TIMEOUT" })), task.timeoutMs); timer.unref?.(); })])
    : work;
  guarded.then((result) => {
    if (task.controller.signal.aborted) throw Object.assign(new Error("task_cancelled"), { code: "TASK_CANCELLED" });
    task.result = result;
    task.summary = summarize(result);
    task.progress = 100;
    task.finishedAt = Date.now();
    setStatus(task, "completed");
    task.resolve(result);
  }).catch((error) => {
    const cancelled = task.controller.signal.aborted || error?.code === "TASK_CANCELLED";
    if (!cancelled && task.retryCount < task.maxRetries) {
      task.retryCount += 1;
      task.error = String(error?.message || error).slice(0, 300);
      setStatus(task, "retrying", task.error);
      waiting.push(task);
      return;
    }
    task.error = String(error?.message || error).slice(0, 300);
    task.finishedAt = Date.now();
    setStatus(task, cancelled ? "cancelled" : "failed");
    if (!cancelled) noteFailure("task-queue", error, { where: "src/lib/terboo-task-queue.js:start", stage: task.type, payload: task.id });
    task.reject(error);
  }).finally(() => {
    if (timer) clearTimeout(timer);
    if (isHeavy(task)) activeHeavy = Math.max(0, activeHeavy - 1); else activeLight = Math.max(0, activeLight - 1);
    if (TERMINAL.has(task.status)) scheduleCleanup(task);
    runNext();
  });
}

/** ملخص نصي قصير للنتيجة (للتاريخ والذاكرة) */
function summarize(result) {
  if (result === undefined || result === null) return null;
  if (typeof result === "string") return result.slice(0, 500);
  if (typeof result === "object") {
    const text = result.summary || result.text || result.title || result.message || "";
    if (text) return String(text).slice(0, 500);
    try { return JSON.stringify(result).slice(0, 300); } catch { return "[result]"; }
  }
  return String(result).slice(0, 300);
}

// ═══════════════════════════════════════════════
// الواجهة
// ═══════════════════════════════════════════════

/**
 * @param {{type?:string, title?:string, owner?:string, scope?:string, priority?:number, run:Function,
 *          cleanupMs?:number, maxRetries?:number, timeoutMs?:number, parentTask?:string, resumable?:boolean,
 *          persist?:boolean, input?:any, provider?:string, tool?:string, expireMs?:number, notBefore?:number}} spec
 *   notBefore: لا تبدأ قبل هذا الوقت (ms) — تنتظر في الطابور بلا خانة تنفيذ
 */
function enqueueTask({
  type = "general", title = "", owner = "", scope = "", priority = PRIORITY.P2, run,
  cleanupMs = DEFAULT_CLEANUP_MS, maxRetries = 0, timeoutMs = 0, parentTask = null, resumable = false,
  persist: shouldPersist = false, input = null, provider = null, tool = null, expireMs = 0, checkpoint = null, notBefore = 0,
}) {
  if (typeof run !== "function") throw new Error("يجب توفير دالة للمهمة.");
  const id = `TASK-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  let resolve; let reject;
  const done = new Promise((res, rej) => { resolve = res; reject = rej; });
  done.catch(() => { /* الرفض يُقرأ عبر الحالة والسجل؛ المستدعي ينتظر done إن أراد */ });
  const task = {
    id, type, title: String(title || type).slice(0, 120), owner, scope, priority: Number.isInteger(priority) ? priority : PRIORITY.P2,
    status: "queued", progress: 0, note: "", createdAt: Date.now(), startedAt: null, finishedAt: null, result: null, summary: null,
    error: null, retryCount: 0, maxRetries: Math.max(0, Math.min(3, maxRetries)), timeoutMs, parentTask, childTasks: [],
    provider, tool, cancellation: null, resumable, persist: shouldPersist, input, artifacts: [], expireMs, checkpoint,
    controller: new AbortController(), run, resolve, reject, cleanupMs, notBefore: Number(notBefore) > Date.now() ? Number(notBefore) : 0,
  };
  if (parentTask && tasks.has(parentTask)) tasks.get(parentTask).childTasks.push(id);
  tasks.set(id, task);
  persist(task);
  emit("queued", task);
  waiting.push(task);
  runNext();
  return { id, status: task.status, done };
}

function getTask(id) {
  const live = tasks.get(id);
  if (live) return snapshot(live);
  return loadHistory().get(id) || null;
}

/** الواجهة القديمة: الحالة الحيّة فقط (null بعد التنظيف) */
function getTaskStatus(id) {
  const task = tasks.get(id);
  return task ? { id: task.id, type: task.type, owner: task.owner, status: task.status, error: task.error || null, createdAt: task.createdAt, startedAt: task.startedAt || null, finishedAt: task.finishedAt || null, progress: task.progress, priority: task.priority } : null;
}

/** مهام شخص في نطاق (حيّة + محفوظة)، الأحدث أولاً */
function listTasks({ owner = "", scope = "", status = null, limit = 10 } = {}) {
  const rows = new Map();
  for (const record of loadHistory().values()) rows.set(record.id, record);
  for (const task of tasks.values()) rows.set(task.id, snapshot(task));
  return [...rows.values()]
    .filter((r) => (!owner || r.owner === owner) && (!scope || r.scope === scope) && (!status || (Array.isArray(status) ? status.includes(r.status) : r.status === status)))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

function latestTask(filter = {}) {
  return listTasks({ ...filter, limit: 1 })[0] || null;
}

function owns(task, requester) {
  return !requester || task.owner === requester.owner && (!requester.scope || task.scope === requester.scope) || requester.isOwner === true;
}

/** إلغاء حقيقي: مهمة منتظرة تُزال، جارية يصلها AbortSignal */
function cancelTask(id, requester = null, reason = "user") {
  const task = tasks.get(id);
  if (!task || TERMINAL.has(task.status)) return { ok: false, reason: "not-active" };
  if (!owns(task, requester)) return { ok: false, reason: "not-owner" };
  task.cancellation = { by: requester?.owner || "system", reason, at: Date.now() };
  const index = waiting.indexOf(task);
  if (index !== -1) {
    waiting.splice(index, 1);
    task.finishedAt = Date.now();
    setStatus(task, "cancelled");
    task.reject(Object.assign(new Error("task_cancelled"), { code: "TASK_CANCELLED" }));
    scheduleCleanup(task);
  } else {
    task.controller.abort(reason);
    task.note = "cancelling";
  }
  for (const child of task.childTasks) cancelTask(child, null, "parent-cancelled");
  return { ok: true };
}

function pauseTask(id, requester = null) {
  const task = tasks.get(id);
  if (!task || task.status !== "queued") return { ok: false, reason: task ? "not-pausable" : "not-active" };
  if (!owns(task, requester)) return { ok: false, reason: "not-owner" };
  setStatus(task, "paused");
  return { ok: true };
}

/** استئناف: مهمة موقوفة في الطابور، أو مهمة محفوظة لها runner مسجّل ونقطة استئناف */
function resumeTask(id, requester = null) {
  const live = tasks.get(id);
  if (live?.status === "paused") {
    if (!owns(live, requester)) return { ok: false, reason: "not-owner" };
    setStatus(live, "queued");
    runNext();
    return { ok: true, id };
  }
  const record = loadHistory().get(id);
  if (!record) return { ok: false, reason: "unknown" };
  if (!owns(record, requester)) return { ok: false, reason: "not-owner" };
  // استُؤنف من قبل في مهمة أخرى ⇒ لا تشغيل ثانٍ لنفس العمل
  if (String(record.note || "").startsWith("resumed-as:")) return { ok: false, reason: "already-resumed" };
  const runner = runners.get(record.type);
  // مدخلاتها محفوظة وقابلة لإعادة التشغيل فقط (رابط/بحث) — وسائط لم تُحفظ لا «تُستأنف» شكلياً
  if (!record.resumable && !live) return { ok: false, reason: "not-replayable" };
  if (!runner || !record.resumable || !["failed", "cancelled", "expired", "waiting"].includes(record.status)) return { ok: false, reason: "not-resumable" };
  const next = enqueueTask({ type: record.type, title: record.title, owner: record.owner, scope: record.scope, priority: record.priority, run: runner, persist: true, resumable: true, input: record.input, checkpoint: record.checkpoint, parentTask: record.id, notBefore: record.notBefore || 0 });
  // السجل القديم لم يعد «متوقفاً»: استُؤنف في مهمة جديدة (لا يظهر مرتين ولا يُستأنف مرتين)
  record.status = "cancelled";
  record.cancellation = { by: "system", reason: "resumed", at: Date.now() };
  record.note = ["resumed-as", next.id].join(":");
  record.finishedAt = record.finishedAt || Date.now();
  scheduleSave();
  return { ok: true, id: next.id, resumedFrom: id, done: next.done };
}

/** إعادة المحاولة بنفس المدخلات (runner مسجّل أو دالة المهمة الحيّة) */
function retryTask(id, requester = null) {
  const live = tasks.get(id);
  const record = live ? snapshot(live) : loadHistory().get(id);
  if (!record) return { ok: false, reason: "unknown" };
  if (!owns(record, requester)) return { ok: false, reason: "not-owner" };
  // المهمة الحيّة تُعاد بدالتها الأصلية (سياق الرسالة كاملاً)؛ المحفوظة بعد إعادة التشغيل بـrunner نوعها
  const run = live?.run || (record.resumable ? runners.get(record.type) : null);
  if (!run) return { ok: false, reason: record.resumable ? "not-retryable" : "not-replayable" };
  const next = enqueueTask({ type: record.type, title: record.title, owner: record.owner, scope: record.scope, priority: record.priority, run, persist: Boolean(live?.persist ?? true), resumable: Boolean(record.resumable), input: record.input });
  return { ok: true, id: next.id, done: next.done };
}

/** دالة تنفيذ معروفة بنوعها — شرط الاستئناف بعد إعادة التشغيل */
function registerTaskRunner(type, run) {
  if (typeof run !== "function") throw new Error("invalid_task_runner");
  runners.set(type, run);
}

/** عند الإقلاع: ما كان جارياً قبل الإيقاف يصبح «waiting» (قابلاً للاستئناف إن أمكن) */
function restoreInterrupted() {
  let count = 0;
  for (const record of loadHistory().values()) {
    if (["queued", "planning", "running", "retrying"].includes(record.status)) {
      record.status = "waiting";
      record.note = "interrupted-by-restart";
      count += 1;
    }
  }
  if (count) scheduleSave();
  return count;
}

function onTaskEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getQueueSummary() {
  const byStatus = {};
  for (const task of tasks.values()) byStatus[task.status] = (byStatus[task.status] || 0) + 1;
  return { active: activeHeavy + activeLight, activeHeavy, activeLight, queued: waiting.length, total: tasks.size, byStatus, limits: { ...LIMITS } };
}

/** للاختبارات */
function _resetTasks() {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  wakeAt = 0;
  tasks.clear();
  waiting.length = 0;
  runners.clear();
  listeners.clear();
  activeHeavy = 0;
  activeLight = 0;
  history = null;
}

export {
  PRIORITY,
  STATUS,
  _resetTasks,
  cancelTask,
  enqueueTask,
  getQueueSummary,
  getTask,
  getTaskStatus,
  latestTask,
  listTasks,
  onTaskEvent,
  pauseTask,
  registerTaskRunner,
  restoreInterrupted,
  resumeTask,
  retryTask,
  saveHistory,
};
