// 💣 كاشف الألغام — 8×8 · 10 ألغام يزرعها الخادم بعد أول كشف (الكشف الأول آمن دائماً) · أعلام
import { register, L } from "../locale.js";
import { coord, digits, parseCoord } from "./_grid.js";

const N = 8;
const MINES = 10;
const NUMS = ["▫️", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣"];

register("g.minesweeper", {
  ar: { name: "كاشف الألغام", desc: "اكشف كل الخانات الآمنة دون لمس لغم — الأرقام تخبرك بعدد الألغام حولها.", hint: "C4 للكشف · «علم C4» لوضع علم", status: "الألغام: {n} · الأعلام: {f}", reveal: "اكشف", flag: "🚩 علم", boom: "💥 لغم في {cell}!" },
  en: { name: "Minesweeper", desc: "Reveal every safe cell without touching a mine — numbers count the mines around.", hint: "C4 to reveal · “flag C4” to flag", status: "Mines: {n} · Flags: {f}", reveal: "Reveal", flag: "🚩 Flag", boom: "💥 Mine at {cell}!" },
  es: { name: "Buscaminas", desc: "Descubre todas las casillas seguras sin tocar una mina — los números cuentan las minas vecinas.", hint: "C4 para descubrir · «bandera C4» para marcar", status: "Minas: {n} · Banderas: {f}", reveal: "Descubrir", flag: "🚩 Bandera", boom: "💥 ¡Mina en {cell}!" },
});

const around = (i) => {
  const r = Math.floor(i / N);
  const c = i % N;
  const out = [];
  for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) {
    if ((dr || dc) && r + dr >= 0 && r + dr < N && c + dc >= 0 && c + dc < N) out.push((r + dr) * N + c + dc);
  }
  return out;
};

function plant(state, first, rng) {
  const safe = new Set([first, ...around(first)]);
  const pool = rng.shuffle(Array.from({ length: N * N }, (_, i) => i).filter((i) => !safe.has(i)));
  state.mines = pool.slice(0, MINES);
}

function flood(state, start) {
  const stack = [start];
  while (stack.length) {
    const i = stack.pop();
    if (state.open[i]) continue;
    state.open[i] = true;
    state.flags[i] = false;
    if (count(state, i) === 0) for (const j of around(i)) if (!state.open[j]) stack.push(j);
  }
}

const count = (state, i) => around(i).filter((j) => state.mines.includes(j)).length;
const cleared = (state) => state.mines.length && state.open.filter(Boolean).length === N * N - MINES;

export default {
  id: "minesweeper",
  name: { ar: L("ar", "g.minesweeper.name"), en: L("en", "g.minesweeper.name"), es: L("es", "g.minesweeper.name") },
  aliases: ["mines", "الغام", "ألغام", "كاشف الألغام", "كاشف_الالغام", "buscaminas"],
  icon: "💣",
  category: "puzzle",
  mode: "solo",
  uiMode: "html",
  players: { min: 1, max: 1 },
  inputHint: "g.minesweeper.hint",
  rewardPolicy: { solo: { koin: 1000, exp: 300, energi: 1 }, loss: { exp: 20 } },
  init: () => ({ mines: [], open: Array(N * N).fill(false), flags: Array(N * N).fill(false), boom: null }),
  legalActions(state) {
    if (state.boom !== null || cleared(state)) return [];
    const closed = state.open.map((o, i) => (o ? -1 : i)).filter((i) => i >= 0);
    return [
      ...closed.filter((i) => !state.flags[i]).map((i) => ({ id: "reveal", payload: { cell: i }, label: coord(Math.floor(i / N), i % N), groupKey: "g.minesweeper.reveal" })),
      ...closed.map((i) => ({ id: "flag", payload: { cell: i }, label: `🚩 ${coord(Math.floor(i / N), i % N)}`, groupKey: "g.minesweeper.flag" })),
    ];
  },
  apply(state, action, { rng }) {
    const i = action.payload.cell;
    if (state.open[i]) return { ok: false, code: "illegal" };
    if (action.id === "flag") {
      state.flags[i] = !state.flags[i];
      return { ok: true, state };
    }
    if (!state.mines.length) plant(state, i, rng);
    if (state.mines.includes(i)) {
      state.boom = i;
      return { ok: true, state, events: [{ noteKey: "g.minesweeper.boom", vars: { cell: coord(Math.floor(i / N), i % N) } }] };
    }
    flood(state, i);
    return { ok: true, state };
  },
  status(state) {
    if (state.boom !== null) return { over: true, winners: [], draw: false };
    if (cleared(state)) return { over: true, winners: [0], draw: false };
    return { over: false };
  },
  currentActor: () => 0,
  parseInput(text) {
    const t = digits(text);
    const flag = t.match(/^(?:f|flag|علم|bandera)\s+(.+)$/i);
    const p = parseCoord(flag ? flag[1] : t, N, N);
    if (!p) return null;
    return { id: flag ? "flag" : "reveal", payload: { cell: p.r * N + p.c } };
  },
  view(state, { lang }) {
    const over = state.boom !== null;
    return {
      status: L(lang, "g.minesweeper.status", { n: MINES, f: state.flags.filter(Boolean).length }),
      board: {
        kind: "grid",
        cols: N,
        rowLabels: Array.from({ length: N }, (_, i) => String(i + 1)),
        colLabels: ["🅰", "🅱", "©", "🅳", "🅴", "🅵", "🅶", "🅷"],
        cells: state.open.map((open, i) => {
          if (over && state.mines.includes(i)) return { t: i === state.boom ? "💥" : "💣", k: "mine", hl: i === state.boom };
          if (!open) return state.flags[i] ? { t: "🚩", k: "flag" } : { t: "⬜", k: "hidden" };
          const n = count(state, i);
          return { t: NUMS[n], k: "empty", n: n || undefined, bg: "#0f0c26" };
        }),
      },
    };
  },
};
