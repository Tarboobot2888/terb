// ═══════════════════════════════════════════════
// ⏱️ Terboo Latency — قياس زمن كل مرحلة في مسار الذكاء (§51 §52)
// ───────────────────────────────────────────────
// المراحل: parse · context · memory · intent · routing · provider · scraper · response
// ويُسجَّل لكل رسالة: TTFT (زمن أول رد يصل للمستخدم) · زمن المزوّد · زمن البديل · الإجمالي.
// القياسات في الذاكرة فقط (آخر 300 رسالة) ولا تحمل أي نص من المحادثة.
// ═══════════════════════════════════════════════

const STAGES = ["parse", "context", "memory", "intent", "routing", "provider", "scraper", "response"];
/**
 * مراحل تفكير النواة بالترتيب (v4 §10) — تُسجَّل لكل رسالة كتسلسل أسماء وتسميات قصيرة
 * (نوع القرار، معرّف الأداة، الحالة) بلا أي نص من المحادثة.
 */
const PIPELINE = ["intent", "context", "memory", "capability", "strategy", "permission", "tool", "verify", "response"];
const MAX_TRACES = 300;

if (!global.terbooLatency) global.terbooLatency = { traces: [], seq: 0 };
const store = global.terbooLatency;
const active = new WeakMap();

const now = () => performance.now();

class Trace {
  constructor(kind, meta = {}) {
    this.id = ++store.seq;
    this.kind = kind;
    this.meta = { ...meta };
    this.t0 = now();
    this.last = this.t0;
    this.stages = {};
    this.ttftMs = null;
    this.providerMs = null;
    this.provider = "";
    this.fallbackMs = 0;
    this.fallbackUsed = false;
    this.providerCalls = 0;
    this.pipeline = [];
    this.done = false;
  }

  /** مرحلة تفكير من PIPELINE مع تسمية قصيرة اختيارية (بلا نص محادثة) */
  step(stage, detail = "") {
    if (!PIPELINE.includes(stage)) return this;
    this.pipeline.push({ stage, detail: String(detail || "").slice(0, 40), atMs: Math.round((now() - this.t0) * 10) / 10 });
    return this;
  }

  /** يُغلق المرحلة الحالية: الزمن منذ آخر علامة يُحسب لهذه المرحلة */
  mark(stage) {
    const t = now();
    this.stages[stage] = (this.stages[stage] || 0) + (t - this.last);
    this.last = t;
    return this;
  }

  /** أول رد وصل للمستخدم (رسالة أو وسيط) */
  firstResponse() {
    if (this.ttftMs === null) this.ttftMs = now() - this.t0;
    return this;
  }

  /** نتيجة نداء مزوّد من الموجّه (attempts · latency · fallback) */
  providerResult(answer) {
    if (!answer) return this;
    this.providerCalls += 1;
    this.provider = answer.provider || this.provider;
    if (Number.isFinite(answer.latencyMs)) this.providerMs = (this.providerMs || 0) + answer.latencyMs;
    if (answer.fallbackUsed) {
      this.fallbackUsed = true;
      this.fallbackMs += answer.fallbackLatencyMs || 0;
    }
    return this;
  }

  end(outcome = "") {
    if (this.done) return this.summary();
    this.done = true;
    this.totalMs = now() - this.t0;
    this.outcome = String(outcome || "");
    store.traces.push(this.summary());
    if (store.traces.length > MAX_TRACES) store.traces.splice(0, store.traces.length - MAX_TRACES);
    return this.summary();
  }

  summary() {
    const round = (value) => (value === null || value === undefined ? null : Math.round(value * 10) / 10);
    return {
      id: this.id,
      kind: this.kind,
      outcome: this.outcome || "",
      totalMs: round(this.totalMs ?? now() - this.t0),
      ttftMs: round(this.ttftMs),
      providerMs: round(this.providerMs),
      provider: this.provider,
      providerCalls: this.providerCalls,
      fallbackUsed: this.fallbackUsed,
      fallbackMs: round(this.fallbackMs),
      stages: Object.fromEntries(Object.entries(this.stages).map(([key, value]) => [key, round(value)])),
      pipeline: this.pipeline.map((entry) => ({ ...entry })),
    };
  }
}

function startTrace(kind, meta) {
  return new Trace(kind, meta);
}

/** ربط القياس برسالة حتى تسجّل دوال الرد أول رد بلا تمرير صريح */
function attachTrace(m, trace) {
  if (m && typeof m === "object" && trace) active.set(m, trace);
  return trace;
}

function traceOf(m) {
  return m && typeof m === "object" ? active.get(m) || null : null;
}

/** مرحلة تفكير على قياس الرسالة إن وُجد (للمحوّلات التي لا تحمل trace) */
function stepOf(m, stage, detail = "") {
  traceOf(m)?.step(stage, detail);
}

/** علامة «أول رد» على قياس الرسالة إن وُجد */
function markFirstResponse(m) {
  traceOf(m)?.firstResponse();
}

function percentile(values, p) {
  const list = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!list.length) return null;
  const index = Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1));
  return Math.round(list[index] * 10) / 10;
}

/** تقرير الأداء للمالك: p50/p95 لكل مرحلة ولزمن أول رد والمزوّد والبديل والإجمالي */
function latencyReport({ kind = "", last = MAX_TRACES } = {}) {
  const traces = store.traces.filter((trace) => !kind || trace.kind === kind).slice(-last);
  const stages = {};
  for (const stage of STAGES) {
    const values = traces.map((trace) => trace.stages[stage]).filter((value) => value !== undefined);
    if (values.length) stages[stage] = { p50: percentile(values, 50), p95: percentile(values, 95), n: values.length };
  }
  const pick = (key) => ({ p50: percentile(traces.map((t) => t[key]), 50), p95: percentile(traces.map((t) => t[key]), 95) });
  return {
    count: traces.length,
    total: pick("totalMs"),
    ttft: pick("ttftMs"),
    provider: pick("providerMs"),
    fallback: { count: traces.filter((t) => t.fallbackUsed).length, p95: percentile(traces.filter((t) => t.fallbackUsed).map((t) => t.fallbackMs), 95) },
    multiProviderMessages: traces.filter((t) => t.providerCalls > 1).length,
    duplicatesBlocked: claimsState.duplicates,
    stages,
  };
}

function recentTraces(count = 20) {
  return store.traces.slice(-count);
}

/** للاختبارات فقط */
function resetLatency() {
  store.traces.length = 0;
  claimsState.map.clear();
  claimsState.duplicates = 0;
}

// ── منع معالجة نفس الرسالة مرتين (§52 Message ID deduplication) ──
// الاتصال يُسقط التكرار الفوري (30ث)؛ وهذا يغطي إعادة التسليم المتأخرة بعد إعادة
// الاتصال: نفس المعرّف ونفس النص في نفس المسار لا يُعالَج (ولا يُستدعى مزوّد) مرتين.
const CLAIM_TTL_MS = 10 * 60 * 1000;
const claimsState = { map: new Map(), duplicates: 0 };

function bodyHash(text) {
  let hash = 0;
  for (const ch of String(text || "")) hash = (hash * 31 + ch.codePointAt(0)) | 0;
  return (hash >>> 0).toString(36);
}

/**
 * @param {Object} m رسالة مُسلسلة
 * @param {string} path kernel | autoai
 * @returns {boolean} false إن كانت نفس الرسالة قد عولجت في هذا المسار
 */
function claimAiMessage(m, path) {
  const id = m?.key?.id || m?.id;
  if (!id) return true;
  const now = Date.now();
  const key = `${path}:${m.chat || ""}:${id}:${bodyHash(m.body ?? m.text)}`;
  for (const [old, at] of claimsState.map) {
    if (now - at <= CLAIM_TTL_MS && claimsState.map.size <= 5000) break;
    claimsState.map.delete(old);
  }
  const seen = claimsState.map.get(key);
  if (seen && now - seen < CLAIM_TTL_MS) {
    claimsState.duplicates += 1;
    return false;
  }
  claimsState.map.set(key, now);
  return true;
}

export { PIPELINE, STAGES, attachTrace, claimAiMessage, latencyReport, markFirstResponse, recentTraces, resetLatency, startTrace, stepOf, traceOf };
