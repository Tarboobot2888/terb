#!/usr/bin/env node
// ═══════════════════════════════════════════════
// ⚖️ Terboo Benchmark BEFORE vs AFTER (§114 §118)
// ───────────────────────────────────────────────
// يشغّل نفس السيناريوهات على نسختين من المشروع (الأصل v4.0 والحالية) كلٌّ في عملية مستقلة،
// بإعدادات الإنتاج نفسها (محدّد المعدّل مُفعّل كما في التشغيل الحقيقي) ومزوّد مُحاكى بزمن ثابت
// معلن — كل ما عدا المزوّد هو النواة الحقيقية لكل نسخة.
//
//   node tools/terboo-benchmark-compare.mjs --before <مجلد v4.0> [--after .] [--runs 5] [--provider-ms 800]
//   التقرير: tools/reports/terboo-benchmark-compare.{json,md}
//
// المقاييس لكل سيناريو: زمن أول رد مرئي (TTFR) · عدد نداءات النموذج · عدد الردود · ردود مهدرة.
// ═══════════════════════════════════════════════

import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const argv = process.argv.slice(2);
const opt = (name, fallback) => (argv.includes(`--${name}`) ? argv[argv.indexOf(`--${name}`) + 1] : fallback);
const RUNS = Math.max(1, Math.min(50, Number(opt("runs", 5)) || 5));
const PROVIDER_MS = Math.max(0, Number(opt("provider-ms", 800)) || 0);

// ═══════════════════════════════════════════════
// العامل: يقيس نسخة واحدة
// ═══════════════════════════════════════════════
async function worker(root) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-cmp-"));
  process.env.TERBOO_LID_CACHE_PATH = path.join(tmp, "lid.json");
  process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
  const lib = (name) => pathToFileURL(path.join(root, "src/lib", name)).href;
  const log = console.log;
  console.log = () => {};
  const { initDatabase } = await import(lib("terboo-database.js"));
  const db = await initDatabase(tmp);
  const memory = await import(lib("terboo-ai-memory.js"));
  memory.initMemory(path.join(tmp, "memory"));
  const { loadPlugins } = await import(lib("terboo-plugins.js"));
  await loadPlugins(path.join(root, "plugins"));
  const core = await import(lib("terboo-ai-core.js"));
  console.log = log;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const sock = { user: { id: "2348093093240:12@s.whatsapp.net" }, async sendMessage() { return { key: { id: "s" } }; } };
  let modelCalls = 0;
  let reply = "تمام.";
  const ask = async (payload) => {
    modelCalls += 1;
    await sleep(PROVIDER_MS);
    if (payload?.purpose === "summary") return { text: "ملخص", provider: "Simulated" };
    return { text: JSON.stringify({ decision: "CHAT", reply, confidence: 0.9 }), provider: "Simulated", latencyMs: PROVIDER_MS };
  };
  const runTool = async () => { await sleep(1200); return { ok: true, via: "scraper", deliveries: [{ type: "video" }], attempts: [], latencyMs: 1200 }; };
  // إعدادات الإنتاج: لا rateLimit:false — المحدّد/المتحكم كما يعمل فعلاً
  const deps = { ask, runTool };

  let seq = 0;
  function message(sender, body) {
    const m = {
      key: { remoteJid: sender, fromMe: false, id: `CMP${++seq}` }, id: `CMP${seq}`, sender, chat: sender, isGroup: false, body,
      pushName: "bench", type: "conversation", isCommand: false, prefix: ".", isOwner: false, isPremium: false, isPartner: false,
      isAdmin: false, isBotAdmin: false, isBot: false, fromMe: false, isNewsletter: false, mentionedJid: [], quoted: null,
      sentAt: 0, firstOutputAt: 0, replies: [],
      async reply(text) { if (!m.firstOutputAt) m.firstOutputAt = performance.now(); m.replies.push(String(text)); return { key: { id: "r" } }; },
      async react(emoji) { if (!m.firstOutputAt) m.firstOutputAt = performance.now(); m.replies.push(`react:${emoji}`); },
    };
    return m;
  }
  async function send(m) {
    m.sentAt = performance.now();
    return core.runKernel(m, sock, db, deps).catch((error) => `error:${error?.message}`);
  }
  const ttfr = (m) => (m.firstOutputAt ? m.firstOutputAt - m.sentAt : null);

  const SCENARIOS = {
    // رسالة واحدة: النموذج ثم الرد
    "single chat message": async (user) => {
      reply = "أهلاً!";
      const m = message(user, "ازيك عامل ايه");
      await send(m);
      return { ttfr: ttfr(m), replies: m.replies.length, wasted: 0 };
    },
    // رسالتان متتاليتان بفارق 300ms: زمن الرد على الثانية
    "two quick messages (300 ms apart)": async (user) => {
      reply = "تمام، فهمت.";
      const first = message(user, "عايز اسألك عن حاجة");
      const p1 = send(first);
      await sleep(300);
      const second = message(user, "هي ايه افضل لغة برمجة للمبتدئين؟");
      const p2 = send(second);
      await Promise.all([p1, p2]);
      const answered = [first, second].filter((m) => m.replies.some((r) => !r.startsWith("react:")));
      return { ttfr: ttfr(second) ?? ttfr(first), replies: first.replies.length + second.replies.length, wasted: answered.length > 1 ? 1 : 0 };
    },
    // إلغاء أثناء التفكير: «لا خلاص» بعد 300ms — هل يصل الرد الملغى؟ ومتى يُؤكَّد الإلغاء؟
    "cancel while thinking": async (user) => {
      reply = "شرح طويل…";
      const ask1 = message(user, "اشرح لي النظرية النسبية بالتفصيل");
      const p1 = send(ask1);
      await sleep(300);
      const cancel = message(user, "لا خلاص");
      const p2 = send(cancel);
      await Promise.all([p1, p2]);
      return { ttfr: ttfr(cancel), replies: ask1.replies.length + cancel.replies.length, wasted: ask1.replies.some((r) => r.includes("شرح طويل")) ? 1 : 0 };
    },
    // رابط تيك توك: مسار حتمي بلا نموذج
    "TikTok link (deterministic tool)": async (user) => {
      const m = message(user, `حمل https://www.tiktok.com/@bench/video/7300000000000${String(seq).padStart(6, "0")}`);
      await send(m);
      return { ttfr: ttfr(m), replies: m.replies.length, wasted: 0 };
    },
  };

  const out = {};
  for (const [name, run] of Object.entries(SCENARIOS)) {
    const rows = [];
    for (let i = 0; i < RUNS; i += 1) {
      const before = modelCalls;
      const user = `2015${String(50000000 + Object.keys(out).length * 1000 + i).padStart(8, "0")}@s.whatsapp.net`;
      const t0 = performance.now();
      const row = await run(user);
      rows.push({ ...row, total: performance.now() - t0, modelCalls: modelCalls - before });
      await sleep(50);
    }
    const med = (key) => {
      const list = rows.map((r) => r[key]).filter(Number.isFinite).sort((a, b) => a - b);
      return list.length ? Math.round(list[Math.floor((list.length - 1) / 2)]) : null;
    };
    out[name] = { runs: rows.length, ttfrMs: med("ttfr"), totalMs: med("total"), modelCalls: med("modelCalls"), replies: med("replies"), wastedReplies: rows.reduce((s, r) => s + r.wasted, 0) };
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  process.stdout.write(`\n@@RESULT@@${JSON.stringify(out)}\n`);
  process.exit(0);
}

// ═══════════════════════════════════════════════
// المنسّق
// ═══════════════════════════════════════════════
function runWorker(root) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [path.resolve(process.argv[1]), "--worker", root, "--runs", String(RUNS), "--provider-ms", String(PROVIDER_MS)], { cwd: root, shell: false, timeout: 900_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
      const line = String(stdout).split("\n").find((l) => l.startsWith("@@RESULT@@"));
      if (!line) return reject(error || new Error(`no result from ${root}`));
      resolve(JSON.parse(line.slice("@@RESULT@@".length)));
    });
  });
}

if (argv.includes("--worker")) {
  await worker(path.resolve(opt("worker", ".")));
} else {
  const beforeRoot = path.resolve(opt("before", ""));
  const afterRoot = path.resolve(opt("after", "."));
  if (!fs.existsSync(path.join(beforeRoot, "src/lib/terboo-ai-core.js"))) {
    console.error("حدد --before <مجلد نسخة v4.0 الأصلية> (مع node_modules)");
    process.exit(2);
  }
  const before = await runWorker(beforeRoot);
  const after = await runWorker(afterRoot);
  const names = Object.keys(after);
  const fmt = (v) => (v === null || v === undefined ? "—" : String(v));
  const lines = [
    "# Terboo Benchmark — BEFORE (v4.0) vs AFTER (v5.0)",
    "",
    `- generated: ${new Date().toISOString()}`,
    `- runs per scenario: ${RUNS} (median shown) · simulated provider latency: ${PROVIDER_MS} ms · simulated scraper: 1200 ms`,
    "- production defaults in both versions (the per-user rate limiter / concurrency controller is ON, as in the real bot)",
    "- TTFR = time from the message arriving to the first visible output (reply or reaction) for the measured message",
    "",
    "| scenario | TTFR before | TTFR after | model calls before → after | replies before → after | wasted replies before → after |",
    "| --- | --- | --- | --- | --- | --- |",
    ...names.map((n) => `| ${n} | ${fmt(before[n]?.ttfrMs)} ms | ${fmt(after[n]?.ttfrMs)} ms | ${fmt(before[n]?.modelCalls)} → ${fmt(after[n]?.modelCalls)} | ${fmt(before[n]?.replies)} → ${fmt(after[n]?.replies)} | ${fmt(before[n]?.wastedReplies)} → ${fmt(after[n]?.wastedReplies)} |`),
  ];
  fs.mkdirSync(path.join(afterRoot, "tools/reports"), { recursive: true });
  fs.writeFileSync(path.join(afterRoot, "tools/reports/terboo-benchmark-compare.json"), `${JSON.stringify({ generatedAt: new Date().toISOString(), runs: RUNS, providerMs: PROVIDER_MS, before, after }, null, 2)}\n`);
  fs.writeFileSync(path.join(afterRoot, "tools/reports/terboo-benchmark-compare.md"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}
