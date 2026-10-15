// 🐍🎲 ثعبان وسلم — على محرك TERBOO ARCADE: لوحة مرئية محلية + نرد من الخادم + زر «ارمِ»
// الأوامر الفرعية القديمة باقية: انشاء/انضمام/بدء/معلومات/خروج/حذف (وبالإنجليزية/الإسبانية)،
// و«ارمي» مكتوبة تعمل كما كانت (يلتقطها answerHandler الموحّد في اركيد.js).
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { arcadeCommand, quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "ثعبان_وسلم",
  alias: ["ut"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "snakes",
  description: "العب ثعبان وسلم مع لاعبين آخرين أو ضد الكمبيوتر مع لوحة مرئية",
  usage: ".ثعبان_وسلم <انشاء|انضمام|بدء|معلومات|خروج|حذف>",
  example: ".ثعبان_وسلم انشاء",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

// الأوامر الفرعية القديمة ⇒ أفعال غرفة المحرك الموحّد
const LEGACY = {
  انشاء: "create", create: "create", crear: "create",
  انضمام: "join", join: "join", unirse: "join",
  بدء: "start", start: "start", iniciar: "start",
  معلومات: "board", info: "board",
  خروج: "leave", leave: "leave", salir: "leave",
  حذف: "cancel", delete: "cancel", borrar: "cancel",
};
const quick = quickCommand("snakes");

async function handler(m, ctx) {
  const verb = LEGACY[String(m.args?.[0] || "").toLowerCase()];
  if (!verb) return quick(m, ctx);
  if (verb === "create") return arcadeCommand(m, ctx.sock, ["play", "snakes", ...(m.args || []).slice(1)]);
  return arcadeCommand(m, ctx.sock, [verb, ...(m.args || []).slice(1)], { gameId: "snakes" });
}

export { pluginConfig as config, handler };
