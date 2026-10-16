// 🐂🐄 بولز آند كاوز — رقم سري من 4 أرقام مختلفة يختاره الخادم · تخمينات متبادلة · أول من يكشفه يفوز
// الكمبيوتر يستنتج بتصفية المرشحين المتسقين مع كل النتائج المعلنة (حتمي)
import { register, L } from "../locale.js";
import { digits } from "./_grid.js";

const LEN = 4;
const MAX_GUESSES = 24;
const MARKS = ["🅰️", "🅱️"];

register("g.bulls_cows", {
  ar: { name: "بولز آند كاوز", desc: "اكشف الرقم السري (4 أرقام مختلفة): 🐂 رقم في مكانه · 🐄 رقم موجود في مكان آخر.", hint: "4 أرقام مختلفة مثل 1234", result: "{code}: 🐂 {b} · 🐄 {c}", status: "دور {mark}", bad: "4 أرقام مختلفة فقط", secret: "الرقم السري: {code}" },
  en: { name: "Bulls and Cows", desc: "Crack the secret code (4 different digits): 🐂 right place · 🐄 wrong place.", hint: "4 different digits like 1234", result: "{code}: 🐂 {b} · 🐄 {c}", status: "{mark} to guess", bad: "4 different digits only", secret: "The secret was {code}" },
  es: { name: "Toros y vacas", desc: "Descifra el código secreto (4 dígitos distintos): 🐂 en su sitio · 🐄 en otro sitio.", hint: "4 dígitos distintos como 1234", result: "{code}: 🐂 {b} · 🐄 {c}", status: "Adivina {mark}", bad: "Solo 4 dígitos distintos", secret: "El código era {code}" },
});

const valid = (code) => /^\d{4}$/.test(code) && new Set(code).size === LEN;
function grade(guess, secret) {
  let b = 0;
  let c = 0;
  for (let i = 0; i < LEN; i += 1) {
    if (guess[i] === secret[i]) b += 1;
    else if (secret.includes(guess[i])) c += 1;
  }
  return { b, c };
}

let ALL = null;
function allCodes() {
  if (ALL) return ALL;
  ALL = [];
  for (let n = 0; n < 10000; n += 1) {
    const s = String(n).padStart(4, "0");
    if (valid(s)) ALL.push(s);
  }
  return ALL;
}

export default {
  id: "bulls_cows",
  name: { ar: L("ar", "g.bulls_cows.name"), en: L("en", "g.bulls_cows.name"), es: L("es", "g.bulls_cows.name") },
  aliases: ["bulls", "mastermind", "بولز", "بولز اند كاوز", "خمن الرقم", "toros y vacas"],
  icon: "🐂",
  category: "puzzle",
  mode: "pvp",
  uiMode: "text",
  players: { min: 2, max: 2 },
  timeout: 120000,
  inputHint: "g.bulls_cows.hint",
  freeActions: ["guess"],
  rewardPolicy: { win: { koin: 1000, exp: 220, energi: 1 }, draw: { koin: 200, exp: 60 }, loss: { exp: 25 } },
  init: ({ rng }) => ({ secret: rng.shuffle([..."0123456789"]).slice(0, LEN).join(""), log: [], turn: 0, winner: null }),
  legalActions: () => [],
  validateFree(state, action) {
    const code = digits(action.payload?.code || "");
    if (!valid(code)) return { ok: false, code: "illegal", detail: "g.bulls_cows.bad" };
    return { ok: true, action: { id: "guess", payload: { code } } };
  },
  apply(state, action, { actor }) {
    const { code } = action.payload;
    const g = grade(code, state.secret);
    state.log.push({ by: actor, code, ...g });
    if (g.b === LEN) state.winner = actor;
    else state.turn = 1 - actor;
    return { ok: true, state, events: [{ noteKey: "g.bulls_cows.result", vars: { code, b: g.b, c: g.c } }] };
  },
  status(state) {
    if (state.winner !== null) return { over: true, winners: [state.winner], draw: false };
    if (state.log.length >= MAX_GUESSES) return { over: true, winners: [], draw: true };
    return { over: false };
  },
  currentActor: (state) => state.turn,
  parseInput(text) {
    const code = digits(text).replace(/\s+/g, "");
    return /^\d{4}$/.test(code) ? { id: "guess", payload: { code } } : null;
  },
  view(state, { lang, turn }) {
    const over = state.winner !== null || state.log.length >= MAX_GUESSES;
    return {
      marks: MARKS,
      status: over ? L(lang, "g.bulls_cows.secret", { code: state.secret }) : L(lang, "g.bulls_cows.status", { mark: MARKS[turn] }),
      board: { kind: "lines", lines: state.log.slice(-12).map((x) => `${MARKS[x.by]} ${x.code} → 🐂${x.b} 🐄${x.c}`) },
    };
  },
  ai: {
    kind: "custom",
    // الكمبيوتر لا يرى السر: يستنتج من السجل العام فقط (نفس معلومات اللاعب)
    choose(state, me, { rng, difficulty }) {
      const pool = allCodes().filter((code) => state.log.every((x) => {
        const g = grade(x.code, code);
        return g.b === x.b && g.c === x.c;
      }));
      const sloppy = { EASY: 0.6, NORMAL: 0.25, HARD: 0.05, EXPERT: 0 }[difficulty] ?? 0.25;
      const code = rng.float() < sloppy || !pool.length ? rng.pick(allCodes()) : rng.pick(pool);
      return { id: "guess", payload: { code } };
    },
  },
};
