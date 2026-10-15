// الداما — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/checkers.js)
// نفس سلوك «.اركيد checkers»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "داما",
  alias: ["checkers"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "checkers",
  description: "العب الداما 8×8 مع صديق أو ضد الكمبيوتر",
  usage: ".داما [@صديق|ai]",
  example: ".داما",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("checkers");

export { pluginConfig as config, handler };
