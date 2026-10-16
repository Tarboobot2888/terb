// ⚫⚪ خمسة في صف (جوموكو) — 15×15 · أول من يكوّن خمسة · ذكاء بتقييم التهديدات
import { register, L } from "../locale.js";
import { coord, parseCoord } from "./_grid.js";

const N = 15;
const STONES = ["⚫", "⚪"];
const D4 = [[0, 1], [1, 0], [1, 1], [1, -1]];

register("g.gomoku", {
  ar: { name: "خمسة في صف", desc: "جوموكو 15×15: أول من يرص خمسة أحجار متتالية يفوز.", hint: "خانة مثل H8", status: "دور {mark}", near: "قرب الأحجار" },
  en: { name: "Gomoku", desc: "15×15 Gomoku: first to line up five stones wins.", hint: "a cell like H8", status: "{mark} to move", near: "Near the stones" },
  es: { name: "Gomoku", desc: "Gomoku 15×15: gana quien alinee cinco piedras.", hint: "una casilla como H8", status: "Mueve {mark}", near: "Cerca de las piedras" },
});

const at = (b, r, c) => (r >= 0 && r < N && c >= 0 && c < N ? b[r * N + c] : undefined);

function runLength(b, i, seat, dr, dc) {
  const r = Math.floor(i / N);
  const c = i % N;
  let n = 1;
  let open = 0;
  for (const s of [1, -1]) {
    let k = 1;
    while (at(b, r + dr * k * s, c + dc * k * s) === seat) {
      n += 1;
      k += 1;
    }
    if (at(b, r + dr * k * s, c + dc * k * s) === null) open += 1;
  }
  return { n, open };
}

function winnerAt(b, i) {
  const seat = b[i];
  if (seat === null || seat === undefined) return null;
  for (const [dr, dc] of D4) if (runLength(b, i, seat, dr, dc).n >= 5) return seat;
  return null;
}

/** خانات قرب الأحجار (مسافة ≤ 2) — أولاً في القوائم وللذكاء */
function nearCells(b) {
  const out = new Set();
  b.forEach((v, i) => {
    if (v === null) return;
    const r = Math.floor(i / N);
    const c = i % N;
    for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) if (at(b, r + dr, c + dc) === null) out.add((r + dr) * N + c + dc);
  });
  if (!out.size) out.add(Math.floor(N / 2) * N + Math.floor(N / 2));
  return [...out];
}

function cellScore(b, i, seat) {
  let total = 0;
  for (const [dr, dc] of D4) {
    const { n, open } = runLength(b, i, seat, dr, dc);
    if (n >= 5) total += 100000;
    else if (n === 4) total += open === 2 ? 10000 : open === 1 ? 1200 : 0;
    else if (n === 3) total += open === 2 ? 1000 : open === 1 ? 100 : 0;
    else if (n === 2) total += open === 2 ? 60 : 10;
  }
  return total;
}

export default {
  id: "gomoku",
  name: { ar: L("ar", "g.gomoku.name"), en: L("en", "g.gomoku.name"), es: L("es", "g.gomoku.name") },
  aliases: ["five", "خمسة", "خمسة في صف", "جوموكو", "five in a row"],
  icon: "⚪",
  category: "board",
  mode: "pvp",
  uiMode: "html",
  players: { min: 2, max: 2 },
  timeout: 150000,
  inputHint: "g.gomoku.hint",
  rewardPolicy: { win: { koin: 1300, exp: 220, energi: 1 }, draw: { koin: 300, exp: 80 }, loss: { exp: 25 } },
  init: () => ({ board: Array(N * N).fill(null), turn: 0, last: null, winner: null }),
  legalActions(state) {
    if (state.winner !== null || state.board.every((v) => v !== null)) return [];
    const near = new Set(nearCells(state.board));
    const all = state.board.map((v, i) => i).filter((i) => state.board[i] === null);
    const ordered = [...all.filter((i) => near.has(i)), ...all.filter((i) => !near.has(i))];
    return ordered.map((i) => ({ id: "place", payload: { cell: i }, label: coord(Math.floor(i / N), i % N), groupKey: near.has(i) ? "g.gomoku.near" : undefined }));
  },
  apply(state, action, { actor }) {
    const cell = action.payload.cell;
    if (state.board[cell] !== null) return { ok: false, code: "illegal" };
    state.board[cell] = actor;
    state.last = cell;
    state.winner = winnerAt(state.board, cell);
    state.turn = 1 - actor;
    return { ok: true, state };
  },
  status(state) {
    if (state.winner !== null) return { over: true, winners: [state.winner], draw: false };
    if (state.board.every((v) => v !== null)) return { over: true, winners: [], draw: true };
    return { over: false };
  },
  currentActor: (state) => state.turn,
  parseInput(text) {
    const p = parseCoord(text, N, N);
    return p ? { id: "place", payload: { cell: p.r * N + p.c } } : null;
  },
  view(state, { lang, turn }) {
    return {
      marks: STONES,
      status: state.winner === null ? L(lang, "g.gomoku.status", { mark: STONES[turn] }) : "",
      board: {
        kind: "grid",
        cols: N,
        cells: state.board.map((v, i) => (v === null ? { t: "➕", k: "dot", bg: "#c89b5a" } : { t: STONES[v], k: "disc", s: v, c: v === 0 ? "#111111" : "#f4f4f4", bg: "#c89b5a", hl: state.last === i })),
      },
    };
  },
  ai: {
    kind: "heuristic",
    choose(state, me, { rng, legal, difficulty }) {
      const weight = { EASY: 0.3, NORMAL: 0.8, HARD: 1, EXPERT: 1.15 }[difficulty] ?? 1;
      let best = null;
      for (const i of nearCells(state.board)) {
        const attack = cellScore(state.board, i, me);
        const defend = cellScore(state.board, i, 1 - me) * weight;
        const score = attack + defend + rng.float();
        if (!best || score > best.score) best = { i, score };
      }
      return legal.find((a) => a.payload.cell === best?.i) || rng.pick(legal);
    },
  },
};
