// 🔤 سباق الحروف — جماعي متزامن: حرف + فئة كل جولة · أول كلمة صحيحة من القاموس تأخذ النقاط · 5 جولات
import { register, L } from "../locale.js";
import { loadData } from "../questions.js";
import { normWord } from "./_text.js";

const ROUNDS = 5;
const ROUND_MS = 45000;
const CATS = ["country", "animal", "fruit"];

register("g.letter_rush", {
  ar: { name: "سباق الحروف", desc: "حرف وفئة كل جولة — أسرع كلمة صحيحة تفوز بالنقاط.", hint: "اكتب كلمة تبدأ بالحرف من الفئة المطلوبة", round: "الجولة {n}/{total}: فئة *{cat}* تبدأ بحرف *{ch}*", country: "دولة", animal: "حيوان", fruit: "فاكهة أو خضار", scored: "✅ {name}: «{w}» +10", noword: "❌ ليست في القاموس أو لا تبدأ بالحرف", timeout: "⏱️ لم يجب أحد: مثال «{w}»", examples: "أمثلة" },
  en: { name: "Letter Rush", desc: "A letter and a category each round — fastest valid word scores.", hint: "type a word from the category starting with the letter", round: "Round {n}/{total}: *{cat}* starting with *{ch}*", country: "Country", animal: "Animal", fruit: "Fruit or vegetable", scored: "✅ {name}: “{w}” +10", noword: "❌ Not in the dictionary or wrong letter", timeout: "⏱️ No one answered: e.g. “{w}”", examples: "Examples" },
  es: { name: "Carrera de letras", desc: "Una letra y una categoría por ronda — la palabra válida más rápida suma.", hint: "escribe una palabra de la categoría que empiece por la letra", round: "Ronda {n}/{total}: *{cat}* que empiece por *{ch}*", country: "País", animal: "Animal", fruit: "Fruta o verdura", scored: "✅ {name}: «{w}» +10", noword: "❌ No está en el diccionario o no empieza por la letra", timeout: "⏱️ Nadie respondió: p. ej. «{w}»", examples: "Ejemplos" },
});

/** قاموس الفئة بلغة الجولة (أسماء الدول من بيانات الجغرافيا، والبقية من words.json) */
function dictionary(cat, lang) {
  if (cat === "country") return loadData("countries.json").map((c) => c.name[lang]);
  const words = loadData("words.json");
  return (cat === "animal" ? words.animals : words.fruits || []).map((x) => x[lang]);
}

function makeRound(rng, lang) {
  for (let k = 0; k < 20; k += 1) {
    const cat = rng.pick(CATS);
    const dict = dictionary(cat, lang).map(normWord).filter(Boolean);
    const strip = (w) => w.replace(/^ال(?=..)/, "");
    const letters = [...new Set(dict.map((w) => strip(w)[0]))];
    if (!letters.length) continue;
    const ch = rng.pick(letters);
    return { cat, ch };
  }
  return { cat: "country", ch: lang === "ar" ? "م" : "m" };
}

export default {
  id: "letter_rush",
  name: { ar: L("ar", "g.letter_rush.name"), en: L("en", "g.letter_rush.name"), es: L("es", "g.letter_rush.name") },
  aliases: ["حروف", "سباق الحروف", "سباق_الحروف", "اسم حيوان جماد", "carrera de letras"],
  icon: "🔤",
  category: "word",
  mode: "party",
  uiMode: "text",
  sessionType: "simultaneous",
  players: { min: 1, max: 12 },
  timeout: ROUND_MS,
  inputHint: "g.letter_rush.hint",
  freeActions: ["word"],
  rewardPolicy: { win: { koin: 700, exp: 220, energi: 1 }, draw: { koin: 150, exp: 60 }, loss: { exp: 20 } },
  init({ players, rng, options }) {
    const lang = ["ar", "en", "es"].includes(options?.lang) ? options.lang : "ar";
    return { lang, rounds: Array.from({ length: ROUNDS }, () => makeRound(rng, lang)), i: 0, scores: Array(players).fill(0), used: [] };
  },
  legalActions: () => [],
  validateFree(state, action) {
    if (state.i >= ROUNDS) return { ok: false, code: "finished" };
    const w = normWord(action.payload?.w || "");
    const { cat, ch } = state.rounds[state.i];
    const base = w.replace(/^ال(?=..)/, "");
    const dict = new Set(dictionary(cat, state.lang).map(normWord));
    if (!w || !base.startsWith(ch) || !dict.has(w) || state.used.includes(w)) return { ok: false, code: "illegal", detail: "g.letter_rush.noword" };
    return { ok: true, action: { id: "word", payload: { w } } };
  },
  apply(state, action, { actor }) {
    state.scores[actor] += 10;
    state.used.push(action.payload.w);
    state.i += 1;
    return { ok: true, state, events: [{ noteKey: "g.letter_rush.scored", vars: { w: action.payload.w }, seat: actor }] };
  },
  onTimeout(state) {
    const { cat, ch } = state.rounds[state.i] || {};
    const example = cat ? dictionary(cat, state.lang).find((w) => normWord(w).replace(/^ال(?=..)/, "").startsWith(ch)) : "";
    state.timeoutExample = example || "";
    state.i += 1;
    return { state };
  },
  status(state) {
    if (state.i < ROUNDS) return { over: false };
    const best = Math.max(...state.scores);
    if (best <= 0) return { over: true, winners: [], draw: true, scores: state.scores };
    return { over: true, winners: state.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0), draw: false, scores: state.scores };
  },
  currentActor: () => null,
  parseInput: (text) => (String(text).trim().length >= 2 && String(text).trim().length <= 30 ? { id: "word", payload: { w: String(text).trim() } } : null),
  view(state, { lang }) {
    if (state.i >= ROUNDS) return { scores: state.scores, board: { kind: "lines", lines: [] } };
    const { cat, ch } = state.rounds[state.i];
    return {
      scores: state.scores,
      status: L(lang, "ui.time") + `: ${ROUND_MS / 1000}s`,
      board: { kind: "lines", lines: [L(lang, "g.letter_rush.round", { n: state.i + 1, total: ROUNDS, cat: L(lang, `g.letter_rush.${cat}`), ch: ch.toUpperCase() }), state.timeoutExample ? L(lang, "g.letter_rush.timeout", { w: state.timeoutExample }) : ""].filter(Boolean) },
    };
  },
};
