// 🃏 ذاكرة البطاقات — 16 بطاقة (8 أزواج) يخلطها الخادم · الوجه لا يظهر إلا عند القلب · خصم بذاكرة حسب المستوى
import { register, L } from "../locale.js";
import { digits, keycap } from "./_grid.js";

const SIZE = 16;
const FACES = ["🍎", "🚀", "🎧", "🐱", "⚽", "🌙", "🎲", "💎", "🦊", "🌵", "🍩", "🎈"];
const MARKS = ["🟣", "🟢"];
// لوحة HTML تُظهر وجوه البطاقات كخلايا ملوّنة؛ كل وجه له لون ثابت
const FACE_HEX = ["#ff5964", "#35a7ff", "#ffe74c", "#6bf178", "#c77dff", "#ff9f1c", "#2ec4b6", "#f15bb5", "#9b5de5", "#00bbf9", "#fee440", "#00f5d4"];

register("g.memory", {
  ar: { name: "ذاكرة البطاقات", desc: "اقلب بطاقتين في كل دور — الزوج المتطابق نقطة ودور إضافي.", hint: "رقم البطاقة 1–16", status: "دور {mark}", match: "✨ زوج متطابق {face}!", nomatch: "🙈 لا تطابق: {a} و {b}", pairs: "الأزواج" },
  en: { name: "Memory Match", desc: "Flip two cards per turn — a matching pair scores and plays again.", hint: "card number 1–16", status: "{mark} to flip", match: "✨ Matching pair {face}!", nomatch: "🙈 No match: {a} and {b}", pairs: "Pairs" },
  es: { name: "Memoria", desc: "Voltea dos cartas por turno — una pareja suma y repites.", hint: "número de carta 1–16", status: "Voltea {mark}", match: "✨ ¡Pareja {face}!", nomatch: "🙈 No coinciden: {a} y {b}", pairs: "Parejas" },
});

const num = (i) => (i < 10 ? keycap(i + 1) : `${i + 1}`);

export default {
  id: "memory",
  name: { ar: L("ar", "g.memory.name"), en: L("en", "g.memory.name"), es: L("es", "g.memory.name") },
  aliases: ["ذاكرة", "ذاكره", "ذاكرة البطاقات", "memory match", "memoria"],
  icon: "🃏",
  category: "puzzle",
  mode: "pvp",
  uiMode: "html",
  players: { min: 2, max: 2 },
  timeout: 90000,
  inputHint: "g.memory.hint",
  rewardPolicy: { win: { koin: 900, exp: 160, energi: 1 }, draw: { koin: 250, exp: 60 }, loss: { exp: 20 } },
  init({ rng }) {
    const faces = rng.shuffle(FACES).slice(0, SIZE / 2);
    return { cards: rng.shuffle([...faces, ...faces]), owner: Array(SIZE).fill(null), open: null, peek: null, seen: {}, turn: 0, scores: [0, 0] };
  },
  legalActions(state) {
    if (state.owner.every((o) => o !== null)) return [];
    return state.cards.map((_, i) => i).filter((i) => state.owner[i] === null && i !== state.open).map((i) => ({ id: "flip", payload: { i }, label: num(i) }));
  },
  apply(state, action, { actor }) {
    const i = action.payload.i;
    if (state.owner[i] !== null || i === state.open) return { ok: false, code: "illegal" };
    // كل قلب معلومة عامة (يراها الجميع) ⇒ ذاكرة الخصم من نفس المعلومات المتاحة للبشر
    state.seen[i] = state.cards[i];
    if (state.open === null) {
      state.open = i;
      state.peek = null;
      return { ok: true, state };
    }
    const a = state.open;
    state.open = null;
    if (state.cards[a] === state.cards[i]) {
      state.owner[a] = actor;
      state.owner[i] = actor;
      state.scores[actor] += 1;
      state.peek = null;
      return { ok: true, state, events: [{ noteKey: "g.memory.match", vars: { face: state.cards[i] } }] };
    }
    state.peek = [a, i];
    state.turn = 1 - actor;
    return { ok: true, state, events: [{ noteKey: "g.memory.nomatch", vars: { a: state.cards[a], b: state.cards[i] } }] };
  },
  status(state) {
    if (state.owner.some((o) => o === null)) return { over: false };
    const [a, b] = state.scores;
    return a === b ? { over: true, winners: [], draw: true, scores: state.scores } : { over: true, winners: [a > b ? 0 : 1], draw: false, scores: state.scores };
  },
  currentActor: (state) => state.turn,
  parseInput(text) {
    const n = Number(digits(text));
    return Number.isInteger(n) && n >= 1 && n <= SIZE ? { id: "flip", payload: { i: n - 1 } } : null;
  },
  view(state, { lang, turn }) {
    const face = (i) => state.owner[i] !== null || state.open === i || state.peek?.includes(i);
    return {
      marks: MARKS,
      scores: state.scores,
      status: state.owner.every((o) => o !== null) ? "" : L(lang, "g.memory.status", { mark: MARKS[turn] }),
      board: {
        kind: "grid",
        cols: 4,
        cells: state.cards.map((c, i) => (face(i)
          ? { t: c, k: "color", c: FACE_HEX[FACES.indexOf(c)], n: "ABCDEFGHIJKL"[FACES.indexOf(c)], hl: state.open === i || state.peek?.includes(i) }
          : { t: num(i), k: "hidden", n: i + 1 })),
      },
    };
  },
  ai: {
    kind: "heuristic",
    choose(state, me, { rng, legal, difficulty }) {
      const recall = { EASY: 0.25, NORMAL: 0.6, HARD: 0.9, EXPERT: 1 }[difficulty] ?? 0.6;
      // ذاكرة جزئية حتمية: يتذكر نسبة من البطاقات المكشوفة سابقاً
      const memory = Object.entries(state.seen).filter(([i]) => state.owner[i] === null && rng.float() < recall).map(([i, f]) => [Number(i), f]);
      const pick = (i) => legal.find((a) => a.payload.i === i);
      if (state.open !== null) {
        const twin = memory.find(([i, f]) => i !== state.open && f === state.cards[state.open]);
        return (twin && pick(twin[0])) || rng.pick(legal);
      }
      const byFace = {};
      for (const [i, f] of memory) (byFace[f] ||= []).push(i);
      const pair = Object.values(byFace).find((xs) => xs.length >= 2);
      if (pair) return pick(pair[0]);
      const unseen = legal.filter((a) => !(a.payload.i in state.seen));
      return rng.pick(unseen.length ? unseen : legal);
    },
  },
};
