// ═══════════════════════════════════════════════
// 🗣️ TERBOO ARCADE — Game Intent Resolver (كلام طبيعي ⇒ أمر لعبة)
// ───────────────────────────────────────────────
// «عايز ألعب XO» · «ضد الكمبيوتر» · «مع أحمد» · «ابدأ» · «دوري؟» · «كمل» · «وقف»
// · «رجع اللوحة» · «اعمل rematch» · «هات الترتيب» — بالعربية والإنجليزية والإسبانية.
// الاكتشاف من السجل الحي (games.contracts) لا من قائمة ثابتة.
// الناتج نية فقط؛ التنفيذ عبر نفس أمر .اركيد ⇒ نفس الصلاحيات والتبريد (لا تجاوز).
// كلمات التحكم القصيرة («ابدأ/كمل/وقف») تُفسَّر كنية لعبة فقط إن كان للمستخدم غرفة نشطة.
// ═══════════════════════════════════════════════

import { games } from "../terboo-games.js";

const strip = (s) => String(s || "")
  .toLowerCase()
  .replace(/[ً-ْـ]/g, "")
  .replace(/[أإآ]/g, "ا")
  .replace(/ى/g, "ي")
  .replace(/ة/g, "ه")
  .replace(/[_\-–—]+/g, " ")
  .replace(/[؟?!.,،]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const PLAY = /(?:^|\s)(?:عايز|عاوز|عاوزه|عايزه|نفسي|يلا|تعال|تعالي|خلينا|ممكن)?\s*(?:العب|نلعب|يلعب|تلعب|play|lets play|let s play|jugar|juguemos|quiero jugar)\s+(.+)$/;
const VS_AI = /(ضد|مع|قدام)\s*(الكمبيوتر|البوت|الذكاء|الكمبيوتر)|vs\s*(ai|bot|computer|cpu)|against\s+(the\s+)?(ai|bot|computer)|contra\s+(la\s+)?(computadora|maquina|ia|bot)/;
const DIFF = [
  ["EXPERT", /(خبير|مستحيل|expert|experto|imposible)/],
  ["HARD", /(صعب|hard|dificil)/],
  ["EASY", /(سهل|easy|facil)/],
  ["NORMAL", /(عادي|متوسط|normal|medium|medio)/],
];
const WITH = /(?:^|\s)(?:مع|ضد|with|vs|against|con|contra)\s+(@?[^\s]+(?:\s+[^\s]+)?)$/;

const CONTROL = [
  ["start", /^(ابدا|ابدأ|يلا نبدا|start|go|empezar|comenzar|empieza)$/],
  ["turn", /^(دوري|دور مين|الدور علي مين|دوري ولا لا|whose turn|my turn|is it my turn|turno|mi turno|de quien es el turno)$/],
  ["resume", /^(كمل|كملي|كمل اللعبه|استانف|resume|continue|seguir|continuar)$/],
  ["pause", /^(وقف|وقف اللعبه|استني|pause|pausa|pausar)$/],
  ["board", /^(رجع|رجع اللوحه|اعرض اللوحه|اللوحه|board|show board|tablero|ver tablero)$/],
  ["rematch", /^(اعمل rematch|rematch|اعاده|نعيد|نعيدها|العب تاني|revancha|otra vez)$/],
  ["leaderboard", /^(هات الترتيب|الترتيب|ترتيب الالعاب|الصداره|leaderboard|ranking|top|clasificacion|tabla)$/],
  ["surrender", /^(استسلم|استسلام|انسحب|surrender|give up|rendirse|me rindo)$/],
  ["menu", /^(الالعاب|العاب|قائمه الالعاب|games|arcade|juegos|menu de juegos)$/],
];

/** فهرس أسماء/مرادفات كل اللعب (يُبنى من السجل الحي) */
function nameIndex() {
  const out = [];
  for (const c of games.contracts()) {
    const names = new Set([c.id, ...(c.aliases || []), ...Object.values(c.name || {})].map(strip).filter(Boolean));
    for (const n of names) out.push({ key: n, id: c.id, contract: c });
  }
  // الأطول أولاً: «ثعبان وسلم» قبل «ثعبان»
  return out.sort((a, b) => b.key.length - a.key.length);
}

/** يحل نصاً حراً إلى عقد لعبة (مطابقة كاملة ثم احتواء) */
function findGame(text) {
  const q = strip(text);
  if (!q) return null;
  const idx = nameIndex();
  const exact = idx.find((e) => e.key === q);
  if (exact) return exact.contract;
  const contained = idx.find((e) => e.key.length >= 2 && (q === e.key || q.startsWith(`${e.key} `) || q.includes(` ${e.key}`) || q.startsWith(e.key)));
  return contained?.contract || null;
}

/**
 * @param {string} text
 * @param {{hasRoom?:boolean, roomState?:string}} ctx
 * @returns {null | {intent:string, gameId?:string, vsAI?:boolean, difficulty?:string, friend?:string}}
 */
function resolveGameIntent(text, { hasRoom = false, roomState = null } = {}) {
  const raw = strip(text);
  if (!raw || raw.length > 120) return null;
  for (const [intent, re] of CONTROL) {
    if (!re.test(raw)) continue;
    if (intent === "menu" || intent === "leaderboard") return { intent };
    if (!hasRoom) return null;
    if (intent === "resume" && roomState !== "PAUSED") return null;
    if (intent === "pause" && roomState !== "PLAYING") return null;
    if (intent === "start" && !["WAITING", "READY"].includes(roomState)) return null;
    return { intent };
  }
  const play = raw.match(PLAY);
  if (!play) return null;
  let rest = play[1];
  const vsAI = VS_AI.test(rest);
  const difficulty = (DIFF.find(([, re]) => re.test(rest)) || [])[0] || null;
  rest = rest.replace(VS_AI, " ");
  for (const [, re] of DIFF) rest = rest.replace(re, " ");
  rest = rest.replace(/\s+/g, " ").trim();
  let friend = null;
  const withMatch = !vsAI ? rest.match(WITH) : null;
  if (withMatch) {
    friend = withMatch[1].trim();
    rest = rest.slice(0, withMatch.index).trim();
  }
  const contract = findGame(rest);
  if (!contract) return null;
  return { intent: "play", gameId: contract.id, vsAI: vsAI || (Boolean(difficulty) && !friend), difficulty, friend };
}

export { findGame, nameIndex, resolveGameIntent, strip };
