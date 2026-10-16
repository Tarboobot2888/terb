// 🌍 معركة الجغرافيا — عواصم · أعلام · قارات (مولّدة على الخادم من بيانات الدول بثلاث لغات)
import { register, L } from "../locale.js";
import { loadData, quizGame } from "../questions.js";

const CONTINENTS = ["africa", "asia", "europe", "america", "oceania"];

register("g.geo_battle", {
  ar: { name: "معركة الجغرافيا", desc: "عواصم وأعلام وقارات — من يعرف العالم أكثر؟", capital: "ما عاصمة {country}؟", flag: "علم أي دولة هذا؟", continent: "في أي قارة تقع {country}؟", hintCapital: "تبدأ بحرف «{c}»", hintContinent: "ليست {x}", africa: "أفريقيا", asia: "آسيا", europe: "أوروبا", america: "الأمريكتان", oceania: "أوقيانوسيا" },
  en: { name: "Geography Battle", desc: "Capitals, flags and continents — who knows the world best?", capital: "What is the capital of {country}?", flag: "Which country's flag is this?", continent: "Which continent is {country} in?", hintCapital: "It starts with “{c}”", hintContinent: "Not {x}", africa: "Africa", asia: "Asia", europe: "Europe", america: "The Americas", oceania: "Oceania" },
  es: { name: "Batalla de geografía", desc: "Capitales, banderas y continentes — ¿quién conoce mejor el mundo?", capital: "¿Cuál es la capital de {country}?", flag: "¿De qué país es esta bandera?", continent: "¿En qué continente está {country}?", hintCapital: "Empieza por «{c}»", hintContinent: "No es {x}", africa: "África", asia: "Asia", europe: "Europa", america: "América", oceania: "Oceanía" },
});

const LANGS = ["ar", "en", "es"];
const per = (fn) => Object.fromEntries(LANGS.map((lg) => [lg, fn(lg)]));

function questions(rng) {
  const countries = loadData("countries.json");
  const pool = rng.shuffle(countries);
  return pool.slice(0, 10).map((c, k) => {
    const others = rng.shuffle(countries.filter((x) => x.code !== c.code)).slice(0, 3);
    const kind = ["capital", "flag", "continent"][k % 3];
    if (kind === "capital") {
      return { q: per((lg) => L(lg, "g.geo_battle.capital", { country: c.name[lg] })), options: [c, ...others].map((x) => x.capital), answer: 0, hint: per((lg) => L(lg, "g.geo_battle.hintCapital", { c: c.capital[lg][0] })) };
    }
    if (kind === "flag") {
      return { q: per((lg) => `${L(lg, "g.geo_battle.flag")} ${c.flag}`), options: [c, ...others].map((x) => x.name), answer: 0, hint: per((lg) => L(lg, "g.geo_battle.hintCapital", { c: c.name[lg][0] })) };
    }
    const wrong = rng.shuffle(CONTINENTS.filter((x) => x !== c.continent)).slice(0, 3);
    return { q: per((lg) => L(lg, "g.geo_battle.continent", { country: c.name[lg] })), options: [c.continent, ...wrong].map((x) => per((lg) => L(lg, `g.geo_battle.${x}`))), answer: 0, hint: per((lg) => L(lg, "g.geo_battle.hintContinent", { x: L(lg, `g.geo_battle.${wrong[0]}`) })) };
  });
}

export default quizGame({
  id: "geo_battle",
  name: { ar: L("ar", "g.geo_battle.name"), en: L("en", "g.geo_battle.name"), es: L("es", "g.geo_battle.name") },
  aliases: ["geo", "geography", "جغرافيا", "معركة_الجغرافيا", "معركة الجغرافيا", "عواصم", "geografia"],
  icon: "🌍",
  count: 10,
  source: questions,
});
