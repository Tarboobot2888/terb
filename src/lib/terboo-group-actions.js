// ═══════════════════════════════════════════════
// 👥 Terboo Group Actions — أدوات المجموعة الحقيقية مع تحقق بعد كل إجراء (§9 §10 §11 §31 §32)
// ───────────────────────────────────────────────
// طبقة تنفيذ فقط (بلا كلام ولا صلاحيات): المستدعي يمر أولاً من محرّك الصلاحيات (decide/protectTargets).
//   readSettings · applySetting(lock|unlock|restrict|unrestrict) · setSubject · setDescription
//   · inviteLink · revokeInvite · setBlock · planMembers · participantsBulk
//   · scheduleSetting (مهمة مؤجّلة قابلة للإلغاء وتُستأنف بصدق بعد إعادة التشغيل)
// كل كتابة: قراءة حالة قبلها (لا تكرار لما هو مطبّق أصلاً) ← تنفيذ ← قراءة حديثة من واتساب للتحقق.
// النتيجة دائماً صريحة: ok + verified، أو code للسبب — لا «تم» بلا دليل.
// ═══════════════════════════════════════════════

import config from "../../config.js";
import { codeOfError, runBulk } from "./terboo-bulk-executor.js";
import { noteFailure } from "./terboo-failure-log.js";
import { getDirectory, invalidate, memberByJid } from "./terboo-group-directory.js";
import { identityOf, isBot, sameUser, sendableJid } from "./terboo-identity.js";
import { t } from "./terboo-localization.js";
import { candidateOf } from "./terboo-member-resolver.js";
import { protectTargets } from "./terboo-permissions.js";
import { PRIORITY, cancelTask, enqueueTask, listTasks, registerTaskRunner, resumeTask } from "./terboo-task-queue.js";

const SETTING_OPS = Object.freeze({
  lock: { setting: "announcement", check: (s) => s.locked === true, reverse: "unlock" },
  unlock: { setting: "not_announcement", check: (s) => s.locked === false, reverse: "lock" },
  restrict: { setting: "locked", check: (s) => s.restricted === true, reverse: "unrestrict" },
  unrestrict: { setting: "unlocked", check: (s) => s.restricted === false, reverse: "restrict" },
});
const LIMITS = Object.freeze({ subject: 100, description: 2048, minScheduleMs: 30_000, maxScheduleMs: 7 * 24 * 60 * 60 * 1000 });
const PARTICIPANT_OP = Object.freeze({ kick: "remove", promote: "promote", demote: "demote" });
const VERIFY_MEMBER = Object.freeze({
  remove: (member) => !member,
  promote: (member) => Boolean(member?.admin),
  demote: (member) => Boolean(member) && !member.admin,
});
/** رموز حالة groupParticipantsUpdate لكل مشارك */
const PARTICIPANT_STATUS = Object.freeze({ 200: "ok", 401: "not-authorized", 403: "not-authorized", 404: "not-in-group", 406: "not-acceptable", 408: "timeout", 409: "conflict", 429: "rate-limit", 500: "server-error" });
const SCHEDULE_TYPE = "group.schedule";
const BULK_TYPE = "group.bulk";

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (code, extra = {}) => ({ ok: false, code, ...extra });

/** خطأ واتساب ⇒ رمز (البوت ليس مشرفاً = not-authorized) */
function waCode(error) {
  const code = codeOfError(error);
  return code === "not-authorized" ? "bot-not-admin" : code;
}

async function freshMeta(sock, groupId) {
  if (typeof sock?.groupMetadata !== "function" || !String(groupId || "").endsWith("@g.us")) return null;
  try {
    return (await sock.groupMetadata(groupId, { fresh: true })) || null;
  } catch (error) {
    noteFailure("group-actions", error, { where: "terboo-group-actions:freshMeta", target: groupId, fallback: "unverified" });
    return null;
  }
}

function settingsOf(meta) {
  const participants = meta?.participants || [];
  return {
    subject: String(meta?.subject || ""),
    description: String(meta?.desc || ""),
    locked: Boolean(meta?.announce),
    restricted: Boolean(meta?.restrict),
    size: Number(meta?.size) || participants.length,
    admins: participants.filter((p) => p?.admin).length,
    memberAddMode: meta?.memberAddMode ?? null,
    joinApprovalMode: meta?.joinApprovalMode ?? null,
    ephemeral: Number(meta?.ephemeralDuration) || 0,
  };
}

/** إعدادات المجموعة الحالية من واتساب (قراءة حديثة) */
async function readSettings(sock, groupId) {
  const meta = await freshMeta(sock, groupId);
  return meta ? ok({ settings: settingsOf(meta) }) : fail("unavailable");
}

/**
 * قفل/فتح الرسائل أو تعديل البيانات مع تحقق.
 * @returns {Promise<{ok:boolean, code?:string, already?:boolean, verified?:boolean, settings?:Object}>}
 */
async function applySetting(sock, groupId, op) {
  const spec = SETTING_OPS[op];
  if (!spec) return fail("unknown-op");
  if (typeof sock?.groupSettingUpdate !== "function") return fail("unsupported");
  const before = await readSettings(sock, groupId);
  if (before.ok && spec.check(before.settings)) return ok({ already: true, verified: true, settings: before.settings });
  try {
    await sock.groupSettingUpdate(groupId, spec.setting);
  } catch (error) {
    noteFailure("group-actions", error, { where: "terboo-group-actions:applySetting", stage: op, target: groupId });
    return fail(waCode(error));
  }
  invalidate(groupId);
  const after = await readSettings(sock, groupId);
  if (!after.ok) return ok({ verified: false });
  return spec.check(after.settings) ? ok({ verified: true, settings: after.settings }) : fail("not-applied", { settings: after.settings });
}

async function setSubject(sock, groupId, value) {
  const subject = String(value || "").replace(/\s+/g, " ").trim();
  if (!subject) return fail("empty");
  if ([...subject].length > LIMITS.subject) return fail("too-long", { limit: LIMITS.subject });
  if (typeof sock?.groupUpdateSubject !== "function") return fail("unsupported");
  const before = await readSettings(sock, groupId);
  if (before.ok && before.settings.subject === subject) return ok({ already: true, verified: true, subject });
  try {
    await sock.groupUpdateSubject(groupId, subject);
  } catch (error) {
    noteFailure("group-actions", error, { where: "terboo-group-actions:setSubject", target: groupId });
    return fail(waCode(error));
  }
  invalidate(groupId);
  const after = await readSettings(sock, groupId);
  if (!after.ok) return ok({ verified: false, subject });
  return after.settings.subject === subject ? ok({ verified: true, subject }) : fail("not-applied");
}

async function setDescription(sock, groupId, value) {
  const description = String(value ?? "").trim();
  if ([...description].length > LIMITS.description) return fail("too-long", { limit: LIMITS.description });
  if (typeof sock?.groupUpdateDescription !== "function") return fail("unsupported");
  const before = await readSettings(sock, groupId);
  if (before.ok && before.settings.description.trim() === description) return ok({ already: true, verified: true });
  try {
    // نص فارغ ⇒ حذف الوصف
    await sock.groupUpdateDescription(groupId, description || undefined);
  } catch (error) {
    noteFailure("group-actions", error, { where: "terboo-group-actions:setDescription", target: groupId });
    return fail(waCode(error));
  }
  invalidate(groupId);
  const after = await readSettings(sock, groupId);
  if (!after.ok) return ok({ verified: false });
  return after.settings.description.trim() === description ? ok({ verified: true }) : fail("not-applied");
}

async function inviteLink(sock, groupId) {
  if (typeof sock?.groupInviteCode !== "function") return fail("unsupported");
  try {
    const code = await sock.groupInviteCode(groupId);
    return code ? ok({ code, link: `https://chat.whatsapp.com/${code}` }) : fail("unavailable");
  } catch (error) {
    noteFailure("group-actions", error, { where: "terboo-group-actions:inviteLink", target: groupId });
    return fail(waCode(error));
  }
}

/** رابط جديد؛ التحقق: الرمز الجديد يختلف عن القديم (القديم لم يعد يعمل) */
async function revokeInvite(sock, groupId) {
  if (typeof sock?.groupRevokeInvite !== "function") return fail("unsupported");
  const before = await inviteLink(sock, groupId);
  let code;
  try {
    code = await sock.groupRevokeInvite(groupId);
  } catch (error) {
    noteFailure("group-actions", error, { where: "terboo-group-actions:revokeInvite", target: groupId });
    return fail(waCode(error));
  }
  if (!code) return fail("unavailable");
  const verified = before.ok ? before.code !== code : false;
  if (before.ok && !verified) return fail("not-applied");
  return ok({ code, link: `https://chat.whatsapp.com/${code}`, verified });
}

async function blocklist(sock) {
  if (typeof sock?.fetchBlocklist !== "function") return null;
  try {
    return ((await sock.fetchBlocklist()) || []).filter(Boolean).map(String);
  } catch (error) {
    noteFailure("group-actions", error, { where: "terboo-group-actions:blocklist", fallback: "unverified" });
    return null;
  }
}

/**
 * حظر/فك حظر جهة اتصال مع تحقق من قائمة الحظر.
 * @param {Object} sock
 * @param {string} jid PN أو LID (من المحلل — لا من النموذج)
 * @param {boolean} block
 */
async function setBlock(sock, jid, block) {
  const target = sendableJid(jid);
  if (!target || !/@(?:s\.whatsapp\.net|lid)$/.test(target)) return fail("invalid-target");
  if (isBot(target, sock)) return fail("bot-itself");
  if (typeof sock?.updateBlockStatus !== "function") return fail("unsupported");
  const has = (list) => list.some((entry) => sameUser(entry, target));
  const before = await blocklist(sock);
  if (before && has(before) === block) return ok({ already: true, verified: true, jid: target });
  try {
    await sock.updateBlockStatus(target, block ? "block" : "unblock");
  } catch (error) {
    noteFailure("group-actions", error, { where: "terboo-group-actions:setBlock", stage: block ? "block" : "unblock" });
    return fail(codeOfError(error));
  }
  const after = await blocklist(sock);
  if (!after) return ok({ verified: false, jid: target });
  return has(after) === block ? ok({ verified: true, jid: target }) : fail("not-applied");
}

/**
 * خطة إجراء جماعي على الأعضاء من قراءة حديثة: من سيُنفَّذ عليه، ومن استُثني ولماذا.
 * @param {{sock:Object, groupId:string, principal:Object, action:string, op:"kick"|"promote"|"demote",
 *          mode:"all"|"selected", except?:Array, selected?:Array, allowAdmins?:boolean}} input
 * @returns {Promise<{ok:boolean, code?:string, targets?:Array, excluded?:Array, missing?:Array, already?:Array, excepted?:number, total?:number, subject?:string}>}
 */
async function planMembers({ sock, groupId, principal, action, op, mode, except = [], selected = [], allowAdmins = false }) {
  const startedAt = Date.now();
  const dir = await getDirectory(sock, groupId, { refresh: true });
  if (!dir || dir.fetchedAt < startedAt) return fail("unavailable");
  const all = [...dir.members.values()].map((member) => candidateOf(member, "directory"));
  const missing = [];
  let pool = [];
  let excepted = 0;
  if (mode === "selected") {
    const seen = new Set();
    for (const target of selected) {
      const member = memberByJid(dir, target.jid || target.id);
      if (!member) { missing.push(target); continue; }
      if (seen.has(member.canonical)) continue;
      seen.add(member.canonical);
      pool.push(candidateOf(member, "directory"));
    }
  } else {
    const keep = new Set(except.map((target) => memberByJid(dir, target.jid || target.id)?.canonical).filter(Boolean));
    excepted = keep.size;
    pool = all.filter((candidate) => !keep.has(candidate.canonical));
  }
  const { allowed, excluded } = protectTargets({ principal, action, targets: pool, sock, allowAdmins });
  // ما هو مطبّق أصلاً لا يُعاد (idempotent): مشرف لا يُرقّى، وعضو عادي لا يُنزَّل
  const already = op === "promote" ? allowed.filter((t) => t.admin) : op === "demote" ? allowed.filter((t) => !t.admin) : [];
  const targets = allowed.filter((t) => !already.includes(t));
  return ok({ targets, excluded, missing, already, excepted, total: all.length, subject: dir.subject });
}

const keyOf = (target) => target.canonical || identityOf(target.jid || target.id).canonical;

/**
 * تنفيذ جماعي على المشاركين (طرد/ترقية/تنزيل) بدفعات + تحقق حديث بعد كل دفعة.
 * @returns {Promise<ReturnType<typeof runBulk>>}
 */
async function participantsBulk({ sock, groupId, targets, op, signal, onProgress, onCheckpoint, done }) {
  const action = PARTICIPANT_OP[op];
  if (!action) throw Object.assign(new Error("unknown-op"), { code: "UNKNOWN_OP" });
  const tuning = config.terboo?.bulk || {};
  return runBulk({
    items: targets,
    keyOf,
    batchSize: Number(process.env.TERBOO_BULK_BATCH) || tuning.batchSize || 5,
    gapMs: Number(process.env.TERBOO_BULK_GAP_MS ?? tuning.gapMs ?? 800),
    backoffMs: Number(process.env.TERBOO_BULK_BACKOFF_MS ?? tuning.backoffMs ?? 2000),
    signal,
    onProgress,
    onCheckpoint,
    done,
    execute: async (batch) => {
      // معرّف المشارك كما تعرفه المجموعة نفسها (LID في المجموعات المعنونة بـLID)
      const jids = batch.map((target) => target.id || target.jid);
      const results = (await sock.groupParticipantsUpdate(groupId, jids, action)) || [];
      return batch.map((target, index) => {
        const row = results.find((r) => [target.id, target.jid, target.pn, target.lid].filter(Boolean).some((j) => sameUser(r?.jid, j))) || results[index];
        const status = Number(row?.status);
        return { key: keyOf(target), ok: status === 200, code: status === 200 ? "ok" : PARTICIPANT_STATUS[status] || (row ? ["status", row.status].join("-") : "no-result") };
      });
    },
    verify: async (batch) => {
      const at = Date.now();
      invalidate(groupId);
      const dir = await getDirectory(sock, groupId, { refresh: true });
      // قراءة فشلت (المخزن القديم عاد) ⇒ لا تحقق، لا ادعاء
      if (!dir || dir.fetchedAt < at) return null;
      return new Map(batch.map((target) => [keyOf(target), VERIFY_MEMBER[action](memberByJid(dir, target.id || target.jid))]));
    },
  });
}

// ═══════════════════════════════════════════════
// المهام: الجدولة والتنفيذ الجماعي في الخلفية
// ═══════════════════════════════════════════════

let socketGetter = () => null;

/** إشعار في الدردشة (بلا اقتباس: الرسالة الأصلية قد لا تكون موجودة بعد إعادة التشغيل) */
async function notify(chat, text) {
  const sock = socketGetter();
  if (!sock || !chat || !text) return;
  try {
    await sock.sendMessage(chat, { text });
  } catch (error) {
    noteFailure("group-actions", error, { where: "terboo-group-actions:notify", fallback: "silent" });
  }
}

/** منفّذ مهمة الجدولة: يطبّق الإعداد عند موعده ويتحقق، ويقول بصدق إن تأخر (البوت كان متوقفاً) */
async function runScheduled(ctx) {
  const { groupId, op, at, lang = "ar", chat } = ctx.input || {};
  const sock = socketGetter();
  if (!sock) throw Object.assign(new Error("not-connected"), { code: "NOT_CONNECTED" });
  ctx.throwIfCancelled();
  const late = Math.max(0, Date.now() - Number(at || 0));
  const result = await applySetting(sock, groupId, op);
  if (!result.ok) {
    await notify(chat || groupId, t(lang, "grp.scheduleFailed", { op: t(lang, `grp.op_${op}`), reason: t(lang, `grp.code_${result.code}`) }));
    throw Object.assign(new Error(result.code), { code: "GROUP_SETTING_FAILED" });
  }
  const lines = [t(lang, `grp.scheduledDone_${op}`)];
  if (late > 120_000) lines.push(t(lang, "grp.scheduledLate", { minutes: Math.round(late / 60_000) }));
  if (!result.verified) lines.push(t(lang, "grp.unverified"));
  await notify(chat || groupId, lines.join("\n"));
  return { ok: true, summary: [op, result.verified ? "verified" : "unverified", late > 120_000 ? "late" : "on-time"].join(":") };
}

/** مهام جدولة معلّقة لمجموعة (حيّة أو محفوظة) */
function pendingSchedules(groupId) {
  return listTasks({ status: ["queued", "waiting", "paused"], limit: 500 }).filter((task) => task.type === SCHEDULE_TYPE && task.input?.groupId === groupId);
}

/**
 * يجدول قفل/فتح كمهمة مؤجّلة (لا تحجز خانة تنفيذ حتى موعدها). جدولة جديدة لنفس المجموعة تستبدل السابقة.
 * @param {{groupId:string, op:string, at:number, owner:string, scope:string, lang?:string, chat?:string, title?:string}} input
 */
function scheduleSetting({ groupId, op, at, owner, scope, lang = "ar", chat = "", title = "" }) {
  if (!SETTING_OPS[op]) return fail("unknown-op");
  const delay = Number(at) - Date.now();
  if (!Number.isFinite(delay) || delay < LIMITS.minScheduleMs) return fail("too-soon");
  if (delay > LIMITS.maxScheduleMs) return fail("too-far");
  const replaced = [];
  for (const task of pendingSchedules(groupId)) {
    if (cancelTask(task.id, null, "replaced").ok) replaced.push(task.id);
  }
  const task = enqueueTask({
    type: SCHEDULE_TYPE, title: title || op, owner, scope, priority: PRIORITY.P1, run: runScheduled,
    persist: true, resumable: true, notBefore: Number(at), expireMs: 6 * 60 * 60 * 1000,
    input: { groupId, op, at: Number(at), lang, chat: chat || groupId },
  });
  return ok({ id: task.id, at: Number(at), replaced, done: task.done });
}

/** إلغاء جدولة مجموعة (للبلوقن القديم «الغاء_مؤقت» وللمشرفين) */
function cancelSchedules(groupId) {
  let cancelled = 0;
  for (const task of pendingSchedules(groupId)) if (cancelTask(task.id, null, "user").ok) cancelled += 1;
  return cancelled;
}

/** منفّذ مهمة جماعية: يعيد القراءة الحديثة، يتخطى ما تم (checkpoint)، ويرجع تقريراً */
async function runBulkTask(ctx) {
  const { groupId, op, targets = [] } = ctx.input || {};
  const sock = socketGetter();
  if (!sock) throw Object.assign(new Error("not-connected"), { code: "NOT_CONNECTED" });
  const report = await participantsBulk({
    sock, groupId, targets, op, signal: ctx.signal,
    done: ctx.checkpointData?.done || [],
    onCheckpoint: (keys) => ctx.checkpoint({ done: keys }),
    onProgress: ({ done, total }) => ctx.progress(total ? (done / total) * 100 : 100, [done, total].join("/")),
  });
  return { ...report, summary: [op, `${report.succeeded.length}/${report.total}`, report.cancelled ? "cancelled" : "finished"].join(":") };
}

/**
 * تنفيذ جماعي في الخلفية كمهمة قابلة للإلغاء («وقف الطرد») — يُستدعى بعد التأكيد فقط.
 * @param {{groupId:string, op:string, targets:Array, owner:string, scope:string, title?:string}} input
 */
function startBulk({ groupId, op, targets, owner, scope, title = "" }) {
  // معرّفات المشاركين فقط (لا أسماء ولا بيانات أخرى في سجل المهام)
  const slim = targets.map((target) => ({ id: target.id || target.jid, canonical: keyOf(target) }));
  const task = enqueueTask({
    type: BULK_TYPE, title: title || op, owner, scope, priority: PRIORITY.P1, run: runBulkTask,
    persist: true, resumable: true, input: { groupId, op, targets: slim },
  });
  return { id: task.id, done: task.done };
}

/**
 * يسجّل منفّذي المهام (للاستئناف بعد إعادة التشغيل) ويعيد جدولة ما قاطعه الإيقاف.
 * الجدولة المقطوعة تُستأنف تلقائياً بموعدها الأصلي (أو فوراً مع إشعار التأخير)؛ الجماعية لا تُستأنف إلا بطلب صريح.
 */
function installGroupActions({ getSocket } = {}) {
  if (typeof getSocket === "function") socketGetter = getSocket;
  registerTaskRunner(SCHEDULE_TYPE, runScheduled);
  registerTaskRunner(BULK_TYPE, runBulkTask);
  let resumed = 0;
  for (const task of listTasks({ status: "waiting", limit: 500 })) {
    if (task.type !== SCHEDULE_TYPE || task.note !== "interrupted-by-restart") continue;
    if (resumeTask(task.id, null).ok) resumed += 1;
  }
  return { resumed };
}

export {
  BULK_TYPE, LIMITS, PARTICIPANT_OP, SCHEDULE_TYPE, SETTING_OPS,
  applySetting, cancelSchedules, installGroupActions, inviteLink, participantsBulk, pendingSchedules, planMembers,
  readSettings, revokeInvite, scheduleSetting, setBlock, setDescription, setSubject, startBulk,
};
export default { applySetting, readSettings, setSubject, setDescription, inviteLink, revokeInvite, setBlock, planMembers, participantsBulk, scheduleSetting, startBulk, installGroupActions };
