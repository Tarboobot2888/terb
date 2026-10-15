// 🟩 وردل عربي — كلمة من 5 حروف يختارها الخادم · 6 محاولات · 🟩 مكانه صح · 🟨 موجود · ⬛ غير موجود
import { register, L } from "../locale.js";
import { loadData } from "../questions.js";
import { isArabicWord, normWord } from "./_text.js";

const LEN = 5;
const TRIES = 6;

register("g.wordle_ar", {
  ar: { name: "وردل عربي", desc: "خمّن الكلمة العربية من 5 حروف في 6 محاولات.", hint: "اكتب كلمة عربية من 5 حروف", tries: "المحاولات", answer: "الكلمة: {w}", bad: "اكتب 5 حروف عربية" },
  en: { name: "Arabic Wordle", desc: "Guess the 5-letter Arabic word in 6 tries.", hint: "type a 5-letter Arabic word", tries: "Tries", answer: "The word: {w}", bad: "Type 5 Arabic letters" },
  es: { name: "Wordle árabe", desc: "Adivina la palabra árabe de 5 letras en 6 intentos.", hint: "escribe una palabra árabe de 5 letras", tries: "Intentos", answer: "La palabra: {w}", bad: "Escribe 5 letras árabes" },
});

/** تقييم وردل القياسي مع الحروف المكررة */
function score(guess, answer) {
  const g = [...guess];
  const a = [...answer];
  const out = Array(LEN).fill("⬛");
  const left = {};
  a.forEach((ch, i) => {
    if (g[i] === ch) out[i] = "🟩";
    else left[ch] = (left[ch] || 0) + 1;
  });
  g.forEach((ch, i) => {
    if (out[i] === "🟩") return;
    if (left[ch] > 0) {
      out[i] = "🟨";
      left[ch] -= 1;
    }
  });
  return out;
}

const HEX = { "🟩": "#39b54a", "🟨": "#e0b400", "⬛": "#3a3a4a" };

export default {
  id: "wordle_ar",
  name: { ar: L("ar", "g.wordle_ar.name"), en: L("en", "g.wordle_ar.name"), es: L("es", "g.wordle_ar.name") },
  aliases: ["wordle", "وردل", "وردل عربي", "وردل_عربي"],
  icon: "🟩",
  category: "word",
  mode: "solo",
  uiMode: "hybrid",
  players: { min: 1, max: 1 },
  inputHint: "g.wordle_ar.hint",
  freeActions: ["guess"],
  rewardPolicy: { solo: { koin: 900, exp: 260, energi: 1 }, loss: { exp: 20 } },
  init: ({ rng }) => ({ answer: normWord(rng.pick(loadData("words.json").wordle_ar || ["مدرسه"])), guesses: [], won: false }),
  legalActions: () => [],
  validateFree(state, action) {
    const w = normWord(action.payload?.word || "");
    if ([...w].length !== LEN || !isArabicWord(w)) return { ok: false, code: "illegal", detail: "g.wordle_ar.bad" };
    if (state.won || state.guesses.length >= TRIES) return { ok: false, code: "finished" };
    return { ok: true, action: { id: "guess", payload: { word: w } } };
  },
  apply(state, action) {
    const w = action.payload.word;
    state.guesses.push(w);
    if (w === state.answer) state.won = true;
    return { ok: true, state };
  },
  status(state) {
    if (state.won) return { over: true, winners: [0], draw: false, scores: [TRIES - state.guesses.length + 1] };
    if (state.guesses.length >= TRIES) return { over: true, winners: [], draw: false, scores: [0] };
    return { over: false };
  },
  currentActor: () => 0,
  parseInput(text) {
    const w = normWord(text);
    return [...w].length === LEN && isArabicWord(w) ? { id: "guess", payload: { word: w } } : null;
  },
  view(state, { lang }) {
    const over = state.won || state.guesses.length >= TRIES;
    const rows = state.guesses.map((g) => ({ g, s: score(g, state.answer) }));
    const cells = [];
    for (let r = 0; r < TRIES; r += 1) {
      const row = rows[r];
      // اتجاه القراءة العربي: الحرف الأول يمين الصف
      for (let k = LEN - 1; k >= 0; k -= 1) cells.push(row ? { t: row.s[k], k: "color", c: HEX[row.s[k]] } : { t: "⬜", k: "empty" });
    }
    return {
      panels: [{ label: L(lang, "g.wordle_ar.tries"), value: `${state.guesses.length}/${TRIES}` }],
      status: over && !state.won ? L(lang, "g.wordle_ar.answer", { w: state.answer }) : "",
      board: { kind: "lines", lines: rows.map((row) => `${row.s.join("")}  ${[...row.g].join(" ")}`).concat(Array(TRIES - rows.length).fill("⬜⬜⬜⬜⬜")) },
      // شبكة تلوين (View Model منظَّم) — ليست صورة. الاسم السابق `image` كان مضلّلاً.
      visualBoard: { kind: "grid", cols: LEN, cells },
    };
  },
};
