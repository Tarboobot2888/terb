// 🔴🟢 سايمون — تتابع ألوان من الخادم يطول كل جولة · احفظه وأعد إدخاله بالأزرار
import { register, L } from "../locale.js";

const COLORS = ["🔴", "🟢", "🔵", "🟡"];
const HEX = ["#ff4d6d", "#39d98a", "#3a8bff", "#ffd23f"];
const GOAL = 10;
const WORDS = [/^(احمر|أحمر|red|rojo|1)$/i, /^(اخضر|أخضر|green|verde|2)$/i, /^(ازرق|أزرق|blue|azul|3)$/i, /^(اصفر|أصفر|yellow|amarillo|4)$/i];

register("g.simon", {
  ar: { name: "سايمون", desc: "احفظ تتابع الألوان وأعده — يزيد لوناً كل جولة. وصول 10 = فوز.", hint: "🔴 🟢 🔵 🟡 (أو 1–4)", memorize: "احفظ التتابع: {seq}", repeat: "أعد التتابع ({n}/{len})", good: "✅ صحيح! الجولة التالية", wrong: "❌ خطأ! التتابع كان {seq}", level: "الطول" },
  en: { name: "Simon", desc: "Memorize the color sequence and repeat it — one color longer each round. Reach 10 to win.", hint: "🔴 🟢 🔵 🟡 (or 1–4)", memorize: "Memorize: {seq}", repeat: "Repeat the sequence ({n}/{len})", good: "✅ Correct! Next round", wrong: "❌ Wrong! The sequence was {seq}", level: "Length" },
  es: { name: "Simón", desc: "Memoriza la secuencia de colores y repítela — crece cada ronda. Llega a 10 para ganar.", hint: "🔴 🟢 🔵 🟡 (o 1–4)", memorize: "Memoriza: {seq}", repeat: "Repite la secuencia ({n}/{len})", good: "✅ ¡Correcto! Siguiente ronda", wrong: "❌ ¡Error! La secuencia era {seq}", level: "Longitud" },
});

export default {
  id: "simon",
  name: { ar: L("ar", "g.simon.name"), en: L("en", "g.simon.name"), es: L("es", "g.simon.name") },
  aliases: ["سايمون", "simon says", "simón"],
  icon: "🔵",
  category: "arcade",
  mode: "solo",
  uiMode: "buttons",
  players: { min: 1, max: 1 },
  inputHint: "g.simon.hint",
  rewardPolicy: { solo: { koin: 700, exp: 200, energi: 1 }, loss: { exp: 10 } },
  init: ({ rng }) => ({ seq: [rng.int(4), rng.int(4), rng.int(4)], pos: 0, over: false, won: false }),
  legalActions: (state) => (state.over ? [] : COLORS.map((c, i) => ({ id: "press", payload: { c: i }, label: c }))),
  apply(state, action, { rng }) {
    const c = action.payload.c;
    if (state.seq[state.pos] !== c) {
      state.over = true;
      return { ok: true, state, events: [{ noteKey: "g.simon.wrong", vars: { seq: state.seq.map((x) => COLORS[x]).join("") } }] };
    }
    state.pos += 1;
    if (state.pos < state.seq.length) return { ok: true, state };
    if (state.seq.length >= GOAL) {
      state.over = true;
      state.won = true;
      return { ok: true, state };
    }
    state.seq.push(rng.int(4));
    state.pos = 0;
    return { ok: true, state, events: [{ noteKey: "g.simon.good" }] };
  },
  status: (state) => (state.over ? { over: true, winners: state.won ? [0] : [], draw: false, scores: [state.seq.length] } : { over: false }),
  currentActor: () => 0,
  parseInput(text) {
    const t = String(text).trim();
    const byEmoji = COLORS.indexOf(t);
    if (byEmoji >= 0) return { id: "press", payload: { c: byEmoji } };
    const i = WORDS.findIndex((re) => re.test(t));
    return i >= 0 ? { id: "press", payload: { c: i } } : null;
  },
  view(state, { lang }) {
    const showing = state.pos === 0 && !state.over;
    return {
      scores: [state.seq.length],
      status: state.over ? "" : showing ? L(lang, "g.simon.memorize", { seq: state.seq.map((x) => COLORS[x]).join(" ") }) : L(lang, "g.simon.repeat", { n: state.pos, len: state.seq.length }),
      panels: [{ label: L(lang, "g.simon.level"), value: String(state.seq.length) }],
      board: {
        kind: "grid",
        cols: Math.min(state.seq.length, 10),
        cells: state.seq.map((x, i) => (showing || i < state.pos || state.over ? { t: COLORS[x], k: "color", c: HEX[x] } : { t: "⬜", k: "hidden" })),
      },
    };
  },
};
