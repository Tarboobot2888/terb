// 🧠 ساحة المعلومات — أسئلة A–D متعددة اللغات من طبقة البيانات · مساعدات · سلسلة · جماعي/فردي
import { register, L } from "../locale.js";
import { loadData, quizGame } from "../questions.js";

register("g.trivia_arena", {
  ar: { name: "ساحة المعلومات", desc: "10 أسئلة معلومات عامة بأربعة خيارات ومساعدات وسلسلة نقاط." },
  en: { name: "Trivia Arena", desc: "10 general-knowledge questions with four options, lifelines and streaks." },
  es: { name: "Arena de preguntas", desc: "10 preguntas de cultura general con cuatro opciones, comodines y rachas." },
});

export default quizGame({
  id: "trivia_arena",
  name: { ar: L("ar", "g.trivia_arena.name"), en: L("en", "g.trivia_arena.name"), es: L("es", "g.trivia_arena.name") },
  aliases: ["trivia", "معلومات", "ساحة_المعلومات", "ساحة المعلومات", "اسئلة", "preguntas"],
  icon: "🧠",
  count: 10,
  source: (rng) => rng.shuffle(loadData("trivia.json")).map((q) => ({ q: q.q, options: q.options, answer: q.answer, hint: q.hint })),
});
