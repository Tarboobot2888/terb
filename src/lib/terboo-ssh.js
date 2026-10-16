// ═══════════════════════════════════════════════
// 🔐 Terboo SSH Manager — طبقة SSH للمالك (§17 §18 §29)
// ───────────────────────────────────────────────
// مضيفون مسجّلون فقط (لا IP|كلمة مرور في نص الرسائل أبداً):
//   · بيانات الدخول مشفّرة في الخزنة (AES-256-GCM، سياق ssh، مرتبطة بمعرّف المضيف) — أو مسار مفتاح على القرص
//     من config/البيئة (لا يُنسخ) · مفاتيح SSH مفضّلة على كلمات المرور.
//   · تثبيت بصمة المضيف: تُقرأ أثناء المصافحة قبل إرسال أي بيانات دخول، يؤكدها المالك، ثم تُثبَّت؛
//     أي اختلاف لاحق ⇒ رفض (احتمال اعتراض) بلا إرسال كلمة المرور/المفتاح.
//   · التنفيذ argv فقط عبر سياسة terboo-ssh-policy (قراءة/كتابة/مرفوض) — لا نص shell من الذكاء.
//   · «وصفات» ثابتة في الكود (سكربتات تثبيت معروفة) لأوامر المالك القديمة — ليست نصاً من الذكاء ولا من الرسالة.
//   · مهلة · إلغاء · حد مخرجات · تنقيح الأسرار من المخرجات · رمز خروج حقيقي (لا «نجاح» عند الإغلاق).
//   · SFTP داخل مساحة العمل فقط.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ssh2 from "ssh2";
import config from "../../config.js";
import { noteFailure } from "./terboo-failure-log.js";
import { registerSecret, redactSecrets } from "./terboo-secrets.js";
import { LEVEL, classify, commandLine, inside } from "./terboo-ssh-policy.js";
import { decryptSecret, encryptSecret } from "./terboo-vault.js";

const { Client } = ssh2;
const LIMITS = Object.freeze({ timeoutMs: 60_000, maxTimeoutMs: 30 * 60_000, maxOutput: 64 * 1024, readyTimeoutMs: 20_000, maxHosts: 50, maxFileBytes: 50 * 1024 * 1024 });
const ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const fail = (code, extra = {}) => ({ ok: false, code, ...extra });

// ═══════════════════════════════════════════════
// السجل
// ═══════════════════════════════════════════════

function storePath() {
  return process.env.TERBOO_SSH_STORE || path.join(process.cwd(), "database", "ssh-hosts.json");
}

let cache = null;
function load() {
  if (cache) return cache;
  cache = { hosts: {} };
  try {
    if (fs.existsSync(storePath())) cache = JSON.parse(fs.readFileSync(storePath(), "utf8")) || { hosts: {} };
  } catch (error) {
    noteFailure("ssh", error, { where: "terboo-ssh:load", fallback: "empty" });
  }
  cache.hosts ||= {};
  return cache;
}

function save() {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(cache, null, 1), { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}

/** مضيفون من config/البيئة (للقراءة فقط؛ المفتاح مسار على القرص) — البيئة تتغلب على config */
function configuredHosts() {
  let list = Array.isArray(config.ssh?.hosts) ? config.ssh.hosts : [];
  if (process.env.TERBOO_SSH_HOSTS) {
    try {
      list = JSON.parse(process.env.TERBOO_SSH_HOSTS);
    } catch (error) {
      noteFailure("ssh", error, { where: "terboo-ssh:configuredHosts", stage: "env", fallback: "config" });
    }
  }
  const out = {};
  for (const raw of list || []) {
    const id = String(raw?.id || raw?.name || "").toLowerCase();
    if (!ID.test(id) || !raw.host) continue;
    out[id] = { id, name: raw.name || id, host: String(raw.host), port: Number(raw.port) || 22, username: raw.username || "root", auth: "key-file", keyPath: raw.privateKeyPath || raw.keyPath || "", fingerprint: raw.fingerprint || "", workspace: raw.workspace || "", source: "config" };
  }
  return out;
}

function allHosts() {
  return { ...load().hosts, ...configuredHosts() };
}

/** عرض آمن لمضيف (بلا أي بيانات دخول) */
function view(host) {
  return { id: host.id, name: host.name, host: host.host, port: host.port, username: host.username, auth: host.auth, fingerprint: host.fingerprint || "", pinned: Boolean(host.fingerprint), workspace: workspaceOf(host), source: host.source || "store", addedAt: host.addedAt || null };
}

function listHosts() {
  return Object.values(allHosts()).map(view);
}

function getHost(ref) {
  const key = String(ref || "").toLowerCase();
  const hosts = allHosts();
  return hosts[key] || Object.values(hosts).find((h) => String(h.name).toLowerCase() === key) || null;
}

function workspaceOf(host) {
  if (host.workspace) return host.workspace.replace(/\/+$/, "");
  return host.username === "root" ? "/root/terboo-workspaces" : path.posix.join("/home", host.username, "terboo-workspaces");
}

function hostCount() {
  return Object.keys(allHosts()).length;
}
global.terbooSshHostCount = hostCount;

/**
 * تسجيل مضيف (سر مشفّر في الخزنة، بلا تثبيت بصمة بعد).
 * @param {{id:string, name?:string, host:string, port?:number, username?:string, auth:"key"|"password", secret:string, passphrase?:string, workspace?:string, addedBy?:string}} input
 */
function addHost({ id, name = "", host, port = 22, username = "root", auth, secret, passphrase = "", workspace = "", addedBy = "" }) {
  const key = String(id || "").toLowerCase();
  if (!ID.test(key)) return fail("invalid-id");
  if (!/^[a-z0-9.-]{1,253}$/i.test(String(host || "")) && !/^[0-9a-f:]{2,45}$/i.test(String(host || ""))) return fail("invalid-host");
  if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) return fail("invalid-port");
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(String(username || ""))) return fail("invalid-username");
  if (!["key", "password"].includes(auth) || !secret) return fail("missing-secret");
  if (auth === "key" && !/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(secret)) return fail("invalid-key");
  // مساحة العمل مجلد مخصص — لا جذر النظام ولا مجلدات النظام (كل كتابة عبر الذكاء محصورة فيه)
  const normalized = workspace ? path.posix.normalize(workspace).replace(/\/+$/, "") || "/" : "";
  if (workspace && (!workspace.startsWith("/") || /\.\./.test(workspace) || ["/", "/etc", "/usr", "/bin", "/sbin", "/lib", "/var", "/boot", "/root", "/home", "/opt", "/srv", "/tmp", "/dev", "/proc", "/sys"].includes(normalized))) return fail("invalid-workspace");
  const store = load();
  if (configuredHosts()[key]) return fail("exists");
  if (!store.hosts[key] && Object.keys(store.hosts).length >= LIMITS.maxHosts) return fail("too-many");
  registerSecret(secret);
  if (passphrase) registerSecret(passphrase);
  store.hosts[key] = {
    id: key, name: String(name || key).slice(0, 40), host: String(host), port: Number(port), username: String(username), auth,
    credential: encryptSecret(secret, { context: "ssh", aad: key }),
    passphrase: passphrase ? encryptSecret(passphrase, { context: "ssh", aad: `${key}:passphrase` }) : "",
    fingerprint: "", workspace: normalized, addedAt: Date.now(), addedBy: String(addedBy || ""),
  };
  save();
  return { ok: true, host: view(store.hosts[key]) };
}

function removeHost(ref) {
  const host = getHost(ref);
  if (!host) return fail("unknown-host");
  if (host.source === "config") return fail("configured-host");
  delete load().hosts[host.id];
  save();
  return { ok: true };
}

function pinHost(ref, fingerprint) {
  const host = getHost(ref);
  if (!host) return fail("unknown-host");
  if (!/^SHA256:[A-Za-z0-9+/]{43}$/.test(String(fingerprint || ""))) return fail("invalid-fingerprint");
  if (host.source === "config") return fail("configured-host");
  load().hosts[host.id].fingerprint = fingerprint;
  save();
  return { ok: true };
}

// ═══════════════════════════════════════════════
// الاتصال
// ═══════════════════════════════════════════════

/** بصمة OpenSSH: SHA256:<base64 بلا حشو> لمفتاح المضيف الخام */
function fingerprintOf(key) {
  return `SHA256:${crypto.createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

/** بيانات الدخول مفكوكة في الذاكرة فقط (تُسجَّل كسر للتنقيح) */
function credentials(host) {
  if (host.auth === "key-file") {
    if (!host.keyPath || !fs.existsSync(host.keyPath)) return null;
    const key = fs.readFileSync(host.keyPath, "utf8");
    registerSecret(key);
    return { privateKey: key };
  }
  const secret = decryptSecret(host.credential, { context: "ssh", aad: host.id });
  if (!secret) return null;
  registerSecret(secret);
  if (host.auth === "key") {
    const passphrase = host.passphrase ? decryptSecret(host.passphrase, { context: "ssh", aad: `${host.id}:passphrase` }) : "";
    if (passphrase) registerSecret(passphrase);
    return { privateKey: secret, ...(passphrase ? { passphrase } : {}) };
  }
  return { password: secret };
}

/**
 * بصمة المضيف كما يقدّمها الآن — قبل أي مصادقة (لا تُرسل بيانات دخول).
 * @returns {Promise<{ok:boolean, code?:string, fingerprint?:string, pinned?:string, matches?:boolean}>}
 */
function probeFingerprint(ref, { timeoutMs = LIMITS.readyTimeoutMs } = {}) {
  const host = getHost(ref);
  if (!host) return Promise.resolve(fail("unknown-host"));
  return new Promise((resolve) => {
    const client = new Client();
    let seen = "";
    const finish = (value) => {
      try { client.end(); } catch (error) { noteFailure("ssh", error, { where: "terboo-ssh:probe", stage: "end" }); }
      resolve(value);
    };
    client.on("error", (error) => {
      if (seen) return finish({ ok: true, fingerprint: seen, pinned: host.fingerprint || "", matches: host.fingerprint ? host.fingerprint === seen : null });
      finish(fail(networkCode(error)));
    });
    client.on("close", () => {
      if (seen) finish({ ok: true, fingerprint: seen, pinned: host.fingerprint || "", matches: host.fingerprint ? host.fingerprint === seen : null });
    });
    client.connect({
      host: host.host, port: host.port, username: host.username, readyTimeout: timeoutMs,
      // نقرأ البصمة ونرفض المتابعة: لا يصل أي سر للمضيف قبل تأكيد المالك
      hostVerifier: (key) => {
        seen = fingerprintOf(key);
        return false;
      },
    });
  });
}

function networkCode(error) {
  const text = `${error?.code || ""} ${error?.level || ""} ${error?.message || ""}`;
  if (/ENOTFOUND|EAI_AGAIN/.test(text)) return "dns";
  if (/ECONNREFUSED/.test(text)) return "refused";
  if (/ETIMEDOUT|Timed out|timeout/i.test(text)) return "timeout";
  if (/EHOSTUNREACH|ENETUNREACH/.test(text)) return "unreachable";
  if (/client-authentication|authentication/i.test(text)) return "auth-failed";
  if (/host key|verification/i.test(text)) return "fingerprint-mismatch";
  return "connect-failed";
}

/**
 * اتصال موثّق بمضيف مثبَّت البصمة.
 * @returns {Promise<{ok:boolean, code?:string, client?:import("ssh2").Client, host?:Object}>}
 */
function connect(ref, { timeoutMs = LIMITS.readyTimeoutMs } = {}) {
  const host = getHost(ref);
  if (!host) return Promise.resolve(fail("unknown-host"));
  if (!host.fingerprint) return Promise.resolve(fail("not-pinned"));
  const creds = credentials(host);
  if (!creds) return Promise.resolve(fail("credential-unavailable"));
  return new Promise((resolve) => {
    const client = new Client();
    let mismatch = false;
    let settled = false;
    const done = (value) => { if (!settled) { settled = true; resolve(value); } };
    client.on("ready", () => done({ ok: true, client, host }));
    client.on("error", (error) => {
      noteFailure("ssh", error, { where: "terboo-ssh:connect", stage: host.id, fallback: "report" });
      done(fail(mismatch ? "fingerprint-mismatch" : networkCode(error)));
    });
    client.connect({
      host: host.host, port: host.port, username: host.username, readyTimeout: timeoutMs, ...creds,
      hostVerifier: (key) => {
        const ok = fingerprintOf(key) === host.fingerprint;
        mismatch = !ok;
        return ok;
      },
    });
  });
}

/** يجمع مخرجات قناة مع حد وتنقيح */
function collector(max) {
  let size = 0;
  let truncated = false;
  const chunks = [];
  return {
    push(chunk) {
      if (size >= max) { truncated = true; return; }
      const piece = chunk.subarray(0, max - size);
      size += piece.length;
      if (piece.length < chunk.length) truncated = true;
      chunks.push(piece);
    },
    text() { return redactSecrets(Buffer.concat(chunks).toString("utf8")); },
    get truncated() { return truncated; },
  };
}

/** تشغيل سطر على قناة exec (السطر مبني من argv مقتبس أو وصفة ثابتة — لا نص خارجي) */
function runLine(client, line, { pty = false, answers = [], timeoutMs, signal, maxOutput = LIMITS.maxOutput } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    client.exec(line, { pty }, (error, stream) => {
      if (error) return resolve(fail("exec-failed", { durationMs: Date.now() - started }));
      const out = collector(maxOutput);
      const err = collector(maxOutput);
      let pending = answers.slice();
      let window = "";
      let finished = false;
      const stop = (code) => {
        if (finished) return;
        try { stream.signal?.("KILL"); } catch (e) { noteFailure("ssh", e, { where: "terboo-ssh:runLine", stage: "signal" }); }
        try { stream.close(); } catch (e) { noteFailure("ssh", e, { where: "terboo-ssh:runLine", stage: "close" }); }
        finish({ ok: false, code, exitCode: null });
      };
      const timer = setTimeout(() => stop("timeout"), Math.min(LIMITS.maxTimeoutMs, Math.max(1000, timeoutMs || LIMITS.timeoutMs)));
      const onAbort = () => stop("cancelled");
      signal?.addEventListener?.("abort", onAbort, { once: true });
      function finish(extra) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", onAbort);
        resolve({ ...extra, stdout: out.text(), stderr: err.text(), truncated: out.truncated || err.truncated, durationMs: Date.now() - started });
      }
      stream.on("data", (chunk) => {
        out.push(chunk);
        if (!pending.length) return;
        // إجابات مبرمجة لأسئلة سكربت ثابت معروف (وصفة) — حسب النص الظاهر فعلاً
        window = (window + chunk.toString("utf8")).slice(-4000);
        if (window.includes(pending[0].trigger)) {
          stream.write(`${pending[0].value}\n`);
          pending = pending.slice(1);
          window = "";
        }
      });
      stream.stderr?.on("data", (chunk) => err.push(chunk));
      stream.on("close", (exitCode, signalName) => {
        if (finished) return;
        const code = typeof exitCode === "number" ? exitCode : null;
        finish({ ok: code === 0, code: code === 0 ? "ok" : code === null ? (signalName ? "killed" : "no-exit-code") : "exit-nonzero", exitCode: code });
      });
    });
  });
}

/**
 * تنفيذ أمر argv على مضيف.
 * @param {string} ref
 * @param {string[]} argv
 * @param {{cwd?:string, timeoutMs?:number, signal?:AbortSignal, allowWrite?:boolean, maxOutput?:number, client?:Object}} [options]
 *   allowWrite: المستدعي أكّد إجراء الكتابة عبر محرّك الصلاحيات (ssh.write) — بدونه أوامر الكتابة مرفوضة
 * @returns {Promise<{ok:boolean, code:string, level?:string, reason?:string, exitCode?:number|null, stdout?:string, stderr?:string, truncated?:boolean, durationMs?:number}>}
 */
async function exec(ref, argv, { cwd = "", timeoutMs = LIMITS.timeoutMs, signal = null, allowWrite = false, maxOutput = LIMITS.maxOutput, client = null } = {}) {
  const host = getHost(ref);
  if (!host) return fail("unknown-host");
  const workspace = workspaceOf(host);
  if (cwd && !inside(workspace, cwd)) return fail("denied", { level: LEVEL.DENIED, reason: "cwd-outside-workspace" });
  const policy = classify(argv, { workspace, cwd: cwd || workspace });
  if (!policy.allowed) return fail("denied", { level: policy.level, reason: policy.reason });
  if (policy.level === LEVEL.WRITE && !allowWrite) return fail("needs-confirmation", { level: policy.level, reason: policy.reason });
  const session = client ? { ok: true, client } : await connect(host.id);
  if (!session.ok) return session;
  try {
    // الكتابة تُنفَّذ داخل مساحة العمل دائماً (npm/pip/node بلا cwd لا تعمل في مجلد المستخدم الرئيسي)
    const dir = cwd || (policy.level === LEVEL.WRITE ? workspace : "");
    const out = await runLine(session.client, commandLine(argv, { cwd: dir }), { timeoutMs, signal, maxOutput });
    return { ...out, level: policy.level, reason: policy.reason };
  } finally {
    if (!client) session.client.end();
  }
}

// ═══════════════════════════════════════════════
// الوصفات الثابتة (محرك عام لتشغيل خطوات سكربت مُعرّفة في الكود على خادم SSH)
// ═══════════════════════════════════════════════

const RECIPES = new Map();
/**
 * @param {string} id
 * @param {{title:string, steps:Array<{script:string, pty?:boolean, answers?:Array<{trigger:string, value:string}>, timeoutMs?:number}>}} recipe
 *   السكربتات نصوص ثابتة في الكود؛ القيم المتغيرة (روابط المالك) تُمرَّر كإجابات للأسئلة لا كجزء من السكربت.
 */
function registerRecipe(id, recipe) {
  if (!ID.test(id) || !recipe?.steps?.length) throw new Error(["invalid-recipe", id].join(":"));
  RECIPES.set(id, recipe);
}

/**
 * تشغيل وصفة (مالك + تأكيد مسبق من المستدعي). رمز الخروج لكل خطوة حقيقي؛ أول فشل يوقف ما بعده.
 * @returns {Promise<{ok:boolean, code:string, steps:Array<{ok:boolean, code:string, exitCode:number|null, tail:string}>}>}
 */
async function runRecipe(ref, recipeId, { answers = {}, signal = null } = {}) {
  const recipe = RECIPES.get(recipeId);
  if (!recipe) return fail("unknown-recipe");
  const session = await connect(ref);
  if (!session.ok) return session;
  const steps = [];
  try {
    for (const step of recipe.steps) {
      const stepAnswers = (step.answers || []).map((a) => ({ trigger: a.trigger, value: typeof a.value === "function" ? a.value(answers) : a.value }));
      const out = await runLine(session.client, step.script, { pty: Boolean(step.pty), answers: stepAnswers, timeoutMs: step.timeoutMs || 20 * 60_000, signal });
      const tail = `${out.stdout || ""}\n${out.stderr || ""}`.trim().split("\n").slice(-12).join("\n").slice(-1500);
      steps.push({ ok: out.ok, code: out.code, exitCode: out.exitCode ?? null, tail });
      if (!out.ok) return { ok: false, code: out.code, steps };
    }
    return { ok: true, code: "ok", steps };
  } finally {
    session.client.end();
  }
}

// ═══════════════════════════════════════════════
// SFTP داخل مساحة العمل
// ═══════════════════════════════════════════════

function sftpOf(client) {
  return new Promise((resolve, reject) => client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp))));
}

const promisify = (fn) => new Promise((resolve, reject) => fn((error, value) => (error ? reject(error) : resolve(value))));

async function mkdirp(sftp, dir) {
  const parts = dir.split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current += `/${part}`;
    try {
      await promisify((cb) => sftp.stat(current, cb));
    } catch {
      await promisify((cb) => sftp.mkdir(current, cb));
    }
  }
}

/**
 * يكتب ملفاً داخل مساحة عمل المضيف (ينشئ المجلدات).
 * @returns {Promise<{ok:boolean, code:string, path?:string, bytes?:number}>}
 */
async function sftpWrite(ref, remotePath, data, { client = null } = {}) {
  const host = getHost(ref);
  if (!host) return fail("unknown-host");
  const workspace = workspaceOf(host);
  const target = path.posix.normalize(remotePath);
  if (!target.startsWith("/") || !inside(workspace, target) || target === workspace) return fail("outside-workspace");
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
  if (buffer.length > LIMITS.maxFileBytes) return fail("too-large");
  const session = client ? { ok: true, client } : await connect(host.id);
  if (!session.ok) return session;
  try {
    const sftp = await sftpOf(session.client);
    await mkdirp(sftp, path.posix.dirname(target));
    await promisify((cb) => sftp.writeFile(target, buffer, cb));
    return { ok: true, code: "ok", path: target, bytes: buffer.length };
  } catch (error) {
    noteFailure("ssh", error, { where: "terboo-ssh:sftpWrite", fallback: "report" });
    return fail("sftp-failed");
  } finally {
    if (!client) session.client.end();
  }
}

/** يقرأ ملفاً داخل مساحة العمل (حد حجم، تنقيح أسرار للنصوص) */
async function sftpRead(ref, remotePath, { maxBytes = 512 * 1024, client = null } = {}) {
  const host = getHost(ref);
  if (!host) return fail("unknown-host");
  const workspace = workspaceOf(host);
  const target = path.posix.normalize(remotePath);
  if (!inside(workspace, target)) return fail("outside-workspace");
  const session = client ? { ok: true, client } : await connect(host.id);
  if (!session.ok) return session;
  try {
    const sftp = await sftpOf(session.client);
    const stat = await promisify((cb) => sftp.stat(target, cb));
    if (stat.size > maxBytes) return fail("too-large", { size: stat.size });
    const data = await promisify((cb) => sftp.readFile(target, cb));
    return { ok: true, code: "ok", data };
  } catch (error) {
    noteFailure("ssh", error, { where: "terboo-ssh:sftpRead", fallback: "report" });
    return fail("sftp-failed");
  } finally {
    if (!client) session.client.end();
  }
}

/** جلسة واحدة لعدة عمليات (خطوات خط النشر) */
async function withSession(ref, fn) {
  const session = await connect(ref);
  if (!session.ok) return session;
  try {
    return await fn(session.client, session.host);
  } finally {
    session.client.end();
  }
}

/** للاختبارات */
function _resetSsh() {
  cache = null;
}

export {
  LIMITS, RECIPES, _resetSsh, addHost, connect, exec, fingerprintOf, getHost, hostCount, listHosts, pinHost, probeFingerprint,
  registerRecipe, removeHost, runRecipe, sftpRead, sftpWrite, withSession, workspaceOf,
};
export default { listHosts, getHost, addHost, removeHost, pinHost, probeFingerprint, exec, runRecipe, registerRecipe, sftpWrite, sftpRead, withSession, hostCount };
