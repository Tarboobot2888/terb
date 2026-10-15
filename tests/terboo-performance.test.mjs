// اختبار الأداء (§9–§13 §51 §52): مزوّد واحد لكل رسالة، البديل فقط عند الفشل،
// مهلة محدودة وقاطع دائرة لا ينتظر مزوّداً ميتاً، ميزانية كلية محدودة،
// زمن النواة الداخلي صغير، لا تأخير «كتابة» مصطنع، وقياس كل مرحلة.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const router = await import("../src/lib/terboo-ai-router.js");
const health = await import("../src/lib/terboo-provider-health.js");
const latency = await import("../src/lib/terboo-latency.js");

const route = { task: "chat", primary: "A", fallbacks: ["B", "C"] };
const payload = { message: "hi", instruction: "", history: [] };
const never = () => new Promise(() => { });
const elapsed = async (fn) => { const t0 = Date.now(); const value = await fn(); return { value, ms: Date.now() - t0 }; };

// ── 1. نجاح الأساسي ⇒ لا يُستدعى أي بديل (§10) ──
health.resetProviderHealth();
{
  const calls = [];
  const providers = {
    A: async () => { calls.push("A"); return { text: "ok-A" }; },
    B: async () => { calls.push("B"); return { text: "ok-B" }; },
  };
  const result = await router.runRoutedChat({ route, providers, payload });
  assert.equal(result.text, "ok-A");
  assert.deepEqual(calls, ["A"], "استُدعي بديل رغم نجاح الأساسي");
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.attempts.length, 1);
}

// ── 2. مزوّد معلّق ⇒ مهلة قصيرة ثم بديل (لا انتظار بلا حد) ──
health.resetProviderHealth();
{
  const providers = { A: never, B: async () => ({ text: "ok-B" }) };
  const { value, ms } = await elapsed(() => router.runRoutedChat({ route, providers, payload, timeoutMs: 200 }));
  assert.equal(value.text, "ok-B");
  assert.equal(value.fallbackUsed, true);
  assert.ok(ms < 600, `المهلة لم تُحترم: ${ms}ms`);
  assert.ok(value.fallbackLatencyMs >= 180 && value.fallbackLatencyMs < 600, `زمن البديل غير مسجل: ${value.fallbackLatencyMs}`);
  assert.match(value.attempts[0].error, /provider_timeout/);
}

// ── 3. نتيجة فارغة أو خطأ HTTP ⇒ بديل ──
health.resetProviderHealth();
{
  const empty = await router.runRoutedChat({ route, providers: { A: async () => ({ text: "   " }), B: async () => ({ text: "ok" }) }, payload });
  assert.equal(empty.provider, "B");
  const http = await router.runRoutedChat({ route, providers: { A: async () => { throw new Error("HTTP 503"); }, B: async () => ({ text: "ok" }) }, payload });
  assert.equal(http.provider, "B");
}

// ── 4. قاطع الدائرة: بعد 3 إخفاقات يُتخطّى المزوّد فوراً بلا انتظار ──
health.resetProviderHealth();
{
  let aCalls = 0;
  const providers = { A: async () => { aCalls++; throw new Error("down"); }, B: async () => ({ text: "ok-B" }) };
  for (let i = 0; i < 3; i++) await router.runRoutedChat({ route, providers, payload });
  assert.equal(health.canUseProvider("A").allowed, false, "الدائرة لم تُفتح بعد 3 إخفاقات");
  const before = aCalls;
  const slowDead = { A: never, B: async () => ({ text: "ok-B" }) };
  const { value, ms } = await elapsed(() => router.runRoutedChat({ route, providers: slowDead, payload, timeoutMs: 5000 }));
  assert.equal(value.provider, "B");
  assert.equal(aCalls, before);
  assert.ok(ms < 100, `مزوّد مفتوح الدائرة ما زال يؤخّر الرد: ${ms}ms`);
  assert.equal(value.attempts.length, 1, "المزوّد المعطّل يجب أن يُتخطّى لا أن يُجرَّب");
}

// ── 5. الميزانية الكلية محدودة حتى لو تعطّلت كل المزوّدات ──
health.resetProviderHealth();
{
  const providers = { A: never, B: never, C: never };
  const t0 = Date.now();
  await assert.rejects(router.runRoutedChat({ route, providers, payload, timeoutMs: 400, budgetMs: 900 }), (error) => {
    assert.ok(Array.isArray(error.attempts) && error.attempts.length >= 1);
    return true;
  });
  const ms = Date.now() - t0;
  assert.ok(ms < 1300, `تجاوز الميزانية الكلية: ${ms}ms`);
}

// ── 6. ترتيب البدائل حسب الصحة والزمن ──
health.resetProviderHealth();
{
  health.reportProviderSuccess("B", 3000);
  health.reportProviderSuccess("C", 300);
  const order = router.orderCandidates(route, { A: () => { }, B: () => { }, C: () => { } });
  assert.deepEqual(order, ["A", "C", "B"], "الأساسي أولاً ثم البديل الأسرع");
  for (let i = 0; i < 3; i++) health.reportProviderFailure("A", "x");
  assert.deepEqual(router.orderCandidates(route, { A: () => { }, B: () => { }, C: () => { } })[0], "C", "الأساسي المعطّل لا يتقدّم");
}

// ── 7. النواة: نداء مزوّد واحد لكل رسالة وزمن داخلي صغير ومراحل مقيسة ──
health.resetProviderHealth();
const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-perf-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmpDb);
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmpDb, "memory"));
memory.resetAll();
const core = await import("../src/lib/terboo-ai-core.js");

const sock = { user: { id: "2348093093240:12@s.whatsapp.net" }, async sendMessage() { return { key: { id: "s" } }; }, async sendPresenceUpdate() { } };
function message(body, i, overrides = {}) {
  const sender = overrides.sender || `2010000${String(2000 + (i % 9)).padStart(5, "0")}@s.whatsapp.net`;
  return {
    sender, chat: sender, body, type: "conversation", isCommand: false, prefix: ".", args: [], isGroup: false,
    isOwner: false, fromMe: false, isBot: false, mentionedJid: [], quoted: null,
    key: { id: `P${i}`, remoteJid: sender }, raw: { key: { id: `P${i}`, remoteJid: sender } },
    async reply() { return { key: { id: "r" } }; }, async react() { }, ...overrides,
  };
}

latency.resetLatency();
{
  let asks = 0;
  const ask = async () => { asks++; return { text: '{"decision":"CHAT","reply":"تمام","confidence":0.9}', provider: "fake", latencyMs: 0 }; };
  const texts = ["ازيك عامل ايه", "بتعمل اي", "طب احكيلي حاجة حلوة", "what can you do", "cuéntame algo", "فاكر اسمي؟", "ايه الجديد"];
  const N = 35;
  for (let i = 0; i < N; i++) await core.runKernel(message(texts[i % texts.length], i), sock, getDatabase(), { ask, rateLimit: false });
  assert.equal(asks, N, `عدد نداءات المزوّد ${asks} ≠ عدد الرسائل ${N}`);
  const report = latency.latencyReport({ kind: "kernel" });
  assert.equal(report.count, N);
  assert.equal(report.multiProviderMessages, 0, "رسالة استدعت أكثر من مزوّد");
  assert.ok(report.total.p50 < 30, `زمن النواة الداخلي مرتفع (p50=${report.total.p50}ms)`);
  assert.ok(report.total.p95 < 250, `زمن النواة الداخلي مرتفع (p95=${report.total.p95}ms)`);
  for (const stage of ["parse", "context", "memory", "routing", "intent", "provider", "response"]) {
    assert.ok(report.stages[stage], `المرحلة ${stage} غير مقيسة`);
  }
  assert.ok(report.ttft.p50 !== null, "زمن أول رد غير مسجل");
}

// المسار السريع للأدوات: صفر نداء مزوّد
{
  let asks = 0;
  const ask = async () => { asks++; return { text: "{}" }; };
  const dispatch = async () => ({ ok: true, replies: ["x"] });
  await core.runKernel(message("حمل لي الفيديو ده https://vt.tiktok.com/ZS1/", 900), sock, getDatabase(), { ask, dispatch, rateLimit: false });
  assert.equal(asks, 0, "طلب أداة واضح استدعى النموذج");
  const last = latency.recentTraces(1)[0];
  assert.ok(last.stages.scraper !== undefined, "مرحلة الأداة غير مقيسة");
  assert.equal(last.providerCalls, 0);
}

// ── 8. Auto AI: لا تأخير «كتابة» مصطنع بعد جاهزية الرد (§9) ──
{
  const db = getDatabase();
  const chat = "perf-autoai@g.us";
  db.db.data.autoai = { [chat]: { enabled: true, instruction: "أجب باختصار.", character: "assistant", responseType: "text", sessions: {} } };
  db.db.data.autoai_global = { enabled: false };
  const { handleAutoAI } = await import("../src/lib/terboo-auto-ai.js");
  const replies = [];
  const long = "هذا رد طويل نسبياً ".repeat(20);
  const m = {
    isGroup: true, fromMe: false, isCommand: false, chat, sender: "201999999977@s.whatsapp.net", body: "تيربو رسالة للقياس", // v4 §23: المجموعة تُخاطَب بالاسم أو المنشن أو الرد
    groupMembers: [{ id: "2348093093240@s.whatsapp.net" }], quoted: null,
    reply: async (text) => replies.push(text), react: async () => { },
  };
  const { value, ms } = await elapsed(() => handleAutoAI(m, sock, { db, geminiChat: async () => ({ text: long }) }));
  assert.equal(value, true);
  assert.ok(replies.length >= 1);
  assert.ok(ms < 1500, `Auto AI أبطأ من اللازم (${ms}ms) — تأخير مصطنع؟`);
  const trace = latency.recentTraces(1)[0];
  assert.equal(trace.kind, "autoai");
  assert.ok(trace.ttftMs !== null, "Auto AI لا يسجل زمن أول رد");
  assert.ok(trace.stages.provider !== undefined);
}

fs.rmSync(tmpDb, { recursive: true, force: true });
console.log("✅ terboo-performance: مزوّد واحد لكل رسالة، مهلة وقاطع دائرة وميزانية، نواة داخلية سريعة، بلا تأخير مصطنع، كل المراحل مقيسة");
process.exit(0);
