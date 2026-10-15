// ═══════════════════════════════════════════════
// 🖥️ Terboo SSH Agent — واجهة المالك لطبقة SSH (أمر .ssh + الكلام الطبيعي + أدوات النموذج)
// ───────────────────────────────────────────────
//   .ssh                         خوادمي (بلا أي بيانات دخول)
//   .ssh add <id> user@host[:port] [workspace]   (في الخاص فقط) ⇒ السر في رسالة مستقلة تُحذف فوراً ⇒ مشفّر
//                                ⇒ بصمة المضيف قبل أي مصادقة ⇒ زر «تثبيت البصمة»
//   .ssh pin <id> · .ssh test <id> · .ssh run <id> <أمر> · .ssh rm <id>
//   .ssh deploy <id> (مع/رد على zip) ⇒ خطة ⇒ تأكيد ⇒ مهمة نشر ⇒ تقرير ⇒ «اقترح إصلاح» عند الفشل
// الكلام: «حالة سيرفر lab» · «المساحة على lab» · «ارفع المشروع ده على lab وشغله» (مع zip) — أوامر ثابتة من الكود.
// كل إجراء: مالك فقط (محرّك الصلاحيات) · الكتابة/النشر/الحذف بتأكيد · لا نص shell من النموذج أبداً.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import { consumeActionToken, createActionToken, endInput, registerFlow, startInput } from "./terboo-flow.js";
import { stepOf } from "./terboo-latency.js";
import { t } from "./terboo-localization.js";
import { DECISION, decide, principalOf } from "./terboo-permissions.js";
import * as RW from "./terboo-remote-workspace.js";
import * as S from "./terboo-ssh.js";
import { classify, splitArgs } from "./terboo-ssh-policy.js";
import { taskOwner } from "./terboo-task-control.js";
import { sendCard } from "./terboo-ui-kit.js";
import * as UI from "./terboo-ui-theme.js";

const CMD = "ssh";
const cmd = (m, ...parts) => `${m.prefix || "."}${CMD} ${parts.filter(Boolean).join(" ")}`.trim();
/** بديل للاختبارات؛ وإلا نداء النواة المعتمد (kernelAsk) — لا استيراد للمزوّدات هنا */
let askModel = null;

function known(text) {
  return /^[a-z]+\.[\w-]+$/.test(text) ? null : text;
}
/** سبب تقني ⇒ نص مفهوم (أسباب السياسة: «مرفوض: <السبب>») */
function reason(lang, code, detail = "") {
  const base = known(t(lang, `ssh.code_${code}`)) || t(lang, "ssh.code_unknown");
  return detail ? `${base} (${detail})` : base;
}

async function card(m, sock, lang, { title = "", icon = "🖥️", blocks = [], buttons = [] }) {
  const sent = await sendCard(sock, m, { cardId: "ssh", lang, title, icon, blocks: blocks.filter(Boolean), buttons }).catch((error) => {
    noteFailure("ssh-agent", error, { where: "terboo-ssh-agent:card", fallback: "text" });
    return null;
  });
  if (!sent) await m.reply(UI.card({ title, icon, blocks: blocks.filter(Boolean), lang })).catch((error) => noteFailure("ssh-agent", error, { where: "terboo-ssh-agent:card", stage: "reply" }));
  return "answered";
}

/** قرار مركزي (مالك/مزوّد/تأكيد). ⇒ القرار أو null بعد الرد بالرفض */
async function gate(m, sock, lang, action, extra = {}) {
  const principal = await principalOf({ m, sock });
  const decision = decide({ principal, action, ...extra });
  stepOf(m, "permission", `${action}:${decision.decision}`);
  if (decision.allowed || decision.decision === DECISION.NEEDS_CONFIRMATION) return decision;
  // لا مضيف مسجّل بعد: المالك يحتاج «أضف خادماً» لا «غير متاح»
  if (decision.decision === DECISION.PROVIDER_NOT_AVAILABLE && principal.isOwner) {
    await card(m, sock, lang, { title: t(lang, "ssh.title"), blocks: [t(lang, "ssh.none"), t(lang, "ssh.usage", { p: m.prefix || "." })] });
    return null;
  }
  await m.reply(t(lang, decision.reason === "owner-only" ? "act.perm_owner-only" : "act.permDenied")).catch((error) => noteFailure("ssh-agent", error, { where: "terboo-ssh-agent:gate" }));
  return null;
}

/** زر تأكيد برمز لمرة واحدة (الضغط = أمر .ssh ok <رمز>) */
function confirmButtons(m, lang, payload, key = "ssh.btnConfirm") {
  const token = createActionToken({ user: m.sender, action: "ssh", payload, ttlMs: 10 * 60_000 });
  return [{ id: cmd(m, "ok", token), text: `✅ ${t(lang, key)}` }, { id: cmd(m, "no"), text: `✖️ ${t(lang, "act.btnNo")}` }];
}

// ═══════════════════════════════════════════════
// الأوامر
// ═══════════════════════════════════════════════

async function listHosts(m, sock, lang) {
  const hosts = S.listHosts();
  return card(m, sock, lang, {
    title: t(lang, "ssh.title"),
    blocks: [
      hosts.length ? hosts.map((h) => UI.bullet(t(lang, "ssh.hostLine", { id: h.id, user: h.username, host: h.host, port: h.port, pin: t(lang, h.pinned ? "ssh.pinned" : "ssh.notPinned") }), lang)).join("\n") : t(lang, "ssh.none"),
      t(lang, "ssh.usage", { p: m.prefix || "." }),
    ],
  });
}

const TARGET = /^([a-z_][a-z0-9_-]{0,31})@([a-z0-9.-]{1,253}|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/i;

async function startAdd(m, sock, lang, [id, target, workspace = ""]) {
  if (m.isGroup) return m.reply(t(lang, "ssh.privateOnly"));
  const hit = String(target || "").match(TARGET);
  if (!id || !hit) return m.reply(t(lang, "ssh.addUsage", { p: m.prefix || "." }));
  startInput({ user: m.sender, chat: m.chat, flow: "ssh.add", step: "secret", data: { id: id.toLowerCase(), username: hit[1], host: hit[2].replace(/^\[|\]$/g, ""), port: Number(hit[3] || 22), workspace, lang }, secret: true, ttlMs: 5 * 60_000 });
  return m.reply(t(lang, "ssh.askSecret"));
}

registerFlow("ssh.add", {
  async onInput(m, { sock }, state) {
    endInput(m.sender, m.chat);
    const lang = state.data.lang || "ar";
    const secret = String(m.body || "").trim();
    const auth = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(secret) ? "key" : "password";
    const principal = await principalOf({ m, sock });
    if (!principal.isOwner) return m.reply(t(lang, "act.perm_owner-only"));
    const { lang: ignored, ...data } = state.data;
    const added = S.addHost({ ...data, auth, secret, addedBy: principal.canonical });
    if (!added.ok) return m.reply(t(lang, "ssh.addFailed", { reason: reason(lang, added.code) }));
    return offerPin(m, sock, lang, added.host.id, "ssh.added");
  },
  async onCancel(m, ctx, state) {
    return m.reply(t(state?.data?.lang || "ar", "act.cancelled"));
  },
});

/** البصمة الحالية قبل أي مصادقة + زر التثبيت */
async function offerPin(m, sock, lang, hostId, titleKey = "ssh.pinTitle") {
  const probe = await S.probeFingerprint(hostId);
  if (!probe.ok) return m.reply(t(lang, "ssh.probeFailed", { reason: reason(lang, probe.code) }));
  const blocks = [UI.quote(probe.fingerprint, lang), t(lang, "ssh.compareFingerprint")];
  if (probe.matches === false) blocks.unshift(t(lang, "ssh.mismatch"));
  if (probe.matches === true) return card(m, sock, lang, { title: t(lang, "ssh.alreadyPinned", { id: hostId }), icon: "🔒", blocks });
  return card(m, sock, lang, { title: t(lang, titleKey, { id: hostId }), icon: "🔑", blocks, buttons: confirmButtons(m, lang, { type: "pin", hostId, fingerprint: probe.fingerprint }, "ssh.btnPin") });
}

function outputBlocks(lang, out) {
  const text = [out.stdout, out.stderr].filter((x) => x && x.trim()).join("\n").trim().slice(-2500);
  return [t(lang, "ssh.output", { code: out.exitCode ?? "—" }), text ? `\`\`\`\n${text}\n\`\`\`` : t(lang, "ssh.noOutput"), out.truncated ? t(lang, "ssh.truncated") : ""];
}

async function runCommand(m, sock, lang, hostId, argv, { confirmed = false } = {}) {
  const host = S.getHost(hostId);
  if (!host) return m.reply(reason(lang, "unknown-host"));
  const policy = classify(argv, { workspace: S.workspaceOf(host) });
  if (!policy.allowed) return m.reply(t(lang, "ssh.runDenied", { reason: reason(lang, "denied", policy.reason) }));
  const action = policy.level === "write" ? "ssh.write" : "ssh.read";
  const decision = await gate(m, sock, lang, action, { confirmed });
  if (!decision) return "answered";
  if (decision.decision === DECISION.NEEDS_CONFIRMATION) {
    return card(m, sock, lang, { title: t(lang, "ssh.runConfirm", { id: host.id }), icon: "⚠️", blocks: [`\`\`\`\n${argv.join(" ").slice(0, 300)}\n\`\`\``], buttons: confirmButtons(m, lang, { type: "run", hostId: host.id, argv }, "ssh.btnRun") });
  }
  stepOf(m, "tool", `ssh.exec:${policy.level}`);
  const out = await S.exec(host.id, argv, { allowWrite: policy.level === "write" });
  stepOf(m, "verify", out.code);
  if (!out.ok && !("exitCode" in out)) return m.reply(t(lang, "ssh.failed", { reason: reason(lang, out.code, out.reason) }));
  return card(m, sock, lang, { title: `${host.id} ⟩ ${argv.join(" ").slice(0, 60)}`, icon: out.ok ? "🖥️" : "⚠️", blocks: outputBlocks(lang, out) });
}

/** تشخيص بأوامر ثابتة من الكود (للكلام الطبيعي وأدوات النموذج) */
const CHECKS = Object.freeze({
  status: [["uptime"], ["df", "-h", "/"], ["free", "-m"]],
  disk: [["df", "-h"]],
  memory: [["free", "-m"]],
  load: [["uptime"], ["nproc"]],
  processes: [["pm2", "ls"]],
});

async function diagnose(m, sock, lang, hostId, check = "status") {
  const host = S.getHost(hostId);
  if (!host) return m.reply(reason(lang, "unknown-host"));
  if (!(await gate(m, sock, lang, "ssh.read"))) return "answered";
  const blocks = [];
  for (const argv of CHECKS[check] || CHECKS.status) {
    const out = await S.exec(host.id, argv, { timeoutMs: 30_000 });
    stepOf(m, "verify", `${argv[0]}:${out.code}`);
    if (!out.ok && !("exitCode" in out)) return m.reply(t(lang, "ssh.failed", { reason: reason(lang, out.code) }));
    blocks.push(`*${argv.join(" ")}*\n\`\`\`\n${(out.stdout || out.stderr || "").trim().slice(-900)}\n\`\`\``);
  }
  return card(m, sock, lang, { title: t(lang, "ssh.statusTitle", { id: host.id }), blocks });
}

// ── النشر ──

async function zipOf(m) {
  const pick = [m.quoted, m].find((x) => x && (x.isDocument || x.type === "documentMessage" || x.mtype === "documentMessage"));
  const name = pick?.message?.documentMessage?.fileName || pick?.msg?.fileName || pick?.fileName || "project.zip";
  if (!pick || !/\.zip$/i.test(name)) return null;
  try {
    return { buffer: await pick.download(), name };
  } catch (error) {
    noteFailure("ssh-agent", error, { where: "terboo-ssh-agent:zipOf", fallback: "ask-again" });
    return null;
  }
}

async function planDeploy(m, sock, lang, hostId, { explicit = false } = {}) {
  const host = S.getHost(hostId);
  if (!host) return m.reply(reason(lang, "unknown-host"));
  const decision = await gate(m, sock, lang, "project.deploy", { explicit });
  if (!decision) return "answered";
  const zip = await zipOf(m);
  if (!zip) return m.reply(t(lang, "ssh.deployNeedZip", { p: m.prefix || "." }));
  const info = RW.inspectZip(zip.buffer);
  if (!info.ok) return m.reply(t(lang, "ssh.deployRejected", { reason: reason(lang, info.code) }));
  const steps = RW.planFor(info, RW.slugOf(zip.name));
  if (!steps.length) return m.reply(t(lang, "ssh.deployRejected", { reason: reason(lang, "unknown-project-type") }));
  const blocks = [
    t(lang, "ssh.deployPlan", { files: info.files.length, type: info.type, entry: info.entry || "—" }),
    `\`\`\`\n${steps.map((s) => `${s.id}: ${s.argv.join(" ")}`).join("\n")}\n\`\`\``,
    info.skipped.secrets ? t(lang, "ssh.deploySkippedSecrets", { count: info.skipped.secrets }) : "",
    info.skipped.deps ? t(lang, "ssh.deploySkippedDeps", { count: info.skipped.deps }) : "",
  ];
  const payload = { type: "deploy", hostId: host.id, zip: zip.buffer, name: zip.name };
  if (decision.allowed) return executeDeploy(m, sock, lang, payload);
  return card(m, sock, lang, { title: t(lang, "ssh.deployTitle", { name: zip.name, id: host.id }), icon: "🚀", blocks, buttons: confirmButtons(m, lang, payload, "ssh.btnDeploy") });
}

async function executeDeploy(m, sock, lang, payload) {
  const who = taskOwner(m);
  stepOf(m, "tool", "project.deploy");
  const started = await RW.startDeploy({ hostId: payload.hostId, zip: payload.zip, name: payload.name, owner: who.owner, scope: who.scope, title: t(lang, "ssh.deployTask", { name: payload.name }) });
  if (!started.ok) return m.reply(t(lang, "ssh.deployRejected", { reason: reason(lang, started.code) }));
  stepOf(m, "verify", "task-started");
  started.done.then((result) => card(m, sock, lang, {
    title: t(lang, "ssh.deployDone", { name: payload.name, status: result.observed.code }), icon: "✅",
    blocks: [t(lang, "ssh.deployWhere", { dir: started.dir }), result.observed.log ? `\`\`\`\n${result.observed.log.slice(-1200)}\n\`\`\`` : ""],
  })).catch((error) => {
    const result = error?.result;
    if (error?.code === "TASK_CANCELLED") return m.reply(t(lang, "ssh.deployStopped"));
    if (!result) return m.reply(t(lang, "ssh.failed", { reason: reason(lang, error?.code === "NOT_CONNECTED" ? "connect-failed" : "unknown") }));
    const failed = result.results?.find((r) => r.id === result.failedStep);
    const log = failed?.log || result.observed?.log || "";
    return card(m, sock, lang, {
      title: t(lang, "ssh.deployFailed", { step: result.failedStep, code: failed?.exitCode ?? result.observed?.code ?? "—" }), icon: "⚠️",
      blocks: [log ? `\`\`\`\n${log.slice(-1500)}\n\`\`\`` : ""],
      buttons: result.failedStep !== "observe" ? confirmButtons(m, lang, { type: "fix", hostId: payload.hostId, dir: started.dir, slug: started.slug, step: result.failedStep, log, steps: started.steps }, "ssh.btnFix") : [],
    });
  });
  return m.reply(t(lang, "ssh.deployStarted", { id: started.id, files: started.uploaded }));
}

async function proposeAndConfirm(m, sock, lang, payload) {
  stepOf(m, "tool", "project.fix:propose");
  const ask = askModel || (await import("./terboo-ai-core.js")).kernelAsk;
  const proposal = await RW.proposeFix({ hostId: payload.hostId, dir: payload.dir, step: payload.step, log: payload.log, ask });
  if (!proposal.ok) return m.reply(t(lang, "ssh.noFix", { reason: reason(lang, proposal.code) }));
  return card(m, sock, lang, {
    title: t(lang, "ssh.fixProposal", { risk: t(lang, `ssh.risk_${proposal.fix.risk}`), reason: proposal.fix.reason }), icon: "🩹",
    blocks: [`\`\`\`\n${proposal.diff}\n\`\`\``],
    buttons: confirmButtons(m, lang, { type: "apply", hostId: payload.hostId, dir: payload.dir, slug: payload.slug, step: payload.step, fix: proposal.fix, steps: payload.steps }, "ssh.btnApply"),
  });
}

async function applyConfirmed(m, sock, lang, payload) {
  if (!(await gate(m, sock, lang, "project.write", { confirmed: true }))) return "answered";
  stepOf(m, "tool", "project.fix:apply");
  const out = await RW.applyFix({ hostId: payload.hostId, dir: payload.dir, fix: payload.fix, steps: payload.steps, failedStep: payload.step });
  stepOf(m, "verify", out.code);
  if (!out.ok) return card(m, sock, lang, { title: t(lang, out.rolledBack ? "ssh.fixRolledBack" : "ssh.fixFailed", { reason: reason(lang, out.code) }), icon: "↩️", blocks: [out.log ? `\`\`\`\n${out.log.slice(-1200)}\n\`\`\`` : ""] });
  // الخطوات نجحت الآن ⇒ تشغيل + مراقبة حقيقية
  const runStep = payload.steps.find((s) => s.run);
  if (runStep) await S.exec(payload.hostId, runStep.argv, { cwd: payload.dir, allowWrite: true, timeoutMs: runStep.timeoutMs });
  const observed = await RW.observe(payload.hostId, payload.slug);
  return card(m, sock, lang, { title: t(lang, observed.ok ? "ssh.fixApplied" : "ssh.fixAppliedNotRunning", { status: observed.code }), icon: observed.ok ? "✅" : "⚠️", blocks: [t(lang, "ssh.fixBackup", { path: out.backup }), observed.log ? `\`\`\`\n${observed.log.slice(-1000)}\n\`\`\`` : ""] });
}

/** تنفيذ رمز تأكيد (.ssh ok <رمز>) */
async function confirmToken(m, sock, lang, token) {
  const entry = consumeActionToken(m.sender, token, { action: "ssh" });
  if (!entry) return m.reply(t(lang, "act.expired"));
  const p = entry.payload;
  if (p.type === "pin") {
    if (!(await gate(m, sock, lang, "ssh.write", { confirmed: true }))) return "answered";
    // البصمة تُعاد قراءتها: لا تثبيت لبصمة تغيّرت بين العرض والضغط
    const probe = await S.probeFingerprint(p.hostId);
    if (!probe.ok || probe.fingerprint !== p.fingerprint) return m.reply(t(lang, "ssh.mismatch"));
    const pinned = S.pinHost(p.hostId, p.fingerprint);
    return m.reply(pinned.ok ? t(lang, "ssh.pinDone", { id: p.hostId }) : reason(lang, pinned.code));
  }
  if (p.type === "run") return runCommand(m, sock, lang, p.hostId, p.argv, { confirmed: true });
  if (p.type === "rm") {
    if (!(await gate(m, sock, lang, "ssh.write", { confirmed: true }))) return "answered";
    const removed = S.removeHost(p.hostId);
    return m.reply(removed.ok ? t(lang, "ssh.removed", { id: p.hostId }) : reason(lang, removed.code));
  }
  if (p.type === "deploy") {
    if (!(await gate(m, sock, lang, "project.deploy", { confirmed: true }))) return "answered";
    return executeDeploy(m, sock, lang, p);
  }
  if (p.type === "fix") return proposeAndConfirm(m, sock, lang, p);
  if (p.type === "apply") return applyConfirmed(m, sock, lang, p);
  return m.reply(t(lang, "act.expired"));
}

/**
 * أمر .ssh
 * @param {Object} m
 * @param {Object} sock
 * @param {string} lang
 */
async function handleSshCommand(m, sock, lang) {
  const raw = String(m.text || "").trim();
  const [sub = "", ...rest] = raw.split(/\s+/);
  const op = sub.toLowerCase();
  // الإضافة لا تحتاج مضيفاً مسجّلاً (هي أول مضيف) ⇒ مالك فقط
  if (op === "add") return (await ownerOnly(m, sock, lang)) ? startAdd(m, sock, lang, rest) : "answered";
  if (!op || op === "list" || op === "ls") {
    if (!(await ownerOnly(m, sock, lang))) return "answered";
    return listHosts(m, sock, lang);
  }
  if (op === "ok") return confirmToken(m, sock, lang, rest[0]);
  if (op === "no") return m.reply(t(lang, "act.cancelled"));
  const hostId = rest[0];
  if (!hostId) return m.reply(t(lang, "ssh.usage", { p: m.prefix || "." }));
  if (op === "pin") return (await ownerOnly(m, sock, lang)) ? offerPin(m, sock, lang, hostId) : "answered";
  if (op === "test" || op === "status") return diagnose(m, sock, lang, hostId, "status");
  if (op === "run") {
    // الأمر كتبه المالك بنفسه — يُقسَّم إلى argv بلا أي تفسير shell
    const argv = splitArgs(raw.slice(raw.indexOf(hostId) + hostId.length).trim());
    if (!argv?.length) return m.reply(t(lang, "ssh.usage", { p: m.prefix || "." }));
    return runCommand(m, sock, lang, hostId, argv);
  }
  if (op === "rm" || op === "remove") {
    if (!(await ownerOnly(m, sock, lang))) return "answered";
    if (!S.getHost(hostId)) return m.reply(reason(lang, "unknown-host"));
    return card(m, sock, lang, { title: t(lang, "ssh.removeConfirm", { id: hostId }), icon: "🗑️", buttons: confirmButtons(m, lang, { type: "rm", hostId }) });
  }
  if (op === "deploy") return planDeploy(m, sock, lang, hostId);
  return m.reply(t(lang, "ssh.usage", { p: m.prefix || "." }));
}

/** مالك فقط (لعمليات لا تحتاج مضيفاً مسجّلاً بعد: القائمة/الإضافة/الحذف) */
async function ownerOnly(m, sock, lang) {
  const principal = await principalOf({ m, sock });
  if (principal.isOwner) return true;
  await m.reply(t(lang, "act.perm_owner-only")).catch((error) => noteFailure("ssh-agent", error, { where: "terboo-ssh-agent:ownerOnly" }));
  return false;
}

// ═══════════════════════════════════════════════
// الكلام الطبيعي وأدوات النموذج (أوامر ثابتة فقط)
// ═══════════════════════════════════════════════

const HOST_WORD = "(?:سيرفر|السيرفر|خادم|الخادم|server|servidor|vps)?";
const NL = [
  { kind: "deploy", re: new RegExp(`^(?:ارفع|انشر|نزل|شغل|ركب)(?:ه|ها)?\\s+(?:المشروع\\s+(?:ده|دا|دي)\\s+)?(?:على|علي|في)\\s+${HOST_WORD}\\s*([a-z0-9_-]{1,32})(?:\\s+(?:و\\s*)?شغل(?:ه|ها)?)?$`, "iu") },
  { kind: "deploy", re: /^(?:deploy|run)\s+(?:this|it|the project)\s+(?:on|to)\s+(?:server\s+)?([a-z0-9_-]{1,32})$/iu },
  { kind: "deploy", re: /^(?:despliega|ejecuta)(?:lo)?\s+en\s+(?:el\s+servidor\s+)?([a-z0-9_-]{1,32})$/iu },
  { kind: "status", re: new RegExp(`^(?:حال[هة]|وضع|افحص|شوف)\\s+${HOST_WORD}\\s*([a-z0-9_-]{1,32})$`, "iu") },
  { kind: "disk", re: new RegExp(`^(?:المساح[هة]|الديسك|الهارد)\\s+(?:على|علي|في)\\s+${HOST_WORD}\\s*([a-z0-9_-]{1,32})$`, "iu") },
  { kind: "memory", re: new RegExp(`^(?:الرام|الذاكر[هة])\\s+(?:على|علي|في)\\s+${HOST_WORD}\\s*([a-z0-9_-]{1,32})$`, "iu") },
  { kind: "processes", re: new RegExp(`^(?:العمليات|البروسيسات|ايه اللي شغال)\\s+(?:على|علي|في)\\s+${HOST_WORD}\\s*([a-z0-9_-]{1,32})$`, "iu") },
  { kind: "status", re: /^(?:status of|check)\s+(?:server\s+)?([a-z0-9_-]{1,32})$/iu },
];

/** طلب SSH طبيعي — فقط حين يكون المضيف مسجّلاً فعلاً (لا تخطف «شغل الأغنية») */
function parseSshRequest(raw) {
  const text = String(raw || "").trim().replace(/[؟?!.]+$/, "");
  if (!text || text.length > 120 || !S.hostCount()) return null;
  for (const p of NL) {
    const hit = text.match(p.re);
    if (hit && S.getHost(hit[1])) return { kind: p.kind, host: S.getHost(hit[1]).id };
  }
  return null;
}

async function runSshRequest({ m, sock, lang, request, respond = () => {} }) {
  respond();
  if (request.kind === "deploy") return planDeploy(m, sock, lang, request.host);
  return diagnose(m, sock, lang, request.host, request.kind);
}

const SSH_TOOLS = Object.freeze({
  "ssh.diagnose": { purpose: "read-only health of a registered server: input.host (its id) and input.check one of status|disk|memory|load|processes" },
  "project.deploy": { purpose: "deploy the zip attached to this message to input.host (asks confirmation; build, run, observe)" },
});

async function sshToolsForModel(m, sock, request = "") {
  if (!S.hostCount() || !/سيرفر|خادم|server|servidor|vps|ssh|deploy|انشر|ارفع/iu.test(String(request || ""))) return "";
  const principal = await principalOf({ m, sock });
  if (!principal.isOwner) return "";
  return [...Object.entries(SSH_TOOLS).map(([id, tool]) => `- ${id} ${tool.purpose}`), `  registered hosts: ${S.listHosts().map((h) => h.id).join(", ")}`].join("\n");
}

async function runSshTool({ id, input = {}, m, sock, lang }) {
  if (!SSH_TOOLS[id]) return null;
  const host = S.getHost(String(input.host || ""));
  if (!host) return m.reply(reason(lang, "unknown-host"));
  if (id === "project.deploy") return planDeploy(m, sock, lang, host.id);
  return diagnose(m, sock, lang, host.id, CHECKS[input.check] ? input.check : "status");
}

/** للاختبارات: مزوّد نموذج بديل */
function _setSshAsk(fn) {
  askModel = typeof fn === "function" ? fn : null;
}

export { CHECKS, SSH_TOOLS, _setSshAsk, handleSshCommand, parseSshRequest, runSshRequest, runSshTool, sshToolsForModel };
export default { handleSshCommand, parseSshRequest, runSshRequest, sshToolsForModel, runSshTool };
