// ⚫⚪ أوثيلو (ريفيرسي) — 8×8 · قلب القطع · تمرير عند العجز · minimax بأوزان المواقع والحركية
import { register, L } from "../locale.js";
import { coord, digits, parseCoord } from "./_grid.js";

const N = 8;
const DISCS = ["⚫", "⚪"];
const D8 = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
const W = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];
const PASS = /^(pass|تمرير|مرر|pasar|paso)$/i;

register("g.reversi", {
  ar: { name: "أوثيلو", desc: "حاصر قطع خصمك لتقلبها — الأكثر قطعاً يفوز.", hint: "خانة مثل D3 (أو «تمرير» إن لم توجد حركة)", status: "دور {mark}", pass: "⏭️ تمرير" },
  en: { name: "Reversi", desc: "Outflank your opponent's discs to flip them — most discs wins.", hint: "a cell like D3 (or “pass” when you have no move)", status: "{mark} to move", pass: "⏭️ Pass" },
  es: { name: "Reversi", desc: "Encierra las fichas rivales para voltearlas — gana quien tenga más.", hint: "una casilla como D3 (o «pasar» si no tienes jugada)", status: "Mueve {mark}", pass: "⏭️ Pasar" },
});

function flips(board, i, seat) {
  if (board[i] !== null) return [];
  const r = Math.floor(i / N);
  const c = i % N;
  const out = [];
  for (const [dr, dc] of D8) {
    const line = [];
    let rr = r + dr;
    let cc = c + dc;
    while (rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === 1 - seat) {
      line.push(rr * N + cc);
      rr += dr;
      cc += dc;
    }
    if (line.length && rr >= 0 && rr < N && cc >= 0 && cc < N && board[rr * N + cc] === seat) out.push(...line);
  }
  return out;
}

const placements = (board, seat) => board.map((_, i) => i).filter((i) => flips(board, i, seat).length);
const count = (board, seat) => board.filter((v) => v === seat).length;

export default {
  id: "reversi",
  name: { ar: L("ar", "g.reversi.name"), en: L("en", "g.reversi.name"), es: L("es", "g.reversi.name") },
  aliases: ["othello", "اوثيلو", "أوثيلو", "ريفيرسي"],
  icon: "⚪",
  category: "board",
  mode: "pvp",
  uiMode: "html",
  players: { min: 2, max: 2 },
  timeout: 150000,
  inputHint: "g.reversi.hint",
  rewardPolicy: { win: { koin: 1300, exp: 220, energi: 1 }, draw: { koin: 300, exp: 80 }, loss: { exp: 25 } },
  init() {
    const board = Array(N * N).fill(null);
    board[27] = 1;
    board[28] = 0;
    board[35] = 0;
    board[36] = 1;
    return { board, turn: 0, last: null, passes: 0 };
  },
  legalActions(state, seat = state.turn) {
    const places = placements(state.board, seat);
    if (places.length) return places.map((i) => ({ id: "place", payload: { cell: i }, label: coord(Math.floor(i / N), i % N) }));
    // لا حركة: تمرير فقط إن كان للخصم حركة (وإلا انتهت اللعبة)
    return placements(state.board, 1 - seat).length ? [{ id: "pass", payload: null, labelKey: "g.reversi.pass" }] : [];
  },
  apply(state, action, { actor }) {
    if (action.id === "pass") {
      state.passes += 1;
      state.turn = 1 - actor;
      return { ok: true, state };
    }
    const cell = action.payload.cell;
    const f = flips(state.board, cell, actor);
    if (!f.length) return { ok: false, code: "illegal" };
    state.board[cell] = actor;
    for (const i of f) state.board[i] = actor;
    state.last = cell;
    state.passes = 0;
    state.turn = 1 - actor;
    return { ok: true, state };
  },
  status(state) {
    if (placements(state.board, 0).length || placements(state.board, 1).length) return { over: false };
    const a = count(state.board, 0);
    const b = count(state.board, 1);
    if (a === b) return { over: true, winners: [], draw: true, scores: [a, b] };
    return { over: true, winners: [a > b ? 0 : 1], draw: false, scores: [a, b] };
  },
  currentActor: (state) => state.turn,
  parseInput(text) {
    if (PASS.test(digits(text))) return { id: "pass", payload: null };
    const at = parseCoord(text, N, N);
    return at ? { id: "place", payload: { cell: at.r * N + at.c } } : null;
  },
  view(state, { lang, turn }) {
    const legal = new Set(placements(state.board, turn));
    return {
      marks: DISCS,
      scores: [count(state.board, 0), count(state.board, 1)],
      status: L(lang, "g.reversi.status", { mark: DISCS[turn] }),
      board: {
        kind: "grid",
        cols: N,
        rowLabels: Array.from({ length: N }, (_, i) => String(i + 1)),
        colLabels: ["🅰", "🅱", "©", "🅳", "🅴", "🅵", "🅶", "🅷"],
        cells: state.board.map((v, i) => (v === null
          ? { t: legal.has(i) ? "🟩" : "🟫", k: legal.has(i) ? "dot" : "empty", bg: "#1f6b3a" }
          : { t: DISCS[v], k: "disc", s: v, c: v === 0 ? "#111111" : "#f4f4f4", bg: "#1f6b3a", hl: state.last === i })),
      },
    };
  },
  ai: {
    kind: "minimax",
    depth: { EASY: 1, NORMAL: 2, HARD: 3, EXPERT: 4 },
    evaluate(state, me) {
      let s = 0;
      state.board.forEach((v, i) => {
        if (v === me) s += W[i];
        else if (v !== null) s -= W[i];
      });
      return s + 5 * (placements(state.board, me).length - placements(state.board, 1 - me).length);
    },
    order: (state, actions) => [...actions].sort((a, b) => (W[b.payload?.cell] ?? 0) - (W[a.payload?.cell] ?? 0)),
  },
};
