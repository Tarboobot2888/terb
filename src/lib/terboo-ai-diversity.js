// ═══════════════════════════════════════════════
// 🎭 Response Diversity Engine — طبقة تنويع الردود (§14، §39–§41)
// ───────────────────────────────────────────────
// كل رد محادثة من النواة (قرار CHAT) أو من المسار المشترك composeReply (Auto AI
// وكل واجهات الدردشة) يمر من هنا مرة واحدة قبل الإرسال:
//  • بصمة لكل رد في نطاق محادثته فقط: البداية · النهاية · تسلسل الإيموجي · نمط الجمل.
//  • إعادة تعريف الهوية («أنا تيربو، المساعد الذكي…») تُحذف إذا كان المستخدم يعرف
//    البوت بالفعل — إلا إذا سأل هو «مين انت؟».
//  • بداية مكرّرة من نوع التحية/الحشو («بالتأكيد!»، «أهلاً بك!») تُحذف، والتحية المجرّدة
//    المكرّرة تُستبدل بتحية مختلفة من مجموعة اللغة حسب حالة المحادثة (أول مرة/رجوع).
//  • خاتمة عامة مكرّرة («هل تحتاج أي مساعدة أخرى؟») تُحذف.
//  • نفس تسلسل الإيموجي للرد السابق ⇒ تُزال إيموجي الزينة من الطرفين.
// لا يمس المعنى: الجملة ذات المحتوى لا تُحذف أبداً، ولا يُفرَّغ رد.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import { conversationScope, history } from "./terboo-ai-memory.js";

const RECENT = 6;
const MAX_SCOPES = 3000;
/** key ⇒ آخر بصمات الردود (الأحدث أخيراً) */
const recentReplies = new Map();

const EMOJI = /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*️?/gu;
const SENTENCE = /[^.!?؟…\n]+[.!?؟…]*[ \t]*\n*|\n+/g;

/** أسئلة الهوية: عندها فقط يصح التعريف بالنفس */
const ASKED_IDENTITY = /(?:مين|من)\s*(?:انت|أنت|انتا|حضرتك)|(?:انت|أنت)\s*مين|عرف(?:ني)?\s*(?:ب)?نفسك|اسمك\s*(?:ايه|ايش|اي|ما)|ما\s*اسمك|who\s+are\s+you|what(?:'s| is)\s+your\s+name|what\s+are\s+you|introduce\s+yourself|qui[eé]n\s+eres|c[oó]mo\s+te\s+llamas|qu[eé]\s+eres|pres[eé]ntate/i;
/** جملة تعريف بالنفس */
const INTRO = /^(?:\s*[\p{Extended_Pictographic}️\s]*)(?:(?:أنا|انا|معك|معاك|هنا)\s+(?:بوت\s+)?تيربو|(?:i'?m|i\s+am|this\s+is|it'?s)\s+(?:bot\s+)?terboo|(?:soy|aqu[ií]\s+(?:est[aá]\s+)?)\s*(?:bot\s+)?terboo)(?![\p{L}\p{N}])/iu;
/** ذكر البوت باسمه في رسالة المستخدم ⇒ يعرفه */
const NAMES_BOT = /تيربو|terboo/i;
/** جملة تحية/حشو قصيرة — ذيل قصير فقط حتى لا تُعدّ جملة ذات محتوى («Sure, here is the answer») حشواً */
const GREETING = /^[\s\p{Extended_Pictographic}️¡¿]*(?:أهلا|اهلا|أهلاً|أهلًا|اهلاً|مرحبا|مرحباً|هلا|يا\s*هلا|يا\s*أهلا|السلام\s*عليكم|وعليكم\s*السلام|نورت|hi|hello|hey|welcome|hola|buenas|bienvenid[oa])(?:[^.!?؟…\n\d]{0,24})[.!?؟…]*[\s\p{Extended_Pictographic}️]*$/iu;
const FILLER = /^[\s\p{Extended_Pictographic}️¡¿]*(?:بالتأكيد|بالتاكيد|أكيد|اكيد|طبعا|طبعاً|حسنا|حسناً|تمام|سؤال\s+(?:جميل|رائع|حلو)|sure|of\s+course|certainly|absolutely|great\s+question|good\s+question|claro|por\s+supuesto|desde\s+luego|buena\s+pregunta)(?:[^.!?؟…\n\d]{0,12})[.!?؟…]*[\s\p{Extended_Pictographic}️]*$/iu;
/** خاتمة عامة لا تضيف معنى */
const CLOSER = /(?:هل\s+(?:تحتاج|تريد|في)\s+(?:أي\s+|اي\s+)?(?:مساعدة|شيء|شي|حاجة|حاجه)\s*(?:أخرى|اخرى|تانية|تانيه|ثانية)?|لو\s+(?:احتجت|محتاج|عايز)\s+(?:أي\s+|اي\s+)?(?:حاجة|حاجه|مساعدة|شيء)|(?:أنا|انا)\s+(?:هنا|موجود)\s+(?:لو|إذا|اذا|ل|لأي|لاي)|let\s+me\s+know\s+if|anything\s+else|feel\s+free\s+to|happy\s+to\s+help|hope\s+(?:this|that)\s+helps|si\s+necesitas\s+(?:algo|ayuda|m[aá]s)|¿?\s*(?:algo|necesitas\s+algo)\s+m[aá]s|estoy\s+aqu[ií]\s+para)/iu;

/** تحيات بديلة حسب اللغة وحالة المحادثة (§40) — تُختار بما لم يُستعمل مؤخراً */
const GREETINGS = {
  ar: {
    first: ["أهلاً بيك 👋", "أهلًا، نورت.", "يا أهلا بيك ❤️", "أهلًا! تحت أمرك."],
    again: ["أهلاً من جديد 👋", "نورت تاني!", "أهلًا تاني، تحت أمرك.", "يا هلا، رجعت تاني ❤️"],
  },
  en: {
    first: ["Hey there 👋", "Hi! Good to see you.", "Hello! I'm all yours.", "Hey! What can I do for you?"],
    again: ["Welcome back 👋", "Hey again!", "Good to see you again.", "Back again? I'm here ❤️"],
  },
};

/** تطبيع للمقارنة: بلا إيموجي/ترقيم/تشكيل، وحروف عربية موحّدة */
function norm(text) {
  return String(text || "")
    .replace(EMOJI, " ")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/[\p{P}\p{S}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitSentences(text) {
  return String(text || "").match(SENTENCE) || [];
}

/** مقاطع ذات معنى: فيها حرف أو رقم (مقطع إيموجي وحده زينة لا محتوى) */
const contentOf = (parts) => parts.filter((part) => /[\p{L}\p{N}]/u.test(part));
const words = (text, n, fromEnd = false) => {
  const list = norm(text).split(" ").filter(Boolean);
  return (fromEnd ? list.slice(-n) : list.slice(0, n)).join(" ");
};

/** بصمة رد: البداية · النهاية · الإيموجي · نمط الجمل */
function fingerprint(text) {
  const parts = contentOf(splitSentences(text));
  const first = parts[0] || "";
  const last = parts.at(-1) || "";
  return {
    opening: words(first, 6),
    ending: words(last, 6, true),
    emoji: (String(text || "").match(EMOJI) || []).join(""),
    pattern: `${parts.map((p) => (p.length < 40 ? "s" : p.length < 140 ? "m" : "l")).join("")}:${words(first, 1)}`,
  };
}

function keyOf(m, key) {
  if (key) return key;
  try {
    return conversationScope(m).key;
  } catch {
    return `chat:${m?.chat || "unknown"}:${m?.sender || ""}`;
  }
}

function remember(key, print) {
  const list = recentReplies.get(key) || [];
  list.push({ ...print, at: Date.now() });
  while (list.length > RECENT) list.shift();
  recentReplies.delete(key);
  recentReplies.set(key, list);
  while (recentReplies.size > MAX_SCOPES) recentReplies.delete(recentReplies.keys().next().value);
}

/** هل مرّ على هذه المحادثة رد سابق من البوت؟ */
function hadAssistantTurn(m, past) {
  if (past.length) return true;
  try {
    return history(conversationScope(m)).some((turn) => turn.role === "assistant");
  } catch (error) { noteFailure("ai-diversity", error, {where: "src/lib/terboo-ai-diversity.js:113",stage: "history"}); return false; }
}

/** تحية بديلة لم تُستعمل مؤخراً في هذه المحادثة — ترتيب ثابت لكل مستخدم (لا عشوائية) */
function pickGreeting(lang, { again, past, seed }) {
  const pools = GREETINGS[lang] || GREETINGS.ar;
  const pool = again ? pools.again : pools.first;
  const used = new Set(past.map((p) => p.opening));
  const usedEmoji = past.at(-1)?.emoji || "";
  const start = [...String(seed || "")].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % pool.length;
  for (let i = 0; i < pool.length; i += 1) {
    const candidate = pool[(start + i) % pool.length];
    const print = fingerprint(candidate);
    if (!used.has(print.opening) && (!print.emoji || print.emoji !== usedEmoji)) return candidate;
  }
  return pool[(start + past.length) % pool.length];
}

function stripEdgeEmoji(text) {
  return String(text)
    .replace(/^[\s\p{Extended_Pictographic}️‍]+/u, "")
    .replace(/[\s\p{Extended_Pictographic}️‍]+$/u, "")
    .trim();
}

/**
 * ينوّع رد محادثة قبل إرساله ويسجّل بصمته في نطاق المحادثة.
 * @param {string} text رد النموذج
 * @param {{m?:Object, key?:string, lang?:string, userText?:string}} [context]
 * @returns {{text:string, changes:string[]}}
 */
function diversify(text, { m = null, key = "", lang = "ar", userText = "" } = {}) {
  const original = String(text ?? "");
  if (!original.trim()) return { text: original, changes: [] };
  const scope = keyOf(m, key);
  const past = recentReplies.get(scope) || [];
  const changes = [];
  const asked = ASKED_IDENTITY.test(userText);
  const knows = !asked && (hadAssistantTurn(m, past) || NAMES_BOT.test(userText));
  let parts = splitSentences(original);
  const substantive = () => contentOf(parts).filter((p) => !GREETING.test(p) && !FILLER.test(p) && !INTRO.test(p));

  // 1) لا إعادة تعريف بالهوية لمن يعرف البوت (§41)
  if (knows) {
    const intros = contentOf(parts).slice(0, 3).filter((p) => INTRO.test(p));
    if (intros.length && contentOf(parts).length > intros.length) {
      parts = parts.filter((p) => !intros.includes(p));
      changes.push("intro");
    }
  }

  const recentOpenings = new Set(past.slice(-4).map((p) => p.opening));
  const recentEndings = new Set(past.slice(-4).map((p) => p.ending));
  const lines = contentOf(parts);

  // 2) تحية مجرّدة مكرّرة ⇒ تحية مختلفة حسب حالة المحادثة (§40)
  if (lines.length && lines.length <= 2 && lines.every((p) => GREETING.test(p) || FILLER.test(p) || /[?؟]\s*$/.test(p) && p.length < 50)
    && GREETING.test(lines[0]) && (recentOpenings.has(words(lines[0], 6)) || (fingerprint(lines.join(" ")).emoji && fingerprint(lines.join(" ")).emoji === past.at(-1)?.emoji))) {
    const greeting = pickGreeting(lang, { again: hadAssistantTurn(m, past), past, seed: scope });
    remember(scope, fingerprint(greeting));
    return { text: greeting, changes: [...changes, "greeting"] };
  }

  // 3) بداية تحية/حشو مكرّرة ⇒ تُحذف إن بقي محتوى
  const first = contentOf(parts)[0];
  if (first && (GREETING.test(first) || FILLER.test(first)) && recentOpenings.has(words(first, 6)) && substantive().length) {
    parts = parts.filter((p) => p !== first);
    changes.push("opening");
  }

  // 4) خاتمة عامة مكرّرة ⇒ تُحذف إن بقي محتوى
  const last = contentOf(parts).at(-1);
  if (last && CLOSER.test(last) && recentEndings.has(words(last, 6, true)) && contentOf(parts).length > 1) {
    const index = parts.lastIndexOf(last);
    parts = parts.filter((_, i) => i !== index);
    changes.push("ending");
  }

  let result = parts.join("").replace(/^\s+/, "").replace(/\s+$/, "");
  if (!result) result = original.trim();

  // 5) نفس تسلسل الإيموجي للرد السابق ⇒ تُزال إيموجي الزينة من الطرفين
  const emoji = (result.match(EMOJI) || []).join("");
  if (emoji && emoji === past.at(-1)?.emoji) {
    const stripped = stripEdgeEmoji(result);
    if (stripped && stripped !== result) {
      result = stripped;
      changes.push("emoji");
    }
  }

  remember(scope, fingerprint(result));
  return { text: result, changes };
}

/** للاختبارات والتشخيص */
function recentFingerprints(key) {
  return [...(recentReplies.get(key) || [])];
}

function resetDiversity() {
  recentReplies.clear();
}

export { ASKED_IDENTITY, GREETINGS, diversify, fingerprint, pickGreeting, recentFingerprints, resetDiversity };
export default { diversify, fingerprint, pickGreeting, recentFingerprints, resetDiversity };
