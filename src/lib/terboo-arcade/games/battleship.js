// 🚢 معركة السفن — أسطول يوزّعه الخادم سراً · ضربة إضافية عند الإصابة · مواقع الخصم لا تظهر أبداً قبل النهاية
import { register, L } from "../locale.js";
import { coord, parseCoord } from "./_grid.js";

const N = 8;
const FLEET = [4, 3, 3, 2, 2];
const MARKS = ["🔵", "🟠"];

register("g.battleship", {
  ar: { name: "معركة السفن", desc: "أغرق أسطول خصمك المخفي على شبكة 8×8 — الإصابة تمنحك ضربة أخرى.", hint: "خانة مثل B5", status: "{mark} يطلق على أسطول الخصم", hit: "💥 إصابة في {cell}!", miss: "🌊 {cell}: في الماء", sunk: "🔥 أُغرقت سفينة بطول {n}!", fleet: "السفن الباقية", radar: "رادار", suggested: "اقتراحات" },
  en: { name: "Battleship", desc: "Sink your opponent's hidden fleet on an 8×8 grid — a hit earns another shot.", hint: "a cell like B5", status: "{mark} fires at the enemy fleet", hit: "💥 Hit at {cell}!", miss: "🌊 {cell}: splash", sunk: "🔥 Sank a ship of length {n}!", fleet: "Ships left", radar: "Radar", suggested: "Suggested" },
  es: { name: "Batalla naval", desc: "Hunde la flota oculta del rival en una cuadrícula 8×8 — un impacto da otro disparo.", hint: "una casilla como B5", status: "{mark} dispara a la flota enemiga", hit: "💥 ¡Impacto en {cell}!", miss: "🌊 {cell}: agua", sunk: "🔥 ¡Hundido un barco de {n}!", fleet: "Barcos restantes", radar: "Radar", suggested: "Sugeridas" },
});

function placeFleet(rng) {
  const taken = new Set();
  const ships = [];
  for (const len of FLEET) {
    for (let tries = 0; tries < 500; tries += 1) {
      const horiz = rng.int(2) === 0;
      const r = rng.int(horiz ? N : N - len + 1);
      const c = rng.int(horiz ? N - len + 1 : N);
      const cells = Array.from({ length: len }, (_, k) => (horiz ? r * N + c + k : (r + k) * N + c));
      // لا تلامس: ولا خانة مجاورة لسفينة أخرى
      const near = (i) => [-N - 1, -N, -N + 1, -1, 0, 1, N - 1, N, N + 1].some((d) => {
        const j = i + d;
        return j >= 0 && j < N * N && Math.abs((j % N) - (i % N)) <= 1 && taken.has(j);
      });
      if (cells.some(near)) continue;
      cells.forEach((i) => taken.add(i));
      ships.push({ cells, hits: [] });
      break;
    }
  }
  return ships;
}

const sunk = (ship) => ship.hits.length === ship.cells.length;
const alive = (ships) => ships.filter((s) => !sunk(s)).length;

/** ترتيب ذكي للخانات: جوار الإصابات أولاً ثم نمط الشطرنج */
function targetOrder(state, shooter) {
  const shots = state.shots[shooter];
  const enemy = state.ships[1 - shooter];
  const openHits = Object.entries(shots).filter(([i, v]) => v === "hit" && !enemy.some((s) => sunk(s) && s.cells.includes(Number(i)))).map(([i]) => Number(i));
  const free = Array.from({ length: N * N }, (_, i) => i).filter((i) => !(i in shots));
  const adj = new Set();
  for (const h of openHits) for (const d of [-N, N, -1, 1]) {
    const j = h + d;
    if (j >= 0 && j < N * N && Math.abs((j % N) - (h % N)) <= 1 && !(j in shots)) adj.add(j);
  }
  const parity = free.filter((i) => !adj.has(i) && (Math.floor(i / N) + (i % N)) % 2 === 0);
  const rest = free.filter((i) => !adj.has(i) && !parity.includes(i));
  return { adj: [...adj], parity, rest };
}

export default {
  id: "battleship",
  name: { ar: L("ar", "g.battleship.name"), en: L("en", "g.battleship.name"), es: L("es", "g.battleship.name") },
  aliases: ["سفن", "معركة السفن", "معركة_السفن", "battleships", "batalla naval"],
  icon: "🚢",
  category: "board",
  mode: "pvp",
  uiMode: "hybrid",
  players: { min: 2, max: 2 },
  timeout: 150000,
  inputHint: "g.battleship.hint",
  rewardPolicy: { win: { koin: 1400, exp: 230, energi: 1 }, loss: { exp: 30 } },
  init: ({ rng }) => ({ ships: [placeFleet(rng), placeFleet(rng)], shots: [{}, {}], turn: 0, last: null }),
  legalActions(state, seat = state.turn) {
    if (alive(state.ships[0]) === 0 || alive(state.ships[1]) === 0) return [];
    const { adj, parity, rest } = targetOrder(state, seat);
    return [...adj, ...parity, ...rest].map((i) => ({ id: "fire", payload: { cell: i }, label: coord(Math.floor(i / N), i % N), groupKey: adj.includes(i) ? "g.battleship.suggested" : undefined }));
  },
  apply(state, action, { actor }) {
    const cell = action.payload.cell;
    if (cell in state.shots[actor]) return { ok: false, code: "illegal" };
    const enemy = state.ships[1 - actor];
    const ship = enemy.find((s) => s.cells.includes(cell));
    const events = [];
    const name = coord(Math.floor(cell / N), cell % N);
    if (ship) {
      ship.hits.push(cell);
      state.shots[actor][cell] = "hit";
      events.push({ noteKey: "g.battleship.hit", vars: { cell: name } });
      if (sunk(ship)) events.push({ noteKey: "g.battleship.sunk", vars: { n: ship.cells.length } });
    } else {
      state.shots[actor][cell] = "miss";
      events.push({ noteKey: "g.battleship.miss", vars: { cell: name } });
      state.turn = 1 - actor;
    }
    state.last = { actor, cell };
    return { ok: true, state, events };
  },
  status(state) {
    for (const seat of [0, 1]) if (alive(state.ships[1 - seat]) === 0) return { over: true, winners: [seat], draw: false };
    return { over: false };
  },
  currentActor: (state) => state.turn,
  parseInput(text) {
    const p = parseCoord(text, N, N);
    return p ? { id: "fire", payload: { cell: p.r * N + p.c } } : null;
  },
  /** رادار صاحب الدور على أسطول الخصم: إصابات/ماء فقط — السفن تظهر بعد النهاية فقط */
  view(state, { lang, turn }) {
    const over = alive(state.ships[0]) === 0 || alive(state.ships[1]) === 0;
    const shooter = over ? (alive(state.ships[1]) === 0 ? 0 : 1) : turn;
    const shots = state.shots[shooter];
    const enemy = state.ships[1 - shooter];
    const cells = Array.from({ length: N * N }, (_, i) => {
      const sh = enemy.find((s) => s.cells.includes(i));
      if (shots[i] === "hit") return sh && sunk(sh) ? { t: "🟥", k: "sunk" } : { t: "💥", k: "hit" };
      if (shots[i] === "miss") return { t: "🌊", k: "miss" };
      if (over && sh) return { t: "🚢", k: "ship" };
      return { t: "▫️", k: "empty" };
    });
    return {
      marks: MARKS,
      status: over ? "" : L(lang, "g.battleship.status", { mark: MARKS[turn] }),
      panels: [0, 1].map((s) => ({ label: `${MARKS[s]} ${L(lang, "g.battleship.fleet")}`, value: String(alive(state.ships[s])) })),
      board: {
        kind: "grid",
        cols: N,
        rowLabels: Array.from({ length: N }, (_, i) => String(i + 1)),
        colLabels: ["🅰", "🅱", "©", "🅳", "🅴", "🅵", "🅶", "🅷"],
        cells: cells.map((cell, i) => ({ ...cell, hl: state.last?.actor === shooter && state.last.cell === i })),
      },
    };
  },
  ai: {
    kind: "heuristic",
    choose(state, me, { rng, legal, difficulty }) {
      if (difficulty === "EASY") return rng.pick(legal);
      const { adj, parity, rest } = targetOrder(state, me);
      const pool = adj.length ? adj : difficulty === "NORMAL" ? [...parity, ...rest] : parity.length ? parity : rest;
      const cell = rng.pick(pool);
      return legal.find((a) => a.payload.cell === cell) || rng.pick(legal);
    },
  },
};
