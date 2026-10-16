#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🩺 Terboo API Health Matrix
// ───────────────────────────────────────────────
//   node tools/terboo-api-health.mjs [--inventory docs/inventory/after] [--offline]
// لكل مزوّد خارجي من الجرد: النطاق · المسارات · البلوقنات · المصادقة · سياسة المهلة/الإعادة · حالة الوصول الفعلية
// · آخر تحقق · البديل (سجل الـscrapers) · نمط الفشل.
// الفحص هنا وصول للنطاق فقط (طلب HEAD/GET لجذر النطاق بلا مفاتيح ولا بيانات مستخدم)، لذلك:
//   REACHABLE ≠ «الواجهة تعمل»؛ endpointVerified=false ما لم يوجد اختبار حيّ للمسار نفسه.
//   ما لا يمكن الوصول إليه من هذه البيئة (منافذ غير 443 · نطاقات أمثلة/قوالب) ⇒ SKIPPED_EXTERNAL بسببه، لا PASS.
// المخرجات: docs/terboo-api-health-matrix.json + docs/terboo-api-health-matrix.md
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { httpRequest } from "../src/lib/terboo-http-client.js";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const INV = path.join(ROOT, args.includes("--inventory") ? args[args.indexOf("--inventory") + 1] : "docs/inventory/after");
const offline = args.includes("--offline");
const apis = JSON.parse(fs.readFileSync(path.join(INV, "apis.json"), "utf8"));
const plugins = JSON.parse(fs.readFileSync(path.join(INV, "plugins.json"), "utf8"));
const { listScrapers } = await import("../src/lib/terboo-scraper-registry.js");
const scrapers = listScrapers();

const PLACEHOLDER = /(?:\$\{|\{\d+\}|^\.+$|example\.|xxx|your[-_]?(?:domain|host)|domain\.com|^\$|localhost|127\.0\.0\.1|0\.0\.0\.0)/i;
const textOf = new Map();
const read = (file) => {
  if (!textOf.has(file)) textOf.set(file, fs.existsSync(path.join(ROOT, file)) ? fs.readFileSync(path.join(ROOT, file), "utf8") : "");
  return textOf.get(file);
};

/** مصادقة من الكود المحيط بالنطاق (بلا قيم): مفتاح من config · رأس Authorization · بلا */
function authOf(files, host) {
  let auth = "none-detected";
  for (const file of files) {
    const text = read(file);
    const near = text.split("\n").filter((line) => line.includes(host)).join("\n");
    if (/config\??\.APIkey|apikey|api_key|apiKey|token=|key=/i.test(near)) return "api-key";
    if (/authorization|bearer/i.test(text)) auth = "header-token";
  }
  return auth;
}

function timeoutPolicy(files) {
  const explicit = files.filter((file) => /timeout\s*:/.test(read(file))).length;
  return explicit ? `explicit in ${explicit}/${files.length} files; others: axios layer 120s idle` : "axios layer 120s idle (no explicit timeout)";
}

async function probe(host) {
  if (PLACEHOLDER.test(host)) return { status: "SKIPPED_EXTERNAL", reason: "placeholder/template host" };
  if (/:\d+$/.test(host) && !/:443$/.test(host)) return { status: "SKIPPED_EXTERNAL", reason: "non-443 port not reachable from the test environment proxy" };
  if (offline) return { status: "SKIPPED_EXTERNAL", reason: "offline run" };
  const started = Date.now();
  let r = await httpRequest({ url: `https://${host}/`, method: "HEAD", timeoutMs: 8000, retries: 0, responseType: "buffer", maxBytes: 64 * 1024, okStatus: () => true });
  if (!r.ok && r.error?.code !== "TIMEOUT") r = await httpRequest({ url: `https://${host}/`, method: "GET", timeoutMs: 8000, retries: 0, responseType: "buffer", maxBytes: 256 * 1024, okStatus: () => true });
  const ms = Date.now() - started;
  if (r.ok) return { status: "REACHABLE", httpStatus: r.status, ms };
  const code = r.error?.code || "NETWORK";
  const reason = /ENOTFOUND|EAI_AGAIN/.test(code) ? "dns" : code === "TIMEOUT" ? "timeout" : /CERT|SSL|TLS/i.test(code + (r.error?.message || "")) ? "tls" : /ECONNREFUSED/.test(code) ? "refused" : code.toLowerCase();
  return { status: "UNREACHABLE_EXTERNAL", reason, ms };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

const checkedAt = new Date().toISOString();
const rows = await pool(apis, 12, async (api) => {
  const result = await probe(api.host);
  const pluginFiles = api.files.filter((f) => f.startsWith("plugins/"));
  const scraperIds = scrapers.filter((s) => api.files.some((f) => f === `src/scraper/${s.id}.js` || f.endsWith(`/${s.id}.js`))).map((s) => s.id);
  const fallback = [...new Set(scrapers.filter((s) => scraperIds.includes(s.id)).flatMap((s) => s.fallbacks || []))];
  return {
    provider: api.host,
    endpoints: api.paths,
    plugins: pluginFiles,
    otherFiles: api.files.filter((f) => !f.startsWith("plugins/")),
    authentication: authOf(api.files, api.host),
    timeout: timeoutPolicy(api.files),
    retryPolicy: scraperIds.length ? "scraper registry: per-tool retries + circuit breaker + healthy fallback" : "reads via terboo-http-client retry; direct axios: none (no write retries anywhere)",
    statusCodeHandling: "per plugin (non-2xx ⇒ error reply); axios layer redacts keys in errors",
    responseSchema: scraperIds.length ? "normalized by scraper registry (normalizeResult)" : "plugin-specific, unverified",
    lastVerification: checkedAt,
    verification: result.status === "REACHABLE" ? "host-reachability-only" : result.status,
    endpointVerified: false,
    status: result.status,
    httpStatus: result.httpStatus ?? null,
    reason: result.reason || null,
    latencyMs: result.ms ?? null,
    scrapers: scraperIds,
    fallback,
    rateLimits: "not published/unknown; scraper registry backs off via circuit breaker",
    failureMode: result.status === "REACHABLE" ? "endpoint errors surface as plugin error replies" : `host ${result.reason}: dependent commands fail with an honest error`,
    replacement: null,
  };
});

const summary = {
  checkedAt,
  providers: rows.length,
  reachable: rows.filter((r) => r.status === "REACHABLE").length,
  unreachable: rows.filter((r) => r.status === "UNREACHABLE_EXTERNAL").length,
  skipped: rows.filter((r) => r.status === "SKIPPED_EXTERNAL").length,
  endpointVerified: rows.filter((r) => r.endpointVerified).length,
  pluginsDependingOnlyOnUnreachable: plugins.filter((p) => p.registered && p.externalApis.length && p.externalApis.every((h) => rows.find((r) => r.provider === h)?.status === "UNREACHABLE_EXTERNAL")).map((p) => p.path),
};
fs.writeFileSync(path.join(ROOT, "docs", "terboo-api-health-matrix.json"), `${JSON.stringify({ summary, providers: rows }, null, 2)}\n`);
const md = [
  "# Terboo API Health Matrix",
  "",
  `> فحص وصول للنطاق فقط بتاريخ ${checkedAt} (بلا مفاتيح ولا بيانات). REACHABLE لا يعني أن الواجهة نفسها تعمل؛ لا يوجد هنا أي PASS لمسار لم يُختبر.`,
  "",
  `| الإجمالي | يصل | لا يصل | متخطى (SKIPPED_EXTERNAL) | مسارات مُتحقق منها |`,
  `| --- | --- | --- | --- | --- |`,
  `| ${summary.providers} | ${summary.reachable} | ${summary.unreachable} | ${summary.skipped} | ${summary.endpointVerified} |`,
  "",
  "## مزوّدون لا يصلون من هذه البيئة",
  "",
  "| المزوّد | السبب | البلوقنات |",
  "| --- | --- | --- |",
  ...rows.filter((r) => r.status !== "REACHABLE").map((r) => `| \`${r.provider}\` | ${r.status} · ${r.reason} | ${r.plugins.length} |`),
  "",
  `## بلوقنات تعتمد فقط على مزوّدين لا يصلون (${summary.pluginsDependingOnlyOnUnreachable.length})`,
  "",
  ...summary.pluginsDependingOnlyOnUnreachable.map((p) => `- \`${p}\``),
  "",
].join("\n");
fs.writeFileSync(path.join(ROOT, "docs", "terboo-api-health-matrix.md"), md);
console.log(`✅ API health: ${summary.providers} providers · reachable ${summary.reachable} · unreachable ${summary.unreachable} · skipped ${summary.skipped} · endpoint-verified ${summary.endpointVerified} · plugins only on unreachable ${summary.pluginsDependingOnlyOnUnreachable.length}`);
process.exit(0);
