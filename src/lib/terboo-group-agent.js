// ═══════════════════════════════════════════════
// 🧑‍✈️ Terboo Group Agent — طلبات المجموعة الطبيعية ⇒ أدوات حقيقية (§9 §10 §11 §31 §32)
// ───────────────────────────────────────────────
//   «اطرد كل الأعضاء إلا أحمد» · «اطرد الكل» · «اطرد أحمد ومحمد» · «رقي @a @b»
//   · «اقفل الجروب ساعة» · «افتح الجروب بعد 30 دقيقة» · «الجروب مقفول؟»
//   · «غير اسم الجروب لـ…» · «هات لينك الجروب» · «غير اللينك» · «احظر أحمد» · «فك الحظر عن أحمد»
// المسار: فهم ← تحديد الأهداف من المحلل (لا JID من النموذج) ← محرّك الصلاحيات ← حماية الأهداف
//   ← تأكيد مركزي للجماعي/المدمّر ← تنفيذ (terboo-group-actions) ← تحقق من واتساب ← تقرير صادق.
// الجماعي يعمل كمهمة خلفية قابلة للإلغاء («وقف الطرد») بتقرير نهائي (تم/فشل/مستثنى ولماذا).
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import * as brand from "./terboo-brand.js";
import { recall, recordAction, remember } from "./terboo-context-engine.js";
import { consumeActionToken, createActionToken } from "./terboo-flow.js";
import * as G from "./terboo-group-actions.js";
import { findByName, getDirectory } from "./terboo-group-directory.js";
import { identityOf, isBot } from "./terboo-identity.js";
import { stepOf } from "./terboo-latency.js";
import { t } from "./terboo-localization.js";
import { candidateOf, resolveMember } from "./terboo-member-resolver.js";
import { DECISION, decide, principalOf, protectTargets } from "./terboo-permissions.js";
import { taskOwner } from "./terboo-task-control.js";
import { sendCard } from "./terboo-ui-kit.js";
import * as UI from "./terboo-ui-theme.js";

// ═══════════════════════════════════════════════
// التطبيع والمدد
// ═══════════════════════════════════════════════

/** أرقام عربية-هندية وفارسية ⇒ لاتينية */
function westernDigits(text) {
  return String(text || "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function norm(text) {
  return westernDigits(text)
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/[؟?!.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
const POLITE = /\s*(?:لو سمحت|من فضلك|بالله|يا تيربو|يا تربو|بقي|بقا|please|pls|por favor)\s*/giu;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NUMBER_WORDS = Object.freeze({
  واحد: 1, واحده: 1, اتنين: 2, اثنين: 2, تلاته: 3, ثلاثه: 3, تلات: 3, اربعه: 4, اربع: 4, خمسه: 5, خمس: 5, سته: 6, ست: 6,
  سبعه: 7, تمانيه: 8, ثمانيه: 8, تسعه: 9, عشره: 10, عشر: 10, ربع: 0.25, نص: 0.5, نصف: 0.5,
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, ten: 10, fifteen: 15, twenty: 20, thirty: 30, half: 0.5,
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, diez: 10, quince: 15, veinte: 20, treinta: 30, media: 0.5,
});
const UNIT_WORDS = [
  [/^(?:ساعتين)$/u, 2 * HOUR], [/^(?:دقيقتين)$/u, 2 * MINUTE], [/^(?:يومين)$/u, 2 * DAY],
  [/^(?:ساعه|ساعات|س|hours?|hrs?|h|horas?)$/u, HOUR],
  [/^(?:دقيقه|دقايق|دقائق|د|minutes?|mins?|m|minutos?)$/u, MINUTE],
  [/^(?:يوم|ايام|ي|days?|d|d[ií]as?)$/u, DAY],
];
const HALF_AFTER = /^(?:ونص|و\s?نص|and a half|y media)$/u;

/** «ساعة» · «ساعتين» · «نص ساعة» · «ساعة ونص» · «30 دقيقة» · «2h» · «half an hour» · «media hora» ⇒ ms (أو null) */
function durationOf(fragment) {
  const s = norm(fragment).replace(/^(?:لمده|لفتره|مده|for|por|durante|during)\s+/u, "").trim();
  if (!s) return null;
  const compact = s.match(/^(\d+(?:\.\d+)?)\s*([mhdسدي])$/u);
  if (compact) return Number(compact[1]) * UNIT_WORDS.find(([re]) => re.test(compact[2]))[1];
  const tokens = s.replace(/\s+و\s?نص$/u, " ونص").split(" ");
  const unitAt = tokens.findIndex((token) => UNIT_WORDS.some(([re]) => re.test(token)));
  if (unitAt < 0) return null;
  const unit = UNIT_WORDS.find(([re]) => re.test(tokens[unitAt]))[1];
  let count = 1;
  for (const token of tokens.slice(0, unitAt)) {
    const value = /^\d+(?:\.\d+)?$/.test(token) ? Number(token) : NUMBER_WORDS[token];
    if (value === undefined) return null;
    count *= value;
  }
  const tail = tokens.slice(unitAt + 1).join(" ");
  if (tail && !HALF_AFTER.test(tail)) return null;
  const ms = Math.round(count * unit + (tail ? unit / 2 : 0));
  return ms > 0 ? ms : null;
}

/** «60 دقيقة» · «ساعتان» للعرض */
function durationText(lang, ms) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return t(lang, "grp.durMinutes", { n: minutes });
  if (minutes < 24 * 60) {
    const hours = Math.round((minutes / 60) * 10) / 10;
    return t(lang, "grp.durHours", { n: hours });
  }
  return t(lang, "grp.durDays", { n: Math.round((minutes / (24 * 60)) * 10) / 10 });
}

// ═══════════════════════════════════════════════
// الفهم
// ═══════════════════════════════════════════════

const GROUP_NOUN = "(?:ال)?(?:جروب|مجموعه|قروب|شات|دردشه)";
const SETTING_PATTERNS = [
  { op: "restrict", re: new RegExp(`^(?:اقفل|قفل|اغلق)\\s+(?:تعديل|تغيير)\\s+(?:(?:اعدادات|بيانات|معلومات|اسم|وصف)\\s+)?${GROUP_NOUN}(?:\\s+(?<rest>.+))?$`, "u") },
  { op: "unrestrict", re: new RegExp(`^(?:افتح|فتح)\\s+(?:تعديل|تغيير)\\s+(?:(?:اعدادات|بيانات|معلومات|اسم|وصف)\\s+)?${GROUP_NOUN}(?:\\s+(?<rest>.+))?$`, "u") },
  { op: "lock", re: new RegExp(`^(?:اقفل|قفل|سكر|اغلق|اقفلي|قفلي)\\s+(?:لي\\s+)?${GROUP_NOUN}(?:\\s+(?<rest>.+))?$`, "u") },
  { op: "unlock", re: new RegExp(`^(?:افتح|فتح|افتحي)\\s+(?:لي\\s+)?${GROUP_NOUN}(?:\\s+(?<rest>.+))?$`, "u") },
  { op: "restrict", re: /^(?:lock|restrict)\s+(?:the\s+)?group\s+(?:info|settings|editing)(?:\s+(?<rest>.+))?$/u },
  { op: "unrestrict", re: /^(?:unlock|unrestrict)\s+(?:the\s+)?group\s+(?:info|settings|editing)(?:\s+(?<rest>.+))?$/u },
  { op: "lock", re: /^(?:lock|close|mute)\s+(?:the\s+|this\s+)?(?:group|chat)(?:\s+(?<rest>.+))?$/u },
  { op: "unlock", re: /^(?:unlock|open|unmute|reopen)\s+(?:the\s+|this\s+)?(?:group|chat)(?:\s+(?<rest>.+))?$/u },
  { op: "lock", re: /^(?:cierra|bloquea|silencia)\s+(?:el\s+)?(?:grupo|chat)(?:\s+(?<rest>.+))?$/u },
  { op: "unlock", re: /^(?:abre|desbloquea|reabre)\s+(?:el\s+)?(?:grupo|chat)(?:\s+(?<rest>.+))?$/u },
];
const DELAY = /^(?:بعد|كمان|in|after|en|dentro de|despu[eé]s de)\s+(.+)$/u;
const NOW = /^(?:دلوقتي|دلوقت|حالا|الان|فورا|now|right now|ahora|ya)$/u;

const SETTINGS_GET = [
  new RegExp(`^(?:هل\\s+)?${GROUP_NOUN}\\s+(?:مقفول|مقفوله|مقفل|مفتوح|مفتوحه)$`, "u"),
  new RegExp(`^(?:حاله|اعدادات|وضع|اعدادت)\\s+${GROUP_NOUN}$`, "u"),
  /^(?:is\s+(?:the\s+|this\s+)?group\s+(?:locked|closed|open)|(?:show\s+)?(?:the\s+)?group\s+(?:settings|status))$/u,
  /^(?:(?:est[aá]\s+)?(?:el\s+)?grupo\s+(?:cerrado|abierto)|configuraci[oó]n\s+del\s+grupo|estado\s+del\s+grupo)$/u,
];

/** القيمة النصية تُستخرج من النص الأصلي (بلا تطبيع يغيّر حروف الاسم) */
const SEP = "\\s*(?:ليكون|يبقى|يبقي|لـ|الى|إلى|الي|ل|:)\\s*";
const SUBJECT_PATTERNS = [
  new RegExp(`^(?:غير|غيّر|عدل|عدّل|بدل|بدّل|خلي|خلّي)\\s+اسم\\s+(?:ال)?(?:جروب|مجموعة|مجموعه|قروب)${SEP}(.+)$`, "su"),
  /^(?:سمي|سمّي)\s+(?:ال)?(?:جروب|مجموعة|مجموعه|قروب)\s+(.+)$/su,
  /^(?:rename)\s+(?:the\s+|this\s+)?group\s+(?:to\s+)?(.+)$/isu,
  /^(?:set|change)\s+(?:the\s+)?group\s+(?:name|subject|title)\s+(?:to\s+)?(.+)$/isu,
  /^(?:cambia|pon)\s+(?:el\s+)?nombre\s+del\s+grupo\s+(?:a\s+|como\s+)?(.+)$/isu,
];
const DESCRIPTION_PATTERNS = [
  new RegExp(`^(?:غير|غيّر|عدل|عدّل|بدل|حط|اكتب|خلي)\\s+(?:ال)?وصف\\s+(?:ال)?(?:جروب|مجموعة|مجموعه|قروب)${SEP}(.+)$`, "su"),
  /^(?:set|change)\s+(?:the\s+)?group\s+description\s+(?:to\s+)?(.+)$/isu,
  /^(?:cambia|pon)\s+(?:la\s+)?descripci[oó]n\s+del\s+grupo\s+(?:a\s+)?(.+)$/isu,
];
const DESCRIPTION_CLEAR = new RegExp(`^(?:امسح|احذف|شيل)\\s+(?:ال)?وصف\\s+${GROUP_NOUN}$|^(?:clear|remove|delete)\\s+(?:the\\s+)?group\\s+description$|^(?:borra|elimina)\\s+(?:la\\s+)?descripci[oó]n\\s+del\\s+grupo$`, "u");
const INVITE_GET = new RegExp(`^(?:(?:هات|ابعت|ابعتلي|هاتلي|اديني|عايز|عاوز|اعطني|ابغي)\\s+)?(?:ال)?(?:لينك|رابط)\\s+(?:ال)?(?:جروب|مجموعه|قروب|دعوه)$|^(?:(?:send|give me|get)\\s+)?(?:the\\s+)?(?:group\\s+(?:invite\\s+)?link|invite link)$|^(?:(?:dame|manda)\\s+)?(?:el\\s+)?(?:enlace|link)\\s+del\\s+grupo$`, "u");
const INVITE_REVOKE = new RegExp(`^(?:غير|جدد|الغي|صفر)\\s+(?:ال)?(?:لينك|رابط)(?:\\s+(?:ال)?(?:جروب|مجموعه|قروب|دعوه))?(?:\\s+(?:ال)?قديم)?$|^(?:اعمل|اعملي)\\s+(?:لينك|رابط)\\s+جديد(?:\\s+(?:لل)?(?:جروب|مجموعه))?$|^(?:revoke|reset|regenerate)\\s+(?:the\\s+)?(?:group\\s+)?(?:invite\\s+)?link$|^(?:restablece|revoca|cambia)\\s+(?:el\\s+)?(?:enlace|link)(?:\\s+del\\s+grupo)?$`, "u");

const KICK_ALL = [
  new RegExp(`^(?:اطرد|طرد|شيل|طلع|اخرج)\\s+(?:كل\\s+(?:ال)?(?:اعضاء|اعضا|ناس|افراد|عالم|اللي\\s+(?:في|ف)\\s+${GROUP_NOUN}|اللي\\s+هنا)|الكل|الجميع|كلهم|كل\\s+الناس)(?:\\s+(?:من|برا|بره)\\s+${GROUP_NOUN})?(?<rest>.*)$`, "u"),
  /^(?:kick|remove)\s+(?:all|everyone|everybody|all\s+(?:the\s+)?members)(?:\s+(?:from|out of)\s+(?:the\s+|this\s+)?group)?(?<rest>.*)$/u,
  /^(?:expulsa|saca|echa)\s+a\s+todos(?:\s+los\s+miembros)?(?:\s+del\s+grupo)?(?<rest>.*)$/u,
];
const EXCEPT = /^\s*(?:ما\s*عدا|ماعدا|عدا|الا|غير|باستثناء|ما\s*عدي|except(?:\s+for)?|but|apart from|menos(?:\s+a)?|excepto(?:\s+a)?|salvo(?:\s+a)?)\s+(.+)$/u;
const ADMINS_ONLY = /^(?:ال)?(?:مشرفين|ادمنز|ادمنيه|ادمن)$|^(?:the\s+)?admins$|^(?:los\s+)?admins$/u;
const WITH_ADMINS = /\s*(?:(?:حتي|و|بما فيهم|ومعاهم|مع)\s*(?:ال)?(?:مشرفين|ادمنز|ادمنيه|ادمن)(?:\s+كمان)?|,?\s*including (?:the )?admins|,?\s*admins too|,?\s*incluso (?:a )?los admins)\s*/u;

/** strong: صيغة فعل عربية واضحة — غيرها (block/bloquea) لا يُرد عليه برفض لغير المالك إلا بهدف صريح */
const BLOCK_PATTERNS = [
  { block: false, strong: true, re: /^(?:فك|الغي|شيل|ارفع)\s+(?:ال)?(?:حظر|بلوك|بلك)(?<pro>ه|ها)?(?=\s|$)(?:\s+(?:عن|من|لل|ل))?\s*(?<name>.*)$/u },
  { block: true, strong: true, re: /^(?:احظر|حظر|بلك|بلوك|اعمل\s+(?:بلوك|بلك|حظر))(?<pro>ه|ها)?(?=\s|$)(?:\s+(?:علي|لل|ل))?\s*(?<name>.*)$/u },
  { block: false, re: /^unblock\s+(?<name>\S+(?:\s+\S+){0,2})$/u },
  { block: true, re: /^block\s+(?<name>(?!the\s+(?:group|chat))\S+(?:\s+\S+){0,2})$/u },
  { block: false, re: /^desbloquea(?<pro>lo|la)?(?=\s|$)\s*(?:a\s+)?(?<name>.*)$/u },
  { block: true, re: /^bloquea(?<pro>lo|la)?(?=\s|$)\s*(?:a\s+)?(?<name>(?!(?:el\s+)?(?:grupo|chat)).*)$/u },
];
/** «بدون تأكيد» — طلب صريح من المالك يسمح بتجاوز تأكيد ما تسمح سياسته بذلك فقط */
const EXPLICIT = /\s*(?:بدون|من غير|بلا)\s+(?:تاكيد|ما تسالني|سؤال)|\s*(?:without|no) confirm(?:ation)?|\s*sin confirmar/u;
const SEPARATORS = /\s*(?:،|,|\s+و(?=\S)|\s+(?:and|y|&)\s+)\s*/u;

/**
 * يفهم طلب مجموعة/حظر. null ⇒ ليس من اختصاصه.
 * @returns {null|{kind:string, op?:string, delayMs?:number, durationMs?:number, value?:string, exceptText?:string,
 *          allowAdmins?:boolean, block?:boolean, name?:string, pronoun?:boolean, explicit?:boolean}}
 */
function parseGroupRequest(raw) {
  const original = String(raw || "").trim();
  if (!original || original.length > 300) return null;
  let s = norm(original).replace(POLITE, " ").replace(/\s+/g, " ").trim();
  const explicit = EXPLICIT.test(s);
  s = s.replace(EXPLICIT, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;

  for (const re of SUBJECT_PATTERNS) {
    const hit = original.match(re);
    if (hit) return { kind: "subject", value: cleanValue(hit[1]) };
  }
  if (DESCRIPTION_CLEAR.test(s)) return { kind: "description", value: "" };
  for (const re of DESCRIPTION_PATTERNS) {
    const hit = original.match(re);
    if (hit) return { kind: "description", value: cleanValue(hit[1]) };
  }
  if (s.length > 120) return null;
  if (SETTINGS_GET.some((re) => re.test(s))) return { kind: "settings.get" };
  if (INVITE_GET.test(s)) return { kind: "invite.get" };
  if (INVITE_REVOKE.test(s)) return { kind: "invite.revoke", explicit };
  for (const pattern of SETTING_PATTERNS) {
    const hit = s.match(pattern.re);
    if (!hit) continue;
    const rest = (hit.groups?.rest || "").trim();
    if (!rest || NOW.test(rest)) return { kind: "setting", op: pattern.op };
    const delay = rest.match(DELAY);
    if (delay) {
      const ms = durationOf(delay[1]);
      return ms ? { kind: "setting", op: pattern.op, delayMs: ms } : null;
    }
    const ms = durationOf(rest);
    return ms ? { kind: "setting", op: pattern.op, durationMs: ms } : null;
  }
  const allowAdmins = WITH_ADMINS.test(s);
  const plain = s.replace(WITH_ADMINS, " ").replace(/\s+/g, " ").trim();
  for (const re of KICK_ALL) {
    const hit = plain.match(re);
    if (!hit) continue;
    const rest = (hit.groups?.rest || "").trim();
    if (!rest) return { kind: "bulk", op: "kick", mode: "all", exceptText: "", allowAdmins };
    const except = rest.match(EXCEPT);
    if (!except) return null;
    // «إلا المشرفين»: محميون أصلاً ⇒ لا استثناء بالاسم
    const exceptText = ADMINS_ONLY.test(except[1].trim()) ? "" : except[1].trim();
    return { kind: "bulk", op: "kick", mode: "all", exceptText, allowAdmins };
  }
  for (const pattern of BLOCK_PATTERNS) {
    const hit = s.match(pattern.re);
    if (!hit) continue;
    const name = (hit.groups?.name || "").trim();
    const pronoun = Boolean(hit.groups?.pro) || /^(?:ده|دا|دي|هو|هي|him|her|them|it)$/u.test(name);
    if (name.length > 60) return null;
    return { kind: "block", block: pattern.block, strong: Boolean(pattern.strong), name: pronoun && /^(?:ده|دا|دي|هو|هي|him|her|them|it)$/u.test(name) ? "" : name, pronoun, explicit };
  }
  return null;
}

function cleanValue(value) {
  return String(value || "").trim().replace(/^[«"“'`]+|[»"”'`]+$/g, "").trim();
}

// ═══════════════════════════════════════════════
// الرد
// ═══════════════════════════════════════════════

function footer(lang) {
  return UI.footer(brand.plainName(), null, lang);
}

async function say(m, lang, blocks, { icon = "👥" } = {}) {
  const text = UI.card({ title: "", blocks: [blocks.filter(Boolean).map((b, i) => (i === 0 ? `${icon} ${b}` : b)).join("\n")], lang });
  await m.reply(text).catch((error) => noteFailure("group-agent", error, { where: "terboo-group-agent:say", stage: "reply" }));
  return "answered";
}

function label(target) {
  const n = target?.number || "";
  const tail = n ? `…${n.slice(-4)}` : target?.lid ? "LID" : "";
  const name = target?.name && !/^\+?\d+$/.test(target.name) ? target.name : "";
  return name ? `${name}${tail ? ` (${tail})` : ""}` : tail || "?";
}

/** نص مفتاح إن وُجدت له ترجمة، وإلا null (t يعيد المفتاح نفسه حين لا ترجمة) */
const known = (text) => (/^[a-z]+\.[\w-]+$/.test(text) ? null : text);

/** سبب رفض الصلاحية ⇒ نص مفهوم */
function permText(lang, decision) {
  return known(t(lang, `act.perm_${decision.reason}`)) || t(lang, "act.permDenied");
}

function codeText(lang, code) {
  return known(t(lang, `grp.code_${code}`)) || t(lang, "grp.code_unknown");
}

/** ملخص مستثنين/فاشلين مجمّع بالسبب (أسماء لأول 5 فقط) */
function groupedLines(lang, rows, reasonKey) {
  const byReason = new Map();
  for (const row of rows) {
    const reason = row.reason || row.code || "unknown";
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push(row.target || row);
  }
  return [...byReason.entries()].map(([reason, list]) => {
    const names = list.slice(0, 5).map(label).join("، ");
    const more = list.length > 5 ? ` ${t(lang, "grp.andMore", { n: list.length - 5 })}` : "";
    return UI.bullet(`${reasonKey(reason)} — ${list.length}${names ? `: ${names}${more}` : ""}`, lang);
  });
}

const protectReason = (lang) => (reason) => t(lang, `act.protect_${String(reason).split(" ")[0]}`);

// ═══════════════════════════════════════════════
// التأكيد المركزي (زر أو كتابة)
// ═══════════════════════════════════════════════

async function askConfirm(m, sock, lang, { title, blocks = [], payload, icon = "⚠️", confirmKey = "grp.btnConfirm" }) {
  const token = createActionToken({ user: m.sender, action: "grp", payload });
  remember(m, "choice", { kind: "grp-confirm", token });
  const sent = await sendCard(sock, m, {
    cardId: "group-confirm",
    lang,
    title,
    icon,
    blocks,
    footer: footer(lang),
    buttons: [
      { id: `terboo_grp_${token}`, text: `✅ ${t(lang, confirmKey)}`, typed: t(lang, confirmKey) },
      { id: "terboo_grp_no", text: `✖️ ${t(lang, "act.btnNo")}`, typed: t(lang, "act.btnNo") },
    ],
  }).catch((error) => {
    noteFailure("group-agent", error, { where: "terboo-group-agent:askConfirm", stage: "card", fallback: "text" });
    return null;
  });
  if (!sent) await say(m, lang, [title, ...blocks, t(lang, "grp.typeConfirm")], { icon });
  return "answered";
}

const YES = /^(?:اه|ايوه|ايوا|اكيد|نعم|تمام|اكد|نفذ|موافق|yes|yeah|yep|sure|ok|confirm|si|sí|claro|confirmar|confirmo)$/u;
const NO = /^(?:لا|لأ|لاء|بلاش|الغي|الغاء|كنسل|no|nope|cancel|cancelar)$/u;

/** ضغطة/كتابة تأكيد لطلب مجموعة معلّق ⇒ تنفيذ؛ null ⇒ ليست لهذا المحرك */
async function handleGroupConfirm({ m, sock, lang, text, respond = () => {} }) {
  const value = String(text || "").trim();
  const button = value.match(/^terboo_grp_([\w-]{6,40}|no)$/);
  const choice = recall(m, "choice");
  let token = null;
  if (button) token = button[1];
  else if (choice?.kind === "grp-confirm") {
    const typed = norm(value);
    if (NO.test(typed)) token = "no";
    else if (YES.test(typed)) token = choice.token;
  } else if (choice?.kind === "grp-pick") {
    const typed = norm(value);
    if (NO.test(typed)) token = "no";
    else if (/^[1-3]$/.test(typed)) token = choice.tokens[Number(typed) - 1] || null;
  }
  if (!token) return null;
  respond();
  remember(m, "choice", { kind: "none" });
  if (token === "no") return say(m, lang, [t(lang, "act.cancelled")], { icon: "✖️" });
  const entry = consumeActionToken(m.sender, token, { action: "grp" });
  if (!entry) return say(m, lang, [t(lang, "act.expired")], { icon: "⌛" });
  return executeConfirmed({ m, sock, lang, payload: entry.payload });
}

// ═══════════════════════════════════════════════
// التنفيذ
// ═══════════════════════════════════════════════

const SETTING_ACTION = { lock: "group.settings.lock", unlock: "group.settings.unlock", restrict: "group.settings.restrict", unrestrict: "group.settings.unrestrict" };
const BULK_ACTION = { all: "group.members.kickAll", kick: "group.members.kickSelected", promote: "group.members.promoteSelected", demote: "group.members.demoteSelected" };

/** قرار مركزي + رد بالرفض إن لزم. ⇒ القرار، أو null بعد الرد بالرفض */
async function gate(m, lang, principal, action, extra = {}) {
  const decision = decide({ principal, action, ...extra });
  stepOf(m, "permission", `${action}:${decision.decision}`);
  if (decision.allowed || decision.decision === DECISION.NEEDS_CONFIRMATION) return decision;
  await say(m, lang, [permText(lang, decision)], { icon: "⛔" });
  return null;
}

async function runSetting(m, sock, lang, request, principal) {
  const { op } = request;
  const scheduled = Boolean(request.delayMs || request.durationMs);
  if (!(await gate(m, lang, principal, SETTING_ACTION[op]))) return "answered";
  if (scheduled && !(await gate(m, lang, principal, "group.settings.schedule"))) return "answered";
  const owner = taskOwner(m);
  // «افتحه بعد 30 دقيقة»: مهمة مؤجّلة فقط
  if (request.delayMs) {
    const plan = G.scheduleSetting({ groupId: m.chat, op, at: Date.now() + request.delayMs, owner: owner.owner, scope: owner.scope, lang, chat: m.chat, title: t(lang, `grp.task_${op}`) });
    stepOf(m, "tool", `group.schedule:${op}`);
    stepOf(m, "verify", plan.ok ? "scheduled" : plan.code);
    if (!plan.ok) return say(m, lang, [codeText(lang, plan.code)], { icon: "⚠️" });
    recordAction(m, { kind: `group.schedule.${op}` });
    return say(m, lang, [t(lang, `grp.scheduled_${op}`, { when: durationText(lang, request.delayMs) }), plan.replaced.length ? t(lang, "grp.replacedSchedule") : "", t(lang, "grp.cancelHint", { id: plan.id })], { icon: "⏳" });
  }
  stepOf(m, "tool", `group.settings:${op}`);
  const result = await G.applySetting(sock, m.chat, op);
  stepOf(m, "verify", result.ok ? (result.verified ? "ok" : "unverified") : result.code);
  if (!result.ok) return say(m, lang, [t(lang, "grp.settingFailed", { op: t(lang, `grp.op_${op}`), reason: codeText(lang, result.code) })], { icon: "⚠️" });
  recordAction(m, { kind: `group.${op}` });
  const lines = [t(lang, result.already ? `grp.already_${op}` : `grp.done_${op}`)];
  if (!result.verified) lines.push(t(lang, "grp.unverified"));
  // «اقفله ساعة»: نفّذ الآن + مهمة عكسية بعد المدة
  if (request.durationMs) {
    const reverse = G.SETTING_OPS[op].reverse;
    const plan = G.scheduleSetting({ groupId: m.chat, op: reverse, at: Date.now() + request.durationMs, owner: owner.owner, scope: owner.scope, lang, chat: m.chat, title: t(lang, `grp.task_${reverse}`) });
    lines.push(plan.ok ? t(lang, `grp.scheduled_${reverse}`, { when: durationText(lang, request.durationMs) }) : codeText(lang, plan.code));
    if (plan.ok) lines.push(t(lang, "grp.cancelHint", { id: plan.id }));
  }
  return say(m, lang, lines, { icon: op === "lock" || op === "restrict" ? "🔒" : "🔓" });
}

async function runSettingsGet(m, sock, lang, principal) {
  if (!(await gate(m, lang, principal, "group.settings.get"))) return "answered";
  stepOf(m, "tool", "group.settings:get");
  const result = await G.readSettings(sock, m.chat);
  stepOf(m, "verify", result.ok ? "ok" : result.code);
  if (!result.ok) return say(m, lang, [t(lang, "act.directoryUnavailable")], { icon: "⚠️" });
  const s = result.settings;
  const pending = G.pendingSchedules(m.chat).filter((task) => task.status === "queued");
  return say(m, lang, [
    t(lang, "grp.settingsTitle", { group: s.subject || "" }),
    UI.bullet(t(lang, s.locked ? "grp.messagesAdmins" : "grp.messagesAll"), lang),
    UI.bullet(t(lang, s.restricted ? "grp.infoAdmins" : "grp.infoAll"), lang),
    UI.bullet(t(lang, "grp.membersLine", { count: s.size, admins: s.admins }), lang),
    s.joinApprovalMode ? UI.bullet(t(lang, "grp.approvalOn"), lang) : "",
    s.ephemeral ? UI.bullet(t(lang, "grp.ephemeralOn", { when: durationText(lang, s.ephemeral * 1000) }), lang) : "",
    ...pending.map((task) => UI.bullet(t(lang, "grp.pendingLine", { op: t(lang, `grp.op_${task.input?.op}`), when: durationText(lang, Math.max(MINUTE, (task.notBefore || task.input?.at || Date.now()) - Date.now())), id: task.id }), lang)),
  ], { icon: s.locked ? "🔒" : "🔓" });
}

async function runText(m, sock, lang, request, principal) {
  const action = request.kind === "subject" ? "group.subject.set" : "group.description.set";
  if (!(await gate(m, lang, principal, action))) return "answered";
  stepOf(m, "tool", action);
  const result = request.kind === "subject" ? await G.setSubject(sock, m.chat, request.value) : await G.setDescription(sock, m.chat, request.value);
  stepOf(m, "verify", result.ok ? (result.verified ? "ok" : "unverified") : result.code);
  if (!result.ok) return say(m, lang, [t(lang, "grp.textFailed", { reason: codeText(lang, result.code), limit: result.limit || "" })], { icon: "⚠️" });
  recordAction(m, { kind: action });
  const key = request.kind === "subject" ? "grp.subjectDone" : request.value ? "grp.descriptionDone" : "grp.descriptionCleared";
  return say(m, lang, [t(lang, result.already ? "grp.textAlready" : key, { value: request.value }), result.verified ? "" : t(lang, "grp.unverified")], { icon: "✏️" });
}

async function runInvite(m, sock, lang, request, principal, { confirmed = false } = {}) {
  const action = request.kind === "invite.revoke" ? "group.invite.revoke" : "group.invite.get";
  const decision = await gate(m, lang, principal, action, { confirmed, explicit: Boolean(request.explicit) });
  if (!decision) return "answered";
  if (decision.decision === DECISION.NEEDS_CONFIRMATION) {
    return askConfirm(m, sock, lang, { title: t(lang, "grp.revokeConfirm"), payload: { type: "invite.revoke", groupId: m.chat } });
  }
  stepOf(m, "tool", action);
  const result = request.kind === "invite.revoke" ? await G.revokeInvite(sock, m.chat) : await G.inviteLink(sock, m.chat);
  stepOf(m, "verify", result.ok ? (result.verified === false ? "unverified" : "ok") : result.code);
  if (!result.ok) return say(m, lang, [t(lang, "grp.inviteFailed", { reason: codeText(lang, result.code) })], { icon: "⚠️" });
  recordAction(m, { kind: action });
  const title = t(lang, request.kind === "invite.revoke" ? "grp.revokeDone" : "grp.inviteTitle");
  const sent = await sendCard(sock, m, { cardId: "group-invite", lang, title, icon: "🔗", blocks: [result.link], footer: footer(lang), copies: [{ text: t(lang, "grp.copyLink"), code: result.link }] })
    .catch((error) => {
      noteFailure("group-agent", error, { where: "terboo-group-agent:runInvite", stage: "card", fallback: "text" });
      return null;
    });
  if (!sent) await say(m, lang, [title, result.link], { icon: "🔗" });
  return "answered";
}

/** هدف الحظر من المحلل: منشن · رد · رقم · اسم (المجموعة/الخارجون/جهات الاتصال) · ضمير ⇒ آخر عضو */
async function blockTarget(m, sock, lang, request) {
  const names = request.name ? [request.name, ...(/^ل[^ل]/u.test(request.name) ? [request.name.slice(1)] : [])] : [""];
  let result = null;
  for (const name of names) {
    result = await resolveMember({ m, sock, name, purpose: "add", text: request.name || "" });
    if (result.status === "resolved" || result.status === "ambiguous") break;
  }
  if (result.status === "resolved") return { target: result.target, weak: Boolean(result.weak) };
  if (result.status === "ambiguous") return { options: result.options };
  if (result.status === "not-found") return { reply: await say(m, lang, [t(lang, "grp.blockNotFound", { name: request.name || "" })], { icon: "🔎" }) };
  return { reply: await say(m, lang, [t(lang, "grp.blockWho")], { icon: "❓" }) };
}

async function runBlock(m, sock, lang, request, principal) {
  const action = request.block ? "contact.block" : "contact.unblock";
  // مالك فقط: الرفض قبل أي بحث عن هدف (لا تسريب لوجود أشخاص)
  if (!(await gate(m, lang, principal, action, { targets: null }))) return "answered";
  const found = await blockTarget(m, sock, lang, request);
  if (found.reply) return found.reply;
  if (found.options) {
    // لا تخمين: كل خيار زر تأكيد مستقل (الضغط = تأكيد هذا الشخص تحديداً)
    const options = found.options.slice(0, 3);
    const tokens = options.map((option) => createActionToken({ user: m.sender, action: "grp", payload: { type: "block", block: request.block, target: option } }));
    remember(m, "choice", { kind: "grp-pick", tokens });
    const buttons = options.map((option, i) => ({ id: `terboo_grp_${tokens[i]}`, text: `${i + 1}. ${label(option)}`.slice(0, 24), typed: String(i + 1) }));
    await sendCard(sock, m, { cardId: "group-block-pick", lang, title: t(lang, "act.ambiguous"), icon: "👥", blocks: [options.map((o, i) => UI.bullet(`${i + 1}. ${label(o)}`, lang)).join("\n")], footer: footer(lang), buttons: [...buttons, { id: "terboo_grp_no", text: `✖️ ${t(lang, "act.btnNo")}` }] })
      .catch((error) => noteFailure("group-agent", error, { where: "terboo-group-agent:runBlock", stage: "pick" }));
    return "answered";
  }
  const target = found.target;
  const { excluded } = protectTargets({ principal, action, targets: [{ ...target, admin: null }], sock });
  if (excluded.length) return say(m, lang, [t(lang, "act.protectedTarget", { name: label(target), reason: protectReason(lang)(excluded[0].reason) })], { icon: "🛡️" });
  const decision = decide({ principal, action, targets: [target], explicit: Boolean(request.explicit) && !found.weak });
  if (request.block && decision.decision === DECISION.NEEDS_CONFIRMATION) {
    return askConfirm(m, sock, lang, { title: t(lang, "grp.blockConfirm", { name: label(target) }), payload: { type: "block", block: true, target } });
  }
  return doBlock(m, sock, lang, request.block, target);
}

async function doBlock(m, sock, lang, block, target) {
  stepOf(m, "tool", block ? "contact.block" : "contact.unblock");
  const result = await G.setBlock(sock, target.pn || target.jid || target.id, block);
  stepOf(m, "verify", result.ok ? (result.verified ? "ok" : "unverified") : result.code);
  if (!result.ok) return say(m, lang, [t(lang, "grp.blockFailed", { name: label(target), reason: codeText(lang, result.code) })], { icon: "⚠️" });
  recordAction(m, { kind: block ? "contact.block" : "contact.unblock", targetJid: target.jid, targetName: target.name });
  remember(m, "member", target);
  const key = result.already ? (block ? "grp.alreadyBlocked" : "grp.alreadyUnblocked") : block ? "grp.blocked" : "grp.unblocked";
  return say(m, lang, [t(lang, key, { name: label(target) }), result.verified ? "" : t(lang, "grp.unverified")], { icon: block ? "🚫" : "✅" });
}

// ── الجماعي ──

/** أسماء/منشنات/أرقام ⇒ أهداف؛ اسم غامض ⇒ كل المطابقين (للاستثناء: الأمان أن لا يُطرد) أو سؤال (للتنفيذ) */
async function resolveList(m, sock, text, { forExcept }) {
  const directory = await getDirectory(sock, m.chat);
  const out = { targets: [], ambiguous: [], notFound: [] };
  const raw = String(text || "").replace(/@\d{5,20}/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return out;
  const lookup = (name) => {
    const digits = name.replace(/[\s+-]/g, "");
    if (/^\d{8,15}$/.test(digits)) return { status: "resolved", best: null, number: digits };
    return findByName(directory, name);
  };
  const whole = lookup(raw);
  const parts = whole.status === "not-found" ? raw.split(SEPARATORS).map((p) => p.trim()).filter(Boolean) : [raw];
  for (const part of parts) {
    const hit = part === raw ? whole : lookup(part);
    if (hit.status === "resolved") {
      out.targets.push(hit.best ? candidateOf(hit.best, "name") : { jid: `${hit.number}@s.whatsapp.net`, number: hit.number, name: `+${hit.number}` });
      if (hit.weak) out.weak = true;
    } else if (hit.status === "ambiguous") {
      out.ambiguous.push({ name: part, options: hit.options.map((o) => candidateOf(o, "name")) });
      if (forExcept) out.targets.push(...hit.options.map((o) => candidateOf(o, "name")));
    } else {
      out.notFound.push(part);
    }
  }
  return out;
}

async function planAndConfirm(m, sock, lang, { op, mode, except = [], selected = [], allowAdmins = false, notes = [] }, principal) {
  const action = mode === "all" ? BULK_ACTION.all : BULK_ACTION[op];
  const decision = await gate(m, lang, principal, action, { targets: mode === "selected" ? selected : null });
  if (!decision) return "answered";
  stepOf(m, "tool", `group.plan:${op}:${mode}`);
  const plan = await G.planMembers({ sock, groupId: m.chat, principal, action, op, mode, except, selected, allowAdmins: allowAdmins && principal.isOwner });
  if (!plan.ok) return say(m, lang, [t(lang, "act.directoryUnavailable")], { icon: "⚠️" });
  const blocks = [
    ...notes,
    plan.excepted ? UI.bullet(t(lang, "grp.exceptedLine", { count: plan.excepted }), lang) : "",
    ...(plan.excluded.length ? [UI.section(t(lang, "grp.excludedTitle", { count: plan.excluded.length }), lang), ...groupedLines(lang, plan.excluded, protectReason(lang))] : []),
    plan.missing.length ? UI.bullet(t(lang, "grp.missingLine", { names: plan.missing.map(label).join("، ") }), lang) : "",
    plan.already.length ? UI.bullet(t(lang, `grp.alreadyLine_${op}`, { count: plan.already.length }), lang) : "",
  ].filter(Boolean);
  if (!plan.targets.length) {
    stepOf(m, "verify", "nothing-to-do");
    return say(m, lang, [t(lang, `grp.bulkNothing_${op}`), ...blocks], { icon: "ℹ️" });
  }
  const names = plan.targets.length <= 10 ? UI.quote(plan.targets.map(label).join("، "), lang) : "";
  return askConfirm(m, sock, lang, {
    title: t(lang, `grp.bulkConfirm_${op}`, { count: plan.targets.length, total: plan.total, group: plan.subject || "" }),
    blocks: [names, ...blocks].filter(Boolean),
    payload: { type: "bulk", op, mode, action, groupId: m.chat, keys: plan.targets.map((x) => x.canonical || identityOf(x.jid).canonical), ids: plan.targets.map((x) => x.id || x.jid), allowAdmins: allowAdmins && principal.isOwner },
  });
}

async function runBulkRequest(m, sock, lang, request, principal) {
  const except = { targets: [], ambiguous: [], notFound: [] };
  const mentioned = (m.mentionedJid || []).filter((jid) => !isBot(jid, sock));
  if (request.exceptText || mentioned.length) {
    except.targets.push(...mentioned.map((jid) => ({ jid })));
    const named = await resolveList(m, sock, request.exceptText, { forExcept: true });
    except.targets.push(...named.targets);
    except.ambiguous.push(...named.ambiguous);
    except.notFound.push(...named.notFound);
  }
  // استثناء لم يُعرف ⇒ لا تنفيذ جماعي (قد يُطرد من أراد إبقاءه)
  if (except.notFound.length) return say(m, lang, [t(lang, "grp.exceptNotFound", { names: except.notFound.join("، ") })], { icon: "🔎" });
  const notes = except.ambiguous.map((a) => UI.bullet(t(lang, "grp.exceptAmbiguous", { name: a.name, count: a.options.length }), lang));
  return planAndConfirm(m, sock, lang, { op: "kick", mode: "all", except: except.targets, allowAdmins: request.allowAdmins, notes }, principal);
}

/**
 * عدة أعضاء محددين في خطوة واحدة («اطرد أحمد ومحمد» · «رقي @a @b»). null ⇒ هدف واحد (المسار العادي).
 * @param {{m:Object, sock:Object, lang:string, step:{kind:string, name:string}, respond?:Function}} input
 */
async function trySelected({ m, sock, lang, step, respond = () => {} }) {
  if (!m?.isGroup || !["kick", "promote", "demote"].includes(step?.kind)) return null;
  const mentioned = [...new Set((m.mentionedJid || []).filter((jid) => !isBot(jid, sock)))];
  let selected = [];
  if (mentioned.length >= 2) selected = mentioned.map((jid) => ({ jid }));
  else if (step.name && SEPARATORS.test(step.name)) {
    const directory = await getDirectory(sock, m.chat);
    if (findByName(directory, step.name).status !== "not-found") return null;
    const list = await resolveList(m, sock, step.name, { forExcept: false });
    if (list.targets.length + list.ambiguous.length + list.notFound.length < 2) return null;
    respond();
    if (list.ambiguous.length || list.notFound.length) {
      return say(m, lang, [
        t(lang, "grp.selectedUnclear"),
        ...list.ambiguous.map((a) => UI.bullet(t(lang, "grp.selectedAmbiguous", { name: a.name, options: a.options.slice(0, 4).map(label).join("، ") }), lang)),
        ...list.notFound.map((name) => UI.bullet(t(lang, "act.notFound", { name }), lang)),
      ], { icon: "❓" });
    }
    selected = list.targets;
  } else return null;
  respond();
  const principal = await principalOf({ m, sock, fresh: true });
  return planAndConfirm(m, sock, lang, { op: step.kind, mode: "selected", selected }, principal);
}

/** تقرير المهمة الجماعية — يُرسل عند انتهائها (لا انتظار في مسار الرسالة) */
function reportBulk(m, lang, op, total, done) {
  done.then(async (report) => {
    const failed = report.failed || [];
    const lines = [
      t(lang, `grp.bulkDone_${op}`, { done: report.succeeded.length, total }),
      report.verified ? t(lang, "grp.verifiedFresh") : t(lang, "grp.unverified"),
      ...(failed.length ? [UI.section(t(lang, "grp.failedTitle", { count: failed.length }), lang), ...groupedLines(lang, failed.map((f) => ({ reason: f.code, target: { number: String(f.key).startsWith("pn:") ? String(f.key).slice(3) : "", lid: String(f.key).startsWith("lid:") ? f.key : "" } })), (code) => codeText(lang, code))] : []),
      report.cancelled ? t(lang, "grp.bulkCancelled", { count: report.skipped.length }) : "",
      report.rateLimited ? t(lang, "grp.rateLimited") : "",
    ];
    await say(m, lang, lines, { icon: report.failed.length || report.cancelled ? "⚠️" : "✅" });
  }).catch(async (error) => {
    if (error?.code === "TASK_CANCELLED") return say(m, lang, [t(lang, "grp.bulkStopped")], { icon: "⏹️" });
    noteFailure("group-agent", error, { where: "terboo-group-agent:reportBulk", stage: op });
    return say(m, lang, [t(lang, "grp.bulkFailed", { reason: codeText(lang, error?.code === "NOT_CONNECTED" ? "network" : "unknown") })], { icon: "⚠️" });
  });
}

/** منفّذو تأكيد لأنواع أخرى (المراسلة/الإذاعة) — نفس آلية الرمز والزر والكتابة بلا تكرار لها */
const confirmHandlers = new Map();
function registerConfirmHandler(type, handler) {
  if (typeof handler === "function") confirmHandlers.set(type, handler);
}

/** تنفيذ بعد التأكيد: صلاحية من جديد + قراءة حديثة + فقط من شملتهم الخطة المؤكَّدة */
async function executeConfirmed({ m, sock, lang, payload }) {
  if (confirmHandlers.has(payload?.type)) return confirmHandlers.get(payload.type)({ m, sock, lang, payload });
  const principal = await principalOf({ m, sock, fresh: true });
  if (payload.type === "block") {
    const action = payload.block === false ? "contact.unblock" : "contact.block";
    if (!(await gate(m, lang, principal, action, { targets: [payload.target], confirmed: true }))) return "answered";
    const { excluded } = protectTargets({ principal, action, targets: [{ ...payload.target, admin: null }], sock });
    if (excluded.length) return say(m, lang, [t(lang, "act.protectedTarget", { name: label(payload.target), reason: protectReason(lang)(excluded[0].reason) })], { icon: "🛡️" });
    return doBlock(m, sock, lang, payload.block !== false, payload.target);
  }
  if (payload.groupId !== m.chat) return say(m, lang, [t(lang, "act.expired")], { icon: "⌛" });
  if (payload.type === "invite.revoke") return runInvite(m, sock, lang, { kind: "invite.revoke" }, principal, { confirmed: true });
  if (payload.type !== "bulk") return null;
  if (!(await gate(m, lang, principal, payload.action, { targets: payload.ids.map((id) => ({ jid: id })), confirmed: true }))) return "answered";
  const plan = await G.planMembers({ sock, groupId: m.chat, principal, action: payload.action, op: payload.op, mode: "selected", selected: payload.ids.map((id) => ({ jid: id })), allowAdmins: payload.allowAdmins });
  if (!plan.ok) return say(m, lang, [t(lang, "act.directoryUnavailable")], { icon: "⚠️" });
  const confirmed = new Set(payload.keys);
  const targets = plan.targets.filter((x) => confirmed.has(x.canonical));
  if (!targets.length) return say(m, lang, [t(lang, `grp.bulkNothing_${payload.op}`)], { icon: "ℹ️" });
  const owner = taskOwner(m);
  const task = G.startBulk({ groupId: m.chat, op: payload.op, targets, owner: owner.owner, scope: owner.scope, title: t(lang, `grp.task_bulk_${payload.op}`, { count: targets.length }) });
  stepOf(m, "tool", `group.bulk:${payload.op}`);
  stepOf(m, "verify", "task-started");
  recordAction(m, { kind: `group.bulk.${payload.op}`, targetName: String(targets.length) });
  reportBulk(m, lang, payload.op, targets.length, task.done);
  return say(m, lang, [t(lang, `grp.bulkStarted_${payload.op}`, { count: targets.length }), t(lang, "grp.bulkStopHint", { id: task.id })], { icon: "⏳" });
}

/**
 * ينفّذ طلب مجموعة مفهوماً.
 * @param {{m:Object, sock:Object, lang:string, request:Object, respond?:Function}} input
 */
async function runGroupRequest({ m, sock, lang, request, respond = () => {} }) {
  if (request.kind !== "block" && !m.isGroup) {
    respond();
    return say(m, lang, [t(lang, "act.groupOnly")], { icon: "👥" });
  }
  const principal = await principalOf({ m, sock, fresh: request.kind !== "settings.get" });
  if (request.kind === "block" && !principal.isOwner && !request.strong) {
    // غير المالك: رفض صريح فقط لطلب واضح (صيغة فعل عربية أو هدف صريح) — «block chain» حديث عادي يكمل للذكاء
    const explicitTarget = Boolean(m.mentionedJid?.length || m.quoted || /\d{8,}/.test(request.name || "") || request.pronoun);
    if (!explicitTarget) return null;
  }
  respond();
  switch (request.kind) {
    case "setting": return runSetting(m, sock, lang, request, principal);
    case "settings.get": return runSettingsGet(m, sock, lang, principal);
    case "subject":
    case "description": return runText(m, sock, lang, request, principal);
    case "invite.get":
    case "invite.revoke": return runInvite(m, sock, lang, request, principal);
    case "block": return runBlock(m, sock, lang, request, principal);
    case "bulk": return runBulkRequest(m, sock, lang, request, principal);
    default: return null;
  }
}

// ═══════════════════════════════════════════════
// أدوات النموذج (حين لا يطابق نمط حتمي): أسماء فقط — لا JID ولا رقم لم يكتبه المستخدم
// ═══════════════════════════════════════════════

const GROUP_TOOLS = Object.freeze({
  "group.settings.get": { action: "group.settings.get", purpose: "show if the group is locked, who can edit info, member count, pending schedules" },
  "group.settings.lock": { action: "group.settings.lock", purpose: "only admins can send messages; input.minutes>0 ⇒ reopen after that; input.afterMinutes>0 ⇒ lock later" },
  "group.settings.unlock": { action: "group.settings.unlock", purpose: "everyone can send messages; input.minutes>0 ⇒ lock again after; input.afterMinutes>0 ⇒ open later" },
  "group.settings.restrict": { action: "group.settings.restrict", purpose: "only admins can edit group name/description/photo" },
  "group.settings.unrestrict": { action: "group.settings.unrestrict", purpose: "everyone can edit group info" },
  "group.members.kickAll": { action: "group.members.kickAll", purpose: "remove all members (owner only, asks confirmation); input.except = names to keep; input.includeAdmins" },
  "group.members.kickSelected": { action: "group.members.kickSelected", purpose: "remove several named members (input.names), asks confirmation" },
  "group.members.promoteSelected": { action: "group.members.promoteSelected", purpose: "make several named members admins (input.names)" },
  "group.members.demoteSelected": { action: "group.members.demoteSelected", purpose: "remove admin from several named members (input.names)" },
  "group.subject.set": { action: "group.subject.set", purpose: "rename the group to input.text" },
  "group.description.set": { action: "group.description.set", purpose: "set the group description to input.text (empty clears it)" },
  "group.invite.get": { action: "group.invite.get", purpose: "send the group invite link" },
  "group.invite.revoke": { action: "group.invite.revoke", purpose: "reset the invite link (old link stops working; asks confirmation)" },
  "contact.block": { action: "contact.block", anywhere: true, purpose: "block a person from messaging the bot (owner only); input.names[0]" },
  "contact.unblock": { action: "contact.unblock", anywhere: true, purpose: "unblock a person (owner only); input.names[0]" },
});
const GROUP_WORDS = /جروب|مجموعه|مجموعة|قروب|شات|اعضاء|أعضاء|الكل|حظر|بلوك|بلك|لينك|رابط|group|chat|members|everyone|block|link|grupo|miembros|todos|bloque|enlace/iu;

/** أسطر أدوات المجموعة المتاحة لهذا الشخص الآن (للنموذج) */
async function groupToolsForModel(m, sock, request = "") {
  if (!GROUP_WORDS.test(String(request || ""))) return "";
  const principal = await principalOf({ m, sock });
  const lines = [];
  for (const [id, tool] of Object.entries(GROUP_TOOLS)) {
    if (!m?.isGroup && !tool.anywhere) continue;
    const decision = decide({ principal, action: tool.action, confirmed: true });
    if (!decision.allowed) continue;
    lines.push(`- ${id} ${tool.purpose}`);
  }
  return lines.join("\n");
}

const safeNames = (list, text) => (Array.isArray(list) ? list : [list]).map((x) => String(x || "").trim()).filter(Boolean).slice(0, 20)
  .filter((name) => name.length <= 60 && !/@/.test(name) && (!/\d{6,}/.test(name) || String(text || "").includes(name.replace(/\D/g, ""))));
const minutesOf = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 7 * 24 * 60) * MINUTE : 0;
};

/**
 * أداة مجموعة من قرار النموذج ⇒ نفس المسار الحتمي (صلاحية · حماية · تأكيد · تحقق).
 * @returns {Promise<"answered"|null>}
 */
async function runGroupTool({ id, input = {}, m, sock, lang, text = "", respond = () => {} }) {
  const tool = GROUP_TOOLS[id];
  if (!tool) return null;
  respond();
  const names = safeNames(input.names, text);
  if (id.startsWith("group.settings.") && id !== "group.settings.get") {
    const op = id.split(".").pop();
    return runGroupRequest({ m, sock, lang, request: { kind: "setting", op, delayMs: minutesOf(input.afterMinutes), durationMs: input.afterMinutes ? 0 : minutesOf(input.minutes) } });
  }
  switch (id) {
    case "group.settings.get": return runGroupRequest({ m, sock, lang, request: { kind: "settings.get" } });
    case "group.subject.set": return runGroupRequest({ m, sock, lang, request: { kind: "subject", value: String(input.text || "").slice(0, 200) } });
    case "group.description.set": return runGroupRequest({ m, sock, lang, request: { kind: "description", value: String(input.text || "").slice(0, 2100) } });
    case "group.invite.get": return runGroupRequest({ m, sock, lang, request: { kind: "invite.get" } });
    case "group.invite.revoke": return runGroupRequest({ m, sock, lang, request: { kind: "invite.revoke" } });
    case "group.members.kickAll": return runGroupRequest({ m, sock, lang, request: { kind: "bulk", op: "kick", mode: "all", exceptText: safeNames(input.except, text).join("، "), allowAdmins: Boolean(input.includeAdmins) } });
    case "contact.block":
    case "contact.unblock": return runGroupRequest({ m, sock, lang, request: { kind: "block", block: id === "contact.block", name: names[0] || "", pronoun: !names.length } });
    default: {
      const kind = id === "group.members.kickSelected" ? "kick" : id === "group.members.promoteSelected" ? "promote" : "demote";
      if (!m?.isGroup) return say(m, lang, [t(lang, "act.groupOnly")], { icon: "👥" });
      const selected = await resolveList(m, sock, names.join("، "), { forExcept: false });
      const mentioned = (m.mentionedJid || []).filter((jid) => !isBot(jid, sock)).map((jid) => ({ jid }));
      if (selected.ambiguous.length || selected.notFound.length) {
        return say(m, lang, [
          t(lang, "grp.selectedUnclear"),
          ...selected.ambiguous.map((a) => UI.bullet(t(lang, "grp.selectedAmbiguous", { name: a.name, options: a.options.slice(0, 4).map(label).join("، ") }), lang)),
          ...selected.notFound.map((name) => UI.bullet(t(lang, "act.notFound", { name }), lang)),
        ], { icon: "❓" });
      }
      const targets = [...mentioned, ...selected.targets];
      if (!targets.length) return say(m, lang, [t(lang, "act.noTarget")], { icon: "❓" });
      const principal = await principalOf({ m, sock, fresh: true });
      return planAndConfirm(m, sock, lang, { op: kind, mode: "selected", selected: targets }, principal);
    }
  }
}

export { GROUP_TOOLS, askConfirm, codeText, durationOf, gate, groupToolsForModel, handleGroupConfirm, label, parseGroupRequest, permText, registerConfirmHandler, runGroupRequest, runGroupTool, say, trySelected };
export default { parseGroupRequest, runGroupRequest, handleGroupConfirm, trySelected, groupToolsForModel, runGroupTool, durationOf, GROUP_TOOLS };
