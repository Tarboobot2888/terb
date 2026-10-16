// 🪢 الرجل المشنوق — كلمة بلغة اللاعب يختارها الخادم · أزرار الحروف · 6 أخطاء مسموحة · تخمين الكلمة كاملة
import { register, L } from "../locale.js";
import { loadData } from "../questions.js";
import { alphabetOf, normWord } from "./_text.js";

const MAX_WRONG = 6;
const STAGES = ["😀", "🙂", "😐", "😟", "😨", "😰", "💀"];

register("g.hangman", {
  ar: { name: "الرجل المشنوق", desc: "خمّن الكلمة حرفاً حرفاً قبل 6 أخطاء.", hint: "حرف واحد أو الكلمة كاملة", wrong: "الأخطاء", letters: "الحروف", answer: "الكلمة: {w}", pick: "اختر حرفاً" },
  en: { name: "Hangman", desc: "Guess the word letter by letter before 6 mistakes.", hint: "one letter or the whole word", wrong: "Mistakes", letters: "Letters", answer: "The word: {w}", pick: "Pick a letter" },
  es: { name: "Ahorcado", desc: "Adivina la palabra letra a letra antes de 6 errores.", hint: "una letra o la palabra completa", wrong: "Errores", letters: "Letras", answer: "La palabra: {w}", pick: "Elige una letra" },
});

export default {
  id: "hangman",
  name: { ar: L("ar", "g.hangman.name"), en: L("en", "g.hangman.name"), es: L("es", "g.hangman.name") },
  aliases: ["مشنوق", "المشنوق", "الرجل المشنوق", "ahorcado"],
  icon: "🪢",
  category: "word",
  mode: "solo",
  uiMode: "buttons",
  players: { min: 1, max: 1 },
  inputHint: "g.hangman.hint",
  freeActions: ["word"],
  rewardPolicy: { solo: { koin: 700, exp: 200, energi: 1 }, loss: { exp: 15 } },
  init({ rng, options }) {
    const lang = ["ar", "en", "es"].includes(options?.lang) ? options.lang : "ar";
    const word = normWord(rng.pick(loadData("words.json").hangman?.[lang] || ["terboo"]));
    return { lang, word, guessed: [], wrong: 0, solved: false };
  },
  legalActions(state) {
    if (state.solved || state.wrong >= MAX_WRONG) return [];
    return alphabetOf(state.lang).filter((ch) => !state.guessed.includes(ch)).map((ch) => ({ id: "letter", payload: { ch }, label: ch.toUpperCase(), groupKey: "g.hangman.pick" }));
  },
  validateFree(state, action) {
    const w = normWord(action.payload?.w || "");
    if (!w || w.length > 24) return { ok: false, code: "illegal" };
    return { ok: true, action: { id: "word", payload: { w } } };
  },
  apply(state, action) {
    if (action.id === "word") {
      if (action.payload.w === state.word) state.solved = true;
      else state.wrong += 1;
      return { ok: true, state };
    }
    const ch = action.payload.ch;
    state.guessed.push(ch);
    if (!state.word.includes(ch)) state.wrong += 1;
    if ([...state.word].every((c) => c === " " || state.guessed.includes(c))) state.solved = true;
    return { ok: true, state };
  },
  status(state) {
    if (state.solved) return { over: true, winners: [0], draw: false, scores: [MAX_WRONG - state.wrong] };
    if (state.wrong >= MAX_WRONG) return { over: true, winners: [], draw: false, scores: [0] };
    return { over: false };
  },
  currentActor: () => 0,
  parseInput(text, state) {
    const t = normWord(text);
    if (!t) return null;
    if ([...t].length === 1) return alphabetOf(state.lang).includes(t) ? { id: "letter", payload: { ch: t } } : null;
    return { id: "word", payload: { w: t } };
  },
  view(state, { lang }) {
    const over = state.solved || state.wrong >= MAX_WRONG;
    const shown = [...state.word].map((c) => (c === " " ? "   " : over || state.guessed.includes(c) ? c.toUpperCase() : "＿")).join(" ");
    return {
      status: over && !state.solved ? L(lang, "g.hangman.answer", { w: state.word }) : "",
      panels: [{ label: L(lang, "g.hangman.wrong"), value: `${state.wrong}/${MAX_WRONG} ${STAGES[state.wrong]}` }, { label: L(lang, "g.hangman.letters"), value: state.guessed.join(" ").toUpperCase() || "—" }],
      board: { kind: "lines", lines: [shown] },
    };
  },
};
