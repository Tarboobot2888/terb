// ═══════════════════════════════════════════════
// 📣 Terboo Broadcast Orchestrator — إذاعة عبر البوت الرئيسي والبوتات الفرعية (§13 §33)
// ───────────────────────────────────────────────
//   planBroadcast({ bots }) ⇒ لكل بوت مجموعاته (قراءة حقيقية groupFetchAllParticipating لكل حساب)
//     · منع التكرار: المجموعة التي فيها أكثر من بوت تستلم مرة واحدة من بوت واحد (الرئيسي أولاً) — منع الحلقات
//     · تخطي القائمة السوداء (jpmBlacklist المشتركة مع أمر .نشر) · تخطي المقفولة حين البوت ليس مشرفاً (لن تُقبل)
//   dry-run = الخطة فقط بأعدادها · startBroadcast = مهمة خلفية قابلة للإيقاف («وقف الإذاعة») والاستئناف
//     («كمل الإذاعة» يكمل بلا إعادة لما أُرسل: checkpoint) · لكل بوت طابوره وحد معدّله (البوتات بالتوازي)
//   النتيجة صادقة: «أُرسلت» = واتساب قبلها برقم رسالة؛ البوت غير المتصل وقت التنفيذ ⇒ فشل صريح لمجموعاته.
// ═══════════════════════════════════════════════

import config from "../../config.js";
import { appendAuditEvent } from "./terboo-agent-audit.js";
import { runBulk } from "./terboo-bulk-executor.js";
import { getDatabase } from "./terboo-database.js";
import { noteFailure } from "./terboo-failure-log.js";
import { getActiveJadibots, isSocketAlive } from "./terboo-jadibot-manager.js";
import { fetchGroupsSafe } from "./terboo-jpm-helper.js";
import { PRIORITY, enqueueTask, registerTaskRunner } from "./terboo-task-queue.js";

const TYPE = "broadcast";
const LIMITS = Object.freeze({ maxText: 4000, maxGroups: 1000 });
let mainSocket = () => null;

const fail = (code, extra = {}) => ({ ok: false, code, ...extra });
const bare = (jid) => String(jid || "").split("@")[0].split(":")[0];

/** البوتات المرسِلة المتاحة الآن (الرئيسي أولاً ثم الفرعية المتصلة) */
function senders(bots = "all") {
  const list = [];
  const main = mainSocket();
  if (bots !== "children" && main) list.push({ id: "main", label: bare(main.user?.id), sock: main });
  if (bots !== "main") {
    for (const child of getActiveJadibots()) {
      if (!child?.sock || child.connectionReady === false || !isSocketAlive(child.sock)) continue;
      list.push({ id: `child:${child.id}`, label: bare(child.id), sock: child.sock });
    }
  }
  return list;
}

function senderById(id) {
  if (id === "main") return mainSocket();
  const child = getActiveJadibots().find((c) => `child:${c.id}` === id);
  return child?.sock && child.connectionReady !== false && isSocketAlive(child.sock) ? child.sock : null;
}

function botIsAdminIn(group, sock) {
  const me = bare(sock?.user?.id);
  const myLid = bare(sock?.user?.lid);
  return (group?.participants || []).some((p) => [p.id, p.jid, p.phoneNumber, p.lid].map(bare).some((x) => x && (x === me || x === myLid)) && p.admin);
}

/**
 * خطة الإذاعة (بلا إرسال).
 * @param {{bots?:"all"|"main"|"children"}} input
 * @returns {Promise<{ok:boolean, code?:string, items?:Array<{groupId:string, sender:string}>, bots?:Array, skipped?:Object, total?:number}>}
 */
async function planBroadcast({ bots = "all" } = {}) {
  const list = senders(bots);
  if (!list.length) return fail("no-senders");
  const db = getDatabase();
  const blacklist = new Set([...(db?.setting?.("jpmBlacklist") || []), ...(db?.setting?.("broadcastBlacklist") || [])]);
  const assigned = new Map();
  const skipped = { blacklisted: 0, locked: 0, duplicates: 0 };
  const report = [];
  for (const sender of list) {
    let groups = {};
    try {
      groups = (await fetchGroupsSafe(sender.sock)) || {};
    } catch (error) {
      noteFailure("broadcast", error, { where: "terboo-broadcast:planBroadcast", stage: sender.id, fallback: "skip-sender" });
      report.push({ id: sender.id, label: sender.label, groups: 0, assigned: 0, error: "fetch-failed" });
      continue;
    }
    let mine = 0;
    for (const [groupId, group] of Object.entries(groups)) {
      if (blacklist.has(groupId)) { skipped.blacklisted += 1; continue; }
      if (assigned.has(groupId)) { skipped.duplicates += 1; continue; }
      if (group?.announce && !botIsAdminIn(group, sender.sock)) { skipped.locked += 1; continue; }
      assigned.set(groupId, { groupId, sender: sender.id, subject: String(group?.subject || "").slice(0, 60) });
      mine += 1;
    }
    report.push({ id: sender.id, label: sender.label, groups: Object.keys(groups).length, assigned: mine });
  }
  // مجموعة قُفلت/حُظرت لدى بوت لكن بوت آخر يقدر عليها ⇒ أُسندت له؛ العدّ يبقى للتشخيص فقط
  const items = [...assigned.values()].slice(0, LIMITS.maxGroups);
  return { ok: true, items, bots: report, skipped, total: items.length, truncated: assigned.size > LIMITS.maxGroups };
}

/** منفّذ المهمة: لكل بوت طابوره بالتوازي، checkpoint مشترك بما أُرسل */
async function runBroadcast(ctx) {
  const { text, items = [] } = ctx.input || {};
  const done = new Set(ctx.checkpointData?.done || []);
  const bySender = new Map();
  for (const item of items) {
    if (!bySender.has(item.sender)) bySender.set(item.sender, []);
    bySender.get(item.sender).push(item);
  }
  const gapMs = Number(process.env.TERBOO_BROADCAST_GAP_MS ?? config.broadcast?.gapMs ?? 1500);
  let finished = done.size;
  const reports = await Promise.all([...bySender.entries()].map(async ([senderId, list]) => {
    const report = await runBulk({
      items: list, keyOf: (item) => item.groupId, batchSize: 1, gapMs, backoffMs: Math.max(gapMs * 2, 3000), signal: ctx.signal, done: [...done],
      execute: async (batch) => {
        const sock = senderById(senderId);
        if (!sock) return batch.map((item) => ({ key: item.groupId, ok: false, code: "sender-offline" }));
        return Promise.all(batch.map(async (item) => {
          const sent = await sock.sendMessage(item.groupId, { text });
          return { key: item.groupId, ok: Boolean(sent?.key?.id), code: sent?.key?.id ? "ok" : "unconfirmed" };
        }));
      },
      onCheckpoint: (keys) => {
        for (const key of keys) done.add(key);
        ctx.checkpoint({ done: [...done] });
      },
      onProgress: () => {
        finished = done.size;
        ctx.progress(items.length ? (finished / items.length) * 100 : 100, [finished, items.length].join("/"));
      },
    });
    return { sender: senderId, ...report };
  }));
  const sent = reports.reduce((n, r) => n + r.succeeded.length, 0);
  const failed = reports.flatMap((r) => r.failed.map((f) => ({ ...f, sender: r.sender })));
  const skipped = reports.reduce((n, r) => n + r.skipped.length, 0);
  const cancelled = reports.some((r) => r.cancelled);
  try {
    appendAuditEvent({ type: "broadcast", actor: ctx.owner, tool: TYPE, status: cancelled ? "cancelled" : failed.length ? "partial" : "sent", runId: ctx.id, metadata: { groups: items.length, sent, failed: failed.length, skipped, senders: bySender.size } });
  } catch (error) {
    noteFailure("broadcast", error, { where: "terboo-broadcast:audit", fallback: "no-audit" });
  }
  return { ok: !failed.length && !cancelled, total: items.length, sent, failed, skipped, cancelled, perSender: reports.map((r) => ({ sender: r.sender, sent: r.succeeded.length, failed: r.failed.length, skipped: r.skipped.length })), summary: ["broadcast", `${sent}/${items.length}`, cancelled ? "cancelled" : "finished"].join(":") };
}

/**
 * يبدأ الإذاعة كمهمة خلفية (بعد التأكيد فقط).
 * @param {{text:string, items:Array, owner:string, scope:string, title?:string}} input
 */
function startBroadcast({ text, items, owner, scope, title = "" }) {
  const body = String(text || "").trim();
  if (!body) return fail("empty");
  if ([...body].length > LIMITS.maxText) return fail("too-long", { limit: LIMITS.maxText });
  if (!items?.length) return fail("no-groups");
  const slim = items.map((item) => ({ groupId: item.groupId, sender: item.sender }));
  const task = enqueueTask({ type: TYPE, title: title || TYPE, owner, scope, priority: PRIORITY.P3, run: runBroadcast, persist: true, resumable: true, input: { text: body, items: slim } });
  return { ok: true, id: task.id, done: task.done };
}

/** يسجّل المنفّذ (استئناف بعد إعادة التشغيل بطلب صريح) ومصدر البوت الرئيسي */
function installBroadcast({ getSocket } = {}) {
  if (typeof getSocket === "function") mainSocket = getSocket;
  registerTaskRunner(TYPE, runBroadcast);
}

export { LIMITS, TYPE, installBroadcast, planBroadcast, senders, startBroadcast };
export default { planBroadcast, startBroadcast, installBroadcast, senders };
