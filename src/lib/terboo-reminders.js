// ═══════════════════════════════════════════════
// ⏰ Terboo Reminders (§21 §48) — تذكيرات بكلام طبيعي فوق المجدول الموجود
// ───────────────────────────────────────────────
//   «فكرني بعد ساعة أشرب مية» · «ذكرني بكرة الساعة 9 بالاجتماع» · «فكرني كل يوم الساعة 8 بالدوا»
//   · «remind me in 10 minutes to call mom» · «recuérdame mañana a las 9 la reunión»
//   · «تذكيراتي» · «الغي التذكير» · «الغي كل التذكيرات»
//
// لا مجدول ثانٍ: كل تذكير مهمة في terboo-scheduler.js (scheduleMessage) تُحفظ وتُستعاد بعد إعادة التشغيل.
// المالك = الهوية القانونية للمرسل، النطاق = الدردشة: لا يرى أحد تذكيرات غيره ولا يلغيها.
// لا وعود كاذبة: بلا وقت مفهوم ⇒ سؤال عن الوقت؛ أفعال تلقائية متكررة (لخص/ابحث كل يوم) ⇒ رد صريح.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import moment from "moment-timezone";
import { noteFailure } from "./terboo-failure-log.js";
import { identityOf } from "./terboo-identity.js";
import { t } from "./terboo-localization.js";
import * as UI from "./terboo-ui-theme.js";
import { markRaw } from "./terboo-i18n/runtime.js";

const LIMITS = { minMinutes: 1, maxDays: 30, perUser: 10, perChat: 30, whatChars: 300 };
const MINUTE = 60_000;

/** أرقام عربية/فارسية ⇒ لاتينية */
function latinDigits(text) {
  return String(text || "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

// أنماط متسامحة مع الإملاء: ة/ه · أ/إ/آ/ا · ى/ي (بلا تطبيع يغيّر نص التذكير نفسه)
const H = "[ةه]";
const A = "[اأإآ]";
const END = "(?=[\\s،,.!؟?:]|$)";

const TRIGGER = new RegExp(`^\\s*(?:(?:من فضلك|لو سمحت|please)\\s+)?(?:فكّ?رني|ذكّ?رني|نبّ?هني|remind me|recu[eé]rdame)${END}`, "i");
const DAILY = new RegExp(`(?:كل\\s+يوم|يومي${A}?ً?|every\\s*day|daily|todos\\s+los\\s+d[ií]as|cada\\s+d[ií]a)${END}`, "i");
const TOMORROW = new RegExp(`(?:بكر${H}|غد${A}ً?|tomorrow|ma[ñn]ana)${END}`, "i");
const TODAY = new RegExp(`(?:النهارد${H}|${A}ليوم|today|hoy)${END}`, "i");
const SPECIAL = [
  [new RegExp(`(?:بعد|كمان|in|en|dentro\\s+de)\\s+ساع${H}\\s+و\\s*نص${END}`, "i"), 90],
  [new RegExp(`(?:بعد|كمان)\\s+نص\\s+ساع${H}${END}`, "i"), 30],
  [new RegExp(`(?:بعد|كمان)\\s+ربع\\s+ساع${H}${END}`, "i"), 15],
  [/(?:in|after)\s+(?:half\s+an\s+hour|30\s+min(?:ute)?s?)\b/i, 30],
  [/(?:en|dentro\s+de)\s+media\s+hora\b/i, 30],
];
const UNITS = [
  { re: `دقيقتين`, minutes: 1, dual: true }, { re: `ساعتين`, minutes: 60, dual: true }, { re: `يومين`, minutes: 1440, dual: true },
  { re: `دقيق${H}|دقايق|دق${A}ئق|minutes?|mins?|minutos?`, minutes: 1 },
  { re: `ساع${H}|ساع${A}ت|hours?|hrs?|horas?`, minutes: 60 },
  { re: `يوم|${A}ي${A}م|days?|d[ií]as?`, minutes: 1440 },
];
const RELATIVE = new RegExp(`(?:بعد|كمان|in|after|en|dentro\\s+de)\\s+(?:(\\d+(?:[.,]\\d+)?)\\s*)?(${UNITS.map((u) => u.re).join("|")})${END}`, "i");
const ABSOLUTE = new RegExp(`(?:${A}لساع${H}|الس${A}ع${H}|at|a\\s+las?)\\s*(\\d{1,2})(?:[:.](\\d{2}))?\\s*(ص|م|${A}لصبح|صب${A}ح${A}ً?|${A}لضهر|${A}لظهر|${A}لعصر|${A}لمغرب|بالليل|مس${A}ءً?|am|pm|a\\.?m\\.?|p\\.?m\\.?)?${END}`, "i");
const PM_WORDS = /^(?:م|[اأإآ]لعصر|[اأإآ]لمغرب|بالليل|مس[اأإآ]ءً?|pm|p\.?m\.?)$/i;
const AM_WORDS = /^(?:ص|[اأإآ]لصبح|صب[اأإآ]ح[اأإآ]ً?|am|a\.?m\.?)$/i;
const NOON_WORDS = /^(?:[اأإآ]لضهر|[اأإآ]لظهر)$/i;
/** أفعال تنفيذ تلقائي (ليست نص تذكير): «كل يوم لخص الأخبار» */
const ACTION_VERB = new RegExp(`^(?:لخص|ابحث|دور|ابعت|انشر|حمل|نزل|ترجم|summari[sz]e|search|send|post|download|translate|resume|busca|env[ií]a)${END}`, "i");
const CONNECTOR = new RegExp(`^(?:${A}ن|${A}ني|ب|بـ|to|that|about|of|que|de|a|para|عن|على)\\s+`, "i");

function unitMinutes(word) {
  for (const unit of UNITS) {
    if (new RegExp(`^(?:${unit.re})$`, "i").test(word)) return unit;
  }
  return null;
}

function cleanWhat(text) {
  let what = String(text || "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 3; i += 1) what = what.replace(CONNECTOR, "").replace(/^[\s،,.:\-–]+|[\s،,.:\-–]+$/g, "");
  // «بالاجتماع» ⇒ «الاجتماع»
  what = what.replace(/^ب(?=ال)/, "");
  return what.slice(0, LIMITS.whatChars);
}

/**
 * يفهم طلب التذكير بلا نموذج.
 * @param {string} text
 * @param {{now?:Date|number, tz?:string}} [options]
 * @returns {{ok:true, at:Date, repeat:boolean, what:string, recurringAction:boolean} | {ok:false, error:"need-time"|"too-soon"|"too-far"|"daily-needs-time", what:string}}
 */
function parseReminder(text, { now = Date.now(), tz = "Africa/Cairo" } = {}) {
  let rest = latinDigits(text);
  rest = rest.replace(TRIGGER, " ");
  const base = moment.tz(now, tz);
  let at = null;
  const daily = DAILY.test(rest);
  rest = rest.replace(DAILY, " ");

  let relative = 0;
  for (const [re, minutes] of SPECIAL) {
    if (re.test(rest)) { relative = minutes; rest = rest.replace(re, " "); break; }
  }
  if (!relative) {
    const rel = rest.match(RELATIVE);
    if (rel) {
      const unit = unitMinutes(rel[2]);
      const count = unit?.dual ? 2 : Number(String(rel[1] || "1").replace(",", "."));
      relative = Math.round(count * (unit?.minutes || 1));
      rest = rest.replace(rel[0], " ");
    }
  }

  const tomorrow = TOMORROW.test(rest);
  rest = rest.replace(TOMORROW, " ").replace(TODAY, " ");
  const abs = rest.match(ABSOLUTE);
  if (abs) rest = rest.replace(abs[0], " ");

  const what = cleanWhat(rest);
  if (relative) {
    at = base.clone().add(relative, "minutes");
  } else if (abs) {
    let hour = Number(abs[1]);
    const minute = Number(abs[2] || 0);
    const marker = String(abs[3] || "");
    if (hour > 23 || minute > 59) return { ok: false, error: "need-time", what };
    const day = tomorrow ? base.clone().add(1, "day") : base.clone();
    const at0 = (h) => day.clone().hour(h).minute(minute).second(0).millisecond(0);
    if (PM_WORDS.test(marker) && hour < 12) hour += 12;
    else if (AM_WORDS.test(marker) && hour === 12) hour = 0;
    else if (NOON_WORDS.test(marker) && hour < 6) hour += 12;
    if (marker || hour > 12) {
      at = at0(hour);
      if (!tomorrow && at.isSameOrBefore(base)) at.add(1, "day");
    } else if (tomorrow || daily) {
      // «بكرة/كل يوم الساعة 5» بلا ص/م: 1–6 مساءً، 7–11 صباحاً (التأكيد يعرض الوقت المفهوم)
      at = at0(hour >= 1 && hour <= 6 ? hour + 12 : hour);
      if (!tomorrow && at.isSameOrBefore(base)) at.add(1, "day");
    } else {
      // «الساعة 5» اليوم: أقرب موعد قادم بين 5 و17
      at = [at0(hour), at0(hour === 12 ? 12 : hour + 12)].find((c) => c.isAfter(base)) || at0(hour).add(1, "day");
    }
  }

  if (daily && !abs) return { ok: false, error: "daily-needs-time", what };
  if (!at) return { ok: false, error: "need-time", what };
  const diff = at.valueOf() - base.valueOf();
  if (diff < LIMITS.minMinutes * MINUTE - 1000) return { ok: false, error: "too-soon", what };
  if (diff > LIMITS.maxDays * 1440 * MINUTE) return { ok: false, error: "too-far", what };
  return { ok: true, at: at.toDate(), repeat: daily, what, recurringAction: daily && ACTION_VERB.test(what) };
}

// ═══════════════════════════════════════════════
// التخزين: مهام المجدول نفسه (kind:"reminder")
// ═══════════════════════════════════════════════

function ownerOf(m) {
  return identityOf(m?.sender).canonical || String(m?.sender || "");
}

async function scheduler(deps) {
  return deps.scheduler || (await import("./terboo-scheduler.js"));
}

function remindersOf(all, { owner, chat }) {
  return all.filter((task) => task.kind === "reminder" && task.owner === owner && task.jid === chat)
    .sort((a, b) => String(a.nextRun || a.at).localeCompare(String(b.nextRun || b.at)));
}

function whenText(lang, at, tz, { now = Date.now(), repeat = false } = {}) {
  const time = moment.tz(at, tz).locale("en").format("HH:mm");
  if (repeat) return t(lang, "reminders.daily", { time });
  const day = moment.tz(at, tz).startOf("day");
  const today = moment.tz(now, tz).startOf("day");
  const diffDays = Math.round(day.diff(today, "days", true));
  if (diffDays === 0) return t(lang, "reminders.today", { time });
  if (diffDays === 1) return t(lang, "reminders.tomorrow", { time });
  return t(lang, "reminders.onDate", { date: moment.tz(at, tz).locale("en").format("DD/MM"), time });
}

/**
 * ينفّذ طلب تذكير (إنشاء · قائمة · إلغاء) ويُرجع كتل الرد.
 * @param {{m:Object, sock:Object, lang:string, text:string, op?:"schedule"|"list"|"cancel"|"cancel-all", deps?:{scheduler?:Object, now?:number}}} input
 * @returns {Promise<{ok:boolean, op:string, icon:string, blocks:string[], id?:string, at?:Date}>}
 */
async function handleReminder({ m, sock, lang = "ar", text = "", op = "schedule", deps = {} }) {
  const sched = await scheduler(deps);
  const tz = sched.SCHEDULER_TZ || "Africa/Cairo";
  const now = deps.now ?? Date.now();
  const owner = ownerOf(m);
  const chat = String(m?.chat || "");
  const mine = () => remindersOf(sched.getScheduledMessages(), { owner, chat });
  const save = () => { try { sched.saveScheduledMessages(); } catch (error) { noteFailure("reminders", error, { where: "src/lib/terboo-reminders.js:save", stage: "saveScheduledMessages" }); } };

  if (op === "list") {
    const rows = mine();
    if (!rows.length) return { ok: false, op, icon: "⏰", blocks: [t(lang, "reminders.none")] };
    return {
      ok: true, op, icon: "⏰",
      blocks: [UI.section(t(lang, "reminders.listTitle"), lang), rows.map((task) => UI.bullet(t(lang, "reminders.line", { when: whenText(lang, task.at || task.nextRun, tz, { now, repeat: task.repeat }), what: markRaw(task.what) }), lang)).join("\n")],
    };
  }

  if (op === "cancel" || op === "cancel-all") {
    const rows = mine();
    if (!rows.length) return { ok: false, op, icon: "⏰", blocks: [t(lang, "reminders.none")] };
    const targets = op === "cancel-all" ? rows : [rows.at(-1)];
    for (const task of targets) sched.cancelScheduledMessage(task.id);
    save();
    return op === "cancel-all"
      ? { ok: true, op, icon: "🗑️", blocks: [t(lang, "reminders.cancelledAll", { count: targets.length })] }
      : { ok: true, op, icon: "🗑️", blocks: [t(lang, "reminders.cancelled", { what: markRaw(targets[0].what) })] };
  }

  const parsed = parseReminder(text, { now, tz });
  if (!parsed.ok) {
    const key = { "too-soon": "reminders.tooSoon", "too-far": "reminders.tooFar", "daily-needs-time": "reminders.dailyNeedsTime" }[parsed.error] || "reminders.needTime";
    return { ok: false, op, icon: "⏰", blocks: [t(lang, key)] };
  }
  if (parsed.recurringAction) return { ok: false, op, icon: "⏰", blocks: [t(lang, "reminders.recurringAction", { what: markRaw(parsed.what) })] };

  const all = sched.getScheduledMessages().filter((task) => task.kind === "reminder");
  const count = all.filter((task) => task.owner === owner).length;
  if (count >= LIMITS.perUser) return { ok: false, op, icon: "⏰", blocks: [t(lang, "reminders.tooMany", { count })] };
  if (all.filter((task) => task.jid === chat).length >= LIMITS.perChat) return { ok: false, op, icon: "⏰", blocks: [t(lang, "reminders.chatFull")] };

  const what = parsed.what || t(lang, "reminders.defaultWhat");
  const local = moment.tz(parsed.at, tz);
  const mentionJid = m?.isGroup ? String(m.sender || "") : "";
  const tag = mentionJid ? `@${mentionJid.split("@")[0].split(":")[0]} ` : "";
  const message = { text: `${tag}${t(lang, "reminders.fire", { what })}`, ...(mentionJid ? { mentions: [mentionJid] } : {}) };
  const id = `rem_${String(owner).replace(/\W/g, "").slice(-12)}_${now}_${crypto.randomBytes(3).toString("hex")}`;
  try {
    await sched.scheduleMessage({
      id, jid: chat, message, hour: local.hour(), minute: local.minute(), repeat: parsed.repeat,
      ...(parsed.repeat ? {} : { date: local.clone().locale("en").format("YYYY-MM-DD") }),
      persist: true, kind: "reminder", owner, lang, what, at: parsed.at.toISOString(),
    }, sock);
  } catch (error) {
    noteFailure("reminders", error, { where: "src/lib/terboo-reminders.js:handleReminder", stage: "scheduleMessage" });
    return { ok: false, op, icon: "⚠️", blocks: [t(lang, "reminders.failed")] };
  }
  save();
  const when = whenText(lang, parsed.at, tz, { now, repeat: parsed.repeat });
  return { ok: true, op, id, at: parsed.at, icon: "⏰", blocks: [t(lang, parsed.repeat ? "reminders.setDaily" : "reminders.set", { when, what: markRaw(what) })] };
}

export { LIMITS as REMINDER_LIMITS, handleReminder, parseReminder, remindersOf };
export default { handleReminder, parseReminder };
