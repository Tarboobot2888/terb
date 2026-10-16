// ═══════════════════════════════════════════════
// 🚦 Terboo Smart Concurrency Controller (§17 §83 §84 §85)
// ───────────────────────────────────────────────
// بديل RATE_LIMIT_MS = 4000 (كان يؤخّر كل رسالة تالية حتى 4 ثوانٍ):
//   • لا تأخير لأول رسالة أبداً، ولا تأخير ثابت لأي رسالة.
//   • dedupe: message ID + الدردشة + المرسل + بصمة المحتوى + سياق الاقتباس.
//   • قرار أساسي واحد لكل رسالة واردة عبر كل المسارات (النواة · Auto AI · …).
//   • ممرّ لكل (دردشة، مرسل): قرار واحد قيد التنفيذ؛ رسالة جديدة أثناءه:
//       – إلغاء/تصحيح («لا» · «خلاص» · «وقف» …) ⇒ يُلغى القرار الجاري (AbortSignal)
//       – غيرها ⇒ تنتظر انتهاء الجاري بلا مهلة مصطنعة، والجاري يُعلَّم «superseded»
//         فلا يُرسل رداً متأخراً إن لم يبدأ الإرسال بعد (المحادثة تمضي مع الأحدث).
//   • تجميع الدفعة: الرسائل التي سبقت ولم يُرد عليها تُمرَّر نصاً سياقياً للقرار الأحدث.
//   • ضغط عكسي: حد للممرّات النشطة لكل شخص وللبوت كله؛ الزائد يُرفض بإشارة مرئية لا بصمت.
//   • أولويات P0..P5 تُستعمل في Task Control Plane للمهام الثقيلة.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";

const PRIORITY = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4, P5: 5 };

const DEFAULTS = {
  dedupeTtlMs: 2 * 60 * 1000,
  burstWindowMs: 8_000,       // رسائل الشخص نفسه خلال هذه النافذة تُعدّ دفعة واحدة للسياق
  maxWaitingPerLane: 3,       // ما زاد عنه إغراق
  maxActiveGlobal: 48,        // قرارات ذكاء متزامنة للبوت كله
  waitTimeoutMs: 45_000,      // أقصى انتظار لانتهاء القرار السابق (لا يعلق ممرّ للأبد)
};

if (!global.terbooConcurrency) {
  global.terbooConcurrency = { lanes: new Map(), seen: new Map(), primary: new Map(), active: 0, stats: { entered: 0, duplicates: 0, primaryConflicts: 0, superseded: 0, cancelled: 0, flood: 0, coalesced: 0, waitedMs: 0 } };
}
const state = global.terbooConcurrency;
const config = { ...DEFAULTS };

/** ضبط الحدود (من config.ai.concurrency أو الاختبارات) */
function configure(overrides = {}) {
  Object.assign(config, overrides);
  return { ...config };
}

const hash = (value) => crypto.createHash("sha1").update(String(value ?? "")).digest("hex").slice(0, 16);

function prune(map, ttl) {
  const now = Date.now();
  for (const [key, at] of map) {
    if (now - (at?.at ?? at) <= ttl) break;
    map.delete(key);
  }
}

/** بصمة الرسالة للـdedupe: id + دردشة + مرسل + محتوى + اقتباس */
function fingerprint(m) {
  const quoted = m?.quoted?.id || m?.quoted?.key?.id || "";
  return `${m?.chat || ""}|${m?.sender || ""}|${m?.key?.id || m?.id || ""}|${hash(m?.body ?? m?.text ?? m?.type ?? "")}|${quoted}`;
}

/**
 * نفس الرسالة وصلت مرة أخرى (إعادة تسليم/upsert مكرر/سباق نقل)؟
 * @returns {boolean} true إن كانت مكررة
 */
function isDuplicate(m) {
  prune(state.seen, config.dedupeTtlMs);
  const key = fingerprint(m);
  if (state.seen.has(key)) {
    state.stats.duplicates += 1;
    return true;
  }
  state.seen.set(key, { at: Date.now() });
  return false;
}

/**
 * قرار أساسي واحد لكل رسالة واردة عبر كل المسارات.
 * أول مسار يطالب بالرسالة يملكها؛ أي مسار آخر يتلقى false (لا رد ثانٍ).
 * @param {Object} m
 * @param {string} path "kernel" | "autoai" | …
 */
function claimPrimary(m, path) {
  prune(state.primary, config.dedupeTtlMs);
  const id = m?.key?.id || m?.id;
  if (!id) return true;
  const key = `${m.chat || ""}:${id}`;
  const owner = state.primary.get(key);
  if (owner && owner.path !== path) {
    state.stats.primaryConflicts += 1;
    return false;
  }
  if (owner) return false; // نفس المسار مرة ثانية = تكرار
  state.primary.set(key, { at: Date.now(), path });
  return true;
}

/** إلغاء/تصحيح صريح للطلب الجاري */
const CANCEL_WORDS = /^(?:لا|لأ|لاء|خلاص|بلاش|سيبك|الغي|الغ|الغاء|إلغاء|وقف|اوقف|أوقف|ستوب|stop|cancel|nevermind|never mind|no|nope|para|cancela|olv[ií]dalo|det[eé]n(?:lo)?)(?:\s+(?:خلاص|يا\s*عم|ده|دا|كده|بقى|بقا|please|it|eso))?[\s!.،,؟?]*$/iu;

function isCancelText(text) {
  return CANCEL_WORDS.test(String(text || "").trim());
}

/** ممرّ (دردشة + مرسل): قرار جارٍ واحد + طابور منتظرين بالترتيب */
function laneOf(m) {
  const key = `${m?.chat || ""}|${String(m?.sender || "").split("@")[0].split(":")[0]}`;
  if (!state.lanes.has(key)) state.lanes.set(key, { key, current: null, queue: [], recent: [] });
  return state.lanes.get(key);
}

/** يوقظ رأس الطابور حين يفرغ الممرّ */
function wakeNext(lane) {
  if (lane.current) return;
  while (lane.queue.length) {
    const next = lane.queue.shift();
    if (next.superseded) { next.wake("superseded"); continue; }
    next.wake("go");
    return;
  }
}

/**
 * دخول قرار ذكاء لرسالة. لا تأخير إن كان الممرّ فارغاً، ولا مهلة مصطنعة أبداً.
 * رسالة أحدث تتجاوز كل ما قبلها مما لم يبدأ الرد بعد؛ نصوصها تصل للقرار الأحدث كسياق دفعة.
 * @param {Object} m
 * @param {{priority?:number}} [options]
 * @returns {Promise<{status:"proceed"|"duplicate"|"flood"|"superseded", ticket?:Ticket, cancelledPrevious?:boolean, burst?:string[]}>}
 *
 * @typedef {{id:string, signal:AbortSignal, stale:()=>boolean, cancelled:()=>boolean, superseded:()=>boolean, release:()=>void, markResponding:()=>void, burst:string[]}} Ticket
 */
async function enter(m, { priority = PRIORITY.P0 } = {}) {
  state.stats.entered += 1;
  if (isDuplicate(m)) return { status: "duplicate" };
  const lane = laneOf(m);
  const text = String(m?.body ?? m?.text ?? "");
  const now = Date.now();
  lane.recent = lane.recent.filter((entry) => now - entry.at <= config.burstWindowMs && !entry.answered);
  const mine = { text, at: now, answered: false };

  let cancelledPrevious = false;
  if (lane.current || lane.queue.length) {
    // الإغراق يُفحص أولاً: رسالة مرفوضة لا تتجاوز ما قبلها (وإلا ساد الصمت)
    if (lane.queue.length >= config.maxWaitingPerLane && !isCancelText(text)) {
      state.stats.flood += 1;
      return { status: "flood" };
    }
    if (isCancelText(text) && lane.current) {
      lane.current.abort("user-cancel");
      cancelledPrevious = true;
      state.stats.cancelled += 1;
      // ما أُلغي لا يعود كسياق دفعة لاحقاً
      for (const entry of lane.recent) entry.answered = true;
    } else if (lane.current && !lane.current.responding) {
      // الجاري لم يبدأ الرد ⇒ لا يرسل رداً متأخراً لرسالة تجاوزتها المحادثة
      lane.current.supersede();
      state.stats.superseded += 1;
    }
    // المنتظرون قبلها: يتجاوزهم القرار الأحدث (لا ثلاث عمليات منفصلة بلا داعٍ)
    for (const waiting of lane.queue) {
      if (!waiting.superseded) { waiting.superseded = true; state.stats.superseded += 1; }
    }
    lane.recent.push(mine);
    // الإلغاء يُؤكَّد فوراً: القرار الملغى لا يستطيع الرد (stale)، فلا انتظار لانتهاء ندائه
    const waitStart = Date.now();
    const verdict = cancelledPrevious ? "cancel" : await new Promise((resolve) => {
      const slot = { superseded: false, wake: resolve };
      lane.queue.push(slot);
      const timer = setTimeout(() => {
        const index = lane.queue.indexOf(slot);
        if (index !== -1) lane.queue.splice(index, 1);
        resolve(slot.superseded ? "superseded" : "timeout");
      }, config.waitTimeoutMs);
      timer.unref?.();
      slot.wake = (value) => { clearTimeout(timer); resolve(value); };
    });
    state.stats.waitedMs += Date.now() - waitStart;
    if (verdict === "superseded") return { status: "superseded" };
  } else {
    lane.recent.push(mine);
  }
  if (state.active >= config.maxActiveGlobal && priority >= PRIORITY.P1) {
    state.stats.flood += 1;
    wakeNext(lane);
    return { status: "flood" };
  }

  // سياق الدفعة: رسائل هذا الشخص التي لم يُرد عليها خلال النافذة (عدا هذه)
  const burst = lane.recent.filter((entry) => entry !== mine && !entry.answered && Date.now() - entry.at <= config.burstWindowMs).map((entry) => entry.text).filter(Boolean).slice(-4);
  if (burst.length) state.stats.coalesced += 1;

  const controller = new AbortController();
  let superseded = false;
  const current = {
    id: m?.key?.id || "",
    responding: false,
    abort: (reason) => { if (!controller.signal.aborted) controller.abort(reason); },
    supersede: () => { superseded = true; },
  };
  lane.current = current;
  state.active += 1;
  let released = false;

  /** @type {Ticket} */
  const ticket = {
    id: current.id,
    signal: controller.signal,
    burst,
    cancelled: () => controller.signal.aborted,
    superseded: () => superseded,
    // قديم = أُلغي أو تجاوزته رسالة أحدث قبل أن يبدأ الرد
    stale: () => controller.signal.aborted || (superseded && !current.responding),
    markResponding: () => {
      current.responding = true;
      mine.answered = true;
      // رد يغطي الدفعة كلها: نصوصها لم تعد «بلا رد»
      for (const entry of lane.recent) if (burst.includes(entry.text)) entry.answered = true;
    },
    release: () => {
      if (released) return;
      released = true;
      state.active = Math.max(0, state.active - 1);
      if (lane.current === current) lane.current = null;
      wakeNext(lane);
    },
  };
  return { status: "proceed", ticket, cancelledPrevious, burst };
}

/** هل لدى هذا الشخص قرار جارٍ؟ (لأوامر «وقف») */
function hasActive(m) {
  return Boolean(laneOf(m).current);
}

/** إلغاء القرار الجاري لهذا الشخص صراحة */
function cancelActive(m, reason = "user-cancel") {
  const lane = laneOf(m);
  if (!lane.current) return false;
  lane.current.abort(reason);
  state.stats.cancelled += 1;
  return true;
}

function concurrencyStats() {
  return { ...state.stats, activeGlobal: state.active, lanes: state.lanes.size, config: { ...config } };
}

/** للاختبارات فقط */
function _resetConcurrency() {
  state.lanes.clear();
  state.seen.clear();
  state.primary.clear();
  state.active = 0;
  for (const key of Object.keys(state.stats)) state.stats[key] = 0;
  Object.assign(config, DEFAULTS);
}

export { DEFAULTS, PRIORITY, _resetConcurrency, cancelActive, claimPrimary, concurrencyStats, configure, enter, fingerprint, hasActive, isCancelText, isDuplicate };
export default { enter, claimPrimary, isDuplicate, cancelActive, concurrencyStats, PRIORITY };
