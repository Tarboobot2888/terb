// ❌⭕ XO — التنفيذ المرجعي لـ TERBOO ARCADE (HTML للعرض + أزرار للتفاعل + minimax كامل)
import { register, L } from "../locale.js";

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const MARKS = ["❌", "⭕"];
const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

register("g.xo", {
  ar: { name: "إكس أو", desc: "ثلاثة في صف على لوحة 3×3.", hint: "رقم الخانة 1–9", status: "دور {mark}" },
  en: { name: "Tic-Tac-Toe", desc: "Three in a row on a 3×3 board.", hint: "cell number 1–9", status: "{mark} to move" },
  es: { name: "Tres en raya", desc: "Tres en línea en un tablero de 3×3.", hint: "número de casilla 1–9", status: "Mueve {mark}" },
});

function winLine(board) {
  return LINES.find(([a, b, c]) => board[a] !== null && board[a] === board[b] && board[b] === board[c]) || null;
}

export default {
  id: "xo",
  name: { ar: L("ar", "g.xo.name"), en: L("en", "g.xo.name"), es: L("es", "g.xo.name") },
  aliases: ["ttt", "tictactoe", "اكس_او", "اكس او", "إكس أو", "xo", "اكسو", "tres_en_raya"],
  icon: "❌",
  category: "board",
  mode: "pvp",
  uiMode: "html",
  players: { min: 2, max: 2 },
  timeout: 90000,
  legacyCommand: "اكس_او",
  inputHint: "g.xo.hint",
  rewardPolicy: { win: { koin: 1000, exp: 150, energi: 1 }, draw: { koin: 200, exp: 60 }, loss: { exp: 20 } },
  init: () => ({ board: Array(9).fill(null), turn: 0, last: null }),
  legalActions(state) {
    if (winLine(state.board) || state.board.every((c) => c !== null)) return [];
    return state.board.flatMap((c, i) => (c === null ? [{ id: "place", payload: { cell: i }, label: NUM[i] }] : []));
  },
  apply(state, action, { actor }) {
    const cell = action.payload?.cell;
    if (state.board[cell] !== null) return { ok: false, code: "illegal" };
    state.board[cell] = actor;
    state.last = cell;
    state.turn = 1 - actor;
    return { ok: true, state, events: [{ type: "place", cell, actor }] };
  },
  status(state) {
    const line = winLine(state.board);
    if (line) return { over: true, winners: [state.board[line[0]]], draw: false, line };
    if (state.board.every((c) => c !== null)) return { over: true, winners: [], draw: true };
    return { over: false };
  },
  currentActor: (state) => state.turn,
  parseInput(text) {
    const n = Number(String(text).trim().replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d)));
    return Number.isInteger(n) && n >= 1 && n <= 9 ? { id: "place", payload: { cell: n - 1 } } : null;
  },
  view(state, { lang, turn }) {
    const line = winLine(state.board) || [];
    return {
      marks: MARKS,
      status: line.length || state.board.every((c) => c !== null) ? "" : L(lang, "g.xo.status", { mark: MARKS[turn] }),
      board: {
        kind: "grid",
        cols: 3,
        cells: state.board.map((c, i) => ({
          t: c === null ? NUM[i] : MARKS[c],
          k: c === null ? "empty" : c === 0 ? "x" : "o",
          n: c === null ? i + 1 : undefined,
          a: c === null ? i : undefined,
          hl: line.includes(i),
          pop: state.last === i,
        })),
      },
    };
  },
  ai: {
    kind: "minimax",
    depth: { EASY: 1, NORMAL: 3, HARD: 9, EXPERT: 9 },
    noise: { EASY: 0.5, NORMAL: 0.2, HARD: 0, EXPERT: 0 },
    evaluate(state, me) {
      let score = 0;
      for (const ln of LINES) {
        const vals = ln.map((i) => state.board[i]);
        const mine = vals.filter((v) => v === me).length;
        const theirs = vals.filter((v) => v !== null && v !== me).length;
        if (!theirs) score += mine * mine;
        if (!mine) score -= theirs * theirs;
      }
      return score;
    },
    order: (state, actions) => [...actions].sort((a, b) => (a.payload.cell === 4 ? -1 : b.payload.cell === 4 ? 1 : 0)),
  },
};
