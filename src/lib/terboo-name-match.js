// ═══════════════════════════════════════════════
// 🔤 Terboo Name Match — مطابقة الأسماء عربي/إنجليزي
// ───────────────────────────────────────────────
// يفهم: الاسم الكامل · الاسم الأول · جزء من الاسم · اختلاف الإملاء العربي (أ/ا/إ · ة/ه · ى/ي)
// · الأسماء المكتوبة بالإنجليزية لنفس الاسم العربي (Ahmed ≈ أحمد · Mohamed ≈ محمد) عبر «هيكل
// الحروف الساكنة» · وأسماء الدلع الشائعة. النتيجة درجة 0–100؛ القرار (أو الغموض) عند المستدعي.
// ═══════════════════════════════════════════════

const ARABIC_DIACRITICS = /[ً-ٰٟـ]/g;
const NON_NAME = /[^\p{L}\p{N}\s]/gu;

/** تطبيع للمقارنة: همزات · تاء مربوطة · ألف مقصورة · تشكيل · رموز وإيموجي · حالة الأحرف */
function normalizeName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .toLowerCase()
    .replace(NON_NAME, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// حروف عربية ⇒ صوت لاتيني تقريبي (الصوائت الطويلة والألف تُحذف كما تُحذف الصوائت اللاتينية)
const AR_TO_LATIN = {
  ا: "", ب: "b", ت: "t", ث: "s", ج: "g", ح: "h", خ: "k", د: "d", ذ: "z", ر: "r", ز: "z", س: "s", ش: "s",
  ص: "s", ض: "d", ط: "t", ظ: "z", ع: "", غ: "g", ف: "f", ق: "k", ك: "k", ل: "l", م: "m", ن: "n", ه: "h",
  و: "", ي: "", ء: "", پ: "p", چ: "c", ڤ: "v", گ: "g",
};
const LATIN_FOLD = [[/ph/g, "f"], [/sh|ch/g, "s"], [/kh/g, "k"], [/gh/g, "g"], [/th/g, "t"], [/dh/g, "d"], [/j/g, "g"], [/q/g, "k"], [/c/g, "k"], [/x/g, "ks"], [/[aeiouyw]/g, ""]];

function scriptOf(word) {
  if (/[\u0600-\u06FF]/.test(word)) return "ar";
  return /[a-z]/.test(word) ? "latin" : "other";
}

/**
 * هيكل الحروف الساكنة لكلمة واحدة — للمطابقة بين لغتين فقط («Ahmed» ↔ «أحمد» ⇒ hmd).
 * و/ي في أول الكلمة ساكنتان (وليد · يوسف ⇒ w/y)، والهاء الأخيرة (ة) لا تميّز (سارة ≈ Sara).
 */
function skeleton(word) {
  const value = normalizeName(word).replace(/\s+/g, "");
  if (!value) return "";
  let out = "";
  if (scriptOf(value) === "ar") {
    [...value].forEach((ch, i) => {
      if (i === 0 && (ch === "و" || ch === "ي")) out += ch === "و" ? "w" : "y";
      else out += AR_TO_LATIN[ch] ?? (/[a-z0-9]/.test(ch) ? ch : "");
    });
  } else {
    const head = /^[wy]/.test(value) ? value[0] : "";
    out = value.slice(head.length);
    for (const [re, to] of LATIN_FOLD) out = out.replace(re, to);
    out = head + out;
  }
  return out.replace(/(.)\1+/g, "$1").replace(/(?<=.)h$/, "");
}

/** أسماء دلع/اختصارات شائعة ⇒ الاسم الكامل (كلمة بكلمة بعد التطبيع) */
const NICKNAME_ALIASES = [
  ["حمو", "محمد"], ["حماده", "محمد"], ["ميدو", "محمد"], ["moha", "محمد"],
  ["حوده", "محمود"], ["عبده", "عبدالله"], ["abdo", "عبدالله"], ["زيزو", "عبدالعزيز"], ["علوش", "علي"], ["joe", "يوسف"],
];
const nickMap = new Map();
for (const [nick, full] of NICKNAME_ALIASES) {
  const a = normalizeName(nick);
  const b = normalizeName(full);
  if (!nickMap.has(a)) nickMap.set(a, new Set());
  if (!nickMap.has(b)) nickMap.set(b, new Set());
  nickMap.get(a).add(b);
  nickMap.get(b).add(a);
}

function tokens(value) {
  return normalizeName(value).split(" ").filter((t) => t.length > 0);
}

/** نوع تطابق كلمتين: exact · phonetic (لغتان مختلفتان فقط) · nick · prefix · null */
function tokenMatch(a, b) {
  if (!a || !b) return null;
  if (a === b) return "exact";
  if (scriptOf(a) !== scriptOf(b)) {
    const sa = skeleton(a);
    if (sa.length >= 2 && sa === skeleton(b)) return "phonetic";
  }
  if (nickMap.get(a)?.has(b)) return "nick";
  if (a.length >= 3 && b.startsWith(a)) return "prefix";
  return null;
}

/**
 * درجة تطابق اسم مطلوب مع اسم معروف.
 * ≥ 80 قوي (ينفَّذ مباشرة) · 66–79 ضعيف (يحتاج تأكيداً) · أقل = لا تطابق.
 * @returns {number} 0–100
 */
function nameScore(query, candidate) {
  const q = normalizeName(query);
  const c = normalizeName(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  const qt = tokens(q);
  const ct = tokens(c);
  if (qt.length === 1) {
    const kinds = ct.map((t) => tokenMatch(qt[0], t));
    const first = kinds[0];
    if (first === "exact") return 90;
    if (kinds.includes("exact")) return 84;
    if (first === "phonetic") return 78;
    if (kinds.includes("phonetic")) return 74;
    if (kinds.includes("nick")) return 70;
    if (first === "prefix") return 68;
    if (kinds.includes("prefix")) return 66;
    return 0;
  }
  // عدة كلمات بالترتيب كبداية الاسم («أحمد علي» ⇒ «أحمد علي حسن»)
  const ordered = qt.map((t, i) => tokenMatch(t, ct[i]));
  if (ordered.every((k) => k === "exact")) return 96;
  if (ordered.every((k) => k === "exact" || k === "phonetic")) return 88;
  const hits = qt.filter((t) => ct.some((x) => ["exact", "phonetic"].includes(tokenMatch(t, x)))).length;
  if (!hits) return 0;
  return Math.round(40 + (40 * hits) / qt.length);
}

/** أفضل درجة بين عدة أسماء لنفس الشخص (اسم العرض · pushName · الاسم المسجل) */
function bestScore(query, names = []) {
  let best = 0;
  for (const name of names) best = Math.max(best, nameScore(query, name));
  return best;
}

const MATCH_THRESHOLD = 66;
const STRONG_MATCH = 80;
const AMBIGUITY_GAP = 8;

/**
 * يرتّب مرشحين ويقرر: واحد واضح · غموض · لا شيء.
 * @param {string} query
 * @param {Array<{names:string[]}>} candidates
 * @returns {{status:"resolved"|"ambiguous"|"not-found", best?:Object, weak?:boolean, options:Array}}
 */
function rankByName(query, candidates = []) {
  const ranked = candidates
    .map((c) => ({ ...c, score: bestScore(query, c.names || []) }))
    .filter((c) => c.score >= MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);
  if (!ranked.length) return { status: "not-found", options: [] };
  const [first, second] = ranked;
  const multiWord = normalizeName(query).split(" ").length > 1;
  // «محمد» وفي الجروب «محمد» و«محمد سمير» ⇒ تطابقان قويان = غموض (لا تخمين) — إلا إن ذُكر الاسم الكامل بكلماته
  const bothStrong = second && second.score >= STRONG_MATCH && !(multiWord && first.score >= 96 && second.score < 96);
  if (!bothStrong && (!second || first.score - second.score >= AMBIGUITY_GAP || (first.score >= 96 && second.score < 96))) {
    // تطابق ضعيف (بادئة/دلع/نطق بلغة أخرى) ⇒ يُعرض للتأكيد قبل أي إجراء
    return { status: "resolved", best: first, weak: first.score < STRONG_MATCH, options: ranked.slice(0, 6) };
  }
  return { status: "ambiguous", options: ranked.filter((c) => c.score >= STRONG_MATCH || first.score - c.score < AMBIGUITY_GAP).slice(0, 6) };
}

export { AMBIGUITY_GAP, MATCH_THRESHOLD, STRONG_MATCH, bestScore, nameScore, normalizeName, rankByName, skeleton };
export default { normalizeName, skeleton, nameScore, bestScore, rankByName };
