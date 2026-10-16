// 🧱 تحطيم الطوب — فيزياء شبكية حتمية على الخادم: حرّك المضرب ثم تتقدم الكرة خطوتين · 3 محاولات
import { register, L } from "../locale.js";

const W = 9;
const H = 10;
const PADDLE = 3;
const BRICK_ROWS = 3;
const TICKS = 2;
const BRICK_HEX = ["#ff5964", "#ffb547", "#35a7ff"];
const WORDS = { left: /^(left|يسار|شمال|a|izquierda|⬅️)$/i, right: /^(right|يمين|d|derecha|➡️)$/i, stay: /^(stay|ثبت|مكانك|s|quieto|⏸️)$/i };

register("g.breakout", {
  ar: { name: "تحطيم الطوب", desc: "حرّك المضرب واكسر كل الطوب دون إسقاط الكرة.", hint: "يمين / شمال / ثبت", left: "⬅️ شمال", right: "➡️ يمين", stay: "⏸️ ثبت", lost: "💔 سقطت الكرة!", lives: "المحاولات", score: "النقاط" },
  en: { name: "Breakout", desc: "Move the paddle and break every brick without dropping the ball.", hint: "left / right / stay", left: "⬅️ Left", right: "➡️ Right", stay: "⏸️ Stay", lost: "💔 Ball lost!", lives: "Lives", score: "Score" },
  es: { name: "Rompeladrillos", desc: "Mueve la paleta y rompe todos los ladrillos sin dejar caer la pelota.", hint: "izquierda / derecha / quieto", left: "⬅️ Izquierda", right: "➡️ Derecha", stay: "⏸️ Quieto", lost: "💔 ¡Pelota perdida!", lives: "Vidas", score: "Puntos" },
});

function resetBall(state) {
  state.ball = { r: H - 2, c: state.paddle + 1, dr: -1, dc: state.serve % 2 ? 1 : -1 };
  state.serve += 1;
}

function tick(state, events) {
  const b = state.ball;
  let nr = b.r + b.dr;
  let nc = b.c + b.dc;
  if (nc < 0 || nc >= W) {
    b.dc = -b.dc;
    nc = b.c + b.dc;
  }
  if (nr < 0) {
    b.dr = 1;
    nr = b.r + b.dr;
  }
  const brick = nr < BRICK_ROWS && nr >= 0 ? state.bricks[nr * W + nc] : 0;
  if (brick) {
    state.bricks[nr * W + nc] = 0;
    state.score += 10;
    b.dr = -b.dr;
    return;
  }
  if (nr === H - 1) {
    const hit = nc >= state.paddle && nc < state.paddle + PADDLE;
    if (hit) {
      b.dr = -1;
      // حافة المضرب تغيّر الاتجاه الأفقي
      if (nc === state.paddle) b.dc = -1;
      else if (nc === state.paddle + PADDLE - 1) b.dc = 1;
      return;
    }
  }
  if (nr >= H) {
    state.lives -= 1;
    events.push({ noteKey: "g.breakout.lost" });
    if (state.lives > 0) resetBall(state);
    return;
  }
  b.r = nr;
  b.c = nc;
}

export default {
  id: "breakout",
  name: { ar: L("ar", "g.breakout.name"), en: L("en", "g.breakout.name"), es: L("es", "g.breakout.name") },
  aliases: ["طوب", "تحطيم الطوب", "تحطيم_الطوب", "rompeladrillos", "arkanoid"],
  icon: "🧱",
  category: "arcade",
  mode: "solo",
  uiMode: "html",
  players: { min: 1, max: 1 },
  inputHint: "g.breakout.hint",
  rewardPolicy: { solo: { koin: 1200, exp: 350, energi: 1 }, loss: { exp: 25 } },
  init() {
    const state = { bricks: Array(W * BRICK_ROWS).fill(1), paddle: Math.floor((W - PADDLE) / 2), lives: 3, score: 0, serve: 0, ball: null };
    resetBall(state);
    return state;
  },
  legalActions: (state) => (state.lives <= 0 || !state.bricks.some(Boolean) ? [] : ["left", "stay", "right"].map((d) => ({ id: "paddle", payload: { d }, labelKey: `g.breakout.${d}` }))),
  apply(state, action) {
    const d = action.payload.d;
    if (d === "left") state.paddle = Math.max(0, state.paddle - 1);
    if (d === "right") state.paddle = Math.min(W - PADDLE, state.paddle + 1);
    const events = [];
    for (let k = 0; k < TICKS && state.lives > 0 && state.bricks.some(Boolean); k += 1) tick(state, events);
    return { ok: true, state, events };
  },
  status(state) {
    if (!state.bricks.some(Boolean)) return { over: true, winners: [0], draw: false, scores: [state.score] };
    if (state.lives <= 0) return { over: true, winners: [], draw: false, scores: [state.score] };
    return { over: false };
  },
  currentActor: () => 0,
  parseInput(text) {
    const d = Object.keys(WORDS).find((k) => WORDS[k].test(String(text).trim()));
    return d ? { id: "paddle", payload: { d } } : null;
  },
  view(state, { lang }) {
    const cells = Array.from({ length: W * H }, (_, i) => {
      const r = Math.floor(i / W);
      const c = i % W;
      if (state.ball && state.ball.r === r && state.ball.c === c && state.lives > 0) return { t: "⚪", k: "ball" };
      if (r < BRICK_ROWS && state.bricks[i]) return { t: "🟧", k: "brick", c: BRICK_HEX[r] };
      if (r === H - 1 && c >= state.paddle && c < state.paddle + PADDLE) return { t: "🟦", k: "paddle" };
      return { t: "⬛", k: "empty", bg: "#0d0a24" };
    });
    return {
      scores: [state.score],
      panels: [{ label: L(lang, "g.breakout.lives"), value: "❤️".repeat(Math.max(0, state.lives)) || "0" }, { label: L(lang, "g.breakout.score"), value: String(state.score) }],
      board: { kind: "grid", cols: W, cells },
    };
  },
};
