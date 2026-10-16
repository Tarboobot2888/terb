// ═══════════════════════════════════════════════
// 📨 Terboo Messaging Agent — «ابعت لـ…» و«ابعت لكل الجروبات…» بالكلام الطبيعي (§12 §13)
// ───────────────────────────────────────────────
//   «ابعت لـ 01012345678: مرحبا» · «ابعت رسالة لأحمد وقوله اتأخرت» · «send +20101… : hi»
//   «ابعت لكل الجروبات: …» · «اعمل إذاعة لكل جروبات البوتات الفرعية: …» · «جرب الإذاعة» (خطة بلا إرسال)
// للمالك فقط (محرّك الصلاحيات) · الهدف من المحلل (رقم مكتوب/منشن/رد/اسم معروف) لا من النموذج
// · الاسم ⇒ تأكيد قبل الإرسال · الإذاعة ⇒ خطة بالأعداد لكل بوت + تأكيد إلزامي ثم مهمة قابلة للإيقاف والاستئناف.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import { planBroadcast, startBroadcast } from "./terboo-broadcast.js";
import { remember } from "./terboo-context-engine.js";
import { createActionToken } from "./terboo-flow.js";
import { askConfirm, codeText, gate, label, registerConfirmHandler, say } from "./terboo-group-agent.js";
import { stepOf } from "./terboo-latency.js";
import { t } from "./terboo-localization.js";
import { resolveMember } from "./terboo-member-resolver.js";
import { sendToContact } from "./terboo-messaging.js";
import { DECISION, principalOf } from "./terboo-permissions.js";
import { taskOwner } from "./terboo-task-control.js";
import { sendCard } from "./terboo-ui-kit.js";
import * as UI from "./terboo-ui-theme.js";

// ═══════════════════════════════════════════════
// الفهم (على النص الأصلي: نص الرسالة يُرسل كما كتبه المالك)
// ═══════════════════════════════════════════════

/** ألف بكل صورها (نص المالك الأصلي بلا تطبيع) */
const A = /[اأإآ]/.source;
const TO_PREFIX = `(?:(?:لل|ل|لـ|${A}لى|${A}لي|على|علي)\\s*(?:ال)?(?:رقم|نمر[ةه])\\s*|لـ|ل|${A}لى|${A}لي|على|علي)\\s*`;
const SEND_VERB = `(?:ابعت|${A}بعث|${A}رسل|بعت|ابعتي|${A}رسلي)`;
const SEP_AR = `\\s*(?:[:：]|\\s+(?:رسال[ةه]|وقول(?:ه|ها|له|لها)?|قول(?:ه|ها|له|لها)|يقول|تقول|بيقول|مضمونها|نصها|فيها)\\s*[:：]?)\\s*`;
const SEND_PATTERNS = [
  new RegExp(`^${SEND_VERB}\\s+(?:(?:رسال[ةه]|مسج)\\s+)?${TO_PREFIX}(?<to>.+?)${SEP_AR}(?<text>[\\s\\S]+)$`, "u"),
  /^(?:send|message|text)\s+(?:a\s+message\s+)?(?:to\s+)?(?<to>.+?)\s*(?::|\s+(?:saying|that says)\s*:?)\s*(?<text>[\s\S]+)$/iu,
  /^(?:env[ií]a|manda)(?:le)?\s+(?:un\s+mensaje\s+)?(?:a\s+)?(?<to>.+?)\s*(?::|\s+(?:diciendo|que diga)\s*:?)\s*(?<text>[\s\S]+)$/iu,
];
const SELF = /^(?:ي|لي|ني|me|mi|my self|myself)$/iu;

const GROUPS_AR = "(?:ال)?(?:جروبات|مجموعات|قروبات)";
const BOTS_AR = `(?:(?:بتاع(?:ت|ة|ه)?|في|من|ل|على)\\s*)?(?:كل\\s+)?(?:ال)?(?:بوتات(?:\\s+(?:ال)?فرعي[ةه])?|بوت\\s+(?:ال)?رئيسي(?:\\s+بس)?)`;
const BROADCAST_PATTERNS = [
  new RegExp(`^(?:${SEND_VERB}|انشر|${A}ذيع|اعمل\\s+(?:${A}ذاع[ةه]|برودكاست|نشر))\\s+(?:(?:رسال[ةه]|${A}علان)\\s+)?(?:ل|لـ|في|على|علي)?\\s*(?:كل|جميع)\\s+${GROUPS_AR}(?<scope>\\s+${BOTS_AR})?${SEP_AR}(?<text>[\\s\\S]+)$`, "u"),
  /^(?:broadcast|send)\s+(?:a\s+message\s+)?(?:to\s+)?(?:all|every)\s+(?:the\s+)?groups?(?<scope>\s+(?:of|on|from|in)\s+(?:all\s+)?(?:the\s+)?(?:bots|child bots|sub[- ]?bots|main bot(?: only)?))?\s*(?::|\s+saying\s*:?)\s*(?<text>[\s\S]+)$/iu,
  /^(?:difunde|env[ií]a|manda)\s+(?:un\s+mensaje\s+)?(?:a\s+)?todos\s+los\s+grupos(?<scope>\s+de\s+(?:todos\s+)?los\s+(?:bots|sub-?bots|bots\s+hijos))?\s*(?::|\s+diciendo\s*:?)\s*(?<text>[\s\S]+)$/iu,
];
const DRY_RUN = new RegExp(`^(?:(?:جرب|محاكا[ةه])\\s+(?:ال)?(?:${A}ذاع[ةه]|برودكاست|نشر)|كام\\s+(?:جروب|مجموع[ةه])\\s+(?:هت|ه|ح|هي)?(?:وصل|توصل|يوصل)(?:ها|له|لها)?\\s+(?:ال)?(?:${A}ذاع[ةه]|برودكاست|نشر))(?<scope>\\s+${BOTS_AR})?$|^(?:broadcast\\s+dry[- ]?run|dry[- ]?run\\s+(?:the\\s+)?broadcast)(?<scope2>\\s+(?:of|on|from)\\s+(?:all\\s+)?(?:the\\s+)?(?:bots|child bots|main bot))?$|^simula(?:r)?\\s+(?:la\\s+)?difusi[oó]n$`, "iu");

function botsOf(scope) {
  const value = String(scope || "");
  if (/فرعي|child|sub|hijos/iu.test(value)) return "children";
  if (/رئيسي|main|principal/iu.test(value)) return "main";
  return "all";
}

/**
 * @returns {null|{kind:"send", to:string, text:string}|{kind:"broadcast", text:string, bots:string, dry?:boolean}}
 */
function parseMessagingRequest(raw) {
  const original = String(raw || "").trim();
  if (!original || original.length > 4200) return null;
  const dry = original.match(DRY_RUN);
  if (dry) return { kind: "broadcast", text: "", bots: botsOf(dry.groups?.scope || dry.groups?.scope2), dry: true };
  for (const re of BROADCAST_PATTERNS) {
    const hit = original.match(re);
    if (hit?.groups?.text?.trim()) return { kind: "broadcast", text: hit.groups.text.trim(), bots: botsOf(hit.groups.scope) };
  }
  for (const re of SEND_PATTERNS) {
    const hit = original.match(re);
    if (!hit) continue;
    const to = hit.groups.to.trim().replace(/^[«"“]+|[»"”]+$/g, "");
    if (!to || SELF.test(to) || to.length > 60 || /^(?:كل|جميع|all|every|todos)\s/iu.test(to)) return null;
    if (hit.groups.text.trim()) return { kind: "send", to, text: hit.groups.text.trim() };
  }
  return null;
}

// ═══════════════════════════════════════════════
// التنفيذ
// ═══════════════════════════════════════════════

const NUMBER = /^\+?[\d\s()-]{8,20}$/;

async function deliverOne(m, sock, lang, target, text) {
  const who = taskOwner(m);
  stepOf(m, "tool", "message.send_to_contact");
  const result = await sendToContact({ sock, to: target.pn || target.jid || target.number, text, actor: who.owner });
  stepOf(m, "verify", result.code);
  if (!result.ok) return say(m, lang, [t(lang, "msg.sendFailed", { name: label(target), reason: codeText(lang, result.code) })], { icon: "⚠️" });
  remember(m, "member", target);
  return say(m, lang, [t(lang, "msg.sent", { name: label(target) }), t(lang, "msg.sentNote")], { icon: "✉️" });
}

async function runSend(m, sock, lang, request, principal) {
  if (!(await gate(m, lang, principal, "message.send_to_contact", { targets: null }))) return "answered";
  const value = request.to.trim();
  // رقم مكتوب صراحةً ⇒ تطبيع وإرسال (المالك كتبه بنفسه)
  if (NUMBER.test(value)) {
    const digits = value.replace(/[^\d+]/g, "");
    return deliverOne(m, sock, lang, { number: digits.replace(/\D/g, ""), jid: digits, name: "" }, request.text);
  }
  const mention = (m.mentionedJid || []).length && /^@/.test(value);
  const resolved = await resolveMember({ m, sock, name: mention ? "" : value, purpose: "add", text: value });
  if (resolved.status === "ambiguous") {
    const options = resolved.options.slice(0, 3);
    const tokens = options.map((target) => createActionToken({ user: m.sender, action: "grp", payload: { type: "msg.send", target, text: request.text } }));
    remember(m, "choice", { kind: "grp-pick", tokens });
    await sendCard(sock, m, {
      cardId: "message-pick", lang, title: t(lang, "act.ambiguous"), icon: "👥",
      blocks: [options.map((o, i) => UI.bullet(`${i + 1}. ${label(o)}`, lang)).join("\n")],
      buttons: [...options.map((o, i) => ({ id: `terboo_grp_${tokens[i]}`, text: `${i + 1}. ${label(o)}`.slice(0, 24), typed: String(i + 1) })), { id: "terboo_grp_no", text: `✖️ ${t(lang, "act.btnNo")}` }],
    }).catch((error) => noteFailure("messaging-agent", error, { where: "terboo-messaging-agent:runSend", stage: "pick" }));
    return "answered";
  }
  if (resolved.status !== "resolved") return say(m, lang, [t(lang, "msg.whoNotFound", { name: value })], { icon: "🔎" });
  const target = resolved.target;
  // بالاسم/السياق ⇒ تأكيد قبل الإرسال (لا إرسال لشخص خاطئ)؛ المنشن/الرد/الرقم المكتوب ⇒ مباشرة
  if (["mention", "quoted", "number"].includes(resolved.source) && !resolved.weak) return deliverOne(m, sock, lang, target, request.text);
  return askConfirm(m, sock, lang, {
    title: t(lang, "msg.confirmSend", { name: label(target) }),
    blocks: [UI.quote(request.text.slice(0, 300), lang)],
    payload: { type: "msg.send", target, text: request.text },
    icon: "✉️",
  });
}

async function runBroadcastRequest(m, sock, lang, request, principal) {
  // الخطة للمالك فقط أيضاً: أعداد مجموعات البوتات ليست للعامة
  if (!(await gate(m, lang, principal, request.dry ? "childbots.list" : "broadcast.run"))) return "answered";
  stepOf(m, "tool", `broadcast.plan:${request.bots}`);
  const plan = await planBroadcast({ bots: request.bots });
  if (!plan.ok) return say(m, lang, [codeText(lang, plan.code)], { icon: "⚠️" });
  const blocks = [
    ...plan.bots.map((bot) => UI.bullet(t(lang, bot.error ? "msg.botLineFailed" : "msg.botLine", { bot: bot.id === "main" ? t(lang, "msg.mainBot") : `${t(lang, "msg.childBot")} …${bot.label.slice(-4)}`, groups: bot.groups, assigned: bot.assigned }), lang)),
    plan.skipped.duplicates ? UI.bullet(t(lang, "msg.skippedDuplicates", { count: plan.skipped.duplicates }), lang) : "",
    plan.skipped.blacklisted ? UI.bullet(t(lang, "msg.skippedBlacklisted", { count: plan.skipped.blacklisted }), lang) : "",
    plan.skipped.locked ? UI.bullet(t(lang, "msg.skippedLocked", { count: plan.skipped.locked }), lang) : "",
  ].filter(Boolean);
  stepOf(m, "verify", `plan:${plan.total}`);
  if (request.dry) return say(m, lang, [t(lang, "msg.dryRunTitle", { count: plan.total, bots: plan.bots.length }), ...blocks, t(lang, "msg.dryRunNote")], { icon: "🧪" });
  if (!plan.total) return say(m, lang, [t(lang, "msg.noGroups"), ...blocks], { icon: "ℹ️" });
  return askConfirm(m, sock, lang, {
    title: t(lang, "msg.broadcastConfirm", { count: plan.total, bots: plan.bots.filter((b) => b.assigned).length }),
    blocks: [...blocks, UI.quote(request.text.slice(0, 300), lang)],
    payload: { type: "msg.broadcast", text: request.text, bots: request.bots, items: plan.items.map((i) => ({ groupId: i.groupId, sender: i.sender })) },
    icon: "📣",
  });
}

function reportBroadcast(m, lang, done) {
  done.then((report) => say(m, lang, [
    t(lang, "msg.broadcastDone", { sent: report.sent, total: report.total }),
    ...report.perSender.map((row) => UI.bullet(t(lang, "msg.senderLine", { bot: row.sender === "main" ? t(lang, "msg.mainBot") : `${t(lang, "msg.childBot")} …${row.sender.slice(-4)}`, sent: row.sent, failed: row.failed }), lang)),
    report.failed.length ? t(lang, "msg.broadcastFailedCount", { count: report.failed.length, reason: [...new Set(report.failed.map((f) => codeText(lang, f.code)))].join("، ") }) : "",
    report.cancelled ? t(lang, "msg.broadcastStopped", { count: report.skipped }) : "",
    t(lang, "msg.sentNote"),
  ], { icon: report.failed.length || report.cancelled ? "⚠️" : "📣" })).catch((error) => {
    if (error?.code === "TASK_CANCELLED") return say(m, lang, [t(lang, "msg.broadcastStoppedResumable")], { icon: "⏹️" });
    noteFailure("messaging-agent", error, { where: "terboo-messaging-agent:reportBroadcast" });
    return say(m, lang, [t(lang, "grp.bulkFailed", { reason: codeText(lang, "unknown") })], { icon: "⚠️" });
  });
}

// ── بعد التأكيد (نفس آلية رموز وكيل المجموعة) ──
registerConfirmHandler("msg.send", async ({ m, sock, lang, payload }) => {
  const principal = await principalOf({ m, sock });
  const decision = await gate(m, lang, principal, "message.send_to_contact", { targets: [payload.target], confirmed: true });
  if (!decision || decision.decision !== DECISION.ALLOWED) return "answered";
  return deliverOne(m, sock, lang, payload.target, payload.text);
});
registerConfirmHandler("msg.broadcast", async ({ m, sock, lang, payload }) => {
  const principal = await principalOf({ m, sock });
  const decision = await gate(m, lang, principal, "broadcast.run", { confirmed: true });
  if (!decision || decision.decision !== DECISION.ALLOWED) return "answered";
  const who = taskOwner(m);
  const started = startBroadcast({ text: payload.text, items: payload.items, owner: who.owner, scope: who.scope, title: t(lang, "msg.taskTitle", { count: payload.items.length }) });
  if (!started.ok) return say(m, lang, [codeText(lang, started.code)], { icon: "⚠️" });
  stepOf(m, "tool", "broadcast.run");
  stepOf(m, "verify", "task-started");
  reportBroadcast(m, lang, started.done);
  return say(m, lang, [t(lang, "msg.broadcastStarted", { count: payload.items.length }), t(lang, "msg.broadcastStopHint", { id: started.id })], { icon: "⏳" });
});

// ═══════════════════════════════════════════════
// أدوات النموذج (المالك فقط): الهدف اسم/رقم كتبه المستخدم نفسه — لا رقم مختلق
// ═══════════════════════════════════════════════

const MESSAGING_TOOLS = Object.freeze({
  "message.send_to_contact": { action: "message.send_to_contact", purpose: "send input.text to one person; input.names[0] is the name or the number exactly as the user wrote it" },
  "broadcast.run": { action: "broadcast.run", purpose: "send input.text to all groups (asks confirmation); input.scope all|main|children bots" },
  "broadcast.plan": { action: "childbots.list", purpose: "dry run: how many groups each bot would reach, nothing is sent" },
});
const MESSAGING_WORDS = /ابعت|ارسل|أرسل|رساله|رسالة|اذاع|إذاع|برودكاست|نشر|send|message|broadcast|env[ií]a|mensaje|difund/iu;

async function messagingToolsForModel(m, sock, request = "") {
  if (!MESSAGING_WORDS.test(String(request || ""))) return "";
  const principal = await principalOf({ m, sock });
  if (!principal.isOwner) return "";
  return Object.entries(MESSAGING_TOOLS).map(([id, tool]) => `- ${id} ${tool.purpose}`).join("\n");
}

async function runMessagingTool({ id, input = {}, m, sock, lang, text = "", respond = () => {} }) {
  if (!MESSAGING_TOOLS[id]) return null;
  const body = String(input.text || "").trim().slice(0, 4000);
  const scope = ["main", "children"].includes(input.scope) ? input.scope : "all";
  if (id === "broadcast.plan") return runMessagingRequest({ m, sock, lang, request: { kind: "broadcast", text: "", bots: scope, dry: true }, respond });
  if (id === "broadcast.run") return runMessagingRequest({ m, sock, lang, request: { kind: "broadcast", text: body, bots: scope }, respond });
  const to = String((Array.isArray(input.names) ? input.names[0] : input.names) || "").trim();
  const digits = to.replace(/\D/g, "");
  // رقم لم يكتبه المستخدم ⇒ مرفوض (النموذج لا يختار مستلماً)
  if (!to || /@/.test(to) || (digits.length >= 6 && !String(text).replace(/\D/g, "").includes(digits))) {
    respond();
    return say(m, lang, [t(lang, "msg.whoNotFound", { name: to })], { icon: "🔎" });
  }
  if (!body) {
    respond();
    return say(m, lang, [t(lang, "msg.needText")], { icon: "✍️" });
  }
  return runMessagingRequest({ m, sock, lang, request: { kind: "send", to, text: body }, respond });
}

/**
 * @param {{m:Object, sock:Object, lang:string, request:Object, respond?:Function}} input
 * @returns {Promise<"answered"|null>}
 */
async function runMessagingRequest({ m, sock, lang, request, respond = () => {} }) {
  respond();
  const principal = await principalOf({ m, sock });
  if (request.kind === "send") return runSend(m, sock, lang, request, principal);
  if (request.kind === "broadcast") return runBroadcastRequest(m, sock, lang, request, principal);
  return null;
}

export { MESSAGING_TOOLS, messagingToolsForModel, parseMessagingRequest, runMessagingRequest, runMessagingTool };
export default { parseMessagingRequest, runMessagingRequest, messagingToolsForModel, runMessagingTool, MESSAGING_TOOLS };
