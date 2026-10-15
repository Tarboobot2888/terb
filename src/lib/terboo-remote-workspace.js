// ═══════════════════════════════════════════════
// 🚀 Terboo Remote Workspace — نشر مشروع على مضيف SSH + وكيل إصلاح (§18 §19)
// ───────────────────────────────────────────────
//   zip من المالك ⇒ فحص محلي (zip-slip · حجم · عدد ملفات · نوع المشروع) ⇒ مساحة عمل معزولة جديدة على المضيف
//   ⇒ رفع الملفات عبر SFTP (لا unzip بعيد مطلوب) ⇒ بناء (npm ci/install · build) ⇒ اختبار (إن وُجد)
//   ⇒ تشغيل (pm2) ⇒ مراقبة (حالة العملية + آخر السجلات) — كل خطوة: رمز خروج حقيقي + نقطة استئناف.
//   فشل البناء ⇒ وكيل الإصلاح: آخر السجلات (منقّحة) ⇒ النموذج يقترح تعديلاً واحداً محدداً {file, find, replace}
//   ⇒ تحقق (الملف داخل المساحة · النص موجود حرفياً مرة واحدة) ⇒ فرق + خطورة ⇒ تأكيد المالك ⇒ نسخة احتياطية
//   ⇒ تطبيق ⇒ فحص صياغة ⇒ إعادة البناء ⇒ نجح: تأكيد · فشل: استرجاع النسخة تلقائياً. لا أوامر من النموذج أبداً.
// ═══════════════════════════════════════════════

import path from "node:path";
import AdmZip from "adm-zip";
import { noteFailure } from "./terboo-failure-log.js";
import { redactSecrets } from "./terboo-secrets.js";
import { exec, getHost, sftpRead, sftpWrite, withSession, workspaceOf } from "./terboo-ssh.js";
import { PRIORITY, enqueueTask, registerTaskRunner } from "./terboo-task-queue.js";

const LIMITS = Object.freeze({ zipBytes: 50 * 1024 * 1024, files: 2000, unpackedBytes: 150 * 1024 * 1024, logLines: 40 });
const SKIP = /(?:^|\/)(?:node_modules|\.git|__pycache__|\.venv|venv|dist|build)\//;
const SECRET_FILE = /(?:^|\/)(?:\.env(?:\..+)?|id_(?:rsa|ed25519|ecdsa)|.*\.pem|.*\.key|credentials\.json)$/i;
const TYPE = "project.deploy";
const fail = (code, extra = {}) => ({ ok: false, code, ...extra });

/** اسم آمن لمجلد/عملية */
function slugOf(name) {
  return String(name || "app").toLowerCase().replace(/\.zip$/i, "").replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "app";
}

/**
 * فحص zip محلياً (لا تنفيذ لأي شيء).
 * @returns {{ok:boolean, code?:string, files?:Array<{name:string, data:Buffer}>, type?:string, entry?:string, scripts?:Object, lockfile?:boolean, skipped?:Object}}
 */
function inspectZip(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return fail("empty");
  if (buffer.length > LIMITS.zipBytes) return fail("too-large");
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (error) {
    noteFailure("remote-workspace", error, { where: "terboo-remote-workspace:inspectZip", fallback: "reject" });
    return fail("bad-zip");
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (entries.length > LIMITS.files) return fail("too-many-files");
  const names = entries.map((e) => e.entryName.replace(/\\/g, "/"));
  // zip-slip على الأسماء الأصلية قبل أي تطبيع (وإلا يُعامَل «..» كمجلد جذر ويُزال)
  if (names.some((n) => n.startsWith("/") || n.split("/").includes("..") || /^[a-z]:/i.test(n))) return fail("unsafe-path");
  // مجلد جذر واحد يلف كل شيء (project/…) ⇒ يُزال
  const first = names[0]?.split("/")[0];
  const prefix = names.length && names.every((n) => n.startsWith(`${first}/`)) ? `${first}/` : "";
  const files = [];
  const skipped = { deps: 0, secrets: 0 };
  let total = 0;
  for (const entry of entries) {
    const rel = entry.entryName.replace(/\\/g, "/").slice(prefix.length);
    // zip-slip: مسار مطلق أو صاعد ⇒ رفض الأرشيف كله
    if (!rel || rel.startsWith("/") || rel.split("/").includes("..") || /^[a-z]:/i.test(rel)) return fail("unsafe-path");
    if (SKIP.test(`${rel}`) || SKIP.test(`${rel}/`)) { skipped.deps += 1; continue; }
    if (SECRET_FILE.test(rel)) { skipped.secrets += 1; continue; }
    const data = entry.getData();
    total += data.length;
    if (total > LIMITS.unpackedBytes) return fail("too-large");
    files.push({ name: rel, data });
  }
  if (!files.length) return fail("empty");
  const has = (name) => files.some((f) => f.name === name);
  let type = "unknown";
  let entry = "";
  let scripts = {};
  if (has("package.json")) {
    type = "node";
    try {
      const pkg = JSON.parse(files.find((f) => f.name === "package.json").data.toString("utf8"));
      scripts = pkg.scripts || {};
      entry = [pkg.main, "index.js", "main.js", "app.js", "server.js", "bot.js"].find((n) => n && has(n)) || "";
    } catch (error) {
      noteFailure("remote-workspace", error, { where: "terboo-remote-workspace:inspectZip", stage: "package.json" });
      return fail("bad-package-json");
    }
  } else if (has("requirements.txt") || files.some((f) => f.name.endsWith(".py"))) {
    type = "python";
    entry = ["main.py", "app.py", "bot.py"].find(has) || "";
  }
  return { ok: true, files, type, entry, scripts, lockfile: has("package-lock.json"), skipped };
}

/** آخر السطور (منقّحة) — لا تصل أسرار للنموذج ولا للمالك */
function tail(out) {
  return redactSecrets(`${out?.stdout || ""}\n${out?.stderr || ""}`).trim().split("\n").slice(-LIMITS.logLines).join("\n").slice(-4000);
}

/** خطوات البناء/التشغيل حسب النوع (argv ثابتة من الكود) */
function planFor(info, slug) {
  if (info.type === "node") {
    const steps = [{ id: "install", argv: info.lockfile ? ["npm", "ci", "--no-audit", "--no-fund"] : ["npm", "install", "--no-audit", "--no-fund"], timeoutMs: 15 * 60_000 }];
    if (info.scripts.build) steps.push({ id: "build", argv: ["npm", "run", "build"], timeoutMs: 15 * 60_000 });
    if (info.scripts.test && !/no test specified/.test(info.scripts.test)) steps.push({ id: "test", argv: ["npm", "test"], timeoutMs: 10 * 60_000, optional: true });
    if (info.entry) steps.push({ id: "check", argv: ["node", "--check", info.entry], timeoutMs: 60_000 });
    steps.push({ id: "run", argv: info.entry ? ["pm2", "start", info.entry, "--name", slug] : ["pm2", "start", "npm", "--name", slug, "--", "start"], timeoutMs: 60_000, run: true });
    return steps;
  }
  if (info.type === "python") {
    const steps = [];
    if (info.files.some((f) => f.name === "requirements.txt")) steps.push({ id: "install", argv: ["pip3", "install", "-r", "requirements.txt"], timeoutMs: 15 * 60_000 });
    if (info.entry) steps.push({ id: "check", argv: ["python3", "-m", "py_compile", info.entry], timeoutMs: 60_000 });
    if (info.entry) steps.push({ id: "run", argv: ["pm2", "start", info.entry, "--name", slug, "--interpreter", "python3"], timeoutMs: 60_000, run: true });
    return steps;
  }
  return [];
}

/**
 * منفّذ مهمة النشر. المدخلات بلا أسرار ولا محتوى الملفات (الملفات تُرفع قبل الإدراج في الطابور).
 * input: { hostId, dir, slug, steps:[{id, argv, timeoutMs, optional, run}] }
 */
async function runDeploy(ctx) {
  const { hostId, dir, steps = [] } = ctx.input || {};
  const done = new Set(ctx.checkpointData?.done || []);
  const results = [];
  for (const [index, step] of steps.entries()) {
    ctx.throwIfCancelled();
    if (done.has(step.id)) { results.push({ id: step.id, ok: true, code: "resumed-skip" }); continue; }
    ctx.progress(((index + 0.5) / steps.length) * 100, step.id);
    const out = await exec(hostId, step.argv, { cwd: dir, allowWrite: true, timeoutMs: step.timeoutMs, signal: ctx.signal });
    const row = { id: step.id, ok: out.ok, code: out.code, exitCode: out.exitCode ?? null, log: tail(out) };
    results.push(row);
    if (!out.ok && !step.optional) {
      ctx.artifact({ type: "log", step: step.id, exitCode: row.exitCode });
      // المهمة «فشلت» فعلاً (لا «اكتملت» بنتيجة سيئة) — التفاصيل مرفقة لوكيل الإصلاح
      throw Object.assign(new Error(["deploy-failed", step.id].join(":")), { code: "DEPLOY_FAILED", result: { ok: false, failedStep: step.id, results } });
    }
    done.add(step.id);
    ctx.checkpoint({ done: [...done] });
  }
  // مراقبة: حالة العملية فعلاً بعد التشغيل (لا «اشتغل» لمجرد أن pm2 قبل الأمر)
  const observed = await observe(hostId, ctx.input.slug);
  ctx.artifact({ type: "workspace", path: dir });
  if (!observed.ok) throw Object.assign(new Error(["deploy-failed", "observe"].join(":")), { code: "DEPLOY_FAILED", result: { ok: false, failedStep: "observe", results, observed } });
  return { ok: true, failedStep: null, results, observed, summary: [TYPE, "online"].join(":") };
}

/** حالة عملية pm2 + آخر سجلاتها */
async function observe(hostId, slug) {
  const list = await exec(hostId, ["pm2", "jlist"], { timeoutMs: 30_000 });
  if (!list.ok) return fail("pm2-unavailable", { log: tail(list) });
  let proc = null;
  try {
    proc = (JSON.parse(list.stdout.slice(list.stdout.indexOf("["))) || []).find((p) => p.name === slug) || null;
  } catch (error) {
    noteFailure("remote-workspace", error, { where: "terboo-remote-workspace:observe", stage: "jlist" });
  }
  const logs = await exec(hostId, ["pm2", "logs", slug, "--nostream", "--lines", "20"], { timeoutMs: 30_000 });
  if (!proc) return fail("not-running", { log: tail(logs) });
  const status = proc.pm2_env?.status || "unknown";
  return { ok: status === "online", code: status, restarts: proc.pm2_env?.restart_time ?? 0, log: tail(logs) };
}

/**
 * يبدأ النشر: فحص ⇒ مساحة جديدة ⇒ رفع ⇒ مهمة خلفية للبناء/التشغيل/المراقبة.
 * @param {{hostId:string, zip:Buffer, name:string, owner:string, scope:string, title?:string}} input
 * @returns {Promise<{ok:boolean, code?:string, id?:string, done?:Promise, dir?:string, info?:Object, uploaded?:number}>}
 */
async function startDeploy({ hostId, zip, name, owner, scope, title = "" }) {
  const host = getHost(hostId);
  if (!host) return fail("unknown-host");
  const info = inspectZip(zip);
  if (!info.ok) return info;
  const slug = slugOf(name);
  const steps = planFor(info, slug);
  if (!steps.length) return fail("unknown-project-type", { info: { type: info.type } });
  const dir = path.posix.join(workspaceOf(host), `${slug}-${Date.now().toString(36)}`);
  const uploaded = await withSession(host.id, async (client) => {
    for (const file of info.files) {
      const out = await sftpWrite(host.id, path.posix.join(dir, file.name), file.data, { client });
      if (!out.ok) return out;
    }
    return { ok: true, count: info.files.length };
  });
  if (!uploaded.ok) return uploaded;
  const task = enqueueTask({
    type: TYPE, title: title || slug, owner, scope, priority: PRIORITY.P5, run: runDeploy, persist: true, resumable: true,
    input: { hostId: host.id, dir, slug, steps },
  });
  return { ok: true, id: task.id, done: task.done, dir, slug, steps, info: { type: info.type, entry: info.entry, files: info.files.length, skipped: info.skipped }, uploaded: uploaded.count };
}

// ═══════════════════════════════════════════════
// وكيل الإصلاح (§19): اقتراح ⇒ تحقق ⇒ تأكيد ⇒ نسخة ⇒ تطبيق ⇒ فحص ⇒ إعادة ⇒ تحقق ⇒ استرجاع
// ═══════════════════════════════════════════════

const FIX_INSTRUCTION = [
  "You fix a failed build of a small project on a Linux server.",
  "You get the failing step and the last log lines. Propose ONE minimal text edit to ONE existing project file.",
  "Answer RAW JSON only: {\"file\":\"relative/path\",\"find\":\"exact existing text\",\"replace\":\"new text\",\"reason\":\"one short sentence\",\"risk\":\"low|medium|high\"}",
  "Never propose shell commands, never touch secrets (.env, keys), never invent files. If unsure, answer {\"file\":\"\"}.",
].join("\n");

function parseJson(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    noteFailure("remote-workspace", error, { where: "terboo-remote-workspace:parseJson", fallback: "no-fix" });
    return null;
  }
}

/** فرق موحّد مختصر للعرض */
function diffText(file, find, replace) {
  const minus = String(find).split("\n").map((l) => `- ${l}`).join("\n");
  const plus = String(replace).split("\n").map((l) => `+ ${l}`).join("\n");
  return `--- ${file}\n+++ ${file}\n${minus}\n${plus}`.slice(0, 1500);
}

/**
 * يطلب اقتراح إصلاح ويتحقق منه (بلا تطبيق).
 * @param {{hostId:string, dir:string, step:string, log:string, ask:Function}} input
 * @returns {Promise<{ok:boolean, code?:string, fix?:{file:string, find:string, replace:string, reason:string, risk:string}, diff?:string}>}
 */
async function proposeFix({ hostId, dir, step, log, ask }) {
  if (typeof ask !== "function") return fail("no-model");
  const answer = await ask({ message: `Failed step: ${step}\n\nLast log lines:\n${redactSecrets(log).slice(-3500)}`, instruction: FIX_INSTRUCTION, language: "en", history: [] }, { task: "code", primary: "Claude", fallbacks: ["DeepSeek", "GeminiAPI", "GPT"] })
    .catch((error) => {
      noteFailure("remote-workspace", error, { where: "terboo-remote-workspace:proposeFix", stage: "ask" });
      return null;
    });
  const fix = parseJson(answer?.text);
  if (!fix?.file) return fail("no-fix");
  const file = path.posix.normalize(String(fix.file)).replace(/^\/+/, "");
  if (file.startsWith("..") || SECRET_FILE.test(file) || SKIP.test(`${file}/`)) return fail("unsafe-file");
  if (typeof fix.find !== "string" || !fix.find || typeof fix.replace !== "string" || fix.find === fix.replace) return fail("invalid-fix");
  const current = await sftpRead(hostId, path.posix.join(dir, file));
  if (!current.ok) return fail("file-not-found");
  const text = current.data.toString("utf8");
  const count = text.split(fix.find).length - 1;
  // النص يجب أن يوجد حرفياً مرة واحدة: لا تعديل تخميني ولا استبدال متعدد غير مقصود
  if (count !== 1) return fail(count ? "ambiguous-fix" : "find-not-present");
  const risk = ["low", "medium", "high"].includes(fix.risk) ? fix.risk : "medium";
  return { ok: true, fix: { file, find: fix.find, replace: fix.replace, reason: String(fix.reason || "").slice(0, 200), risk }, diff: diffText(file, fix.find, fix.replace) };
}

/**
 * يطبّق إصلاحاً مؤكَّداً: نسخة ⇒ تطبيق ⇒ فحص صياغة ⇒ إعادة الخطوة الفاشلة ⇒ تحقق؛ فشل ⇒ استرجاع.
 * @returns {Promise<{ok:boolean, code:string, rolledBack?:boolean, log?:string, backup?:string}>}
 */
async function applyFix({ hostId, dir, fix, steps, failedStep, signal = null }) {
  const target = path.posix.join(dir, fix.file);
  const original = await sftpRead(hostId, target);
  if (!original.ok) return fail("file-not-found");
  const text = original.data.toString("utf8");
  if (text.split(fix.find).length - 1 !== 1) return fail("file-changed");
  const backup = path.posix.join(dir, ".terboo-backup", `${Date.now().toString(36)}`, fix.file);
  const saved = await sftpWrite(hostId, backup, original.data);
  if (!saved.ok) return fail("backup-failed");
  const wrote = await sftpWrite(hostId, target, text.replace(fix.find, () => fix.replace));
  if (!wrote.ok) return fail("write-failed");
  const restore = async (code, log = "") => {
    const back = await sftpWrite(hostId, target, original.data);
    return { ok: false, code, rolledBack: back.ok, log, backup };
  };
  if (/\.(?:c|m)?js$/.test(fix.file)) {
    const syntax = await exec(hostId, ["node", "--check", fix.file], { cwd: dir, timeoutMs: 60_000, signal });
    if (!syntax.ok) return restore("syntax-failed", tail(syntax));
  }
  if (/\.py$/.test(fix.file)) {
    const syntax = await exec(hostId, ["python3", "-m", "py_compile", fix.file], { cwd: dir, allowWrite: true, timeoutMs: 60_000, signal });
    if (!syntax.ok) return restore("syntax-failed", tail(syntax));
  }
  // إعادة الخطوة الفاشلة وما قبل التشغيل بعدها (التحقق الحقيقي = الخطوة تنجح الآن)
  const from = steps.findIndex((s) => s.id === failedStep);
  for (const step of steps.slice(Math.max(0, from)).filter((s) => !s.run)) {
    const out = await exec(hostId, step.argv, { cwd: dir, allowWrite: true, timeoutMs: step.timeoutMs, signal });
    if (!out.ok && !step.optional) return restore("still-failing", tail(out));
  }
  return { ok: true, code: "fixed", backup };
}

function installRemoteWorkspace() {
  registerTaskRunner(TYPE, runDeploy);
}

export { LIMITS, TYPE, applyFix, diffText, inspectZip, installRemoteWorkspace, observe, planFor, proposeFix, slugOf, startDeploy };
export default { startDeploy, inspectZip, proposeFix, applyFix, observe, installRemoteWorkspace };
