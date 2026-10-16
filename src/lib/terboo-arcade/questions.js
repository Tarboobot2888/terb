// ═══════════════════════════════════════════════
// ❓ TERBOO ARCADE — محرك الأسئلة
// ───────────────────────────────────────────────
// خيارات A–D · مؤقت لكل سؤال · سلسلة (streak) · مساعدات: 50/50 · تلميح · تخطٍّ · وقت إضافي · ضعف النقاط
// البيانات من طبقة البيانات (src/data/arcade/*.json) أو مولّدة على الخادم — بنصوص ar/en/es.
// party: الكل يجيب معاً (أول إجابة صحيحة تأخذ النقاط، الخطأ يقفل اللاعب لهذا السؤال)
// solo : لاعب واحد بكل المساعدات.
// الإجابة الصحيحة لا تظهر في الأزرار ولا في العرض حتى يُحسم السؤال (لا تسريب من الواجهة).
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { noteFailure } from "../terboo-failure-log.js";
import { register, L } from "./locale.js";

const LETTERS = ["A", "B", "C", "D"];
const LIFELINES = ["fifty", "hint", "skip", "boost", "double"];
const BASE_MS = 30000;
const BOOST_MS = 15000;

register("q", {
  ar: { question: "السؤال {n}/{total}", life: "المساعدات", fifty: "✂️ 50/50", hint: "💡 تلميح", skip: "⏭️ تخطٍّ", boost: "⏱️ +15 ثانية", double: "✖️2 ضعف النقاط", correct: "✅ {name} أجاب صح: {answer} (+{points})", wrong: "❌ {name}: إجابة خاطئة", reveal: "الإجابة الصحيحة: {answer}", timeout: "⏱️ انتهى وقت السؤال", hintText: "💡 {hint}", streak: "🔥 سلسلة {n}", answers: "الإجابات", skipped: "⏭️ تم تخطي السؤال", doubled: "✖️2 مفعّل لهذا السؤال", boosted: "⏱️ +15 ثانية" },
  en: { question: "Question {n}/{total}", life: "Lifelines", fifty: "✂️ 50/50", hint: "💡 Hint", skip: "⏭️ Skip", boost: "⏱️ +15 s", double: "✖️2 Double points", correct: "✅ {name} got it: {answer} (+{points})", wrong: "❌ {name}: wrong answer", reveal: "Correct answer: {answer}", timeout: "⏱️ Time's up for this question", hintText: "💡 {hint}", streak: "🔥 Streak {n}", answers: "Answers", skipped: "⏭️ Question skipped", doubled: "✖️2 active for this question", boosted: "⏱️ +15 seconds" },
  es: { question: "Pregunta {n}/{total}", life: "Comodines", fifty: "✂️ 50/50", hint: "💡 Pista", skip: "⏭️ Saltar", boost: "⏱️ +15 s", double: "✖️2 Puntos dobles", correct: "✅ {name} acertó: {answer} (+{points})", wrong: "❌ {name}: respuesta incorrecta", reveal: "Respuesta correcta: {answer}", timeout: "⏱️ Se acabó el tiempo de la pregunta", hintText: "💡 {hint}", streak: "🔥 Racha {n}", answers: "Respuestas", skipped: "⏭️ Pregunta saltada", doubled: "✖️2 activo en esta pregunta", boosted: "⏱️ +15 segundos" },
});

const dataCache = new Map();
/** يقرأ ملف بيانات من src/data/arcade (مخزن مؤقتاً) */
function loadData(file) {
  if (dataCache.has(file)) return dataCache.get(file);
  let data = [];
  try {
    data = JSON.parse(fs.readFileSync(path.join(process.cwd(), "src", "data", "arcade", file), "utf8"));
  } catch (error) {
    noteFailure("arcade-questions", error, { where: "terboo-arcade/questions:loadData", stage: file, fallback: "empty" });
  }
  dataCache.set(file, data);
  return data;
}

const pickText = (value, lang) => (value && typeof value === "object" ? value[lang] ?? value.en ?? value.ar ?? "" : String(value ?? ""));

/** يخلط الخيارات على الخادم ويعيد {options, answer} */
function shuffleOptions(options, answer, rng) {
  const order = rng.shuffle(options.map((_, i) => i));
  return { options: order.map((i) => options[i]), answer: order.indexOf(answer) };
}

/**
 * مصنع لعبة أسئلة على العقد الموحّد.
 * @param {{id, aliases, icon, category?, players?, count?, source:(rng, options)=>Array<{q, options, answer, hint?}>, rewardPolicy?, timeMs?}} spec
 */
function quizGame(spec) {
  const count = spec.count || 10;
  const timeMs = spec.timeMs || BASE_MS;
  const solo = (state) => state.scores.length === 1;
  return {
    id: spec.id,
    name: spec.name,
    aliases: spec.aliases || [],
    icon: spec.icon || "❓",
    category: spec.category || "quiz",
    mode: "party",
    uiMode: "buttons",
    sessionType: "simultaneous",
    players: spec.players || { min: 1, max: 8 },
    timeout: timeMs,
    inputHint: "ui.quizHint",
    rewardPolicy: spec.rewardPolicy || { win: { koin: 600, exp: 200, energi: 1 }, draw: { koin: 150, exp: 60 }, loss: { exp: 30 } },
    init({ players, rng, options }) {
      const qs = spec.source(rng, options || {}).slice(0, count).map((q) => ({ ...q, ...shuffleOptions(q.options, q.answer, rng) }));
      return {
        qs,
        i: 0,
        scores: Array(players).fill(0),
        streaks: Array(players).fill(0),
        locked: Array(players).fill(false),
        lifelines: Array.from({ length: players }, () => Object.fromEntries(LIFELINES.map((l) => [l, true]))),
        removed: [],
        hint: false,
        double: false,
        boost: 0,
        log: [],
      };
    },
    legalActions(state, seat) {
      if (state.i >= state.qs.length || seat == null || seat < 0 || state.locked[seat]) return [];
      const answers = LETTERS.map((letter, o) => ({ id: "answer", payload: { o }, label: `${letter}`, labels: Object.fromEntries(["ar", "en", "es"].map((lg) => [lg, `${letter}) ${pickText(state.qs[state.i].options[o], lg)}`])), group: null }));
      if (!solo(state)) return answers;
      const lifes = LIFELINES.filter((l) => state.lifelines[seat][l]).map((l) => ({ id: "life", payload: { l }, labelKey: `q.${l}`, groupKey: "q.life" }));
      return [...answers, ...lifes];
    },
    apply(state, action, { actor }) {
      const q = state.qs[state.i];
      const events = [];
      const next = () => {
        state.i += 1;
        state.locked = state.locked.map(() => false);
        state.removed = [];
        state.hint = false;
        state.double = false;
        state.boost = 0;
      };
      if (action.id === "life") {
        const l = action.payload.l;
        state.lifelines[actor][l] = false;
        if (l === "fifty") {
          const wrong = [0, 1, 2, 3].filter((o) => o !== q.answer);
          state.removed = wrong.filter((_, k) => k !== (state.i % wrong.length)).slice(0, 2);
        } else if (l === "hint") state.hint = true;
        else if (l === "boost") {
          state.boost += BOOST_MS;
          events.push({ noteKey: "q.boosted" });
        } else if (l === "double") {
          state.double = true;
          events.push({ noteKey: "q.doubled" });
        } else if (l === "skip") {
          events.push({ noteKey: "q.skipped" }, { noteKey: "q.reveal", vars: { answer: `${LETTERS[q.answer]}` } });
          next();
        }
        return { ok: true, state, events };
      }
      const o = action.payload.o;
      if (o === q.answer) {
        state.streaks[actor] += 1;
        const points = (100 + (state.streaks[actor] - 1) * 10) * (state.double ? 2 : 1);
        state.scores[actor] += points;
        state.log.push({ i: state.i, by: actor, ok: true });
        events.push({ noteKey: "q.correct", vars: { name: `#${actor + 1}`, answer: LETTERS[o], points }, seat: actor });
        if (state.streaks[actor] >= 3) events.push({ noteKey: "q.streak", vars: { n: state.streaks[actor] } });
        next();
      } else {
        state.streaks[actor] = 0;
        state.locked[actor] = true;
        state.log.push({ i: state.i, by: actor, ok: false });
        events.push({ noteKey: "q.wrong", vars: { name: `#${actor + 1}` }, seat: actor });
        if (state.locked.every(Boolean)) {
          events.push({ noteKey: "q.reveal", vars: { answer: LETTERS[q.answer] } });
          next();
        }
      }
      return { ok: true, state, events };
    },
    status(state) {
      if (state.i < state.qs.length) return { over: false };
      const best = Math.max(...state.scores);
      if (solo(state)) return { over: true, winners: state.log.filter((x) => x.ok).length * 2 >= state.qs.length ? [0] : [], draw: false, scores: state.scores };
      if (best <= 0) return { over: true, winners: [], draw: true, scores: state.scores };
      const winners = state.scores.map((s, i) => (s === best ? i : -1)).filter((i) => i >= 0);
      return { over: true, winners, draw: false, scores: state.scores };
    },
    currentActor: () => null,
    turnTimeout: (state) => timeMs + (state.boost || 0),
    onTimeout(state) {
      if (state.i < state.qs.length) {
        state.log.push({ i: state.i, by: null, ok: false, timeout: true });
        state.i += 1;
        state.locked = state.locked.map(() => false);
        state.removed = [];
        state.hint = false;
        state.double = false;
        state.boost = 0;
      }
      return { state };
    },
    parseInput(text) {
      const t = String(text).trim().toUpperCase().replace(/[)\].]/g, "");
      const map = { A: 0, B: 1, C: 2, D: 3, "أ": 0, "ب": 1, "ج": 2, "د": 3, 1: 0, 2: 1, 3: 2, 4: 3 };
      return t in map ? { id: "answer", payload: { o: map[t] } } : null;
    },
    view(state, { lang }) {
      if (state.i >= state.qs.length) return { scores: state.scores, status: "", board: { kind: "lines", lines: [] } };
      const q = state.qs[state.i];
      const lines = [
        `*${L(lang, "q.question", { n: state.i + 1, total: state.qs.length })}*`,
        pickText(q.q, lang),
        "",
        ...q.options.map((opt, o) => (state.removed.includes(o) ? `~${LETTERS[o]}) ${pickText(opt, lang)}~` : `${LETTERS[o]}) ${pickText(opt, lang)}`)),
      ];
      if (state.hint && q.hint) lines.push("", L(lang, "q.hintText", { hint: pickText(q.hint, lang) }));
      if (q.flag) lines.splice(1, 0, q.flag);
      return { scores: state.scores, status: L(lang, "ui.time") + `: ${Math.round((timeMs + (state.boost || 0)) / 1000)}s`, board: { kind: "lines", lines } };
    },
  };
}

export { LETTERS, LIFELINES, loadData, pickText, quizGame, shuffleOptions };
