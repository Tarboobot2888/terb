#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🩺 تقرير صحة كل البلوقنات (C)
// ───────────────────────────────────────────────
//   node tools/terboo-plugin-health.mjs [--since <commit>]
// لكل ملف في plugins/: الحالة healthy · fixed · deprecated · blocked-by-external-provider مع السبب والدليل،
// وأعلام للمراجعة (لا تغيّر الحالة وحدها): ssh2/كلمة مرور في الرسالة · eval · واجهة تفاعلية مباشرة
// · صلاحيات داخلية بدل بيانات الأمر · مزوّد بطيء/لا يصل جزئياً.
// المصدر: docs/inventory/after + docs/terboo-api-health-matrix.json + git diff منذ خط الأساس.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : "36c488d";
const plugins = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/inventory/after/plugins.json"), "utf8"));
const before = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/inventory/before/plugins.json"), "utf8"));
const health = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/terboo-api-health-matrix.json"), "utf8"));
const statusOf = new Map(health.providers.map((p) => [p.provider, p]));
const changed = new Set(execFileSync("git", ["-c", "core.quotepath=false", "diff", "--name-only", "-z", since, "--", "plugins"], { cwd: ROOT }).toString().split("\0").filter(Boolean));
const beforeByPath = new Map(before.map((p) => [p.path, p]));

/** سبب التعديل من مقارنة قبل/بعد */
function fixReason(p) {
  const b = beforeByPath.get(p.path);
  const reasons = [];
  if (b && b.name !== p.name) reasons.push(`renamed «${b.name}» → «${p.name}» (was shadowed by another plugin with the same name)`);
  if (b && !b.registered && p.registered) reasons.push("was unreachable (name collision) — now registered");
  const dropped = b ? b.aliases.filter((a) => !p.aliases.includes(a)) : [];
  if (dropped.length) reasons.push(`removed shadowed/dead aliases: ${dropped.join(", ")}`);
  const removedHosts = b ? b.externalApis.filter((h) => !p.externalApis.includes(h)) : [];
  if (removedHosts.length) reasons.push(`dead provider replaced by registry adapter: ${removedHosts.join(", ")}`);
  return reasons.length ? reasons : ["code fix (see git diff)"];
}

/** كلمة مرور SSH في نص الرسالة: البلوقن نفسه يفتح ssh2 ويقرأ «IP|كلمة مرور» من وسائط الأمر (فحص من الكود لا قائمة ثابتة) */
function sshPasswordInChat(p) {
  if (!p.processExecution.ssh2) return false;
  const text = fs.readFileSync(path.join(ROOT, p.path), "utf8");
  return /password\s*:/.test(text) && /split\(\s*['"]\|['"]\s*\)/.test(text);
}

const rows = plugins.map((p) => {
  const hosts = p.externalApis.map((h) => statusOf.get(h)).filter(Boolean);
  const unreachable = hosts.filter((h) => h.status === "UNREACHABLE_EXTERNAL");
  const flags = [];
  if (sshPasswordInChat(p) || (p.processExecution.ssh2 && /كلمة_المرور|password/i.test(p.usage))) flags.push("ssh-password-in-chat");
  if (p.processExecution.eval) flags.push("eval (owner-only)");
  if (p.interactiveUi.direct > 0 && !p.interactiveUi.centralLayer) flags.push("direct-interactive-ui");
  if (["panel", "vps", "linode", "digitalocean"].includes(p.category) && !p.permissions?.owner) flags.push("internal-role-check (metadata says public)");
  if (unreachable.length && unreachable.length < hosts.length) flags.push(`partial-provider-outage: ${unreachable.map((h) => `${h.provider}(${h.reason})`).join(", ")}`);
  let status = "healthy";
  let evidence = "loads, registered, unique name/aliases, permissions declared";
  let reason = null;
  if (!p.registered && p.notRegisteredReason === "disabled") {
    status = "deprecated";
    const text = fs.readFileSync(path.join(ROOT, p.path), "utf8");
    reason = (text.match(/⛔ معطّل \(V6 audit\): ([^\n]+)/) || [])[1] || "disabled";
    evidence = "isEnabled:false; not in registry or menus";
  } else if (!p.registered) {
    status = "broken";
    reason = p.notRegisteredReason;
  } else if (hosts.length && unreachable.length === hosts.length) {
    status = "blocked-by-external-provider";
    reason = unreachable.map((h) => `${h.provider}: ${h.reason}`).join("; ");
    evidence = `api health probe ${health.summary.checkedAt}`;
  } else if (changed.has(p.path)) {
    status = "fixed";
    reason = fixReason(p).join("; ");
    evidence = "inventory before/after + syntax + test suite";
  }
  return { path: p.path, command: p.name, category: p.category, status, reason, evidence, flags, externalProviders: p.externalApis.length };
});

const count = (s) => rows.filter((r) => r.status === s).length;
const summary = {
  generatedAt: new Date().toISOString(),
  baseline: since,
  plugins: rows.length,
  healthy: count("healthy"),
  fixed: count("fixed"),
  deprecated: count("deprecated"),
  blockedByExternalProvider: count("blocked-by-external-provider"),
  broken: count("broken"),
  flags: Object.fromEntries(["ssh-password-in-chat", "eval (owner-only)", "direct-interactive-ui", "internal-role-check (metadata says public)"].map((f) => [f, rows.filter((r) => r.flags.includes(f)).length])),
  partialProviderOutage: rows.filter((r) => r.flags.some((f) => f.startsWith("partial-provider-outage"))).length,
  note: "healthy = static + load + registry evidence; external endpoints are not called with keys here (see API health matrix: host reachability only).",
};
fs.writeFileSync(path.join(ROOT, "docs", "terboo-plugin-health.json"), `${JSON.stringify({ summary, plugins: rows }, null, 2)}\n`);
console.log(`✅ plugin health: ${JSON.stringify(summary)}`);
process.exit(0);
