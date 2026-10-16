// ═══════════════════════════════════════════════
// 🤐 Terboo Talk Control — تحكّم المالك في كلام الذكاء داخل المجموعات بلغة طبيعية
// ───────────────────────────────────────────────
//   «تيربو متتكلمش في الجروب غير لما اقولك اتكلم» ⇒ صمت الذكاء في هذه المجموعة
//   «اتكلم» · «ارجع اتكلم» (من المالك ولو بلا مناداة أثناء الصمت) ⇒ يرجع يرد
//   «متتكلمش مع العضو ده» (رد على رسالته أو منشن)  ⇒ يتجاهل هذا العضو هنا فقط
//   «اتكلم معاه عادي»                              ⇒ يرجع يرد عليه
//   «اتكلم مع الكل»                                 ⇒ يمسح قائمة التجاهل
// الحالة في سجل المجموعة نفسه (aiSilent · aiIgnored) فتبقى بعد إعادة التشغيل.
// لا تمس الأوامر بالبادئة (لإيقافها كلياً يوجد .حظر_المجموعة)، ولا البلوقنات الأخرى.
// المالك فقط يتحكم، والمالك نفسه لا يُصمَت عنه ولا يُتجاهل أبداً.
// ═══════════════════════════════════════════════

import config from "../../config.js";
import { noteFailure } from "./terboo-failure-log.js";
import { digitsOf, identityOf, isBot, phoneInList, sameUser } from "./terboo-identity.js";

/** المالك (config.owner.number) بمطابقة أرقام دقيقة — لا يُتجاهل أبداً */
function isOwnerJid(jid) {
  const number = identityOf(jid).number || digitsOf(jid);
  return Boolean(number) && phoneInList(number, config.owner?.number || []);
}

/** تطبيع عربي خفيف: تشكيل · همزات · ى/ة */
function norm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

/** نفي الكلام: «لا تتكلم» · «متتكلمش» · «ما تردش» · «بطل كلام» · «اسكت» · «shut up» · «no hables» */
const SILENCE = /(?:^|\s)(?:(?:لا|بلاش|بطل|ممنوع)\s+(?:ت?تكلم|تتحدث|ترد|تنطق|تتدخل|كلام|رد|ترغي)|ما?\s?(?:تتكلم|تكلم|تتحدث|ترد|تنطق|تتدخل|ترغي)ش?(?=\s|$)|(?:كفايه|بس|بطل)\s+(?:كلام|رغي|رد)|اسكت|اصمت|اخرس|سكوت|(?:مش|مو|ما)\s+(?:عايزك|عاوزك|عايزاك|عاوزاك|اريدك|بدي ياك)\s+(?:ت?تكلم|تتحدث|ترد|تنطق|تتدخل))(?=\s|$)|\b(?:shut up|be quiet|stay quiet|stop (?:talking|replying|responding)|(?:don'?t|do not) (?:talk|reply|respond|speak))\b|no (?:le |les )?(?:hables|respondas)|c[aá]llate/i;
/** السماح بالكلام: «اتكلم» · «ارجع اتكلم» · «رد عادي» · «talk again» · «puedes hablar» */
const RESUME = /(?:^|\s)(?:اتكلم|تكلم|اتحدث|تحدث|اتكلمي|ارجع\s+(?:اتكلم|رد|اتحدث)|رجع\s+(?:اتكلم|رد)|رد\s+(?:عادي|عليه|عليها|عليهم)|ممكن\s+تتكلم|تقدر\s+تتكلم|كمل\s+كلام)(?=\s|$)|\b(?:you can (?:talk|speak|reply)|talk again|speak again|start talking|reply again|resume talking|(?:talk|speak|reply) to (?:him|her|them|everyone)(?: again)?)\b|^(?:talk|speak|habla)[\s!.]*$|puedes hablar|vuelve a hablar|habla(?:r)? de nuevo|h[aá]blale/i;
/** نطاق عضو: «مع العضو ده» · «معاه» · «with him» */
const WITH_MEMBER = /(?:^|\s)(?:مع|ويا)\s*(?:ال)?(?:عضو|شخص|واد|راجل|بنت|ده|دا|دي|هذا|هذه|@)|(?:^|\s)(?:معاه|معاها|معاهم|معه|معها|معهم|وياه|وياها|عليه|عليها)(?=\s|$)|\b(?:with|to) (?:him|her|them|this (?:guy|person|member|one))\b|\bcon (?:[eé]l|ella|ellos)\b|h[aá]blale|resp[oó]ndele|\b(?:le|les) (?:hables|respondas)\b/i;
/** الكل: «اتكلم مع الكل» · «with everyone» */
const EVERYONE = /(?:مع|على|علي)\s+(?:ال)?(?:كل|جميع|الناس كلها|كل الناس|الكل)|\b(?:with|to) everyone\b|con todos/i;
/** نطاق المجموعة صراحة: «في الجروب» · «هنا» · «in this group» */
const GROUP_WORDS = /(?:في|ف|جوه)\s*(?:ال)?(?:جروب|قروب|مجموعه|شات|محادثه)|(?:^|\s)هنا(?=\s|$)|\b(?:in (?:the|this) (?:group|chat)|here)\b|en (?:el|este) grupo|aqu[ií]/i;
/** موضوع بعد الفعل («اتكلم عن…» · «talk about…») */
const TOPIC = /(?:اتكلم|تكلم|اتحدث|تحدث|رد)\s+(?:عن|في موضوع|بخصوص|بالنسبه)|\b(?:talk|speak) about\b|habla(?:r)? (?:de|sobre)/i;
/** نداء لشخص آخر غير البوت («اتكلم يا احمد») ⇒ ليس أمراً للبوت */
const OTHER_VOCATIVE = /(?:^|\s)يا\s+(?!تي?ربو)(?!بوت)\S+/;

/** حالة الكلام في مجموعة */
function talkState(db, chat) {
  const group = db?.getGroup?.(chat) || {};
  return { silent: Boolean(group.aiSilent), ignored: Array.isArray(group.aiIgnored) ? group.aiIgnored : [] };
}

function saveState(db, chat, patch) {
  const group = db?.getGroup?.(chat) || {};
  db?.setGroup?.(chat, { ...group, ...patch });
}

/**
 * الذكاء ممنوع من الرد على هذه الرسالة؟ (صمت المجموعة · عضو متجاهَل). المالك لا يُمنع أبداً.
 * @returns {""|"silent"|"ignored"}
 */
function talkBlock(m, db) {
  if (!m?.isGroup || m.isOwner) return "";
  try {
    const state = talkState(db, m.chat);
    if (state.silent) return "silent";
    if (state.ignored.some((jid) => sameUser(jid, m.sender))) return "ignored";
  } catch (error) {
    noteFailure("talk-control", error, { where: "src/lib/terboo-ai-talk-control.js:talkBlock", stage: "state" });
  }
  return "";
}

/** الأعضاء المقصودون: المذكورون (لا البوت) ثم صاحب الرسالة المقتبسة (لا البوت) */
function targetsOf(m, sock) {
  const out = [];
  for (const jid of m?.mentionedJid || []) if (jid && !isBot(jid, sock)) out.push(jid);
  const quoted = m?.quoted?.sender || m?.quoted?.key?.participant || "";
  if (!out.length && quoted && !m?.quoted?.key?.fromMe && !isBot(quoted, sock)) out.push(quoted);
  return [...new Set(out)];
}

/**
 * يفهم رسالة تحكّم بالكلام.
 * @returns {null|{op:"silence"|"resume", scope:"group"|"member"|"everyone"}}
 */
function parseTalkControl(text) {
  const value = norm(text);
  if (!value || value.split(" ").length > 16) return null;
  if (SILENCE.test(value)) return { op: "silence", scope: WITH_MEMBER.test(value) ? "member" : "group" };
  // «اتكلم عن الفيزياء» طلب كلام في موضوع، لا رفع صمت
  if (RESUME.test(value) && !OTHER_VOCATIVE.test(value) && !TOPIC.test(value)) {
    if (EVERYONE.test(value)) return { op: "resume", scope: "everyone" };
    return { op: "resume", scope: WITH_MEMBER.test(value) ? "member" : "group" };
  }
  return null;
}

/**
 * ينفّذ رسالة تحكّم إن كانت كذلك.
 * @param {Object} m
 * @param {Object} sock
 * @param {Object} db
 * @param {{text:string, engaged:boolean, t:Function, lang:string, prefix?:string, claim?:Function}} options
 *   engaged: الرسالة موجهة للبوت (مناداة/منشن/رد عليه). أثناء الصمت يكفي أن يقول المالك «اتكلم».
 *   claim: يُنادى مرة قبل أي رد (منع التكرار عند إعادة التسليم) — false ⇒ لا رد
 * @returns {Promise<null|{handled:true, op:string, scope:string, targets?:string[]}>}
 */
async function applyTalkControl(m, sock, db, { text, engaged, t, lang, prefix = ".", claim = () => true }) {
  if (!m?.isGroup) return null;
  const control = parseTalkControl(text);
  if (!control) return null;
  const state = talkState(db, m.chat);
  // غير موجهة للبوت: تُقبل فقط «اتكلم» من المالك أثناء الصمت (لا «اسكت» موجهة لشخص آخر)
  if (!engaged && !(m.isOwner && control.op === "resume" && control.scope === "group" && state.silent)) return null;
  // «اتكلم» والذكاء غير صامت هنا (ولا أحد متجاهَل) ⇒ كلام عادي للنموذج لا أمر تحكّم
  if (control.op === "resume" && control.scope === "group" && !state.silent) return null;
  if (control.op === "resume" && control.scope === "everyone" && !state.silent && !state.ignored.length) return null;
  if (!claim()) return { handled: true, op: "duplicate", scope: control.scope };

  if (!m.isOwner) {
    await m.reply(t(lang, "talk.ownerOnly"));
    return { handled: true, op: "denied", scope: control.scope };
  }

  // عضو محدد: من المنشن أو الرسالة المقتبسة؛ «متتكلمش» رداً على رسالة عضو بلا كلمة «مع» تعني العضو أيضاً
  const targets = targetsOf(m, sock);
  const scope = control.scope === "group" && targets.length && m.quoted && !m.quoted.key?.fromMe && !GROUP_WORDS.test(norm(text)) ? "member" : control.scope;

  if (scope === "member") {
    if (!targets.length) {
      await m.reply(t(lang, "talk.needTarget"));
      return { handled: true, op: control.op, scope };
    }
    const owners = targets.filter(isOwnerJid);
    const members = targets.filter((jid) => !owners.includes(jid));
    if (!members.length) {
      await m.reply(t(lang, "talk.cantIgnoreOwner"));
      return { handled: true, op: control.op, scope };
    }
    const ignored = control.op === "silence"
      ? [...state.ignored.filter((jid) => !members.some((target) => sameUser(target, jid))), ...members]
      : state.ignored.filter((jid) => !members.some((target) => sameUser(target, jid)));
    saveState(db, m.chat, { aiIgnored: ignored });
    const who = members.map((jid) => `@${digitsOf(jid)}`).join(" ");
    await m.reply(t(lang, control.op === "silence" ? "talk.ignored" : "talk.unignored", { who }), { mentions: members });
    return { handled: true, op: control.op, scope, targets: members };
  }

  if (scope === "everyone") {
    saveState(db, m.chat, { aiSilent: false, aiIgnored: [] });
    await m.reply(t(lang, "talk.unignoredAll"));
    return { handled: true, op: control.op, scope };
  }

  saveState(db, m.chat, { aiSilent: control.op === "silence" });
  await m.reply(t(lang, control.op === "silence" ? "talk.silenced" : "talk.resumed", { prefix }));
  return { handled: true, op: control.op, scope };
}

export { applyTalkControl, parseTalkControl, talkBlock, talkState, targetsOf };
export default { applyTalkControl, parseTalkControl, talkBlock, talkState };
