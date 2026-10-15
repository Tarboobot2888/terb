// 🔢 2048 — اسحب البلاطات ودمج المتشابه · البلاطة الجديدة من عشوائية الخادم · الوصول لـ2048 فوز
import { register, L } from "../locale.js";

const N = 4;
const GOAL = 2048;
const DIRS = ["up", "down", "left", "right"];
const WORDS = { up: /^(up|فوق|اعلى|أعلى|w|arriba|⬆️)$/i, down: /^(down|تحت|اسفل|أسفل|s|abajo|⬇️)$/i, left: /^(left|يسار|شمال|a|izquierda|⬅️)$/i, right: /^(right|يمين|d|derecha|➡️)$/i };

register("g.g2048", {
  ar: { name: "2048", desc: "ادمج البلاطات المتشابهة حتى تصل إلى 2048.", hint: "فوق / تحت / يمين / شمال", up: "⬆️ فوق", down: "⬇️ تحت", left: "⬅️ شمال", right: "➡️ يمين", score: "النقاط", best: "أكبر بلاطة" },
  en: { name: "2048", desc: "Merge matching tiles until you reach 2048.", hint: "up / down / left / right", up: "⬆️ Up", down: "⬇️ Down", left: "⬅️ Left", right: "➡️ Right", score: "Score", best: "Best tile" },
  es: { name: "2048", desc: "Combina fichas iguales hasta llegar a 2048.", hint: "arriba / abajo / izquierda / derecha", up: "⬆️ Arriba", down: "⬇️ Abajo", left: "⬅️ Izquierda", right: "➡️ Derecha", score: "Puntos", best: "Mejor ficha" },
});

function slideRow(row) {
  const vals = row.filter(Boolean);
  const out = [];
  let gained = 0;
  for (let i = 0; i < vals.length; i += 1) {
    if (vals[i] === vals[i + 1]) {
      out.push(vals[i] * 2);
      gained += vals[i] * 2;
      i += 1;
    } else out.push(vals[i]);
  }
  while (out.length < N) out.push(0);
  return { row: out, gained };
}

function move(grid, dir) {
  const g = [...grid];
  let gained = 0;
  for (let k = 0; k < N; k += 1) {
    const idx = Array.from({ length: N }, (_, j) => {
      if (dir === "left") return k * N + j;
      if (dir === "right") return k * N + (N - 1 - j);
      if (dir === "up") return j * N + k;
      return (N - 1 - j) * N + k;
    });
    const res = slideRow(idx.map((i) => g[i]));
    idx.forEach((i, j) => {
      g[i] = res.row[j];
    });
    gained += res.gained;
  }
  return { grid: g, gained, moved: g.some((v, i) => v !== grid[i]) };
}

function spawn(grid, rng) {
  const empty = grid.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  if (!empty.length) return grid;
  const g = [...grid];
  g[rng.pick(empty)] = rng.int(10) === 0 ? 4 : 2;
  return g;
}

export default {
  id: "g2048",
  name: { ar: L("ar", "g.g2048.name"), en: L("en", "g.g2048.name"), es: L("es", "g.g2048.name") },
  aliases: ["2048", "الفين", "الفين وثمانية واربعين"],
  icon: "🔢",
  category: "puzzle",
  mode: "solo",
  uiMode: "html",
  players: { min: 1, max: 1 },
  inputHint: "g.g2048.hint",
  rewardPolicy: { solo: { koin: 1500, exp: 400, energi: 2 }, loss: { exp: 30 } },
  init: ({ rng }) => ({ grid: spawn(spawn(Array(N * N).fill(0), rng), rng), score: 0 }),
  legalActions: (state) => (state.grid.includes(GOAL) ? [] : DIRS.filter((d) => move(state.grid, d).moved).map((d) => ({ id: "slide", payload: { dir: d }, labelKey: `g.g2048.${d}` }))),
  apply(state, action, { rng }) {
    const res = move(state.grid, action.payload.dir);
    if (!res.moved) return { ok: false, code: "illegal" };
    state.grid = spawn(res.grid, rng);
    state.score += res.gained;
    return { ok: true, state };
  },
  status(state) {
    if (state.grid.includes(GOAL)) return { over: true, winners: [0], draw: false, scores: [state.score] };
    if (!DIRS.some((d) => move(state.grid, d).moved)) return { over: true, winners: [], draw: false, scores: [state.score] };
    return { over: false };
  },
  currentActor: () => 0,
  parseInput(text) {
    const t = String(text).trim();
    const dir = DIRS.find((d) => WORDS[d].test(t));
    return dir ? { id: "slide", payload: { dir } } : null;
  },
  view(state, { lang }) {
    return {
      scores: [state.score],
      status: "",
      panels: [{ label: L(lang, "g.g2048.score"), value: String(state.score) }, { label: L(lang, "g.g2048.best"), value: String(Math.max(...state.grid)) }],
      board: { kind: "grid", cols: N, sep: " ", cells: state.grid.map((v) => (v ? { t: String(v).padStart(4, " "), k: "tile", n: v } : { t: "   ·", k: "empty" })) },
    };
  },
};
