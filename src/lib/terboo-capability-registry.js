// ═══════════════════════════════════════════════
// 🧭 Terboo Capability Registry — سجل قدرات موحّد (V6 §12)
// ───────────────────────────────────────────────
// طبقة قراءة فوق الأنظمة الموجودة — لا منطق تنفيذ مكرر ولا تعريفات موازية:
//   • terboo-tool-registry   ← الـscrapers (63) وأدوات الوسائط
//   • terboo-permissions     ← إجراءات المجموعات والرسائل والإذاعة وSSH والمشاريع والمهام
//   • terboo-plugins         ← كل أمر محمَّل (ومنه الألعاب) بقيود بياناته الحقيقية
//   • قدرات النواة          ← المحادثة · الذاكرة · المهام
// كل قدرة بنفس الشكل:
//   id · category · description · inputs · target · permissions · confirmation · chat · provider
//   · timeoutMs · retry · verification · fallback · background · aiExposed · safety · source · executor
// المستهلكون: كتالوج أدوات الموقع، لوحة المالك، المصفوفات، والاختبارات. التنفيذ يبقى في منفّذه الأصلي.
// ═══════════════════════════════════════════════

import { ACTIONS, LEVEL } from "./terboo-permissions.js";
import { allTools } from "./terboo-tool-registry.js";
import { getAllPlugins } from "./terboo-plugins.js";

const FIELDS = Object.freeze([
  "id", "category", "description", "inputs", "target", "permissions", "confirmation", "chat", "provider",
  "timeoutMs", "retry", "verification", "fallback", "background", "aiExposed", "safety", "source", "executor",
]);

/** أداة سجل الأدوات ⇒ قدرة */
function fromTool(tool) {
  return {
    id: `tool:${tool.id}`,
    category: String(tool.category || "Utility").toLowerCase(),
    description: tool.purpose || tool.id,
    inputs: tool.input || { required: [], properties: {} },
    target: "none",
    permissions: { level: tool.permission === "owner" ? LEVEL.OWNER : LEVEL.USER, action: null },
    confirmation: "none",
    chat: "any",
    provider: tool.source === "scraper" ? `scraper:${tool.target}` : "local",
    timeoutMs: tool.timeoutMs || 30_000,
    retry: { attempts: tool.maxAttempts || 1, retries: tool.retries || 0 },
    verification: tool.output ? `output:${tool.output}` : "result-shape",
    fallback: [...(tool.fallbacks || [])],
    background: (tool.timeoutMs || 0) > 20_000,
    aiExposed: Boolean(tool.modelVisible),
    safety: tool.safety || "public-data",
    source: tool.source,
    executor: "terboo-tool-registry.runTool",
  };
}

const ACTION_CATEGORY = (id) => {
  const head = id.split(".")[0];
  if (head === "contact" || head === "message") return "messaging";
  if (head === "childbots") return "broadcast";
  if (head === "project") return "workspace";
  return head;
};
const ACTION_EXECUTOR = {
  group: "terboo-action-engine / terboo-group-agent ⇒ أوامر المجموعة الموجودة",
  messaging: "terboo-messaging-agent",
  broadcast: "terboo-broadcast",
  task: "terboo-task-control",
  ssh: "terboo-ssh-agent ⇒ terboo-ssh (execFile, سياسة أوامر)",
  workspace: "terboo-ssh-agent (مشاريع/نشر)",
};

/** إجراء من محرّك الصلاحيات ⇒ قدرة */
function fromAction(id, policy) {
  const category = ACTION_CATEGORY(id);
  return {
    id: `action:${id}`,
    category,
    description: id,
    inputs: { required: policy.target ? ["target"] : [], properties: policy.target ? { target: { type: "string", description: "resolved by the member/contact resolver — never chosen by the model" } } : {} },
    target: policy.target ? (category === "group" ? "member" : "contact") : "none",
    permissions: { level: policy.min, action: id, scope: policy.scope, botAdmin: Boolean(policy.botAdmin), resource: policy.resource || null },
    confirmation: policy.bulk ? "bulk" : policy.confirm ? (policy.ownerBypass ? "required-owner-bypass" : "required") : "none",
    chat: policy.scope === "group" ? "group" : "any",
    provider: policy.provider || "whatsapp",
    timeoutMs: category === "ssh" || category === "workspace" ? 120_000 : 30_000,
    retry: { attempts: 1, retries: 0 },
    verification: category === "group" ? "re-read group metadata" : category === "broadcast" ? "per-chat delivery report" : "executor result",
    fallback: [],
    background: Boolean(policy.bulk) || category === "workspace",
    aiExposed: true,
    safety: policy.destructive ? "destructive" : "state-change",
    source: "permissions",
    executor: ACTION_EXECUTOR[category] || "terboo-action-engine",
  };
}

const GAME_CATEGORIES = new Set(["game", "games", "rpg", "fun"]);

/** أمر محمَّل ⇒ قدرة (قيوده من بياناته الحقيقية) */
function fromPlugin(plugin) {
  const cfg = plugin.config || {};
  const name = Array.isArray(cfg.name) ? cfg.name[0] : cfg.name;
  const category = String(cfg.category || "uncategorized").toLowerCase();
  const level = cfg.isOwner ? LEVEL.OWNER : cfg.isAdmin ? LEVEL.GROUP_ADMIN : LEVEL.USER;
  return {
    id: `command:${name}`,
    category: GAME_CATEGORIES.has(category) ? "games" : category,
    description: String(cfg.description || name),
    inputs: { required: [], properties: { args: { type: "string", description: String(cfg.usage || "") } } },
    target: "none",
    permissions: { level, premium: Boolean(cfg.isPremium), botAdmin: Boolean(cfg.isBotAdmin) },
    confirmation: "inside-command",
    chat: cfg.isGroup ? "group" : cfg.isPrivate ? "private" : "any",
    provider: "plugin",
    timeoutMs: 60_000,
    retry: { attempts: 1, retries: 0 },
    verification: "command reply",
    fallback: [],
    background: false,
    // الأوامر تصل للنموذج عبر الموزّع الموحّد بصلاحيات المرسل؛ أوامر المالك لا تُعرض لغيره
    aiExposed: !cfg.isOwner,
    safety: cfg.isOwner ? "owner-only" : "plugin",
    source: "plugin",
    executor: `plugins/${category}/… (${name})`,
    aliases: [...(cfg.alias || [])].slice(0, 12),
  };
}

/** قدرات النواة نفسها (لا أداة خارجية) */
const CORE = [
  { id: "core:ai.chat", category: "ai", description: "Conversation through the unified intelligence core (fast gate → context → memory → intent → capability → permission → execute → verify)", executor: "terboo-ai-core" },
  { id: "core:memory.read", category: "memory", description: "Scoped memory recall (private user · user in group · group shared · global) — minimal and relevant", executor: "terboo-ai-memory" },
  { id: "core:memory.forget", category: "memory", description: "Forget the user's own memory on request", executor: "terboo-ai-memory" },
  { id: "core:task.status", category: "tasks", description: "Status / result of the user's tasks", executor: "terboo-task-control" },
  { id: "core:task.resume", category: "tasks", description: "Resume a resumable task (never claims resume when an artifact is missing)", executor: "terboo-task-control" },
].map((c) => ({
  inputs: { required: [], properties: {} }, target: "none", permissions: { level: LEVEL.USER }, confirmation: "none", chat: "any",
  provider: "core", timeoutMs: 60_000, retry: { attempts: 1, retries: 0 }, verification: "core result", fallback: [], background: c.category === "tasks",
  aiExposed: true, safety: "scoped", source: "core", ...c,
}));

let cache = null;

/** كل القدرات (تُبنى عند أول طلب؛ refresh بعد تحميل/إعادة تحميل الإضافات) */
function capabilities({ refresh = false } = {}) {
  if (cache && !refresh) return cache;
  const out = new Map();
  for (const tool of allTools()) if (!tool.alias) out.set(`tool:${tool.id}`, fromTool(tool));
  for (const [id, policy] of Object.entries(ACTIONS)) out.set(`action:${id}`, fromAction(id, policy));
  const seen = new Set();
  for (const plugin of getAllPlugins()) {
    if (!plugin?.config || seen.has(plugin)) continue;
    seen.add(plugin);
    if (plugin.config.isEnabled === false) continue;
    const cap = fromPlugin(plugin);
    if (!out.has(cap.id)) out.set(cap.id, cap);
  }
  for (const c of CORE) out.set(c.id, c);
  cache = [...out.values()];
  return cache;
}

function getCapability(id) {
  return capabilities().find((c) => c.id === id) || null;
}

/** ملخص للعرض/المصفوفات */
function capabilitySummary() {
  const all = capabilities();
  const by = (key) => all.reduce((acc, c) => ({ ...acc, [c[key]]: (acc[c[key]] || 0) + 1 }), {});
  return {
    total: all.length,
    bySource: by("source"),
    byCategory: by("category"),
    scrapers: all.filter((c) => c.source === "scraper").length,
    aiExposed: all.filter((c) => c.aiExposed).length,
    needsConfirmation: all.filter((c) => c.confirmation !== "none" && c.confirmation !== "inside-command").length,
  };
}

/**
 * عرض آمن لمن يطلب الكتالوج (الموقع/النموذج): ما يستطيعه هذا المستوى فقط.
 * المستوى يُحسب من الخادم (principalOf) — لا يُقبل من الواجهة.
 */
function capabilitiesFor(level) {
  const rank = { [LEVEL.USER]: 0, [LEVEL.GROUP_ADMIN]: 1, [LEVEL.OWNER]: 2 };
  const mine = rank[level] ?? 0;
  return capabilities().filter((c) => (rank[c.permissions.level] ?? 0) <= mine);
}

function _resetCapabilities() {
  cache = null;
}

export { FIELDS, _resetCapabilities, capabilities, capabilitiesFor, capabilitySummary, getCapability };
export default { capabilities, capabilitiesFor, capabilitySummary, getCapability, FIELDS };
