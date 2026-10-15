// 🐍✨ الثعبان الذهبي (Snake Deluxe) — شبكة 10×10 · تفاح وتفاحة ذهبية · اندفاع 3 خطوات · الطعام من عشوائية الخادم
import { register, L } from "../locale.js";

const N = 10;
const GOAL = 18;
const DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
const OPP = { up: "down", down: "up", left: "right", right: "left" };
const WORDS = { up: /^(up|فوق|اعلى|أعلى|w|arriba|⬆️)$/i, down: /^(down|تحت|اسفل|أسفل|s|abajo|⬇️)$/i, left: /^(left|يسار|شمال|a|izquierda|⬅️)$/i, right: /^(right|يمين|d|derecha|➡️)$/i, dash: /^(dash|اندفاع|اندفع|turbo|⚡)$/i };

register("g.snake", {
  ar: { name: "الثعبان الذهبي", desc: "كُل التفاح وتجنب الجدران وجسمك — التفاحة الذهبية بثلاث نقاط. طول 18 = فوز.", hint: "فوق / تحت / يمين / شمال / اندفاع", up: "⬆️ فوق", down: "⬇️ تحت", left: "⬅️ شمال", right: "➡️ يمين", dash: "⚡ اندفاع", crash: "💥 اصطدام!", golden: "✨ تفاحة ذهبية! +3", length: "الطول" },
  en: { name: "Snake Deluxe", desc: "Eat apples, avoid walls and yourself — golden apples give 3. Reach length 18 to win.", hint: "up / down / left / right / dash", up: "⬆️ Up", down: "⬇️ Down", left: "⬅️ Left", right: "➡️ Right", dash: "⚡ Dash", crash: "💥 Crash!", golden: "✨ Golden apple! +3", length: "Length" },
  es: { name: "Serpiente deluxe", desc: "Come manzanas y evita muros y tu cuerpo — la dorada da 3. Llega a 18 para ganar.", hint: "arriba / abajo / izquierda / derecha / turbo", up: "⬆️ Arriba", down: "⬇️ Abajo", left: "⬅️ Izquierda", right: "➡️ Derecha", dash: "⚡ Turbo", crash: "💥 ¡Choque!", golden: "✨ ¡Manzana dorada! +3", length: "Longitud" },
});

function freeCell(state, rng) {
  const taken = new Set([...state.body, state.food, state.gold].filter((x) => x !== null));
  const free = Array.from({ length: N * N }, (_, i) => i).filter((i) => !taken.has(i));
  return free.length ? rng.pick(free) : null;
}

function step(state, rng, events) {
  const [dr, dc] = DIRS[state.dir];
  const head = state.body[0];
  const r = Math.floor(head / N) + dr;
  const c = (head % N) + dc;
  const next = r * N + c;
  // الذيل يتحرك في نفس الخطوة ⇒ الدخول مكانه مسموح
  if (r < 0 || r >= N || c < 0 || c >= N || state.body.slice(0, -1).includes(next)) {
    state.dead = true;
    events.push({ noteKey: "g.snake.crash" });
    return false;
  }
  state.body.unshift(next);
  if (next === state.food) {
    state.grow += 1;
    state.food = freeCell(state, rng);
    if (state.gold === null && rng.int(4) === 0) state.gold = freeCell(state, rng);
  } else if (next === state.gold) {
    state.grow += 3;
    state.gold = null;
    events.push({ noteKey: "g.snake.golden" });
  }
  if (state.grow > 0) state.grow -= 1;
  else state.body.pop();
  return true;
}

export default {
  id: "snake",
  name: { ar: L("ar", "g.snake.name"), en: L("en", "g.snake.name"), es: L("es", "g.snake.name") },
  aliases: ["ثعبان", "الثعبان", "الثعبان الذهبي", "snake deluxe", "serpiente"],
  icon: "🐍",
  category: "arcade",
  mode: "solo",
  uiMode: "html",
  players: { min: 1, max: 1 },
  inputHint: "g.snake.hint",
  rewardPolicy: { solo: { koin: 1100, exp: 300, energi: 1 }, loss: { exp: 20 } },
  init({ rng }) {
    const state = { body: [55, 54, 53], dir: "right", food: null, gold: null, grow: 0, dead: false };
    state.food = freeCell(state, rng);
    return state;
  },
  legalActions(state) {
    if (state.dead || state.body.length >= GOAL) return [];
    return [...Object.keys(DIRS).filter((d) => d !== OPP[state.dir]).map((d) => ({ id: "turn", payload: { d }, labelKey: `g.snake.${d}` })), { id: "dash", payload: null, labelKey: "g.snake.dash" }];
  },
  apply(state, action, { rng }) {
    const events = [];
    if (action.id === "turn") {
      state.dir = action.payload.d;
      step(state, rng, events);
    } else for (let k = 0; k < 3 && !state.dead && state.body.length < GOAL; k += 1) step(state, rng, events);
    return { ok: true, state, events };
  },
  status(state) {
    if (state.body.length >= GOAL) return { over: true, winners: [0], draw: false, scores: [state.body.length] };
    if (state.dead) return { over: true, winners: [], draw: false, scores: [state.body.length] };
    return { over: false };
  },
  currentActor: () => 0,
  parseInput(text) {
    const t = String(text).trim();
    if (WORDS.dash.test(t)) return { id: "dash", payload: null };
    const d = Object.keys(DIRS).find((k) => WORDS[k].test(t));
    return d ? { id: "turn", payload: { d } } : null;
  },
  view(state, { lang }) {
    const body = new Set(state.body);
    return {
      scores: [state.body.length],
      panels: [{ label: L(lang, "g.snake.length"), value: `${state.body.length}/${GOAL}` }],
      board: {
        kind: "grid",
        cols: N,
        cells: Array.from({ length: N * N }, (_, i) => {
          if (i === state.body[0]) return { t: state.dead ? "💥" : "🟢", k: "snake", head: true };
          if (body.has(i)) return { t: "🟩", k: "snake" };
          if (i === state.food) return { t: "🍎", k: "food" };
          if (i === state.gold) return { t: "🌟", k: "food", c: "#ffd700" };
          return { t: "⬛", k: "empty", bg: "#0d0a24" };
        }),
      },
    };
  },
};
