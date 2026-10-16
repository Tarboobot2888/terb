// ═══════════════════════════════════════════════
// ⏱️ Terboo Benchmark — أين يذهب الوقت؟ (v4 §45)
// ───────────────────────────────────────────────
// يشغّل النواة الحقيقية (السياق · الذاكرة · النوايا · التوجيه · الصلاحيات · الرد) على سيناريوهات
// ثابتة ويقيس كل مرحلة من القياس الحقيقي (terboo-latency):
//   TTFB (أول رد يصل للمستخدم) · زمن المزوّد · زمن السياق · زمن الذاكرة · زمن الـscraper · الإجمالي
// ثم يطرح زمن الشبكة ليظهر «زمن البوت نفسه».
//
// المزوّد والـscraper خارجيان: افتراضياً يُحاكيان بتأخير ثابت معلن (بلا شبكة) حتى تكون الأرقام
// قابلة للمقارنة بين تشغيلين. الأعلام:
//   --provider-ms 800   زمن المزوّد المحاكى
//   --scraper-ms 1200   زمن الـscraper المحاكى
//   --runs 20           عدد التكرارات لكل سيناريو
// التقرير: tools/reports/terboo-benchmark.{json,md}
// ═══════════════════════════════════════════════

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? Number(argv[index + 1]) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};
const PROVIDER_MS = flag("provider-ms", 800);
const SCRAPER_MS = flag("scraper-ms", 1200);
const RUNS = Math.max(1, Math.min(200, flag("runs", 20)));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-bench-"));
const { initDatabase } = await import("../src/lib/terboo-database.js");
const db = await initDatabase(tmp);
process.on("exit", () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (error) { console.warn("تنظيف:", error.message); } });
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
const log = console.log;
console.log = () => { };
await loadPlugins(path.join(process.cwd(), "plugins"));
console.log = log;
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const core = await import("../src/lib/terboo-ai-core.js");
const latency = await import("../src/lib/terboo-latency.js");
const tools = await import("../src/lib/terboo-ai-tools.js");

const BOT = "2348093093240";
const sock = { user: { id: `${BOT}:12@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net` } };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// المزوّد المحاكى: زمن ثابت ثم قرار بحسب السيناريو
let decision = () => ({ decision: "CHAT", reply: "تمام.", confidence: 0.9 });
const ask = async (payload) => {
  const t0 = performance.now();
  await sleep(PROVIDER_MS);
  const text = payload?.purpose === "summary" ? "ملخص" : JSON.stringify(decision(payload));
  return { text, provider: "Simulated", latencyMs: performance.now() - t0 };
};
const runTool = async () => { await sleep(SCRAPER_MS); return { ok: true, via: "scraper", deliveries: [{ type: "video" }] }; };
const deps = { ask, runTool, rateLimit: false, tools };

let seq = 0;
function message(sender, body) {
  return {
    key: { remoteJid: sender, fromMe: false, id: `BENCH${++seq}` }, sender, chat: sender, isGroup: false, body,
    pushName: "bench", type: "conversation", isCommand: false, prefix: ".", isOwner: false, isPremium: false,
    isPartner: false, isAdmin: false, isBotAdmin: false, isBot: false, fromMe: false, isNewsletter: false, mentionedJid: [], quoted: null,
    async reply() { return { key: { id: "r" } }; }, async react() { },
  };
}

const SCENARIOS = [
  { name: "chat (model)", body: (i) => `اشرح فكرة رقم ${i} باختصار`, setup: () => { decision = () => ({ decision: "CHAT", reply: "شرح قصير.", confidence: 0.9 }); } },
  { name: "scraper fast path (no model)", body: (i) => `حمل https://www.tiktok.com/@bench/video/73000000000000${String(i).padStart(5, "0")}` },
  { name: "follow-up: audio of last link (no model)", body: () => "هات الصوت بس", warm: (i) => `حمل https://www.tiktok.com/@bench/video/74000000000000${String(i).padStart(5, "0")}` },
  { name: "memory: what do you know (no model)", body: () => "ايش تعرف عني" },
];

const round = (value) => (value === null || value === undefined || !Number.isFinite(value) ? null : Math.round(value * 10) / 10);
const pct = (values, p) => {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  return round(list[Math.min(list.length - 1, Math.max(0, Math.ceil((p / 100) * list.length) - 1))]);
};

const results = [];
for (const scenario of SCENARIOS) {
  scenario.setup?.();
  const traces = [];
  for (let i = 0; i < RUNS; i += 1) {
    const sender = `2015${String(40000000 + results.length * 1000 + i).padStart(8, "0")}@s.whatsapp.net`;
    if (scenario.warm) await core.runKernel(message(sender, scenario.warm(i)), sock, db, deps);
    await core.runKernel(message(sender, scenario.body(i)), sock, db, deps);
    traces.push(latency.recentTraces(1)[0]);
  }
  const col = (fn) => traces.map(fn);
  const stage = (name) => col((t) => t.stages?.[name]);
  const internal = col((t) => t.totalMs - (t.providerMs || 0) - (t.stages?.scraper ? SCRAPER_MS : 0));
  results.push({
    scenario: scenario.name,
    runs: traces.length,
    providerCalls: pct(col((t) => t.providerCalls), 50),
    ttfb: { p50: pct(col((t) => t.ttftMs), 50), p95: pct(col((t) => t.ttftMs), 95) },
    provider: { p50: pct(col((t) => t.providerMs), 50), p95: pct(col((t) => t.providerMs), 95) },
    context: { p50: pct(stage("context"), 50), p95: pct(stage("context"), 95) },
    memory: { p50: pct(stage("memory"), 50), p95: pct(stage("memory"), 95) },
    routing: { p50: pct(stage("routing"), 50), p95: pct(stage("routing"), 95) },
    scraper: { p50: pct(stage("scraper"), 50), p95: pct(stage("scraper"), 95) },
    total: { p50: pct(col((t) => t.totalMs), 50), p95: pct(col((t) => t.totalMs), 95) },
    botOverhead: { p50: pct(internal, 50), p95: pct(internal, 95) },
    pipeline: traces.at(-1)?.pipeline?.map((s) => `${s.stage}${s.detail ? `:${s.detail}` : ""}`).join(" → ") || "",
  });
}

const cell = (value) => (value === null ? "—" : `${value}`);
const pair = (v) => `${cell(v.p50)} / ${cell(v.p95)}`;
const header = ["scenario", "TTFB", "provider", "context", "memory", "routing", "scraper", "total", "bot overhead", "calls"];
const lines = [
  `# Terboo Benchmark (v4 §45)`,
  "",
  `- generated: ${new Date().toISOString()}`,
  `- runs per scenario: ${RUNS}`,
  `- simulated provider latency: ${PROVIDER_MS} ms · simulated scraper latency: ${SCRAPER_MS} ms (external services are simulated; every other stage is the real kernel)`,
  `- values: p50 / p95 in ms · «bot overhead» = total − provider − scraper = time spent inside the bot itself`,
  "",
  `| ${header.join(" | ")} |`,
  `| ${header.map(() => "---").join(" | ")} |`,
  ...results.map((r) => `| ${r.scenario} | ${pair(r.ttfb)} | ${pair(r.provider)} | ${pair(r.context)} | ${pair(r.memory)} | ${pair(r.routing)} | ${pair(r.scraper)} | ${pair(r.total)} | ${pair(r.botOverhead)} | ${cell(r.providerCalls)} |`),
  "",
  "## Where the time goes",
  "",
  ...results.map((r) => {
    const parts = [["provider", r.provider.p50], ["scraper", r.scraper.p50], ["bot overhead", r.botOverhead.p50]].filter(([, v]) => v);
    const top = parts.sort((a, b) => b[1] - a[1])[0];
    return `- **${r.scenario}**: total ${cell(r.total.p50)} ms, dominated by ${top ? `${top[0]} (${top[1]} ms)` : "—"}; pipeline: ${r.pipeline}`;
  }),
];
fs.mkdirSync(path.join(process.cwd(), "tools/reports"), { recursive: true });
fs.writeFileSync(path.join(process.cwd(), "tools/reports/terboo-benchmark.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), runs: RUNS, simulated: { providerMs: PROVIDER_MS, scraperMs: SCRAPER_MS }, results }, null, 2)}\n`);
fs.writeFileSync(path.join(process.cwd(), "tools/reports/terboo-benchmark.md"), `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
process.exit(0);
