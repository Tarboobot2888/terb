// ذاكرة البطاقات — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/memory.js)
// نفس سلوك «.اركيد memory»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "ذاكرة_البطاقات",
  alias: ["memorymatch"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "memory",
  description: "العب ذاكرة البطاقات مع صديق أو ضد الكمبيوتر",
  usage: ".ذاكرة_البطاقات [@صديق|ai]",
  example: ".ذاكرة_البطاقات",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("memory");

export { pluginConfig as config, handler };
