// ⬛ نقط ومربعات — 3×3 مربعات · من يغلق مربعاً يأخذه ويلعب مجدداً · ذكاء يتجنب الضلع الثالث ويضحي بأقصر سلسلة
import { register, L } from "../locale.js";
import { digits, parseCoord } from "./_grid.js";

const B = 3;
const D = B + 1;
const COLORS = ["🟥", "🟦"];
const LETTERS = "ABCD";

register("g.dotsboxes", {
  ar: { name: "نقط ومربعات", desc: "ارسم الخطوط بين النقاط؛ من يغلق مربعاً يأخذه ويلعب مرة أخرى.", hint: "نقطتان متجاورتان مثل A1 B1", status: "دور {mark}", boxes: "المربعات" },
  en: { name: "Dots and Boxes", desc: "Draw lines between dots; closing a box claims it and grants another turn.", hint: "two adjacent dots like A1 B1", status: "{mark} to move", boxes: "Boxes" },
  es: { name: "Puntos y cajas", desc: "Traza líneas entre puntos; quien cierra una caja la gana y repite turno.", hint: "dos puntos vecinos como A1 B1", status: "Mueve {mark}", boxes: "Cajas" },
});

const allLines = () => [
  ...Array.from({ length: D * B }, (_, k) => `h${Math.floor(k / B)}${k % B}`),
  ...Array.from({ length: B * D }, (_, k) => `v${Math.floor(k / D)}${k % D}`),
];
const dot = (r, c) => `${LETTERS[c]}${r + 1}`;
function lineLabel(id) {
  const r = Number(id[1]);
  const c = Number(id[2]);
  return id[0] === "h" ? `${dot(r, c)}–${dot(r, c + 1)}` : `${dot(r, c)}–${dot(r + 1, c)}`;
}
const boxSides = (r, c) => [`h${r}${c}`, `h${r + 1}${c}`, `v${r}${c}`, `v${r}${c + 1}`];
function boxesOf(id) {
  const r = Number(id[1]);
  const c = Number(id[2]);
  if (id[0] === "h") return [[r - 1, c], [r, c]].filter(([a]) => a >= 0 && a < B);
  return [[r, c - 1], [r, c]].filter(([, b]) => b >= 0 && b < B);
}
const sidesDrawn = (lines, r, c) => boxSides(r, c).filter((s) => s in lines).length;
const completes = (lines, id) => boxesOf(id).filter(([r, c]) => sidesDrawn(lines, r, c) === 3).length;
const givesThird = (lines, id) => boxesOf(id).some(([r, c]) => sidesDrawn(lines, r, c) === 2);

/** كم مربعاً يأخذه الخصم إن رسمنا هذا الخط (أكل جشع متتالٍ) */
function giveaway(lines, id) {
  const sim = { ...lines, [id]: 1 };
  let taken = 0;
  for (let guard = 0; guard < 40; guard += 1) {
    const grab = allLines().find((l) => !(l in sim) && completes(sim, l));
    if (!grab) break;
    taken += completes(sim, grab);
    sim[grab] = 0;
  }
  return taken;
}

export default {
  id: "dotsboxes",
  name: { ar: L("ar", "g.dotsboxes.name"), en: L("en", "g.dotsboxes.name"), es: L("es", "g.dotsboxes.name") },
  aliases: ["dots", "نقط", "نقط ومربعات", "نقط_ومربعات", "puntos y cajas"],
  icon: "⬛",
  category: "puzzle",
  mode: "pvp",
  uiMode: "html",
  players: { min: 2, max: 2 },
  timeout: 120000,
  inputHint: "g.dotsboxes.hint",
  rewardPolicy: { win: { koin: 1000, exp: 180, energi: 1 }, draw: { koin: 250, exp: 70 }, loss: { exp: 25 } },
  init: () => ({ lines: {}, boxes: Array(B * B).fill(null), turn: 0, last: null }),
  legalActions: (state) => allLines().filter((l) => !(l in state.lines)).map((l) => ({ id: "line", payload: { line: l }, label: lineLabel(l) })),
  apply(state, action, { actor }) {
    const id = action.payload.line;
    if (id in state.lines || !allLines().includes(id)) return { ok: false, code: "illegal" };
    state.lines[id] = actor;
    let closed = 0;
    for (const [r, c] of boxesOf(id)) {
      if (state.boxes[r * B + c] === null && sidesDrawn(state.lines, r, c) === 4) {
        state.boxes[r * B + c] = actor;
        closed += 1;
      }
    }
    state.last = id;
    if (!closed) state.turn = 1 - actor;
    return { ok: true, state };
  },
  status(state) {
    if (state.boxes.some((b) => b === null)) return { over: false };
    const a = state.boxes.filter((b) => b === 0).length;
    const b = state.boxes.filter((x) => x === 1).length;
    return a === b ? { over: true, winners: [], draw: true, scores: [a, b] } : { over: true, winners: [a > b ? 0 : 1], draw: false, scores: [a, b] };
  },
  currentActor: (state) => state.turn,
  parseInput(text) {
    const parts = digits(text).split(/[\s,\-–]+/).filter(Boolean);
    if (parts.length !== 2) return null;
    const [p, q] = parts.map((x) => parseCoord(x, D, D));
    if (!p || !q) return null;
    const [a, b] = p.r * D + p.c <= q.r * D + q.c ? [p, q] : [q, p];
    if (a.r === b.r && b.c === a.c + 1) return { id: "line", payload: { line: `h${a.r}${a.c}` } };
    if (a.c === b.c && b.r === a.r + 1) return { id: "line", payload: { line: `v${a.r}${a.c}` } };
    return null;
  },
  view(state, { lang, turn }) {
    const S = 2 * B + 1;
    const cells = [];
    for (let r = 0; r < S; r += 1) for (let c = 0; c < S; c += 1) {
      if (r % 2 === 0 && c % 2 === 0) cells.push({ t: "⚫", k: "dot", n: r === 0 ? LETTERS[c / 2] : c === 0 ? r / 2 + 1 : undefined });
      else if (r % 2 === 0) {
        const id = `h${r / 2}${(c - 1) / 2}`;
        cells.push({ t: id in state.lines ? "➖" : "  ", k: "line", on: id in state.lines, s: state.lines[id], hl: state.last === id });
      } else if (c % 2 === 0) {
        const id = `v${(r - 1) / 2}${c / 2}`;
        cells.push({ t: id in state.lines ? "｜" : "  ", k: "line", v: true, on: id in state.lines, s: state.lines[id], hl: state.last === id });
      } else {
        const owner = state.boxes[((r - 1) / 2) * B + (c - 1) / 2];
        cells.push({ t: owner === null ? "  " : COLORS[owner], k: owner === null ? "empty" : "box", s: owner ?? undefined });
      }
    }
    return {
      marks: COLORS,
      scores: [0, 1].map((s) => state.boxes.filter((b) => b === s).length),
      status: state.boxes.some((b) => b === null) ? L(lang, "g.dotsboxes.status", { mark: COLORS[turn] }) : "",
      board: { kind: "grid", cols: S, cells },
    };
  },
  ai: {
    kind: "heuristic",
    choose(state, me, { rng, legal, difficulty }) {
      if (difficulty === "EASY" && rng.float() < 0.5) return rng.pick(legal);
      const ids = legal.map((a) => a.payload.line);
      const grab = ids.filter((l) => completes(state.lines, l));
      if (grab.length) return legal.find((a) => a.payload.line === rng.pick(grab));
      const safe = ids.filter((l) => !givesThird(state.lines, l));
      if (safe.length) return legal.find((a) => a.payload.line === rng.pick(safe));
      if (difficulty === "NORMAL") return rng.pick(legal);
      const best = ids.map((l) => ({ l, g: giveaway(state.lines, l) })).sort((a, b) => a.g - b.g)[0];
      return legal.find((a) => a.payload.line === best.l);
    },
  },
};
