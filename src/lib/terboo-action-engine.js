// ═══════════════════════════════════════════════
// ⚙️ Terboo Action Engine — من الكلام الطبيعي إلى أمر حقيقي
// ───────────────────────────────────────────────
//   طلب ← نية ← سياق ← تحديد الهدف ← القدرة ← الأمر الموجود ← الصلاحية ← تنفيذ ← تحقق ← رد
//
// • لا تنفيذ مخترع: كل إجراء يمر عبر dispatchCommand إلى البلوقن الموجود نفسه (اضف · طرد · ترقية
//   · خفض · انذار) بكل فحوصاته — الذكاء لا يقرر الصلاحية.
// • التحقق: بعد إجراءات الأعضاء يُقرأ دليل المجموعة من واتساب من جديد للتأكد (عضو أُضيف/طُرد/رُقّي).
// • المتابعة: «اطرده · رجعه · خليه أدمن · عيد تشغيله» تعرف هدفها من سياق الجلسة.
// • سلسلة: «ضيف أحمد وبعدها اطرده» أو رسائل متتالية (دفعة) ⇒ خطوات بالترتيب على نفس الهدف.
// • توضيح ذكي: أكثر من هدف ⇒ اختيار قصير · تطابق ضعيف ⇒ تأكيد · لا هدف ⇒ سؤال · لا تخمين أبداً.
// • إعدادات المجموعة والجماعي والحظر («اقفل الجروب ساعة» · «اطرد الكل إلا أحمد» · «احظره») ⇒ terboo-group-agent.
// • ما لا يخص هذا المحرك يعود null فيكمل المسار الطبيعي للذكاء (النموذج والأوامر والأدوات).
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import * as brand from "./terboo-brand.js";
import { dispatchCommand } from "./terboo-command-dispatch.js";
import { decide, principalOf, protectTargets } from "./terboo-permissions.js";
import { lastAction, recall, recordAction, remember } from "./terboo-context-engine.js";
import { consumeActionToken, createActionToken } from "./terboo-flow.js";
import { displayName, findByName, getDirectory, memberByJid, namesOf, summary } from "./terboo-group-directory.js";
import { handleGroupConfirm, parseGroupRequest, runGroupRequest, trySelected } from "./terboo-group-agent.js";
import { parseMessagingRequest, runMessagingRequest } from "./terboo-messaging-agent.js";
import { parseSshRequest, runSshRequest } from "./terboo-ssh-agent.js";
import { stepOf } from "./terboo-latency.js";
import { recentContacts } from "./terboo-serialize.js";
import { t } from "./terboo-localization.js";
import { candidateOf, hasPronoun, resolveMember } from "./terboo-member-resolver.js";
import { STRONG_MATCH, bestScore } from "./terboo-name-match.js";
import { sendCard } from "./terboo-ui-kit.js";
import * as UI from "./terboo-ui-theme.js";
import { resolveGameIntent } from "./terboo-arcade/intent.js";
import { findRoom } from "./terboo-arcade/engine.js";
import { games as gameRegistry } from "./terboo-games.js";

// ═══════════════════════════════════════════════
// التطبيع والتقسيم
// ═══════════════════════════════════════════════

function norm(text) {
  return String(text || "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/[؟?!.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** «ضيف أحمد وبعدها اطرده ثم خليه أدمن» ⇒ ثلاث خطوات */
const SPLIT = /\s*[،,;]?\s*(?:^|\s)و?(?:بعدها|بعدين|بعد كده|بعد كدا|ثم|and then|then|after that|luego|despu[eé]s)\s+/iu;
const LEAD = /^(?:و|ف)?(?:بعدها|بعدين|بعد كده|بعد كدا|ثم)\s*|^(?:and then|then|after that|luego|despu[eé]s)\s+/iu;
const POLITE = /\s*(?:لو سمحت|من فضلك|بالله|يا تيربو|يا تربو|بقي|بقى|بقا|دلوقتي|حالا|please|pls|por favor)\s*/giu;

function splitSteps(text) {
  return String(text || "").split(SPLIT).map((s) => s.replace(LEAD, "").replace(POLITE, " ").trim()).filter(Boolean);
}

// ═══════════════════════════════════════════════
// النوايا
// ═══════════════════════════════════════════════

const GROUP_WORD = "(?:ال)?(?:جروب|مجموعه|قروب|group|grupo)";
const OBJ = "(?:ه|ها|هم)?";
/** فعل + اسم اختياري — الأفعال «الضعيفة» (شيل/طلع/دخل) لا تُنفذ إلا بهدف واضح */
const MEMBER_PATTERNS = [
  { kind: "demote", re: new RegExp(`^(?:شيل|نزل|اسحب|الغي)${OBJ}\\s*(?:منه|منها)?\\s*(?:ال)?(?:ادمن|ادمين|اشراف|مشرف)\\s*(?:من|عن|ل)?\\s*(.*)$`, "u") },
  { kind: "demote", re: new RegExp(`^(?:شيل|نزل|اسحب)${OBJ}\\s*(.*?)\\s*(?:من|عن)\\s*(?:ال)?(?:ادمن|ادمنز|اشراف|مشرفين)$`, "u") },
  { kind: "demote", re: /^(?:demote|remove admin(?: from)?|take admin(?: from)?)\s*(.*)$/u },
  { kind: "demote", re: /^(?:quita(?:le)?|retira(?:le)?) (?:el )?admin(?: a)?\s*(.*)$/u },
  { kind: "promote", re: new RegExp(`^(?:خلي|اعمل|اجعل)${OBJ}\\s*(.*?)\\s*(?:ادمن|ادمين|مشرف)$`, "u") },
  { kind: "promote", re: /^(?:اعمل|خلي|اجعل)\s+(?:ال)?(?:ادمن|مشرف)\s+(?:ل|لل)?\s*(.*)$/u },
  { kind: "promote", re: new RegExp(`^(?:ارفع|رقي|رقى)${OBJ}\\s*(.*?)(?:\\s*(?:ادمن|مشرف))?$`, "u") },
  { kind: "promote", re: /^(?:promote|make)\s+(.*?)(?:\s+(?:an?\s+)?admin)?$/u },
  { kind: "promote", re: /^(?:haz(?:lo|la)?)\s*(.*?)\s*admin$/u },
  { kind: "readd", re: new RegExp(`^(?:رجع|رجّع|ارجع)(?:ه|ها|هم)(?:\\s+(?:تاني|للجروب|للمجموعه|${GROUP_WORD}))?$`, "u") },
  { kind: "readd", re: /^(?:bring (?:him|her|them) back|add (?:him|her|them) back|re-?add (?:him|her|them))$/u },
  { kind: "readd", re: /^(?:devu[eé]lvel[oa]s?|vuelve a a[ñn]adirl[oa])$/u },
  { kind: "kick", weakVerb: false, re: new RegExp(`^(?:اطرد|طرد)${OBJ}\\s*(.*?)(?:\\s*(?:من|برا|بره)\\s*${GROUP_WORD})?$`, "u") },
  { kind: "kick", weakVerb: true, re: new RegExp(`^(?:شيل|طلع|اخرج|خرج)${OBJ}\\s*(.*?)(?:\\s*(?:من|برا|بره)\\s*${GROUP_WORD})?$`, "u") },
  { kind: "kick", re: /^(?:kick|remove|ban)\s*(.*?)(?:\s+(?:from|out of)\s+(?:the\s+)?group)?$/u },
  { kind: "kick", re: /^(?:expulsa|saca|echa)\s*(?:a\s+)?(.*)$/u },
  { kind: "add", weakVerb: false, re: new RegExp(`^(?:ضيف|اضف|اضيف|ضم)${OBJ}\\s*(.*?)(?:\\s*(?:لل|ل|في|على|علي)?\\s*${GROUP_WORD})?$`, "u") },
  { kind: "add", weakVerb: true, re: new RegExp(`^(?:دخل)${OBJ}\\s*(.*?)(?:\\s*(?:لل|ل|في)?\\s*${GROUP_WORD})?$`, "u") },
  { kind: "add", re: /^(?:add|invite)\s*(.*?)(?:\s+(?:to|into)\s+(?:the\s+)?group)?$/u },
  { kind: "add", re: /^(?:a[ñn]ade|agrega|invita)\s*(?:a\s+)?(.*)$/u },
  { kind: "warn", re: new RegExp(`^(?:انذر|انذار)${OBJ}\\s*(.*)$`, "u") },
  { kind: "warn", re: /^(?:اعطي|ادي|اعطيه|اديله|اديها)\s+(.*?)\s*انذار$|^(?:اعطي|ادي|اعطيه|اديله|اديها)\s*انذار\s*(?:ل)?\s*(.*)$/u },
  { kind: "warn", re: /^warn\s*(.*)$/u },
];
/**
 * «اعمل نفس اللي عملناه · كررها · أعد الخطوة السابقة · نفس الحاجة لسارة · repeat that · haz lo mismo con Ana»
 * ⇒ آخر إجراء عضو نُفّذ فعلاً (سجل السياق) على نفس الهدف أو على اسم جديد — عبر نفس الصلاحيات والمنفّذ.
 */
const REPEAT = [
  /^(?:اعمل|نفذ|كرر|اعيد|اعد|عيد)\s+(?:نفس\s+)?(?:اللي|الي|الحاجه|الخطوه|الشي|العمليه)(?:\s+(?:اللي|الي))?(?:\s+(?:عملناه|عملناها|عملته|عملتها|السابقه|فاتت|دي|ده))?(?:\s+(?:تاني|كمان))?(?:\s+(?:مع|ل|لل|على|علي)\s*(.{2,40}))?$/u,
  // «أعدها» وحدها تخص المهام (إعادة مهمة قابلة للإعادة) ⇒ لا تُلتقط هنا؛ «اعملها» تحتاج «تاني»
  /^(?:كررها|كرره|(?:اعملها|اعمله)\s+(?:تاني|كمان))(?:\s+(?:تاني|كمان))?(?:\s+(?:مع|ل|لل|على|علي)\s*(.{2,40}))?$/u,
  /^(?:نفس\s+(?:الحاجه|الشي|اللي))(?:\s+(?:مع|ل|لل|على|علي)\s*(.{2,40}))$/u,
  /^(?:repeat(?: that| it| the last (?:step|action))?|do (?:it|that|the same) again|same again)(?:\s+(?:to|for|with)\s+(.{2,40}))?$/u,
  /^(?:do the same|same thing)\s+(?:to|for|with)\s+(.{2,40})$/u,
  /^(?:rep[ií]te(?:lo)?|haz lo mismo)(?:\s+(?:con|a|para)\s+(.{2,40}))?$/u,
];

function parseRepeat(raw) {
  const s = norm(raw);
  if (!s || s.length > 80) return null;
  for (const re of REPEAT) {
    const match = s.match(re);
    if (match) return { name: (match[1] || "").replace(/^(?:يا)\s*/u, "").trim() };
  }
  return null;
}

const SELF_ADD = /^(?:ضيفني|اضفني|ضفني|حطني|دخلني|ضمني|add me|a[ñn][aá]deme)$/u;
/** كلمات لا تكون أسماء أعضاء (فاعل/ظرف/مكملات) */
const FILLER = /^(?:ه|ها|هم|هو|هي|ده|دا|دي|تاني|كمان|برضه|بسرعه|now|again|too|also|him|her|them|it|lo|la)$/u;
/** «الشخص ده · العضو دا · this guy» = إشارة لهدف (منشن/رد/سياق) لا اسم */
const DEMONSTRATIVE = /^(?:(?:ال)?(?:شخص|عضو|واد|راجل|بنت|ست|حد)\s+(?:ده|دا|دي|هذا|هذه)|(?:ده|دا|دي|هذا|هذه)\s+(?:ال)?(?:شخص|عضو)|this (?:guy|person|member|user|one)|that (?:guy|person|member|user|one)|este (?:tipo|miembro|usuario)|esa persona)(?:\s+(?:لل|ل|من|في)?\s*(?:ال)?(?:جروب|مجموعه|group|grupo))?$/u;

/** نوع الخطوة ⇒ إجراء محرّك الصلاحيات */
const MEMBER_ACTIONS = { add: "group.member.add", readd: "group.member.readd", kick: "group.member.kick", promote: "group.member.promote", demote: "group.member.demote", warn: "group.member.warn" };
const MEMBER_COMMANDS = { add: "اضف", readd: "اضف", kick: "طرد", promote: "ترقية", demote: "خفض", warn: "انذار" };

function parseMemberStep(raw) {
  const s = norm(raw);
  if (!s || s.length > 80 || SELF_ADD.test(s)) return null;
  for (const p of MEMBER_PATTERNS) {
    const match = s.match(p.re);
    if (!match) continue;
    let name = (match.slice(1).find((x) => x !== undefined) || "").replace(/^(?:يا|ال(?=ادمن))\s*/u, "").trim();
    const demonstrative = DEMONSTRATIVE.test(name);
    if (FILLER.test(name) || demonstrative) name = "";
    const verbPronoun = new RegExp(`^\\S+(?:ه|ها|هم)(?:\\s|$)`, "u").test(s) && !name;
    return { kind: p.kind, name, weakVerb: Boolean(p.weakVerb), pronoun: verbPronoun || demonstrative || hasPronoun(raw), text: raw };
  }
  return null;
}

const DIRECTORY_PATTERNS = [
  { kind: "admins", re: /^(?:مين|مين هم|مين هما)\s+(?:ال)?(?:ادمن|ادمنز|ادمنيه|ادمين|ادمينز|مشرفين|المشرفين)|^(?:هات|اعرض|وريني)\s+(?:ال)?(?:مشرفين|ادمنز|ادمن)|^who (?:are|is) (?:the )?admins?|^(?:list|show) (?:the )?admins|^qui[eé]n(?:es)? (?:es|son) (?:el|los) admin/u },
  { kind: "count", re: /(?:كام|عدد)\s+(?:ال)?(?:عضو|اعضاء|الاعضاء|فرد|واحد)|^how many (?:members|people)|^cu[aá]ntos miembros/u },
  { kind: "lastAdded", re: /^مين\s+(?:اخر|آخر)\s+(?:واحد|حد|عضو)\s+(?:اتضاف|انضاف|دخل|ضفناه|ضفته)|^who (?:was|got) (?:the )?last (?:one )?added|^last (?:member|person) added/u },
  { kind: "owner", re: /^مين\s+(?:صاحب|مالك|منشئ|عامل)\s+(?:ال)?(?:جروب|مجموعه)|^who (?:owns|created) (?:the |this )?group/u },
  { kind: "members", re: /^مين\s+(?:هم\s+)?(?:ال)?اعضاء(?:\s+(?:ال)?(?:جروب|مجموعه|قروب))?$|^مين\s+(?:اللي\s+)?(?:موجود|موجودين)(?:\s+(?:في|ف)\s+(?:ال)?(?:جروب|مجموعه|قروب))?$|^(?:هات|اعرض|وريني|ابعت)\s+(?:لي\s+)?(?:اسماء\s+)?(?:ال)?(?:اعضاء|ناس)|^(?:اسماء\s+)?(?:ال)?اعضاء\s+(?:ال)?(?:جروب|مجموعه)$|^مين\s+(?:في|ف)\s+(?:ال)?(?:جروب|مجموعه)$|^who(?:'s| is| are)\s+(?:in|on)\s+(?:the|this)\s+group|^(?:list|show)\s+(?:the\s+)?(?:group\s+)?members|^group members|^qui[eé]n(?:es)?\s+est[aá]n?\s+en\s+el\s+grupo|^miembros del grupo/u },
];
const PRESENCE = [
  /^(?:هل\s+)?(.{2,40}?)\s+(?:موجود|موجوده|موجودين|معانا|هنا)(?:\s+(?:في|ف)\s+(?:ال)?(?:جروب|مجموعه))?$/u,
  /^(?:هل\s+)?(.{2,40}?)\s+(?:في|ف)\s+(?:ال)?(?:جروب|مجموعه)$/u,
  /^is\s+(.+?)\s+(?:in the group|here|in this group)$/u,
  /^(?:est[aá])\s+(.+?)\s+en el grupo$/u,
];

/** «هات الأعضاء اللي اسمهم أحمد · members named Ahmed» ⇒ كل المطابقين (لا تخمين: مطابقة الاسم نفسها في المحلّل) */
const NAME_SEARCH = [
  /^(?:(?:هات|اعرض|وريني|طلعلي|دورلي|ابحث عن)\s+)?(?:ال)?(?:اعضاء|ناس|اشخاص)\s+(?:اللي|الي|الذين)\s+(?:اسمهم|اسماءهم|اسمه|اسمها)\s+(.{2,40})$/u,
  /^مين\s+(?:اللي\s+)?(?:اسمه|اسمها|اسمهم)\s+(.{2,40}?)(?:\s+(?:في|ف)\s+(?:ال)?(?:جروب|مجموعه))?$/u,
  /^(?:list |show |find )?(?:the )?members (?:named|called) (.{2,40})$/u,
  /^(?:muestra |busca )?(?:los )?miembros (?:llamados|que se llaman) (.{2,40})$/u,
];
/** «صفحة 2 · page 2» في آخر سؤال قائمة الأعضاء */
const PAGE = /\s+(?:ال)?(?:صفحه|page|p[aá]gina)\s*(\d{1,3})$/u;

function parseDirectoryQuery(raw) {
  let s = norm(raw);
  if (!s || s.length > 80) return null;
  for (const re of NAME_SEARCH) {
    const match = s.match(re);
    if (match?.[1]) return { kind: "search", name: match[1].trim() };
  }
  const page = Number(s.match(PAGE)?.[1] || 1);
  s = s.replace(PAGE, "");
  for (const p of DIRECTORY_PATTERNS) if (p.re.test(s)) return { kind: p.kind, ...(p.kind === "members" ? { page: Math.max(1, page) } : {}) };
  for (const re of PRESENCE) {
    const match = s.match(re);
    const name = match?.[1]?.replace(/^(?:يا)\s*/u, "").trim();
    if (name && !/^(?:مين|انا|انت|البوت|حد|اي حد|who|anyone)$/u.test(name)) return { kind: "presence", name };
  }
  return null;
}

// ═══════════════════════════════════════════════
// الرد
// ═══════════════════════════════════════════════

function footer(lang) {
  return UI.footer(brand.plainName(), null, lang);
}

async function say(m, lang, blocks, { icon = "🧭" } = {}) {
  const text = UI.card({ title: "", blocks: [blocks.filter(Boolean).map((b) => `${icon} ${b}`).join("\n")], lang });
  await m.reply(text).catch((error) => noteFailure("action-engine", error, { where: "terboo-action-engine:say", stage: "reply" }));
  return "answered";
}

/** رقم مقنّع للعرض داخل المجموعة (خصوصية) */
function masked(target) {
  const n = target?.number || "";
  return n ? `…${n.slice(-4)}` : target?.lid ? "LID" : "";
}

function label(target) {
  const name = target?.name && !/^\+?\d+$/.test(target.name) ? target.name : "";
  return name ? `${name}${masked(target) ? ` (${masked(target)})` : ""}` : masked(target) || "?";
}

/** بطاقة اختيار هدف/تأكيد — الأزرار معرّفات داخلية (terboo_pick_N) والكتابة «1/التاني/أيوه» تعمل */
async function askPick(m, sock, lang, { title, options, step, rest = [], weak = false }) {
  remember(m, "choice", { kind: "member-pick", options, step: { kind: step.kind, text: step.text }, rest, weak });
  const buttons = weak
    ? [{ id: "terboo_pick_1", text: `✅ ${t(lang, "act.btnYes")}`, typed: t(lang, "act.btnYes") }, { id: "terboo_pick_no", text: `✖️ ${t(lang, "act.btnNo")}`, typed: t(lang, "act.btnNo") }]
    : options.slice(0, 3).map((o, i) => ({ id: `terboo_pick_${i + 1}`, text: `${i + 1}. ${label(o)}`.slice(0, 24), typed: String(i + 1) }));
  const select = !weak && options.length > 3
    ? { title: t(lang, "act.btnChoose"), sections: [{ title: t(lang, "act.chooseTitle"), rows: options.slice(0, 10).map((o, i) => ({ id: `terboo_pick_${i + 1}`, title: label(o).slice(0, 60), description: o.admin ? t(lang, "act.adminTag") : "" })) }] }
    : null;
  const sent = await sendCard(sock, m, {
    cardId: "action-pick",
    lang,
    title,
    icon: weak ? "❓" : "👥",
    blocks: weak ? [] : [options.slice(0, 10).map((o, i) => UI.bullet(`${i + 1}. ${label(o)}${o.admin ? ` · ${t(lang, "act.adminTag")}` : ""}`, lang)).join("\n")],
    footer: footer(lang),
    buttons,
    select,
  }).catch((error) => {
    noteFailure("action-engine", error, { where: "terboo-action-engine:askPick", stage: "card", fallback: "text" });
    return null;
  });
  if (!sent) await say(m, lang, [title, options.slice(0, 6).map((o, i) => `${i + 1}. ${label(o)}`).join("\n")], { icon: "👥" });
  return "answered";
}

// ═══════════════════════════════════════════════
// تنفيذ إجراءات الأعضاء
// ═══════════════════════════════════════════════

const VERIFY = {
  add: (member) => Boolean(member),
  readd: (member) => Boolean(member),
  kick: (member) => !member,
  promote: (member) => Boolean(member?.admin),
  demote: (member) => Boolean(member) && !member.admin,
};
const SLOT_FOR = { add: "added", readd: "added", kick: "removed", promote: "promoted", demote: "demoted" };
const UNDO = { kick: { kind: "readd", key: "act.btnReadd", icon: "↩️" }, promote: { kind: "demote", key: "act.btnDemote", icon: "⬇️" }, demote: { kind: "promote", key: "act.btnPromote", icon: "⬆️" } };

/**
 * يحدد هدف خطوة عضو (أو يطلب توضيحاً).
 * @returns {Promise<{target?:Object, reply?:string}>}
 */
async function targetFor(m, sock, lang, step, carried, rest) {
  if (!step.name && carried && (step.pronoun || rest.workflow)) return { target: carried };
  // «رجعه»: آخر من طُرد في هذه الجلسة، ثم آخر عضو تعامل معه
  if (step.kind === "readd" && !step.name) {
    const removed = recall(m, "removed") || recall(m, "member");
    if (removed?.jid) return { target: removed };
    return { reply: await say(m, lang, [t(lang, "act.noTarget")], { icon: "❓" }) };
  }
  const names = step.name ? [step.name, ...(/^ل[^ل]/u.test(step.name) ? [step.name.slice(1)] : [])] : [""];
  let result = null;
  for (const name of names) {
    result = await resolveMember({ m, sock, name, purpose: step.kind === "add" ? "add" : "member", text: step.text });
    if (result.status === "resolved" || result.status === "ambiguous") break;
  }
  if (result.status === "resolved") {
    if (result.weak) return { reply: await askPick(m, sock, lang, { title: t(lang, "act.weakConfirm", { name: label(result.target) }), options: [result.target], step, rest: rest.steps, weak: true }) };
    return { target: result.target };
  }
  if (result.status === "ambiguous") return { reply: await askPick(m, sock, lang, { title: t(lang, "act.ambiguous"), options: result.options, step, rest: rest.steps }) };
  // فعل ضعيف (شيل/طلع/دخل) بلا هدف واضح ⇒ ليس طلب عضو غالباً: يكمل الذكاء العادي
  if (step.weakVerb && result.status !== "resolved") return { skip: true };
  if (result.status === "not-found") {
    const key = step.kind === "add" ? "act.notFoundAdd" : "act.notFound";
    return { reply: await say(m, lang, [t(lang, key, { name: step.name || result.query || "" })], { icon: "🔎" }) };
  }
  return { reply: await say(m, lang, [t(lang, "act.noTarget")], { icon: "❓" }) };
}

/**
 * ينفذ خطوة عضو على هدف محدد: فحوص الحالة ← الأمر الحقيقي ← تحقق من واتساب.
 * @returns {Promise<{status:"done"|"stopped", target?:Object}>}
 */
async function runMemberStep(m, sock, lang, step, target, deps) {
  // قراءة حديثة قبل أي إجراء على عضو (موجود؟ مشرف؟) — الإجراءات نادرة والدقة أهم من طلب واحد
  const directory = await getDirectory(sock, m.chat, { refresh: typeof sock?.groupMetadata === "function" })
    || (m.groupMetadata?.participants ? await getDirectory(sock, m.chat, { metadata: m.groupMetadata }) : null);
  const current = memberByJid(directory, target.jid || target.id);
  const kind = step.kind;
  const name = label(target);
  // الدليل غير متاح (لا metadata): لا حكم على العضوية هنا — البلوقن نفسه يفحص
  const known = Boolean(directory);
  if ((kind === "add" || kind === "readd") && current) {
    await say(m, lang, [t(lang, "act.alreadyMember", { name })], { icon: "ℹ️" });
    remember(m, "member", target);
    return { status: "done", target };
  }
  if (known && ["kick", "promote", "demote", "warn"].includes(kind) && !current) {
    await say(m, lang, [t(lang, "act.notMember", { name })], { icon: "ℹ️" });
    return { status: "stopped" };
  }
  if (kind === "promote" && current?.admin) {
    await say(m, lang, [t(lang, "act.alreadyAdmin", { name })], { icon: "ℹ️" });
    remember(m, "member", target);
    return { status: "done", target };
  }
  if (kind === "demote" && current && !current.admin) {
    await say(m, lang, [t(lang, "act.notAdmin", { name })], { icon: "ℹ️" });
    remember(m, "member", target);
    return { status: "done", target };
  }
  // محرّك الصلاحيات المركزي: هوية المرسل الفعلية + بيانات المجموعة الحيّة (لا ما يقوله النموذج)
  const action = MEMBER_ACTIONS[kind];
  if (action) {
    const principal = await principalOf({ m, sock });
    const decision = decide({ principal, action, targets: [target] });
    stepOf(m, "permission", `${action}:${decision.decision}`);
    if (!decision.allowed && decision.decision !== "needs-confirmation") {
      await say(m, lang, [t(lang, `act.perm_${decision.reason}`) !== `act.perm_${decision.reason}` ? t(lang, `act.perm_${decision.reason}`) : t(lang, "act.permDenied")], { icon: "⛔" });
      return { status: "stopped" };
    }
    // حماية الأهداف: البوت نفسه · منشئ المجموعة · مالك البوت · المرسل نفسه — بسبب صريح
    if (["kick", "demote"].includes(kind)) {
      const { excluded } = protectTargets({ principal, action, targets: [{ ...target, admin: current?.admin || target.admin || null }], sock });
      if (excluded.length) {
        await say(m, lang, [t(lang, "act.protectedTarget", { name, reason: t(lang, `act.protect_${excluded[0].reason.split(" ")[0]}`) })], { icon: "🛡️" });
        return { status: "stopped" };
      }
    }
  }
  const command = MEMBER_COMMANDS[kind];
  let request;
  if (kind === "add" || kind === "readd") {
    const number = target.pn ? target.pn.split("@")[0] : target.number;
    if (!number) {
      await say(m, lang, [t(lang, "act.needNumber", { name })], { icon: "📇" });
      return { status: "stopped" };
    }
    request = { command, args: number };
  } else {
    const id = current?.id || target.id || target.jid;
    request = { command, args: `@${String(id).split("@")[0]}`, mentions: [id] };
  }
  // دفاع ثانٍ: مسار البوت نفسه يفحص مرة أخرى (مشرف · بوت مشرف · تسجيل · تبريد) — المحرك لا يتجاوزه
  stepOf(m, "tool", `command:${command}`);
  const result = await deps.dispatch(m, sock, request);
  // حُجب في مسار الصلاحيات: المعالج رد بالسبب الحقيقي بالفعل
  if (!result?.ok && ["blocked", "rejected"].includes(result?.status)) {
    stepOf(m, "verify", String(result?.status || "blocked"));
    return { status: "stopped" };
  }
  // تحقق حقيقي من واتساب (لا افتراض نجاح) — إن تعذّرت القراءة: نتيجة الأمر نفسه
  let verified = Boolean(result?.ok);
  if (VERIFY[kind] && known) {
    const fresh = await getDirectory(sock, m.chat, { refresh: true });
    if (fresh) verified = VERIFY[kind](memberByJid(fresh, target.jid || target.id));
  }
  stepOf(m, "verify", verified ? "ok" : "failed");
  if (!verified) {
    if (!result?.replies?.length) await say(m, lang, [t(lang, "act.notDone", { name })], { icon: "⚠️" });
    return { status: "stopped" };
  }
  remember(m, "member", target);
  if (SLOT_FOR[kind]) remember(m, SLOT_FOR[kind], target);
  recordAction(m, { kind, targetJid: target.jid, targetName: target.name, command });
  return { status: "done", target };
}

/** زر تراجع واحد ذو معنى بعد الإجراء (لا أزرار عشوائية) */
async function offerUndo(m, sock, lang, kind, target) {
  const undo = UNDO[kind];
  if (!undo || (undo.kind === "readd" && !target.pn && !target.number)) return;
  const token = createActionToken({ user: m.sender, action: "act", payload: { kind: undo.kind, target } });
  try {
    await sendCard(sock, m, {
      cardId: "action-undo",
      lang,
      text: t(lang, "act.undoHint", { name: label(target) }),
      buttons: [{ id: `terboo_act_${token}`, text: `${undo.icon} ${t(lang, undo.key)}` }],
    });
  } catch (error) {
    // اقتراح اختياري: فشله لا يلغي إجراءً نُفّذ وتحقق
    noteFailure("action-engine", error, { where: "terboo-action-engine:offerUndo", stage: "suggestion", fallback: "no-suggestion" });
  }
}

/**
 * ينفذ خطوات أعضاء بالترتيب على هدف متصل.
 * @returns {Promise<"answered">}
 */
async function runMemberWorkflow(m, sock, lang, steps, deps, { carried = null, preset = null } = {}) {
  if (!m.isGroup) return say(m, lang, [t(lang, "act.groupOnly")], { icon: "👥" });
  let target = carried;
  let lastDone = null;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const rest = { steps: steps.slice(i + 1), workflow: i > 0 };
    if (i === 0 && preset) target = preset;
    else {
      const picked = await targetFor(m, sock, lang, step, target, rest);
      if (picked.skip) return i === 0 ? null : "answered";
      if (picked.reply) return picked.reply;
      target = picked.target;
    }
    const outcome = await runMemberStep(m, sock, lang, step, target, deps);
    if (outcome.status !== "done") return "answered";
    lastDone = { kind: step.kind, target };
  }
  if (lastDone && steps.length === 1) await offerUndo(m, sock, lang, lastDone.kind, lastDone.target);
  return "answered";
}

// ═══════════════════════════════════════════════
// أسئلة دليل المجموعة (أداة group.members)
// ═══════════════════════════════════════════════

/** نتيجة أداة group.members (للنموذج وللرد الحتمي) — أسماء وأدوار فقط، بلا أرقام كاملة */
async function groupMembersTool({ m, sock, refresh = false }) {
  if (!m?.isGroup) return { ok: false, code: "group-only" };
  const directory = await getDirectory(sock, m.chat, { refresh });
  const s = summary(directory);
  if (!s) return { ok: false, code: "unavailable" };
  const view = (member) => ({ name: displayName(member), admin: member.admin || null, number: member.number ? `…${member.number.slice(-4)}` : "", named: namesOf(member).length > 0 });
  return { ok: true, code: "ok", data: { subject: s.subject, count: s.count, admins: s.admins.map(view), owner: s.owner ? view(s.owner) : null, lastAdded: s.lastAdded ? view(s.lastAdded) : null, members: s.members.slice(0, 300).map(view) } };
}

const MEMBERS_PAGE = 60;

async function answerDirectory(m, sock, lang, query) {
  if (!m.isGroup) return say(m, lang, [t(lang, "act.groupOnly")], { icon: "👥" });
  const directory = await getDirectory(sock, m.chat);
  const s = summary(directory);
  if (!s) return say(m, lang, [t(lang, "act.directoryUnavailable")], { icon: "⚠️" });
  const tag = (member) => `${label(candidateOf(member, "directory"))}${member.admin ? ` · ${t(lang, "act.adminTag")}` : ""}`;
  switch (query.kind) {
    case "count":
      return say(m, lang, [t(lang, "act.count", { count: s.count })], { icon: "👥" });
    case "admins":
      return say(m, lang, [s.admins.length ? `${t(lang, "act.adminsTitle", { count: s.admins.length })}\n${s.admins.map((a) => UI.bullet(tag(a), lang)).join("\n")}` : t(lang, "act.noAdmins")], { icon: "🛡️" });
    case "owner":
      return say(m, lang, [s.owner ? t(lang, "act.owner", { name: label(candidateOf(s.owner, "directory")) }) : t(lang, "act.ownerUnknown")], { icon: "👑" });
    case "lastAdded": {
      const remembered = recall(m, "added");
      const member = s.lastAdded || (remembered?.jid ? memberByJid(directory, remembered.jid) : null);
      return say(m, lang, [member ? t(lang, "act.lastAdded", { name: label(candidateOf(member, "directory")) }) : t(lang, "act.lastAddedNone")], { icon: "🆕" });
    }
    case "presence": {
      const found = findByName(directory, query.name);
      if (found.status === "resolved") {
        const member = found.best;
        remember(m, "member", candidateOf(member, "name"));
        return say(m, lang, [t(lang, found.weak ? "act.presenceMaybe" : "act.presenceYes", { name: tag(member) })], { icon: found.weak ? "❓" : "✅" });
      }
      if (found.status === "ambiguous") return say(m, lang, [t(lang, "act.presenceMany", { count: found.options.length }), found.options.map((o) => UI.bullet(tag(o), lang)).join("\n")], { icon: "👥" });
      return say(m, lang, [t(lang, "act.presenceNo", { name: query.name })], { icon: "🔎" });
    }
    case "search": {
      // كل من يطابق الاسم بنفس محلّل الأعضاء (تطبيع عربي + ترتيب) — لا أسماء مخترعة
      // بحث (لا إجراء): كل التطابقات القوية فقط — «محمد» ⇒ «محمد» و«محمد سمير»، والضعيف لا يُعرض كأنه هو
      const matches = s.members
        .map((member) => ({ member, score: bestScore(query.name, namesOf(member)) }))
        .filter((o) => o.score >= STRONG_MATCH)
        .sort((a, b) => b.score - a.score)
        .map((o) => o.member);
      if (!matches.length) return say(m, lang, [t(lang, "act.searchNone", { name: query.name })], { icon: "🔎" });
      // هدف السياق يُحفظ فقط عند تطابق واحد — «اطرده» بعد نتيجتين لا تخمّن أحدهما
      if (matches.length === 1) remember(m, "member", candidateOf(matches[0], "name"));
      return say(m, lang, [t(lang, "act.searchTitle", { name: query.name, count: matches.length }), matches.slice(0, MEMBERS_PAGE).map((o) => UI.bullet(tag(o), lang)).join("\n")], { icon: "🔎" });
    }
    default: {
      // قائمة مقسّمة صفحات: لا تُرسل مئات الأسماء دفعة واحدة (ولا تدخل نص النموذج)
      const named = s.members.filter((member) => namesOf(member).length);
      const unnamed = s.count - named.length;
      const pages = Math.max(1, Math.ceil(named.length / MEMBERS_PAGE));
      const page = Math.min(Math.max(1, query.page || 1), pages);
      const slice = named.slice((page - 1) * MEMBERS_PAGE, page * MEMBERS_PAGE);
      return say(m, lang, [
        t(lang, "act.membersTitle", { group: s.subject || "", count: s.count }),
        slice.map((member) => UI.bullet(tag(member), lang)).join("\n"),
        unnamed > 0 ? t(lang, "act.unnamed", { count: unnamed }) : "",
        pages > 1 ? t(lang, "act.membersPage", { page, pages }) : "",
      ], { icon: "👥" });
    }
  }
}

// ═══════════════════════════════════════════════
// الاختيارات المعلّقة والأزرار الداخلية
// ═══════════════════════════════════════════════

const ORDINAL = [
  [/^(?:1|١|الاول|اول|واحد|first|primero|uno)$/u, 0],
  [/^(?:2|٢|التاني|الثاني|تاني|اتنين|second|segundo|dos)$/u, 1],
  [/^(?:3|٣|التالت|الثالث|تالت|تلاته|third|tercero|tres)$/u, 2],
  [/^(?:4|٤|الرابع|fourth)$/u, 3],
  [/^(?:5|٥|الخامس|fifth)$/u, 4],
];
const YES = /^(?:اه|ايوه|ايوا|اكيد|نعم|تمام|صح|هو|yes|yeah|yep|sure|ok|si|sí|claro)$/u;
const NO = /^(?:لا|لأ|مش ده|مش هو|غلط|لا مش ده|no|nope|wrong|cancel|الغاء|ولا واحد)$/u;

async function handlePick(m, sock, lang, text, deps) {
  const choice = recall(m, "choice");
  if (!choice || choice.kind !== "member-pick") return null;
  const raw = norm(text);
  const button = raw.match(/^terboo_pick_(\d+|no)$/);
  let index = null;
  if (button) index = button[1] === "no" ? -1 : Number(button[1]) - 1;
  else if (NO.test(raw)) index = -1;
  else if (choice.weak && YES.test(raw)) index = 0;
  else {
    const hit = ORDINAL.find(([re]) => re.test(raw));
    if (hit) index = hit[1];
  }
  if (index === null) return null;
  deps.respond?.();
  remember(m, "choice", { kind: "none" });
  if (index < 0) return say(m, lang, [t(lang, choice.weak ? "act.pickRejected" : "act.cancelled")], { icon: "✖️" });
  const target = choice.options[index];
  if (!target) return say(m, lang, [t(lang, "act.pickInvalid")], { icon: "❓" });
  const steps = [{ kind: choice.step.kind, text: choice.step.text, name: "", pronoun: true }, ...(choice.rest || [])];
  return runMemberWorkflow(m, sock, lang, steps, deps, { preset: target });
}

async function handleActionButton(m, sock, lang, text, deps) {
  const match = String(text || "").trim().match(/^terboo_act_([\w-]{6,40})$/);
  if (!match) return null;
  deps.respond?.();
  const entry = consumeActionToken(m.sender, match[1], { action: "act" });
  if (!entry) return say(m, lang, [t(lang, "act.expired")], { icon: "⌛" });
  return runMemberWorkflow(m, sock, lang, [{ kind: entry.payload.kind, text: "", name: "", pronoun: true }], deps, { preset: entry.payload.target });
}

// ═══════════════════════════════════════════════
// نقطة الدخول
// ═══════════════════════════════════════════════

/**
 * يحاول فهم الطلب كإجراء حقيقي. null ⇒ ليس من اختصاصه (يكمل مسار الذكاء العادي).
 * @param {{m:Object, sock:Object, text:string, lang:string, burst?:string[], deps?:{dispatch?:Function}}} input
 * @returns {Promise<"answered"|null>}
 */
/**
 * TERBOO ARCADE بالكلام: «عايز ألعب XO» · «ضد الكمبيوتر صعب» · «مع أحمد» · «ابدأ» · «دوري؟» · «كمل»
 * · «وقف» · «رجع اللوحة» · «اعمل rematch» · «هات الترتيب» ⇒ نفس أمر .اركيد (نفس الصلاحيات والتبريد).
 * الصديق بالاسم يُحل من دليل المجموعة (لا JID من النموذج)؛ اسم غامض ⇒ غرفة مفتوحة بلا دعوة.
 * @returns {Promise<null | {command:string, args:string, mentions?:string[]}>}
 */
async function gameStep(m, sock, value) {
  const room = findRoom({ chat: m.chat, jid: m.sender, states: ["WAITING", "READY", "PLAYING", "PAUSED", "FINISHED"] });
  const intent = resolveGameIntent(value, { hasRoom: Boolean(room), roomState: room?.state });
  if (!intent) return null;
  if (intent.intent === "menu") return { command: "اركيد", args: "" };
  if (intent.intent === "leaderboard") return { command: "اركيد", args: `top ${room?.gameId || "all"}` };
  if (["turn", "board"].includes(intent.intent)) return { command: "اركيد", args: `board ${room.roomId}` };
  if (intent.intent !== "play") return { command: "اركيد", args: `${intent.intent} ${room.roomId}` };
  const contract = gameRegistry.contractOf(intent.gameId);
  // ألعاب الأسئلة القديمة لها أوامرها الخاصة
  if (contract?.legacy) return { command: contract.legacyCommand, args: "" };
  const args = ["play", intent.gameId, intent.vsAI ? "ai" : "", intent.difficulty || ""].filter(Boolean);
  let mentions = [];
  if (intent.friend && m.isGroup) {
    const directory = await getDirectory(sock, m.chat);
    const found = findByName(directory, intent.friend.replace(/^@/, ""));
    if (found.status === "resolved" && !found.weak && found.best) mentions = [found.best.pn || found.best.id];
  }
  return { command: "اركيد", args: args.join(" "), mentions };
}

async function runActionEngine({ m, sock, text, lang, burst = [], deps: rawDeps = {} }) {
  const deps = { dispatch: rawDeps.dispatch || dispatchCommand, onRespond: rawDeps.onRespond || (() => {}) };
  try {
    const value = String(text || "").trim();
    if (!value) return null;
    // قرار المحرك يُسجَّل قبل التنفيذ (ترتيب مراحل التتبّع: strategy قبل permission/tool/verify)
    const respond = () => {
      stepOf(m, "capability", "action-engine");
      stepOf(m, "strategy", "action");
      deps.onRespond();
    };
    const button = await handleActionButton(m, sock, lang, value, { ...deps, respond });
    if (button) return button;
    const picked = await handlePick(m, sock, lang, value, { ...deps, respond });
    if (picked) return picked;
    const confirmed = await handleGroupConfirm({ m, sock, lang, text: value, respond });
    if (confirmed) return confirmed;

    // TERBOO ARCADE بالكلام (قبل الأعضاء: «العب مع أحمد» ليست إضافة عضو)
    const game = await gameStep(m, sock, value);
    if (game) {
      respond();
      remember(m, "choice", { kind: "arcade", command: game.command });
      await deps.dispatch(m, sock, { command: game.command, args: game.args, mentions: game.mentions || [] });
      return "answered";
    }

    // أسئلة الدليل
    const query = parseDirectoryQuery(value);
    if (query && (m.isGroup || query.kind !== "presence")) {
      respond();
      return answerDirectory(m, sock, lang, query);
    }

    // المراسلة (للمالك): «ابعت لـ رقم: …» · «ابعت لكل الجروبات: …» · «جرب الإذاعة»
    const messaging = parseMessagingRequest(value);
    if (messaging) {
      const handled = await runMessagingRequest({ m, sock, lang, request: messaging, respond });
      if (handled) return handled;
    }

    // خوادم SSH المسجّلة («حالة سيرفر lab» · «ارفعه على lab وشغله» مع zip) — قبل VPS: الاسم مضيف مسجّل فعلاً
    const sshRequest = parseSshRequest(value);
    if (sshRequest) {
      const handled = await runSshRequest({ m, sock, lang, request: sshRequest, respond });
      if (handled) return handled;
    }

    // المجموعة: الإعدادات والجدولة والرابط والاسم والطرد الجماعي — والحظر في أي دردشة
    // (قبل الأعضاء: «اطرد الكل» ليس عضواً اسمه «الكل»)
    const groupRequest = parseGroupRequest(value);
    if (groupRequest && (m.isGroup || groupRequest.kind === "block")) {
      const handled = await runGroupRequest({ m, sock, lang, request: groupRequest, respond });
      if (handled) return handled;
    }

    // «اعمل نفس اللي عملناه» ⇒ آخر إجراء عضو حقيقي (لا تخمين: بلا إجراء سابق يكمل الذكاء العادي)
    const repeat = m.isGroup ? parseRepeat(value) : null;
    if (repeat) {
      const last = lastAction(m, (a) => Boolean(MEMBER_ACTIONS[a.kind]));
      if (last) {
        respond();
        const step = { kind: last.kind, name: repeat.name, weakVerb: false, pronoun: !repeat.name, text: value };
        return await runMemberWorkflow(m, sock, lang, [step], deps, { carried: repeat.name ? null : recall(m, "member") });
      }
    }

    // خطوات الرسالة + رسائل الدفعة السابقة غير المجاب عنها (قرار واحد للتسلسل)
    const current = splitSteps(value).map(parseMemberStep);
    // خارج المجموعة لا أعضاء: النواة/النموذج يقرران («شيل الخلفية» في الخاص ليست طرداً)
    // · بطاقة جهة اتصال مقتبسة أو مرسلة للتو: مسار الإضافة من البطاقات الموجود يتولاها
    const contactCards = Boolean(m.quoted?.contacts?.length) || (current[0]?.kind === "add" && !current[0]?.name && !recall(m, "member") && recentContacts(m.chat, m.sender).length > 0);
    if (m.isGroup && !contactCards && current.length && current.every(Boolean)) {
      const earlier = (burst || []).flatMap(splitSteps).map(parseMemberStep);
      const steps = earlier.every(Boolean) ? [...earlier, ...current] : current;
      // «رجعه» بلا طرد سابق في هذه الجلسة = تراجع عن رد (المسار القديم)، لا إعادة عضو
      if (steps.length === 1 && steps[0].kind === "readd" && !recall(m, "removed") && !lastAction(m, (a) => a.kind === "kick")) return null;
      // عدة أهداف في خطوة واحدة («اطرد أحمد ومحمد» · «رقي @a @b») ⇒ تنفيذ جماعي مؤكَّد
      if (steps.length === 1) {
        const selected = await trySelected({ m, sock, lang, step: steps[0], respond });
        if (selected) return selected;
      }
      const carried = steps[0].name ? null : recall(m, "member");
      respond();
      return await runMemberWorkflow(m, sock, lang, steps, deps, { carried });
    }

    return null;
  } catch (error) {
    noteFailure("action-engine", error, { where: "terboo-action-engine:run", stage: "action", fallback: "kernel" });
    return null;
  }
}

export { gameStep, groupMembersTool, parseDirectoryQuery, parseMemberStep, parseRepeat, runActionEngine, splitSteps };
export default { runActionEngine, groupMembersTool, parseMemberStep, parseDirectoryQuery, splitSteps };
