// ═══════════════════════════════════════════════
// 🧪 Health-aware Provider Router + Bounded Hedging (§50 §51 §52)
// ───────────────────────────────────────────────
//   • أساسي سريع ⇒ نداء واحد فقط (لا مضاعفة تكلفة).
//   • أساسي يتجاوز زمنه المعتاد ⇒ بديل واحد بالتوازي، أول نجاح يفوز، بلا انتظار الأبطأ.
//   • فشل الأساسي سريعاً ⇒ البديل فوراً لا بعد مهلة.
//   • قياسات حقيقية: أساسي أبطأ باستمرار (≥ 2× EWMA بديل صحي بعيّنات كافية) ⇒ يُرقّى البديل.
//   • مهام غير تفاعلية (ملخّص) ⇒ لا hedging.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import { orderCandidates, runRoutedChat } from "../src/lib/terboo-ai-router.js";
import { reportProviderSuccess, resetProviderHealth } from "../src/lib/terboo-provider-health.js";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const route = { task: "chat", primary: "A", fallbacks: ["B"] };
const results = [];
const check = async (name, fn) => { resetProviderHealth(); await fn(); results.push(name); };

await check("fast-primary-single-call", async () => {
  const calls = [];
  const providers = { A: async () => { calls.push("A"); await sleep(30); return "a"; }, B: async () => { calls.push("B"); return "b"; } };
  const out = await runRoutedChat({ route, providers, payload: { message: "hi" } });
  await sleep(50);
  assert.equal(out.provider, "A");
  assert.deepEqual(calls, ["A"], "البديل استُدعي رغم سرعة الأساسي");
  assert.equal(out.hedged, false);
});

await check("slow-primary-hedged", async () => {
  const calls = [];
  const providers = { A: async () => { calls.push("A"); await sleep(4500); return "a"; }, B: async () => { calls.push("B"); await sleep(80); return "b"; } };
  // A يرد عادةً خلال ~1.2 ث (قياس حقيقي) ⇒ تجاوز 1.5× زمنه المعتاد (حد أدنى 2.5 ث) يطلق البديل
  for (let i = 0; i < 3; i++) reportProviderSuccess("A", 1200);
  const t0 = Date.now();
  const out = await runRoutedChat({ route, providers, payload: { message: "hi" } });
  const ms = Date.now() - t0;
  assert.equal(out.provider, "B", "البديل الأسرع لم يفز");
  assert.equal(out.hedged, true);
  assert.deepEqual(calls, ["A", "B"], "أكثر من بديل واحد");
  assert.ok(ms < 3500, `انتظر الأساسي البطيء: ${ms}ms`);
});

await check("failing-primary-immediate-fallback", async () => {
  const providers = { A: async () => { await sleep(20); throw new Error("http 500"); }, B: async () => { await sleep(20); return "b"; } };
  const t0 = Date.now();
  const out = await runRoutedChat({ route, providers, payload: { message: "hi" } });
  assert.equal(out.provider, "B");
  assert.ok(Date.now() - t0 < 500, "البديل انتظر مهلة hedging بعد فشل صريح");
  assert.equal(out.fallbackUsed, true);
});

await check("health-aware-promotion", async () => {
  const providers = { A: async () => "a", B: async () => "b" };
  for (let i = 0; i < 3; i++) { reportProviderSuccess("A", 3000); reportProviderSuccess("B", 600); }
  assert.deepEqual(orderCandidates(route, providers), ["B", "A"], "الأبطأ باستمرار بقي أولاً");
  resetProviderHealth();
  for (let i = 0; i < 3; i++) { reportProviderSuccess("A", 900); reportProviderSuccess("B", 600); }
  assert.deepEqual(orderCandidates(route, providers), ["A", "B"], "ترقية بفرق صغير لا يستحق");
});

await check("no-hedge-for-summary", async () => {
  const calls = [];
  const providers = { A: async () => { calls.push("A"); await sleep(2800); return "a"; }, B: async () => { calls.push("B"); return "b"; } };
  const out = await runRoutedChat({ route, providers, payload: { message: "x", purpose: "summary" } });
  assert.equal(out.provider, "A");
  assert.deepEqual(calls, ["A"], "hedging لمهمة ملخّص خلفية");
});

console.log(`✅ terboo-provider-router: ${results.join(" · ")}`);
process.exit(0);
