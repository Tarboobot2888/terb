// 🔢 سودوكو — لغز 9×9 يولّده الخادم (نمط صالح + تبديلات عشوائية) · المستوى يحدد عدد الفراغات · 3 تلميحات
import { register, L } from "../locale.js";
import { coord, digits, parseCoord } from "./_grid.js";

const N = 9;
const HOLES = { EASY: 36, NORMAL: 46, HARD: 52, EXPERT: 56 };
const KEY = ["", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

register("g.sudoku", {
  ar: { name: "سودوكو", desc: "املأ الشبكة 9×9 بحيث لا يتكرر رقم في صف أو عمود أو مربع.", hint: "«A1 5» لوضع رقم · «A1 0» للمسح · «تلميح»", hintBtn: "💡 تلميح ({n})", conflict: "❌ يتعارض مع صف/عمود/مربع", filled: "الخانات المملوءة", hinted: "💡 {cell} = {v}" },
  en: { name: "Sudoku", desc: "Fill the 9×9 grid so no digit repeats in a row, column or box.", hint: "“A1 5” to place · “A1 0” to clear · “hint”", hintBtn: "💡 Hint ({n})", conflict: "❌ Conflicts with a row/column/box", filled: "Filled cells", hinted: "💡 {cell} = {v}" },
  es: { name: "Sudoku", desc: "Rellena la cuadrícula 9×9 sin repetir dígitos en fila, columna o caja.", hint: "«A1 5» para colocar · «A1 0» para borrar · «pista»", hintBtn: "💡 Pista ({n})", conflict: "❌ Choca con una fila/columna/caja", filled: "Casillas llenas", hinted: "💡 {cell} = {v}" },
});

/** حل كامل صالح: النمط القياسي ثم تبديل أرقام/صفوف داخل الأشرطة/أشرطة/أعمدة */
function solved(rng) {
  const base = (r, c) => ((r % 3) * 3 + Math.floor(r / 3) + c) % 9;
  const digitsMap = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const rows = rng.shuffle([0, 1, 2]).flatMap((band) => rng.shuffle([0, 1, 2]).map((r) => band * 3 + r));
  const cols = rng.shuffle([0, 1, 2]).flatMap((stack) => rng.shuffle([0, 1, 2]).map((c) => stack * 3 + c));
  return rows.flatMap((r) => cols.map((c) => digitsMap[base(r, c)]));
}

function conflicts(grid, i, v) {
  const r = Math.floor(i / N);
  const c = i % N;
  for (let k = 0; k < N; k += 1) {
    if (k !== c && grid[r * N + k] === v) return true;
    if (k !== r && grid[k * N + c] === v) return true;
  }
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr += 1) for (let dc = 0; dc < 3; dc += 1) {
    const j = (br + dr) * N + bc + dc;
    if (j !== i && grid[j] === v) return true;
  }
  return false;
}

export default {
  id: "sudoku",
  name: { ar: L("ar", "g.sudoku.name"), en: L("en", "g.sudoku.name"), es: L("es", "g.sudoku.name") },
  aliases: ["سودوكو", "sudoku"],
  icon: "9️⃣",
  category: "puzzle",
  mode: "solo",
  uiMode: "html",
  players: { min: 1, max: 1 },
  inputHint: "g.sudoku.hint",
  freeActions: ["set"],
  rewardPolicy: { solo: { koin: 1600, exp: 450, energi: 2 }, loss: { exp: 30 } },
  init({ rng, options }) {
    const solution = solved(rng);
    const holes = rng.shuffle(Array.from({ length: N * N }, (_, i) => i)).slice(0, HOLES[options?.difficulty] || HOLES.NORMAL);
    const grid = solution.map((v, i) => (holes.includes(i) ? 0 : v));
    return { grid, given: grid.map(Boolean), solution, hints: 3, last: null };
  },
  legalActions: (state) => (state.grid.every(Boolean) ? [] : state.hints > 0 ? [{ id: "hint", payload: null, labelKey: "g.sudoku.hintBtn", labelVars: { n: state.hints } }] : []),
  /** «set» حرة: الخلية قابلة للتعديل والرقم لا يتعارض (0 = مسح) */
  validateFree(state, action) {
    const { cell, v } = action.payload || {};
    if (!Number.isInteger(cell) || cell < 0 || cell >= N * N || !Number.isInteger(v) || v < 0 || v > 9) return { ok: false, code: "illegal" };
    if (state.given[cell]) return { ok: false, code: "illegal" };
    if (v && conflicts(state.grid, cell, v)) return { ok: false, code: "illegal", detail: "conflict" };
    return { ok: true, action: { id: "set", payload: { cell, v } } };
  },
  apply(state, action) {
    if (action.id === "hint") {
      const empty = state.grid.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
      // تلميح حتمي: أول خانة فارغة لا يتعارض حلها مع الشبكة الحالية
      const i = empty.find((j) => !conflicts(state.grid, j, state.solution[j]));
      if (i === undefined) return { ok: false, code: "illegal" };
      state.grid[i] = state.solution[i];
      state.hints -= 1;
      state.last = i;
      return { ok: true, state, events: [{ noteKey: "g.sudoku.hinted", vars: { cell: coord(Math.floor(i / N), i % N), v: state.solution[i] } }] };
    }
    state.grid[action.payload.cell] = action.payload.v;
    state.last = action.payload.cell;
    return { ok: true, state };
  },
  status: (state) => (state.grid.every((v, i) => v && !conflicts(state.grid, i, v)) ? { over: true, winners: [0], draw: false } : { over: false }),
  currentActor: () => 0,
  parseInput(text) {
    const t = digits(text);
    if (/^(hint|تلميح|pista)$/i.test(t)) return { id: "hint", payload: null };
    const m = t.match(/^([a-i]\s*\d)\s*[=:\s]\s*(\d)$/i);
    if (!m) return null;
    const p = parseCoord(m[1].replace(/\s+/g, ""), N, N);
    return p ? { id: "set", payload: { cell: p.r * N + p.c, v: Number(m[2]) } } : null;
  },
  view(state, { lang }) {
    return {
      panels: [{ label: L(lang, "g.sudoku.filled"), value: `${state.grid.filter(Boolean).length}/81` }],
      board: {
        kind: "grid",
        cols: N,
        rowLabels: Array.from({ length: N }, (_, i) => String(i + 1)),
        colLabels: ["🅰", "🅱", "©", "🅳", "🅴", "🅵", "🅶", "🅷", "🅸"],
        cells: state.grid.map((v, i) => {
          const box = (Math.floor(Math.floor(i / N) / 3) + Math.floor((i % N) / 3)) % 2;
          return { t: v ? KEY[v] : "⬜", k: "empty", n: v || undefined, bg: state.given[i] ? (box ? "#2b2a55" : "#232048") : box ? "#3b2f80" : "#33296e", hl: state.last === i };
        }),
      },
    };
  },
};
