// ═══════════════════════════════════════════════
// 🧭 Terboo Agent Engine — تنفيذ متعدد الخطوات حقيقي (§14)
// ───────────────────────────────────────────────
//   Analyze → Plan → Retrieve Tools → Execute → Verify → Continue
//   → Rollback عند الفشل → Final Report
//
// • كل خطوة أمرٍ تُنفَّذ بالبلوقن الحقيقي عبر المسار الطبيعي (dispatchCommand)
//   بكل الصلاحيات والتسجيل والتبريد والطاقة — لا نسخة ثانية من أي منطق.
// • التحقّق من كل خطوة يأتي من النتيجة الفعلية للمسار (نجح/فشل/حُجب)،
//   لا من كلام النموذج.
// • عند فشل خطوة تتوقّف الخطة، وتُعكس الخطوات السابقة القابلة للعكس
//   (ترقية↔خفض، كتم↔فك الكتم، فتح↔قفل…) بنفس المسار.
// • خطوات الأدوات للمالك فقط وللقراءة/الفحص فقط؛ الكتابة لا تتم إلا
//   بخطة وموافقة صريحة من مسار المالك (terboo-ai-owner.js).
// • الخطة الحسّاسة (طرد، حظر، حذف، مغادرة، أوامر مالك…) لا تُنفَّذ قبل
//   موافقة صاحب الطلب: تُحفظ كإجراء معلّق وتنفَّذ عند «نفذه».
// • الخطة تُسجَّل كمهمة في الذاكرة المركزية وتُحدَّث حالتها خطوةً بخطوة.
// • حدود (§46): ‎6 خطوات · مهلة لكل خطوة · ميزانية زمن للخطة كلها · مقاطعة حقيقية
//   (AbortSignal من متحكّم التزامن: «وقف» يوقف الخطة قبل الخطوة التالية بلا عكس لما تم).
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import { getPlugin } from "./terboo-plugins.js";
import { findEntry, pluginExists } from "./terboo-command-index.js";
import { dispatchCommand } from "./terboo-command-dispatch.js";
import { addTask, conversationScope, recordEvent, setPending, updateTask } from "./terboo-ai-memory.js";

const MAX_STEPS = 6;
/** مهلة الخطوة الواحدة وميزانية الخطة كلها */
const STEP_TIMEOUT_MS = 45_000;
const AGENT_BUDGET_MS = 150_000;

function withStepTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("step_timeout"), { code: "STEP_TIMEOUT" })), ms); timer.unref?.(); }),
  ]).finally(() => clearTimeout(timer));
}

/** أدوات القراءة والفحص المسموح بها كخطوات وكيل (للمالك فقط) */
const READ_TOOLS = new Set(["syntax", "test", "search", "inspect", "read", "diagnostics", "audit", "manifest", "changes"]);

/** أسماء أوامر حسّاسة تحتاج موافقة صريحة داخل خطة متعددة الخطوات */
const SENSITIVE_ALIASES = ["kick", "block", "leave", "delete", "demote", "warn", "حظر", "ban", "reset"];

/** أزواج قابلة للعكس: [أمر، وسائطه] → [أمر العكس، وسائطه] */
const INVERSES = [
  { match: { command: "promote" }, inverse: { command: "demote", keepArgs: true } },
  { match: { command: "demote" }, inverse: { command: "promote", keepArgs: true } },
  { match: { command: "mute" }, inverse: { command: "unmute", keepArgs: false } },
  { match: { command: "unmute" }, inverse: { command: "mute", keepArgs: false } },
  { match: { command: "شات", args: /فتح|open/i }, inverse: { command: "شات", args: "قفل" } },
  { match: { command: "شات", args: /قفل|close/i }, inverse: { command: "شات", args: "فتح" } },
  { match: { command: "antilinkgc", args: /تشغيل|on/i }, inverse: { command: "antilinkgc", args: "إيقاف" } },
  { match: { command: "antilinkgc", args: /إيقاف|ايقاف|off/i }, inverse: { command: "antilinkgc", args: "تشغيل" } },
  { match: { command: "block" }, inverse: { command: "unblock", keepArgs: true } },
  { match: { command: "unblock" }, inverse: { command: "block", keepArgs: true } },
];

function primaryName(plugin) {
  const name = plugin?.config?.name;
  return Array.isArray(name) ? name[0] : String(name || "");
}

/** الاسم الأساسي للأمر كما في السجل الحيّ (يوحّد المرادفات) */
function canonical(command) {
  const plugin = getPlugin(String(command || "").trim());
  return plugin ? primaryName(plugin) : "";
}

function isSensitive(name) {
  if (!name) return false;
  const plugin = getPlugin(name);
  if (plugin?.config?.isOwner) return true;
  return SENSITIVE_ALIASES.some((alias) => canonical(alias) && canonical(alias) === name);
}

/** أمر العكس لخطوة نجحت (أو null إن لم تكن قابلة للعكس) */
function inverseOf(step) {
  for (const { match, inverse } of INVERSES) {
    const matchName = canonical(match.command);
    if (!matchName || matchName !== step.name) continue;
    if (match.args && !match.args.test(step.args || "")) continue;
    const name = canonical(inverse.command);
    if (!name) return null;
    const args = inverse.args !== undefined ? inverse.args : inverse.keepArgs ? step.args : "";
    return { name, args };
  }
  return null;
}

/**
 * Analyze: يحوّل خطوات النموذج إلى خطوات صالحة من السجل الحيّ فقط.
 * @returns {{valid:Array, invalid:Array, sensitive:Array}}
 */
function analyzeSteps(steps, m) {
  const valid = [];
  const invalid = [];
  for (const raw of (Array.isArray(steps) ? steps : []).slice(0, MAX_STEPS)) {
    if (raw?.tool) {
      const tool = String(raw.tool).toLowerCase();
      if (!READ_TOOLS.has(tool)) {
        invalid.push({ raw, reason: "tool-not-allowed" });
      } else if (!m?.isOwner) {
        invalid.push({ raw, reason: "owner-only" });
      } else {
        valid.push({ kind: "tool", tool, path: String(raw.path || ""), query: String(raw.query || raw.args || "") });
      }
      continue;
    }
    const entry = findEntry(raw?.command);
    if (!entry || !pluginExists(entry.name)) {
      invalid.push({ raw, reason: "unknown-command" });
      continue;
    }
    valid.push({ kind: "command", name: entry.name, args: String(raw?.args || "").trim().slice(0, 300) });
  }
  const sensitive = valid.filter((step) => step.kind === "command" && isSensitive(step.name));
  return { valid, invalid, sensitive };
}

function stepLabel(step, prefix = ".") {
  if (step.kind === "tool") return `🛠 ${step.tool}${step.path ? ` ${step.path}` : ""}${step.query ? ` "${step.query}"` : ""}`;
  return `${prefix}${step.name}${step.args ? ` ${step.args}` : ""}`;
}

/** تنفيذ خطوة أداة للقراءة/الفحص — النتيجة الفعلية هي معيار النجاح */
async function runToolStep(step, tools) {
  switch (step.tool) {
    case "syntax": {
      const target = tools.resolveFileQuery(step.path).path;
      if (!target) return { ok: false, summary: "file-not-found" };
      const result = await tools.syntax(target);
      return { ok: result.ok, summary: result.ok ? `${target}: ok` : `${target}: ${String(result.error).split("\n")[0]}` };
    }
    case "test": {
      const result = await tools.test(step.query || step.path || "syntax");
      return { ok: result.ok, summary: `${result.test}: ${result.ok ? "passed" : "failed"}` };
    }
    case "search": {
      const hits = tools.search(step.query, { limit: 20 });
      return { ok: true, summary: `${hits.length} hits`, data: hits.slice(0, 10) };
    }
    case "inspect":
    case "read": {
      const target = tools.resolveFileQuery(step.path).path;
      if (!target) return { ok: false, summary: "file-not-found" };
      const info = tools.inspect(target);
      return { ok: true, summary: `${target}: ${info.lines} lines` };
    }
    case "diagnostics": {
      const info = tools.diagnostics();
      return { ok: true, summary: `node ${info.node} · ${info.files.plugins} plugins` };
    }
    case "audit": {
      const result = await tools.strictAudit();
      const last = String(result.output || "").trim().split("\n").filter(Boolean).pop() || "";
      return { ok: result.ok, summary: last.slice(0, 200) || (result.ok ? "0 violations" : "violations found") };
    }
    case "manifest": {
      const result = await tools.manifest();
      const counts = result.counts || {};
      return { ok: result.ok !== false, summary: result.ok ? `${counts.commands ?? "?"} commands · ${counts.aliases ?? "?"} aliases` : String(result.error || "").slice(0, 200) };
    }
    case "changes": {
      const list = tools.changeHistory(5);
      return { ok: true, summary: `${list.length} changes` };
    }
    default:
      return { ok: false, summary: "tool-not-allowed" };
  }
}

/**
 * تنفيذ خطة كاملة.
 * @param {{m:Object, sock:Object, steps:Array, goal?:string, prefix?:string, approved?:boolean,
 *          deps?:{dispatch?:Function, tools?:Object}}} input
 * @returns {Promise<{status:"needs-approval"|"done"|"failed"|"invalid", results:Array, rolledBack:Array,
 *          taskId:string, invalid:Array, sensitive:Array, steps:Array}>}
 */
async function runAgent({ m, sock, steps, goal = "", prefix = ".", approved = false, deps = {} }) {
  const dispatch = deps.dispatch || dispatchCommand;
  const signal = deps.signal || null;
  const stepTimeoutMs = deps.stepTimeoutMs || STEP_TIMEOUT_MS;
  const budgetMs = deps.budgetMs || AGENT_BUDGET_MS;
  const started = Date.now();
  // Analyze
  const { valid, invalid, sensitive } = analyzeSteps(steps, m);
  if (!valid.length) return { status: "invalid", results: [], rolledBack: [], taskId: "", invalid, sensitive, steps: [] };

  // موافقة صريحة للخطط الحسّاسة متعددة الخطوات
  if (sensitive.length && !approved) {
    setPending(m, {
      kind: "agent",
      steps: valid.map((step) => (step.kind === "tool" ? { tool: step.tool, path: step.path, query: step.query } : { command: step.name, args: step.args })),
      reason: String(goal || "agent").slice(0, 120),
    });
    return { status: "needs-approval", results: [], rolledBack: [], taskId: "", invalid, sensitive, steps: valid };
  }

  // Plan: مهمة في الذاكرة المركزية
  let scope = null;
  let task = null;
  try {
    scope = conversationScope(m);
    task = addTask(scope, {
      title: goal || valid.map((step) => stepLabel(step, prefix)).join(" → "),
      steps: valid.map((step) => stepLabel(step, prefix)),
      source: "agent",
      status: "running",
    });
  } catch (error) {
    noteFailure("ai-agent", error, { where: "src/lib/terboo-ai-agent.js:runAgent", stage: "addTask" });
    task = null;
  }

  // Retrieve Tools
  const tools = valid.some((step) => step.kind === "tool") ? (deps.tools || (await import("./terboo-ai-tools.js"))) : null;

  // Execute → Verify → Continue
  const results = [];
  let failedAt = -1;
  let stopped = "";
  for (let index = 0; index < valid.length; index += 1) {
    const step = valid[index];
    // مقاطعة المستخدم: لا خطوة جديدة بعد «وقف» (ما تم يبقى كما هو ويُذكر في التقرير)
    if (signal?.aborted) { stopped = "cancelled"; break; }
    // ميزانية الخطة: لا تبدأ خطوة بعد نفادها
    if (Date.now() - started > budgetMs) { stopped = "budget"; failedAt = index; break; }
    let outcome;
    try {
      if (step.kind === "tool") {
        outcome = await withStepTimeout(runToolStep(step, tools), stepTimeoutMs);
      } else {
        const result = await withStepTimeout(dispatch(m, sock, { command: step.name, args: step.args }), stepTimeoutMs);
        outcome = { ok: Boolean(result?.ok), summary: result?.summary || result?.error || result?.reason || result?.status || "", status: result?.status };
      }
    } catch (error) {
      outcome = { ok: false, summary: error?.code === "STEP_TIMEOUT" ? "timeout" : String(error?.message || error).slice(0, 200) };
    }
    results.push({ step, ...outcome });
    if (task && scope) updateTask(scope, task.id, { stepId: index + 1, stepStatus: outcome.ok ? "done" : "failed" });
    if (!outcome.ok) {
      failedAt = index;
      break;
    }
  }

  // Rollback: عكس الخطوات الناجحة القابلة للعكس بترتيب معكوس
  const rolledBack = [];
  if (failedAt >= 0) {
    for (const done of results.slice(0, failedAt).reverse()) {
      if (done.step.kind !== "command") continue;
      const inverse = inverseOf(done.step);
      if (!inverse) continue;
      try {
        const undo = await withStepTimeout(dispatch(m, sock, { command: inverse.name, args: inverse.args }), stepTimeoutMs);
        rolledBack.push({ step: done.step, inverse, ok: Boolean(undo?.ok) });
      } catch (error) {
        noteFailure("ai-agent", error, { where: "src/lib/terboo-ai-agent.js:runAgent", stage: "rollback", payload: inverse.name });
        rolledBack.push({ step: done.step, inverse, ok: false });
      }
    }
  }

  const status = stopped === "cancelled" ? "cancelled" : failedAt >= 0 ? "failed" : "done";
  if (task && scope) updateTask(scope, task.id, { status });
  try {
    if (scope) recordEvent(scope, `agent ${status}: ${results.map((r) => `${r.ok ? "✓" : "✗"} ${stepLabel(r.step, prefix)}`).join(" | ")}`, "agent");
  } catch (error) { noteFailure("ai-agent", error, {where: "src/lib/terboo-ai-agent.js:246",stage: "recordEvent"}); }

  return { status, results, rolledBack, taskId: task?.id || "", invalid, sensitive, steps: valid, stopped, elapsedMs: Date.now() - started };
}

/** تقرير نهائي نصّي (تُلبسه النواة بطاقة العرض المترجمة) */
function reportLines(run, { prefix = ".", t = (key) => key } = {}) {
  const lines = [];
  run.results.forEach((result, index) => {
    const mark = result.ok ? "✓" : "✗";
    lines.push(`${mark} ${index + 1}. ${stepLabel(result.step, prefix)}${result.ok ? "" : ` — ${result.summary || t("kernel.agentStepFailed")}`}`);
  });
  const executed = run.results.length;
  for (let index = executed; index < run.steps.length; index += 1) {
    lines.push(`· ${index + 1}. ${stepLabel(run.steps[index], prefix)} — ${t("kernel.agentSkipped")}`);
  }
  for (const undo of run.rolledBack) {
    lines.push(`↩ ${prefix}${undo.inverse.name}${undo.inverse.args ? ` ${undo.inverse.args}` : ""} ${undo.ok ? "✓" : "✗"}`);
  }
  for (const bad of run.invalid) {
    lines.push(`⊘ ${bad.raw?.command || bad.raw?.tool || "?"} — ${t(`kernel.agentInvalid.${bad.reason}`)}`);
  }
  return lines;
}

export { AGENT_BUDGET_MS, INVERSES, MAX_STEPS, READ_TOOLS, STEP_TIMEOUT_MS, analyzeSteps, canonical, inverseOf, isSensitive, reportLines, runAgent, stepLabel };
export default { runAgent, analyzeSteps, reportLines };
