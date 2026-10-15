// أوثيلو — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/reversi.js)
// نفس سلوك «.اركيد reversi»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "اوثيلو",
  alias: ["reversi","othello"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "reversi",
  description: "العب أوثيلو مع صديق أو ضد الكمبيوتر",
  usage: ".اوثيلو [@صديق|ai]",
  example: ".اوثيلو",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("reversi");

export { pluginConfig as config, handler };
