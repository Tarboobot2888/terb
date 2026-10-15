import { noteFailure } from "./terboo-failure-log.js";
import crypto from "crypto";
// ذاكرة المجموعة وخطط العمل تعيش في محرّك الذاكرة المركزي (§6 §8) — هذا الملف محوّل
import { addTask, factsOf, forgetMatching, listTasks, remember, scopeOf, updateTask } from "./terboo-ai-memory.js";

const MAX_GROUP_MEMORIES = 30;
const MAX_WORK_PLANS = 24;
const MAX_DECISIONS = 80;

function getData(db) {
  if (!db?.db?.data) throw new Error("قاعدة بيانات Bot Terboo غير جاهزة");
  return db.db.data;
}

function compact(value, max = 500) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function createId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;
}

function groupScope(chat) {
  return scopeOf("group", { chatJid: chat, isGroup: true });
}

/** ذاكرة المجموعة المسمّاة = حقائق نطاق group المصدرة من المجموعة نفسها */
function getGroupMemories(db, chat) {
  return factsOf(groupScope(chat))
    .filter((fact) => fact.source === "group")
    .sort((a, b) => a.at - b.at)
    .map((fact) => ({ id: fact.id, label: fact.label || "تفضيل المجموعة", content: fact.text, author: fact.author || "", createdAt: fact.at }));
}

function addGroupMemory(db, chat, { content, author, label = "تفضيل المجموعة" } = {}) {
  const clean = compact(content, 500);
  if (clean.length < 3) throw new Error("اكتب معلومة واضحة لا تقل عن 3 أحرف لحفظها");
  const item = remember(groupScope(chat), {
    id: createId("MEM"),
    text: clean,
    label: compact(label, 80) || "تفضيل المجموعة",
    author,
    type: "important_context",
    confidence: 1,
    source: "group",
  });
  if (!item) throw new Error("تعذّر حفظ المعلومة (قد تحوي بيانات حسّاسة)");
  const existing = getGroupMemories(db, chat);
  if (existing.length > MAX_GROUP_MEMORIES) forgetMatching(groupScope(chat), existing[0].id);
  return { id: item.id, label: item.label, content: item.text, author: item.author || author, createdAt: item.at };
}

function removeGroupMemory(db, chat, selector = "") {
  const normalized = compact(selector, 120).toLowerCase();
  const before = getGroupMemories(db, chat).length;
  const all = !normalized || ["الكل", "كل", "all"].includes(normalized);
  forgetMatching(groupScope(chat), all ? "all" : normalized);
  const removed = before - getGroupMemories(db, chat).length;
  return { removed, all };
}

function formatGroupMemory(db, chat) {
  const entries = getGroupMemories(db, chat);
  if (!entries.length) return "🧠 *ذاكرة المجموعة*\n\n> لا توجد تفضيلات أو قواعد محفوظة لهذه المجموعة.";
  return `🧠 *ذاكرة المجموعة*\n\n${entries.map((entry, index) => `${index + 1}. *${entry.label}* — ${entry.content}\n> المعرف: ${entry.id}`).join("\n\n")}\n\n> يمكن للمشرف أو المالك إضافة أو إزالة المعلومات الصريحة فقط.`;
}

function buildGroupMemoryContext(db, chat) {
  const entries = getGroupMemories(db, chat).slice(-8);
  if (!entries.length) return "";
  return `ذاكرة المجموعة المتفق عليها (استخدمها عند صلتها بالسؤال فقط):\n${entries.map((entry) => `- ${entry.label}: ${entry.content}`).join("\n")}`;
}

function inferWorkSteps(goal) {
  const cleanGoal = compact(goal, 600);
  const pieces = cleanGoal.split(/(?:\s+ثم\s+|\s+وبعدها\s+|\s+بعد ذلك\s+|[،؛;])/).map((item) => compact(item, 180)).filter(Boolean);
  const steps = pieces.slice(0, 5);
  if (steps.length >= 2) return steps.map((title, index) => ({ id: index + 1, title, status: "pending" }));
  return [
    { id: 1, title: "تحديد المطلوب والقيود قبل البدء", status: "pending" },
    { id: 2, title: cleanGoal || "تنفيذ المهمة المطلوبة", status: "pending" },
    { id: 3, title: "فحص النتيجة وتقديم ملخص قابل للمراجعة", status: "pending" },
  ];
}

/** نطاق خطة العمل: المجموعة المشتركة، أو خاص صاحب المحادثة */
function planScope(chat, owner) {
  if (String(chat).endsWith("@g.us")) return groupScope(chat);
  return scopeOf("private:user", { userJid: owner || chat });
}

function toPlan(task, chat) {
  return {
    id: task.id,
    chat: task.meta?.chat || chat,
    owner: task.meta?.owner || "",
    goal: task.meta?.goal || task.title,
    steps: task.steps.map((step) => ({ ...step })),
    createdAt: task.at,
    updatedAt: task.updatedAt,
  };
}

function createWorkPlan(db, chat, { owner, goal } = {}) {
  const cleanGoal = compact(goal, 600);
  if (cleanGoal.length < 3) throw new Error("اكتب الهدف المطلوب لوضع العمل");
  const task = addTask(planScope(chat, owner), {
    id: createId("WORK"),
    title: cleanGoal,
    steps: inferWorkSteps(cleanGoal),
    source: "workspace",
    meta: { chat, owner, goal: cleanGoal },
  });
  if (!task) throw new Error("تعذّر إنشاء خطة العمل");
  return toPlan(task, chat);
}

function updateWorkPlan(db, chat, id, stepNumber, status = "done") {
  const scopes = [groupScope(chat)];
  try { scopes.push(scopeOf("private:user", { userJid: chat })); } catch (error) { noteFailure("ai-workspace", error, {where: "src/lib/terboo-ai-workspace.js:119",stage: "scopes.push"}); }
  for (const scope of scopes) {
    const task = listTasks(scope).find((item) => item.id === id);
    if (!task) continue;
    if (!task.steps.find((item) => item.id === Number(stepNumber))) throw new Error("رقم خطوة العمل غير موجود");
    const updated = updateTask(scope, id, { stepId: Number(stepNumber), stepStatus: status === "done" ? "done" : "pending" });
    return toPlan(updated, chat);
  }
  throw new Error("خطة العمل غير موجودة أو تخص مجموعة أخرى");
}

function formatWorkPlan(plan) {
  const steps = plan.steps.map((step) => `${step.status === "done" ? "✅" : "▫️"} ${step.id}. ${step.title}`).join("\n");
  return `🗂️ *وضع العمل*\n\n*الهدف:* ${plan.goal}\n\n${steps}\n\n> المعرف: ${plan.id}\n> لتحديث خطوة: أكمل WORK-... 2`;
}

function recordDecision(db, entry = {}) {
  const data = getData(db);
  if (!data.aiDecisionLog) data.aiDecisionLog = [];
  const item = {
    id: createId("DEC"),
    type: compact(entry.type, 80) || "إجراء AI",
    status: compact(entry.status, 40) || "planned",
    chat: entry.chat || "",
    owner: entry.owner || "",
    summary: compact(entry.summary, 500),
    details: entry.details && typeof entry.details === "object" ? entry.details : {},
    createdAt: Date.now(),
  };
  data.aiDecisionLog.push(item);
  data.aiDecisionLog = data.aiDecisionLog.slice(-MAX_DECISIONS);
  return { ...item, details: { ...item.details } };
}

function listDecisions(db, { chat, owner, limit = 8 } = {}) {
  const entries = getData(db).aiDecisionLog || [];
  return entries.filter((entry) => (!chat || entry.chat === chat) && (!owner || entry.owner === owner)).slice(-limit).reverse().map((entry) => ({ ...entry, details: { ...entry.details } }));
}

function formatDecisions(entries) {
  if (!entries.length) return "📜 *سجل قرارات AI*\n\n> لا توجد إجراءات مسجلة بعد.";
  return `📜 *سجل قرارات AI*\n\n${entries.map((entry, index) => `${index + 1}. *${entry.type}* — ${entry.status}\n> ${entry.summary || "لا يوجد ملخص"}\n> المعرف: ${entry.id}`).join("\n\n")}`;
}

export {
  addGroupMemory,
  buildGroupMemoryContext,
  createWorkPlan,
  formatDecisions,
  formatGroupMemory,
  formatWorkPlan,
  getGroupMemories,
  listDecisions,
  recordDecision,
  removeGroupMemory,
  updateWorkPlan,
};
