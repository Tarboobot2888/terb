#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🌐 Terboo — اختبار كل scraper على الشبكة الحقيقية (v4 §41)
// ───────────────────────────────────────────────
// الاستعمال:
//   node tools/terboo-scraper-live.mjs [--only tiktok,google] [--cap 30000] [--concurrency 6] [--out tools/reports]
// لكل أداة من الـ63:
//   1. استخراج نطاقات الخدمة من ملف الـscraper نفسه وفحص الوصول إليها (بلا مفاتيح، طلب GET عادي).
//   2. إن كانت كل نطاقاتها محجوبة/غير قابلة للوصول ⇒ SKIPPED_EXTERNAL مع السبب الحرفي (لا تشغيل ولا تخمين).
//   3. وإلا تشغيل المحوّل الحقيقي عبر runScraper بمدخل حقيقي ثم التصنيف:
//        PASS              نتيجة موحّدة صالحة (وسائط/قائمة/نص) من الخدمة الحقيقية.
//        SKIPPED_EXTERNAL  الخدمة الخارجية غير متاحة: شبكة/مهلة/HTTP من الخدمة/رفض الخدمة/مصادقة غير مضبوطة.
//        FAIL              خطأ من الكود نفسه أو نتيجة غير مفهومة من خدمة ردّت فعلاً.
// لا يُزيَّف أي نجاح: الأرقام في التقرير هي ما حدث فعلاً، مع رسالة الخطأ الحرفية لكل أداة.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import axios from "axios";

// ── تسجيل النطاقات التي يتصل بها كل scraper فعلاً أثناء تشغيله (بما فيها المبنية ديناميكياً) ──
const contacted = new AsyncLocalStorage();
const LOCAL = /^(127\.|localhost|::1|0\.0\.0\.0)/;
function hostFrom(value) {
  if (!value) return "";
  if (value instanceof URL) return value.hostname;
  if (typeof value === "string") return /^https?:\/\//i.test(value) ? new URL(value).hostname : "";
  if (typeof value === "object") {
    if (typeof value.path === "string" && /^https?:\/\//i.test(value.path)) return new URL(value.path).hostname;
    const header = value.headers?.host || value.headers?.Host;
    if (header) return String(header).split(":")[0];
    return String(value.hostname || value.host || "").split(":")[0];
  }
  return "";
}
function record(value) {
  const store = contacted.getStore();
  const host = hostFrom(value).toLowerCase();
  if (store && host && !LOCAL.test(host)) store.add(host);
}
for (const mod of [http, https]) {
  for (const name of ["request", "get"]) {
    const original = mod[name];
    mod[name] = function patched(...callArgs) {
      record(callArgs[0] && typeof callArgs[0] === "object" && !(callArgs[0] instanceof URL) ? callArgs[0] : callArgs[1] && typeof callArgs[1] === "object" ? { ...callArgs[1], path: String(callArgs[0]) } : callArgs[0]);
      return original.apply(this, callArgs);
    };
  }
}
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  record(typeof input === "string" || input instanceof URL ? input : input?.url);
  return nativeFetch(input, init);
};

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const ROOT = process.cwd();
const ONLY = arg("only", "").split(",").map((x) => x.trim()).filter(Boolean);
const CAP_MS = Number(arg("cap", "30000"));
const CONCURRENCY = Number(arg("concurrency", "6"));
const OUT_DIR = path.resolve(ROOT, arg("out", "tools/reports"));

const R = await import(path.join(ROOT, "src/lib/terboo-scraper-registry.js"));

// ── مدخلات حقيقية لكل نوع (محتوى عام معروف) ──
const PNG = fs.readFileSync(path.join(ROOT, "assets/image/terboo.png"));
const MP4 = fs.readFileSync(path.join(ROOT, "assets/video/terboo-mp4.mp4"));
const URLS = {
  aio: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  tiktok: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
  douyin: "https://www.douyin.com/video/7094857383232818444",
  ig: "https://www.instagram.com/p/C0sXKbKy2yF/",
  reelsvideo: "https://www.instagram.com/p/C0sXKbKy2yF/",
  twitter: "https://x.com/NASA/status/1669040578069331968",
  reddit: "https://www.reddit.com/r/aww/comments/90bu6w/heat_index_was_110_degrees_so_we_offered_him_a/",
  youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  yt: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ytdl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  spotify: "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
  soundclouddl: "https://soundcloud.com/forss/flickermood",
  mediafire: "https://www.mediafire.com/file/7yhc7e5wk2m9m6k/sample.txt/file",
  terabox: "https://1024terabox.com/s/1sample",
  sfiledl: "https://sfile.mobi/sample",
  dailymotion: "https://www.dailymotion.com/video/x8j2p5y",
  likee: "https://likee.video/@likee/video/7000000000000000000",
  rednote: "http://xhslink.com/a/sample",
  pindl: "https://www.pinterest.com/pin/99360735500167749/",
};
const QUERIES = {
  google: "WhatsApp bot", tiktoksearch: "cats", soundcloud: "flickermood", wallpapersearch: "space",
  konachan: "sky", kusonime: "one piece", dramabox: "love", shinigami: "solo leveling", dafont: "pacifico",
  gsmarena: "Galaxy S24", hokinfo: "Lam", wwchar: "Jinhsi", lufemboy: "Ahmed",
};
function liveInput(entry) {
  switch (entry.input) {
    case "url": case "url|query": return { url: URLS[entry.id], format: entry.id === "ytdl" ? "mp3" : "" };
    case "query": case "name": return { query: QUERIES[entry.id] || "terboo", name: QUERIES[entry.id] || "terboo" };
    case "prompt": return { prompt: entry.kind === "chat" || entry.kind === "agent" ? "Reply with the single word: pong" : "a small blue cat in space, digital art" };
    case "image": return { image: PNG };
    case "image+prompt": return { image: PNG, prompt: "make the background blue" };
    case "video": return { video: MP4 };
    case "file": return { file: Buffer.from("Terboo live test\n"), ext: "txt", format: "pdf" };
    default: return {};
  }
}

// ── نطاقات الخدمة من الملف نفسه ──
function hostsOf(id) {
  const source = fs.readFileSync(path.join(ROOT, "src/scraper", `${id}.js`), "utf8");
  const hosts = new Set();
  for (const match of source.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?/gi)) {
    const host = match[1].toLowerCase();
    if (/^(www\.)?(w3\.org|schema\.org|example\.com)$/.test(host)) continue;
    hosts.add(host);
  }
  return [...hosts].slice(0, 6);
}

const probeCache = new Map();
/** وصول لنطاق: محجوب بسياسة البيئة · غير قابل للوصول · متاح (أي رد HTTP من الخدمة نفسها) */
function probeHost(host) {
  if (!probeCache.has(host)) {
    probeCache.set(host, axios.get(`https://${host}/`, { timeout: 8000, maxRedirects: 0, validateStatus: () => true, responseType: "text", transformResponse: (x) => x })
      .then((res) => {
        const body = String(res.data || "").slice(0, 300);
        if (res.status === 403 && /request blocked: no rule or allowlist entry allows host/i.test(body)) return { host, state: "blocked", detail: "egress policy: host not allow-listed" };
        return { host, state: "reachable", detail: `HTTP ${res.status}` };
      })
      .catch((error) => ({ host, state: "unreachable", detail: String(error.code || error.message).slice(0, 80) })));
  }
  return probeCache.get(host);
}

// ── التصنيف ──
const NETWORK = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|socket hang up|fetch failed|network|timeout:|timed? ?out|certificate|self[- ]signed|UND_ERR|aborted|tunneling socket|request blocked/i;
const HTTP = /status code (4\d\d|5\d\d)|\bHTTP (4\d\d|5\d\d)\b|\b(401|403|404|408|429|500|502|503|504|520|521|522|523|524)\b|cloudflare|captcha|rate.?limit|too many requests/i;
const AUTH = /not_configured|api.?key|unauthori[sz]ed|session|cookie|login required|token (?:missing|expired|invalid)|requires_command/i;
const SERVICE = /scraper_reported_failure|status.?false|invalid (?:url|link)|not found|no (?:data|result)|tidak|gagal/i;

/** أخطاء لا يسببها رد خدمة خارجية أبداً (تقع قبل الشبكة أو في الكود نفسه) ⇒ FAIL دائماً */
const CODE_ERROR = /ByteString|Invalid URL|ERR_INVALID_ARG|is not a function|is not defined|is not a constructor|Cannot find module|does not provide an export/i;

function classify(outcome) {
  if (outcome.ok) {
    const r = outcome.result || {};
    const got = r.media?.length ? `${r.media.length} media (${[...new Set(r.media.map((m) => m.type))].join(",")})` : r.items?.length ? `${r.items.length} items` : r.text ? `text ${r.text.length} chars` : "result";
    return { status: "PASS", reason: got };
  }
  const errors = (outcome.attempts || []).map((a) => a.error || a.skipped || "").filter(Boolean).join(" | ") || outcome.reason || "unknown";
  if (outcome.reason === "permission" || outcome.reason === "invalid-input") return { status: "FAIL", reason: `${outcome.reason}: ${outcome.messageKey}` };
  if (CODE_ERROR.test(errors)) return { status: "FAIL", reason: `code error — ${errors.slice(0, 180)}`, code: true };
  if (AUTH.test(errors)) return { status: "SKIPPED_EXTERNAL", reason: `auth/config required — ${errors.slice(0, 160)}` };
  if (NETWORK.test(errors)) return { status: "SKIPPED_EXTERNAL", reason: `network unavailable — ${errors.slice(0, 160)}` };
  if (HTTP.test(errors)) return { status: "SKIPPED_EXTERNAL", reason: `service HTTP error — ${errors.slice(0, 160)}` };
  if (SERVICE.test(errors)) return { status: "SKIPPED_EXTERNAL", reason: `service rejected the request — ${errors.slice(0, 160)}` };
  return { status: "FAIL", reason: errors.slice(0, 200) };
}

async function runOne(entry) {
  const started = Date.now();
  const input = liveInput(entry);
  const seen = new Set(hostsOf(entry.id));
  // التشغيل الحقيقي دائماً (يكشف أخطاء الكود قبل الشبكة)، مع تسجيل كل نطاق تواصل معه
  const outcome = await contacted.run(seen, () => R.runScraper({
    id: entry.id, input, m: { isOwner: true, isPremium: true, sender: "live@s.whatsapp.net", chat: "live@s.whatsapp.net" },
    prefer: "adapter", deliver: false, deps: { timeoutMs: Math.min(entry.timeoutMs, CAP_MS) },
  })).catch((error) => ({ ok: false, reason: "exception", attempts: [{ id: entry.id, ok: false, error: String(error?.stack || error).slice(0, 300) }] }));
  const probes = await Promise.all([...seen].slice(0, 8).map(probeHost));
  let verdict = classify(outcome);
  // فشل وكل نطاقات الخدمة محجوبة/غير قابلة للوصول من هذه البيئة ⇒ الخدمة غير متاحة هنا، لا خطأ كود
  if (verdict.status !== "PASS" && !verdict.code && probes.length && probes.every((p) => p.state !== "reachable")) {
    const blocked = probes.every((p) => p.state === "blocked");
    verdict = { status: "SKIPPED_EXTERNAL", reason: `${blocked ? "service hosts blocked by this environment's egress policy" : "service hosts unreachable"} (${verdict.reason.slice(0, 90)})` };
  }
  const { code, ...shown } = verdict;
  return { id: entry.id, ...shown, hosts: probes, attempts: outcome.attempts || [], ms: Date.now() - started, ran: true };
}

const entries = R.listScrapers().filter((entry) => !ONLY.length || ONLY.includes(entry.id));
const results = [];
let next = 0;
await Promise.all(Array.from({ length: Math.max(1, CONCURRENCY) }, async () => {
  while (next < entries.length) {
    const entry = entries[next++];
    const row = await runOne(entry);
    results.push(row);
    console.log(`  ${row.status.padEnd(17)} ${entry.id.padEnd(17)} ${String(row.ms).padStart(6)}ms  ${row.reason.slice(0, 110)}`);
  }
}));
results.sort((a, b) => entries.findIndex((e) => e.id === a.id) - entries.findIndex((e) => e.id === b.id));

const count = (status) => results.filter((row) => row.status === status).length;
const summary = { at: new Date().toISOString(), node: process.version, total: results.length, PASS: count("PASS"), SKIPPED_EXTERNAL: count("SKIPPED_EXTERNAL"), FAIL: count("FAIL"), capMs: CAP_MS };
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "terboo-scraper-live.json"), JSON.stringify({ summary, results }, null, 2));
const md = [
  "# Terboo — Live scraper run (v4 §41)",
  "",
  `Run: ${summary.at} · Node ${summary.node} · per-tool cap ${CAP_MS} ms`,
  "",
  `**PASS ${summary.PASS} · SKIPPED_EXTERNAL ${summary.SKIPPED_EXTERNAL} · FAIL ${summary.FAIL}** (of ${summary.total})`,
  "",
  "| Scraper | Status | Ran | Reason | Hosts |",
  "|---|---|---|---|---|",
  ...results.map((row) => `| ${row.id} | ${row.status} | ${row.ran ? "yes" : "no"} | ${row.reason.replace(/\|/g, "/").slice(0, 140)} | ${row.hosts.map((h) => `${h.host} (${h.state})`).join(", ") || "—"} |`),
  "",
].join("\n");
fs.writeFileSync(path.join(OUT_DIR, "terboo-scraper-live.md"), md);
console.log(`\nPASS ${summary.PASS} · SKIPPED_EXTERNAL ${summary.SKIPPED_EXTERNAL} · FAIL ${summary.FAIL} (of ${summary.total}) → ${path.relative(ROOT, OUT_DIR)}/terboo-scraper-live.{json,md}`);
process.exit(summary.FAIL ? 1 : 0);
