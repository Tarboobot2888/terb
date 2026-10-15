// خمسة في صف — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/gomoku.js)
// نفس سلوك «.اركيد gomoku»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "خمسة_في_صف",
  alias: ["gomoku"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "gomoku",
  description: "العب خمسة في صف (جوموكو) مع صديق أو ضد الكمبيوتر",
  usage: ".خمسة_في_صف [@صديق|ai]",
  example: ".خمسة_في_صف",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("gomoku");

export { pluginConfig as config, handler };
