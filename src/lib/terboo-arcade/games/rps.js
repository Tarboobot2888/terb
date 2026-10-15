// ✊✋✌️ حجرة ورقة مقص — اختيار سري بالأزرار في الخاص (privateActions) · أفضل من 3 · ضد صديق أو الكمبيوتر
import { register, L } from "../locale.js";

const PICKS = ["rock", "paper", "scissors"];
const EMOJI = { rock: "✊", paper: "✋", scissors: "✌️" };
const BEATS = { rock: "scissors", paper: "rock", scissors: "paper" };
const WORDS = [
  ["rock", /^(حجره|حجرة|حجر|rock|piedra|batu|✊)$/i],
  ["paper", /^(ورقه|ورقة|ورق|paper|papel|kertas|✋)$/i],
  ["scissors", /^(مقص|scissors|tijera|tijeras|gunting|✌️|✌)$/i],
];
const TARGET = 2;
const MAX_ROUNDS = 5;

register("g.rps", {
  ar: { name: "حجرة ورقة مقص", desc: "تحدٍّ سريع: أفضل من 3، والاختيار سري في الخاص.", hint: "حجرة / ورقة / مقص (في الخاص)", rock: "✊ حجرة", paper: "✋ ورقة", scissors: "✌️ مقص", round: "الجولة {n} · {a} {sa} ⟷ {sb} {b}", tie: "تعادل في الجولة", waiting: "⌛ بانتظار الاختيارات السرية", chosen: "✅ اختار", pending: "⌛ لم يختر" },
  en: { name: "Rock Paper Scissors", desc: "Quick duel: best of 3, choices stay secret in private.", hint: "rock / paper / scissors (in private)", rock: "✊ Rock", paper: "✋ Paper", scissors: "✌️ Scissors", round: "Round {n} · {a} {sa} ⟷ {sb} {b}", tie: "Round tied", waiting: "⌛ Waiting for secret picks", chosen: "✅ picked", pending: "⌛ not yet" },
  es: { name: "Piedra, papel o tijera", desc: "Duelo rápido: al mejor de 3, la elección es secreta en privado.", hint: "piedra / papel / tijera (en privado)", rock: "✊ Piedra", paper: "✋ Papel", scissors: "✌️ Tijera", round: "Ronda {n} · {a} {sa} ⟷ {sb} {b}", tie: "Ronda empatada", waiting: "⌛ Esperando las elecciones secretas", chosen: "✅ eligió", pending: "⌛ aún no" },
});

export default {
  id: "rps",
  name: { ar: L("ar", "g.rps.name"), en: L("en", "g.rps.name"), es: L("es", "g.rps.name") },
  aliases: ["suit", "حجرة_ورقة_مقص", "حجرة ورقة مقص", "حجره ورقه مقص", "rock paper scissors", "piedra papel tijera"],
  icon: "✊",
  category: "party",
  mode: "pvp",
  uiMode: "buttons",
  sessionType: "simultaneous",
  privateActions: true,
  players: { min: 2, max: 2 },
  timeout: 90000,
  legacyCommand: "حجرة_ورقة_مقص",
  inputHint: "g.rps.hint",
  rewardPolicy: { win: { koin: 1000, exp: 100 }, draw: { koin: 100, exp: 30 }, loss: { exp: 10 } },
  init: () => ({ choices: [null, null], wins: [0, 0], round: 1, history: [] }),
  legalActions(state, seat) {
    if (seat == null || seat < 0 || state.choices[seat] || state.wins.some((w) => w >= TARGET) || state.round > MAX_ROUNDS) return [];
    return PICKS.map((p) => ({ id: "pick", payload: { pick: p }, labelKey: `g.rps.${p}` }));
  },
  apply(state, action, { actor }) {
    state.choices[actor] = action.payload.pick;
    const events = [];
    if (state.choices.every(Boolean)) {
      const [a, b] = state.choices;
      const winner = a === b ? null : BEATS[a] === b ? 0 : 1;
      if (winner !== null) state.wins[winner] += 1;
      state.history.push({ a, b, winner });
      events.push({ noteKey: "g.rps.round", vars: { n: state.round, a: EMOJI[a], b: EMOJI[b], sa: state.wins[0], sb: state.wins[1] } });
      if (winner === null) events.push({ noteKey: "g.rps.tie" });
      state.choices = [null, null];
      state.round += 1;
    }
    return { ok: true, state, events };
  },
  status(state) {
    const w = state.wins.findIndex((x) => x >= TARGET);
    if (w >= 0) return { over: true, winners: [w], draw: false, scores: state.wins };
    if (state.round > MAX_ROUNDS) {
      if (state.wins[0] === state.wins[1]) return { over: true, winners: [], draw: true, scores: state.wins };
      return { over: true, winners: [state.wins[0] > state.wins[1] ? 0 : 1], draw: false, scores: state.wins };
    }
    return { over: false };
  },
  currentActor: () => null,
  // مهلة الجولة: من لم يختر يخسر الجولة (لا يُترك الخصم معلّقاً)
  onTimeout(state) {
    const late = state.choices.map((c, i) => (c ? null : i)).filter((i) => i !== null);
    if (late.length === 1) state.wins[1 - late[0]] += 1;
    state.history.push({ a: state.choices[0], b: state.choices[1], winner: late.length === 1 ? 1 - late[0] : null, timeout: true });
    state.choices = [null, null];
    state.round += 1;
    return { state };
  },
  parseInput(text) {
    const hit = WORDS.find(([, re]) => re.test(String(text).trim()));
    return hit ? { id: "pick", payload: { pick: hit[0] } } : null;
  },
  view(state, { lang, players, viewerSeat }) {
    const status = state.wins.some((w) => w >= TARGET) || state.round > MAX_ROUNDS ? "" : L(lang, "g.rps.waiting");
    return {
      marks: ["🅰️", "🅱️"],
      scores: state.wins,
      status,
      board: {
        kind: "lines",
        lines: [
          L(lang, "ui.round", { n: Math.min(state.round, MAX_ROUNDS), total: MAX_ROUNDS }),
          ...state.history.slice(-5).map((h, i) => `${i + 1}. ${EMOJI[h.a] || "⌛"} ⟷ ${EMOJI[h.b] || "⌛"}`),
          ...state.choices.map((c, i) => `${players?.[i]?.name || i + 1}: ${c ? (viewerSeat === i ? EMOJI[c] : L(lang, "g.rps.chosen")) : L(lang, "g.rps.pending")}`),
        ],
      },
    };
  },
  ai: { kind: "heuristic", choose: (state, actor, { rng, legal }) => rng.pick(legal) },
};
