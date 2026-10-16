// ═══════════════════════════════════════════════
// ذاكرة وكيل المشروع — محوّل فوق محرّك الذاكرة المركزي
// ───────────────────────────────────────────────
// لم تعد للوكيل ذاكرة مستقلة في ملف خاص (§6). كل نطاق من نطاقات الوكيل
// صار نطاق system في المحرّك المركزي (system:agent:<scope>)، بنفس التنقيح
// وTTL وإزالة التكرار. الواجهة القديمة باقية كما هي لمن يستدعيها.
// ═══════════════════════════════════════════════

import { redactSecrets } from "./terboo-agent-registry.js";
import {
  eventsOf,
  factsOf,
  forgetKey,
  listSystemScopes,
  recordEvent,
  remember,
  scopeOf,
} from "./terboo-ai-memory.js";

const MAX_VALUE_LENGTH = 500;
const MAX_KEY_LENGTH = 80;
const MEMORY_KINDS = new Set(["preference", "fact", "decision", "capability"]);
const BUCKET_OF = { preference: "preferences", fact: "facts", capability: "capabilities", decision: "decisions" };
const TYPE_OF = { preference: "preference", fact: "fact", capability: "important_context", decision: "decision" };
const LESSONS_SCOPE = "agent-lessons";

function normalizeKey(key = "") {
  return String(key)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_:. -]/gu, "")
    .slice(0, MAX_KEY_LENGTH);
}

function isSensitiveKey(key = "") {
  return /(token|secret|password|apikey|api_key|مفتاح|كلمة.?المرور|جلسة|session|credential)/i.test(key);
}

function sanitizeValue(key, value) {
  if (isSensitiveKey(key)) return "[REDACTED]";
  return redactSecrets(String(value || "")).slice(0, MAX_VALUE_LENGTH);
}

/** نطاق الوكيل داخل المحرّك المركزي */
function agentScope(scope = "global") {
  const name = `agent:${String(scope || "global").replace(/[^\p{L}\p{N}_:.-]/gu, "_").slice(0, 70)}`;
  return scopeOf("system", { name });
}

function rememberStructured({ key, value, scope = "global", owner = "", kind = "preference", confidence = 1, ttlMs = 0, source = "user" } = {}) {
  const normalizedKey = normalizeKey(key);
  const normalizedKind = MEMORY_KINDS.has(kind) ? kind : "preference";
  if (!normalizedKey) return { ok: false, reason: "invalid-key" };
  const scopeKey = String(scope || "global").slice(0, 120);
  const bucket = BUCKET_OF[normalizedKind];
  const cleanValue = sanitizeValue(normalizedKey, value);
  const createdAt = new Date().toISOString();
  const factKey = bucket === "decisions" ? `decisions:${normalizedKey}:${createdAt}` : `${bucket}:${normalizedKey}`;
  const ttl = ttlMs > 0 ? Math.min(Number(ttlMs), 365 * 24 * 60 * 60 * 1000) : 0;

  const stored = remember(agentScope(scopeKey), {
    key: factKey,
    text: `${normalizedKey}: ${cleanValue}`,
    type: TYPE_OF[normalizedKind],
    confidence: Math.max(0, Math.min(Number(confidence) || 0, 1)),
    ttl,
    source: String(source).slice(0, 24),
    meta: { bucket, key: normalizedKey, value: cleanValue, owner: String(owner || "").slice(0, 80), source: String(source).slice(0, 80) },
  });
  if (!stored) return { ok: false, reason: "rejected" };
  return { ok: true, key: normalizedKey, scope: scopeKey, kind: normalizedKind };
}

function rememberPreference(key, value, options = {}) {
  return rememberStructured({ ...options, key, value, kind: "preference" });
}

function forgetPreference(key, { scope = "global" } = {}) {
  const normalizedKey = normalizeKey(key);
  const scopeKey = String(scope || "global").slice(0, 120);
  const descriptor = agentScope(scopeKey);
  let removed = false;
  for (const bucket of ["preferences", "facts", "capabilities"]) {
    removed = forgetKey(descriptor, `${bucket}:${normalizedKey}`) || removed;
  }
  for (const fact of factsOf(descriptor)) {
    if (fact.meta?.bucket === "decisions" && fact.meta?.key === normalizedKey) removed = forgetKey(descriptor, fact.key) || removed;
  }
  if (!removed) return { ok: false, reason: "not-found" };
  return { ok: true, key: normalizedKey, scope: scopeKey };
}

/** توافق: كان ينظّف المنتهي يدوياً — المحرّك المركزي يفعل ذلك عند كل قراءة */
function pruneExpiredMemory(memory) {
  return memory;
}

function toEntry(fact) {
  return {
    value: fact.meta?.value ?? fact.text,
    confidence: fact.confidence,
    source: fact.meta?.source || fact.source,
    owner: fact.meta?.owner || "",
    updatedAt: new Date(fact.at).toISOString(),
    expiresAt: fact.ttl ? new Date(fact.at + fact.ttl).toISOString() : null,
  };
}

function getStructuredMemory(scope = "global") {
  const out = { preferences: {}, facts: {}, capabilities: {}, decisions: [] };
  for (const fact of factsOf(agentScope(scope))) {
    const bucket = fact.meta?.bucket;
    if (!bucket) continue;
    if (bucket === "decisions") {
      out.decisions.push({ key: fact.meta.key, value: fact.meta.value, scope: String(scope), confidence: fact.confidence, source: fact.meta.source, owner: fact.meta.owner, createdAt: new Date(fact.at).toISOString() });
    } else if (out[bucket]) {
      out[bucket][fact.meta.key] = toEntry(fact);
    }
  }
  out.decisions = out.decisions.slice(-30);
  return out;
}

function getPreferences(scope = "global") {
  return getStructuredMemory(scope).preferences;
}

function getMemoryStats() {
  const stats = { preferences: 0, facts: 0, capabilities: 0, decisions: 0, lessons: 0 };
  for (const name of listSystemScopes("agent:")) {
    for (const fact of factsOf(scopeOf("system", { name }))) {
      const bucket = fact.meta?.bucket;
      if (bucket && bucket in stats) stats[bucket] += 1;
    }
  }
  stats.lessons = eventsOf(scopeOf("system", { name: LESSONS_SCOPE })).length;
  return stats;
}

function recordLesson({ operation, success, summary, error = "" } = {}) {
  const lesson = {
    operation: String(operation || "unknown").slice(0, 100),
    success: Boolean(success),
    summary: redactSecrets(String(summary || error || "")).slice(0, 500),
    timestamp: new Date().toISOString(),
  };
  recordEvent(scopeOf("system", { name: LESSONS_SCOPE }), `${lesson.operation}: ${lesson.summary}`, lesson.success ? "lesson-ok" : "lesson-fail");
  return lesson;
}

function buildMemoryContext(scope = "global") {
  const structured = getStructuredMemory(scope);
  const entries = [
    ...Object.entries(structured.preferences).map(([key, item]) => `- تفضيل ${key}: ${item.value}`),
    ...Object.entries(structured.facts).map(([key, item]) => `- حقيقة ${key}: ${item.value}`),
    ...Object.entries(structured.capabilities).map(([key, item]) => `- قدرة ${key}: ${item.value}`),
  ].slice(-40);
  return entries.length ? entries.join("\n") : "";
}

export {
  normalizeKey,
  isSensitiveKey,
  rememberStructured,
  rememberPreference,
  forgetPreference,
  getPreferences,
  getStructuredMemory,
  getMemoryStats,
  pruneExpiredMemory,
  recordLesson,
  buildMemoryContext,
};
