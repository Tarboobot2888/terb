// ⚫🔴 الداما — 8×8 · أكل إجباري · أكل متعدد في حركة واحدة · ترقية ملك · minimax
import { register, L } from "../locale.js";
import { coord, digits, parseCoord } from "./_grid.js";

const N = 8;
const MEN = ["🔴", "⚫"];
const KINGS = ["❤️", "🖤"];
const DRAW_PLIES = 80;

register("g.checkers", {
  ar: { name: "الداما", desc: "داما كلاسيكية 8×8 بأكل إجباري ومتعدد وملوك.", hint: "من-إلى مثل C3 D4 (أو C3 E5 G7 للأكل المتعدد)", status: "دور {mark}" },
  en: { name: "Checkers", desc: "Classic 8×8 checkers with forced and multi-captures and kings.", hint: "from-to like C3 D4 (or C3 E5 G7 for multi-jumps)", status: "{mark} to move" },
  es: { name: "Damas", desc: "Damas clásicas 8×8 con captura obligatoria, capturas múltiples y damas.", hint: "origen-destino como C3 D4 (o C3 E5 G7 para capturas múltiples)", status: "Mueve {mark}" },
});

const idx = (r, c) => r * N + c;
const inside = (r, c) => r >= 0 && r < N && c >= 0 && c < N;
const owner = (p) => (p ? p.s : null);

function dirs(piece) {
  if (piece.k) return [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  return piece.s === 0 ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
}

/** كل سلاسل الأكل من خانة (DFS) — الترقية تُنهي السلسلة */
function captures(board, from, piece, path = [from], taken = []) {
  const [r, c] = [Math.floor(from / N), from % N];
  const out = [];
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    if (!piece.k && !dirs(piece).some(([a, b]) => a === dr && b === dc)) continue;
    const mr = r + dr;
    const mc = c + dc;
    const tr = r + dr * 2;
    const tc = c + dc * 2;
    if (!inside(tr, tc)) continue;
    const mid = board[idx(mr, mc)];
    if (!mid || mid.s === piece.s || taken.includes(idx(mr, mc)) || board[idx(tr, tc)]) continue;
    const to = idx(tr, tc);
    const promoted = !piece.k && ((piece.s === 0 && tr === 0) || (piece.s === 1 && tr === N - 1));
    const nextPath = [...path, to];
    const nextTaken = [...taken, idx(mr, mc)];
    const deeper = promoted ? [] : captures(board, to, piece, nextPath, nextTaken);
    if (deeper.length) out.push(...deeper);
    else out.push({ path: nextPath, taken: nextTaken });
  }
  return out;
}

function moves(state, seat) {
  const caps = [];
  const quiet = [];
  state.board.forEach((p, i) => {
    if (!p || p.s !== seat) return;
    // في الحالة الأصلية: القطعة نفسها تُزال مؤقتاً كي لا تعيق مسارها
    const temp = [...state.board];
    temp[i] = null;
    caps.push(...captures(temp, i, p));
    const [r, c] = [Math.floor(i / N), i % N];
    for (const [dr, dc] of dirs(p)) {
      if (inside(r + dr, c + dc) && !state.board[idx(r + dr, c + dc)]) quiet.push({ path: [i, idx(r + dr, c + dc)], taken: [] });
    }
  });
  return caps.length ? caps : quiet;
}

const label = (m) => m.path.map((i) => coord(Math.floor(i / N), i % N)).join(m.taken.length ? "×" : "→");

function evaluate(state, me) {
  let s = 0;
  state.board.forEach((p, i) => {
    if (!p) return;
    const r = Math.floor(i / N);
    const v = (p.k ? 175 : 100) + (p.k ? 0 : (p.s === 0 ? N - 1 - r : r) * 4);
    s += p.s === me ? v : -v;
  });
  return s;
}

export default {
  id: "checkers",
  name: { ar: L("ar", "g.checkers.name"), en: L("en", "g.checkers.name"), es: L("es", "g.checkers.name") },
  aliases: ["draughts", "داما", "الداما", "damas"],
  icon: "⚫",
  category: "board",
  mode: "pvp",
  uiMode: "html",
  players: { min: 2, max: 2 },
  timeout: 180000,
  inputHint: "g.checkers.hint",
  rewardPolicy: { win: { koin: 1500, exp: 250, energi: 1 }, draw: { koin: 300, exp: 80 }, loss: { exp: 30 } },
  init() {
    const board = Array(N * N).fill(null);
    for (let r = 0; r < N; r += 1) for (let c = 0; c < N; c += 1) {
      if ((r + c) % 2 === 1 && r < 3) board[idx(r, c)] = { s: 1, k: false };
      if ((r + c) % 2 === 1 && r > 4) board[idx(r, c)] = { s: 0, k: false };
    }
    return { board, turn: 0, quiet: 0, last: null };
  },
  legalActions(state, seat = state.turn) {
    if (state.quiet >= DRAW_PLIES) return [];
    return moves(state, seat).map((m) => ({ id: "move", payload: { path: m.path }, label: label(m) }));
  },
  apply(state, action, { actor }) {
    const legal = moves(state, actor).find((m) => m.path.join(",") === action.payload.path.join(","));
    if (!legal) return { ok: false, code: "illegal" };
    const from = legal.path[0];
    const to = legal.path[legal.path.length - 1];
    const piece = { ...state.board[from] };
    state.board[from] = null;
    for (const t of legal.taken) state.board[t] = null;
    const r = Math.floor(to / N);
    if ((piece.s === 0 && r === 0) || (piece.s === 1 && r === N - 1)) piece.k = true;
    state.board[to] = piece;
    state.quiet = legal.taken.length ? 0 : state.quiet + 1;
    state.last = legal.path;
    state.turn = 1 - actor;
    return { ok: true, state };
  },
  status(state) {
    if (state.quiet >= DRAW_PLIES) return { over: true, winners: [], draw: true };
    for (const seat of [state.turn]) {
      if (!moves(state, seat).length) return { over: true, winners: [1 - seat], draw: false };
    }
    return { over: false };
  },
  currentActor: (state) => state.turn,
  parseInput(text, state, seat) {
    const parts = digits(text).split(/[\s,\-→>x×]+/).filter(Boolean);
    if (parts.length < 2) return null;
    const cells = parts.map((p) => parseCoord(p, N, N));
    if (cells.some((c) => !c)) return null;
    const path = cells.map(({ r, c }) => idx(r, c));
    // «C3 G7» يكفي إن كان هناك مسار أكل واحد بهذين الطرفين
    const options = moves(state, seat).filter((m) => m.path[0] === path[0] && m.path[m.path.length - 1] === path[path.length - 1]);
    const exact = options.find((m) => m.path.join(",") === path.join(","));
    const pick = exact || (options.length === 1 ? options[0] : null);
    return pick ? { id: "move", payload: { path: pick.path } } : { id: "move", payload: { path } };
  },
  view(state, { lang, turn }) {
    const last = state.last || [];
    return {
      marks: MEN,
      status: L(lang, "g.checkers.status", { mark: MEN[turn] }),
      board: {
        kind: "grid",
        cols: N,
        rowLabels: Array.from({ length: N }, (_, i) => String(i + 1)),
        colLabels: ["🅰", "🅱", "©", "🅳", "🅴", "🅵", "🅶", "🅷"],
        cells: state.board.map((p, i) => {
          const dark = (Math.floor(i / N) + (i % N)) % 2 === 1;
          if (!p) return { t: dark ? "⬛" : "⬜", k: "empty", bg: dark ? "#3a2a4a" : undefined, hl: last.includes(i) };
          return { t: p.k ? KINGS[p.s] : MEN[p.s], k: p.k ? "king" : "disc", s: p.s, hl: last.includes(i), bg: "#3a2a4a" };
        }),
      },
    };
  },
  ai: {
    kind: "minimax",
    depth: { EASY: 1, NORMAL: 3, HARD: 4, EXPERT: 5 },
    evaluate,
    order: (state, actions) => [...actions].sort((a, b) => b.payload.path.length - a.payload.path.length),
  },
};
