// 🔴🟡 أربعة في صف — لوحة 6×7 · إسقاط في عمود · minimax + alpha-beta بتقييم النوافذ
import { register, L } from "../locale.js";
import { digits, keycap } from "./_grid.js";

const ROWS = 6;
const COLS = 7;
const DISCS = ["🔴", "🟡"];
const ORDER = [3, 2, 4, 1, 5, 0, 6];

register("g.connect4", {
  ar: { name: "أربعة في صف", desc: "أسقط القطع وكوّن أربعاً متتالية أفقياً أو رأسياً أو قطرياً.", hint: "رقم العمود 1–7", status: "دور {mark}" },
  en: { name: "Connect Four", desc: "Drop discs and line up four horizontally, vertically or diagonally.", hint: "column number 1–7", status: "{mark} to move" },
  es: { name: "Cuatro en línea", desc: "Deja caer fichas y alinea cuatro en horizontal, vertical o diagonal.", hint: "número de columna 1–7", status: "Mueve {mark}" },
});

const at = (b, r, c) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? b[r * COLS + c] : undefined);

function lineFrom(b, r, c) {
  const v = at(b, r, c);
  if (v === null || v === undefined) return null;
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
    if (cells.every(([rr, cc]) => at(b, rr, cc) === v)) return cells.map(([rr, cc]) => rr * COLS + cc);
  }
  return null;
}

function winner(b) {
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    const line = lineFrom(b, r, c);
    if (line) return { seat: b[r * COLS + c], line };
  }
  return null;
}

function evaluate(state, me) {
  const b = state.board;
  let score = 0;
  for (let r = 0; r < ROWS; r += 1) score += (b[r * COLS + 3] === me ? 3 : b[r * COLS + 3] === null ? 0 : -3);
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) {
    for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
      const w = [0, 1, 2, 3].map((k) => at(b, r + dr * k, c + dc * k));
      if (w.includes(undefined)) continue;
      const mine = w.filter((v) => v === me).length;
      const theirs = w.filter((v) => v !== null && v !== me).length;
      if (mine && !theirs) score += [0, 1, 5, 40][mine] || 0;
      if (theirs && !mine) score -= [0, 1, 6, 60][theirs] || 0;
    }
  }
  return score;
}

export default {
  id: "connect4",
  name: { ar: L("ar", "g.connect4.name"), en: L("en", "g.connect4.name"), es: L("es", "g.connect4.name") },
  aliases: ["c4", "اربعة", "أربعة في صف", "اربعه في صف", "اربعة_في_صف", "connect four", "cuatro en linea"],
  icon: "🔴",
  category: "board",
  mode: "pvp",
  uiMode: "html",
  players: { min: 2, max: 2 },
  timeout: 120000,
  inputHint: "g.connect4.hint",
  rewardPolicy: { win: { koin: 1200, exp: 200, energi: 1 }, draw: { koin: 250, exp: 70 }, loss: { exp: 25 } },
  init: () => ({ board: Array(ROWS * COLS).fill(null), turn: 0, last: null }),
  legalActions(state) {
    if (winner(state.board) || state.board.every((v) => v !== null)) return [];
    return ORDER.filter((c) => state.board[c] === null).sort((a, b) => a - b).map((c) => ({ id: "drop", payload: { col: c }, label: keycap(c + 1) }));
  },
  apply(state, action, { actor }) {
    const col = action.payload.col;
    for (let r = ROWS - 1; r >= 0; r -= 1) {
      if (state.board[r * COLS + col] === null) {
        state.board[r * COLS + col] = actor;
        state.last = r * COLS + col;
        state.turn = 1 - actor;
        return { ok: true, state };
      }
    }
    return { ok: false, code: "illegal" };
  },
  status(state) {
    const w = winner(state.board);
    if (w) return { over: true, winners: [w.seat], draw: false, line: w.line };
    if (state.board.every((v) => v !== null)) return { over: true, winners: [], draw: true };
    return { over: false };
  },
  currentActor: (state) => state.turn,
  parseInput(text) {
    const n = Number(digits(text));
    return Number.isInteger(n) && n >= 1 && n <= COLS ? { id: "drop", payload: { col: n - 1 } } : null;
  },
  view(state, { lang, turn }) {
    const w = winner(state.board);
    const line = w?.line || [];
    return {
      marks: DISCS,
      status: w || state.board.every((v) => v !== null) ? "" : L(lang, "g.connect4.status", { mark: DISCS[turn] }),
      board: {
        kind: "grid",
        cols: COLS,
        colLabels: Array.from({ length: COLS }, (_, i) => keycap(i + 1)),
        cells: state.board.map((v, i) => ({ t: v === null ? "⚪" : DISCS[v], k: v === null ? "empty" : "disc", s: v ?? undefined, hl: line.includes(i), pop: state.last === i })),
      },
    };
  },
  ai: {
    kind: "minimax",
    depth: { EASY: 1, NORMAL: 3, HARD: 5, EXPERT: 6 },
    evaluate,
    order: (state, actions) => [...actions].sort((a, b) => ORDER.indexOf(a.payload.col) - ORDER.indexOf(b.payload.col)),
  },
};
