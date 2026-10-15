// ➗ مبارزة الحساب — مسائل مولّدة على الخادم (المستوى يحدد الصعوبة) · أول إجابة صحيحة تفوز بالجولة
import { register, L } from "../locale.js";
import { quizGame } from "../questions.js";

register("g.math_duel", {
  ar: { name: "مبارزة الحساب", desc: "مسائل سريعة — أول من يجيب صح يأخذ النقاط.", hint: "النتيجة قريبة من {n}" },
  en: { name: "Math Duel", desc: "Quick sums — first correct answer takes the points.", hint: "The result is close to {n}" },
  es: { name: "Duelo matemático", desc: "Cuentas rápidas — la primera respuesta correcta se lleva los puntos.", hint: "El resultado está cerca de {n}" },
});

const per = (fn) => Object.fromEntries(["ar", "en", "es"].map((lg) => [lg, fn(lg)]));

function problem(rng, level) {
  const big = level === "HARD" ? 99 : level === "EASY" ? 12 : 40;
  const op = rng.pick(level === "EASY" ? ["+", "-"] : ["+", "-", "×", "÷"]);
  let a = rng.int(big) + 2;
  let b = rng.int(big) + 2;
  let value;
  if (op === "×") {
    a = rng.int(12) + 2;
    b = rng.int(12) + 2;
    value = a * b;
  } else if (op === "÷") {
    b = rng.int(11) + 2;
    value = rng.int(12) + 2;
    a = value * b;
  } else if (op === "-") {
    if (b > a) [a, b] = [b, a];
    value = a - b;
  } else value = a + b;
  const wrong = new Set();
  while (wrong.size < 3) {
    const delta = (rng.int(5) + 1) * (rng.int(2) ? 1 : -1) * (op === "×" ? rng.int(3) + 1 : 1);
    if (value + delta !== value && value + delta >= 0) wrong.add(value + delta);
  }
  return { q: per(() => `${a} ${op} ${b} = ?`), options: [value, ...wrong].map((n) => per(() => String(n))), answer: 0, hint: per((lg) => L(lg, "g.math_duel.hint", { n: Math.round(value / 5) * 5 })) };
}

export default quizGame({
  id: "math_duel",
  name: { ar: L("ar", "g.math_duel.name"), en: L("en", "g.math_duel.name"), es: L("es", "g.math_duel.name") },
  aliases: ["math", "حساب", "مبارزة_الحساب", "مبارزة الحساب", "matematicas"],
  icon: "➗",
  category: "puzzle",
  count: 7,
  timeMs: 20000,
  rewardPolicy: { win: { koin: 500, exp: 180, energi: 1 }, draw: { koin: 100, exp: 50 }, loss: { exp: 25 } },
  source: (rng, options) => Array.from({ length: 7 }, () => problem(rng, options.level || "NORMAL")),
});
