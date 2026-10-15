// ═══════════════════════════════════════════════
// 🧪 Terboo Agent Limits (§14 §46 §85)
// ───────────────────────────────────────────────
// حدود الوكيل الحقيقي (runAgent) بموزّع مُبرمج:
//   1. خطوة معلّقة ⇒ مهلة الخطوة ⇒ فشل + عكس الخطوة السابقة القابلة للعكس.
//   2. «وقف» (AbortSignal) بعد خطوة ⇒ لا خطوة تالية · لا عكس لما تم · الحالة cancelled.
//   3. نفاد ميزانية الخطة ⇒ لا تبدأ خطوة جديدة.
//   4. حد الخطوات: أكثر من 6 لا يُنفَّذ.
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-agent-limits-"));
process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid.json");
const { initDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
memory.resetAll();
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const agent = await import("../src/lib/terboo-ai-agent.js");

const m = { sender: "201000000401@s.whatsapp.net", chat: "120363000000000401@g.us", isGroup: true, isOwner: false, isAdmin: true, isBotAdmin: true, key: { id: "AL1" }, id: "AL1" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const promote = agent.canonical("promote");
const demote = agent.canonical("demote");
const mute = agent.canonical("mute");
assert.ok(promote && demote && mute, "أوامر الإدارة غير موجودة في السجل الحيّ");
const results = [];
const check = async (name, fn) => { await fn(); results.push(name); };

await check("step-timeout-rollback", async () => {
  const executed = [];
  const dispatch = async (_m, _s, { command, args }) => {
    executed.push(`${command} ${args}`.trim());
    if (command === mute) return new Promise(() => {}); // لا ترد أبداً
    return { ok: true, status: "done" };
  };
  const run = await agent.runAgent({ m, sock: {}, steps: [{ command: promote, args: "@201000000402" }, { command: mute, args: "" }], approved: true, deps: { dispatch, stepTimeoutMs: 80 } });
  assert.equal(run.status, "failed");
  assert.equal(run.results[1].summary, "timeout");
  assert.equal(run.rolledBack.length, 1, "الخطوة السابقة لم تُعكس");
  assert.equal(run.rolledBack[0].inverse.name, demote);
  assert.deepEqual(executed, [`${promote} @201000000402`, mute, `${demote} @201000000402`]);
});

await check("user-interrupt", async () => {
  const controller = new AbortController();
  const executed = [];
  const dispatch = async (_m, _s, { command }) => {
    executed.push(command);
    if (command === promote) { await sleep(30); controller.abort("user-cancel"); }
    return { ok: true, status: "done" };
  };
  const run = await agent.runAgent({ m, sock: {}, steps: [{ command: promote, args: "@201000000403" }, { command: mute, args: "" }], approved: true, deps: { dispatch, signal: controller.signal } });
  assert.equal(run.status, "cancelled");
  assert.deepEqual(executed, [promote], "خطوة نُفّذت بعد «وقف»");
  assert.equal(run.rolledBack.length, 0, "الإيقاف عكس ما تم دون طلب");
  const lines = agent.reportLines(run, { t: (key) => key });
  assert.ok(lines.some((line) => line.includes("kernel.agentSkipped")), "الخطوة المتبقية لم تُذكر كمتخطّاة");
});

await check("plan-budget", async () => {
  const executed = [];
  const dispatch = async (_m, _s, { command }) => { executed.push(command); await sleep(40); return { ok: true, status: "done" }; };
  const run = await agent.runAgent({ m, sock: {}, steps: [{ command: mute, args: "" }, { command: promote, args: "@201000000404" }], approved: true, deps: { dispatch, budgetMs: 10 } });
  assert.equal(run.stopped, "budget");
  assert.deepEqual(executed.filter((c) => c !== agent.canonical("unmute")), [mute], "خطوة بدأت بعد نفاد الميزانية");
});

await check("max-steps", async () => {
  const executed = [];
  const dispatch = async (_m, _s, { command }) => { executed.push(command); return { ok: true, status: "done" }; };
  const steps = Array.from({ length: 9 }, () => ({ command: mute, args: "" }));
  const run = await agent.runAgent({ m, sock: {}, steps, approved: true, deps: { dispatch } });
  assert.equal(run.status, "done");
  assert.equal(executed.length, agent.MAX_STEPS);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✅ terboo-agent-limits: ${results.join(" · ")}`);
process.exit(0);
