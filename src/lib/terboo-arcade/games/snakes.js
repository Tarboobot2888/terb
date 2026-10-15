// 🐍🎲 ثعبان وسلم — لوحة مرئية محلية (بلا روابط خارجية) · نرد من الخادم · 2–4 لاعبين أو ضد الكمبيوتر
import { BOARD_MAPS } from "../../terboo-game-ulartangga.js";
import { register, L } from "../locale.js";

const COLORS = ["🔴", "🟡", "🟢", "🔵"];
const DICE = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const ROLL_WORDS = /^(ارمي|ارم|ارمى|رمي|roll|tirar|dado)$/i;

register("g.snakes", {
  ar: { name: "ثعبان وسلم", desc: "اصعد السلالم وتجنب الثعابين حتى 100 — نرد من الخادم.", hint: "اكتب «ارمي» أو اضغط 🎲", roll: "🎲 ارمِ النرد", rolled: "{mark} رمى {dice} ({n}): {from} → {to}", ladder: "🪜 صعد السلم!", snake: "🐍 وقع في الثعبان!", bounce: "↩️ ارتد عن 100", status: "دور {mark} {name}", position: "الموقع" },
  en: { name: "Snakes & Ladders", desc: "Climb ladders, dodge snakes, reach 100 — server-side dice.", hint: "type “roll” or tap 🎲", roll: "🎲 Roll the dice", rolled: "{mark} rolled {dice} ({n}): {from} → {to}", ladder: "🪜 Climbed a ladder!", snake: "🐍 Bitten by a snake!", bounce: "↩️ Bounced back from 100", status: "{mark} {name} to roll", position: "Position" },
  es: { name: "Serpientes y escaleras", desc: "Sube escaleras, evita serpientes y llega a 100 — dados del servidor.", hint: "escribe «tirar» o pulsa 🎲", roll: "🎲 Tirar el dado", rolled: "{mark} sacó {dice} ({n}): {from} → {to}", ladder: "🪜 ¡Subió una escalera!", snake: "🐍 ¡Lo mordió una serpiente!", bounce: "↩️ Rebotó desde 100", status: "Tira {mark} {name}", position: "Posición" },
});

export default {
  id: "snakes",
  name: { ar: L("ar", "g.snakes.name"), en: L("en", "g.snakes.name"), es: L("es", "g.snakes.name") },
  aliases: ["ut", "ulartangga", "ثعبان_وسلم", "ثعبان وسلم", "سلم وثعبان", "snakes and ladders", "serpientes"],
  icon: "🐍",
  category: "board",
  mode: "pvp",
  uiMode: "hybrid",
  players: { min: 2, max: 4 },
  timeout: 120000,
  legacyCommand: "ثعبان_وسلم",
  inputHint: "g.snakes.hint",
  rewardPolicy: { win: { koin: 2000, exp: 1000, energi: 5 }, loss: { exp: 50 } },
  init: ({ players }) => ({ pos: Array(players).fill(1), turn: 0, jumps: { ...BOARD_MAPS[0].snakesLadders }, last: null }),
  legalActions: (state) => (state.pos.some((p) => p >= 100) ? [] : [{ id: "roll", payload: null, labelKey: "g.snakes.roll" }]),
  apply(state, action, { actor, rng }) {
    const n = rng.int(6) + 1;
    const from = state.pos[actor];
    let to = from + n;
    const events = [];
    if (to > 100) {
      to = 100 - (to - 100);
      events.push({ noteKey: "g.snakes.bounce" });
    }
    const jump = state.jumps[to];
    if (jump) {
      events.push({ noteKey: jump > to ? "g.snakes.ladder" : "g.snakes.snake" });
      to = jump;
    }
    state.pos[actor] = to;
    state.last = { actor, n, from, to };
    events.unshift({ noteKey: "g.snakes.rolled", vars: { mark: COLORS[actor], dice: DICE[n - 1], n, from, to } });
    if (to !== 100) state.turn = (actor + 1) % state.pos.length;
    return { ok: true, state, events };
  },
  status(state) {
    const w = state.pos.findIndex((p) => p >= 100);
    return w >= 0 ? { over: true, winners: [w], draw: false } : { over: false };
  },
  currentActor: (state) => state.turn,
  parseInput: (text) => (ROLL_WORDS.test(String(text).trim()) ? { id: "roll", payload: null } : null),
  view(state, { lang, turn, players }) {
    const jumps = Object.entries(state.jumps).map(([a, b]) => [Number(a), Number(b)]);
    return {
      marks: COLORS,
      scores: state.pos,
      status: state.pos.some((p) => p >= 100) ? "" : L(lang, "g.snakes.status", { mark: COLORS[turn], name: players?.[turn]?.name || "" }),
      board: {
        kind: "track",
        size: 100,
        cols: 10,
        ladders: jumps.filter(([a, b]) => b > a),
        snakes: jumps.filter(([a, b]) => b < a),
        tokens: state.pos.map((pos, i) => ({ pos, mark: COLORS[i], seat: i })),
      },
      panels: state.pos.map((p, i) => ({ label: `${COLORS[i]} ${players?.[i]?.name || ""}`, value: String(p) })),
    };
  },
  // لا قرار في هذه اللعبة سوى رمي النرد — «الذكاء» يرمي فقط
  ai: { kind: "heuristic", choose: (state, actor, { legal }) => legal[0] },
};
