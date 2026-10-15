// الثعبان الذهبي — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/snake.js)
// نفس سلوك «.اركيد snake»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "الثعبان_الذهبي",
  alias: ["snake"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "snake",
  description: "العب الثعبان الذهبي وكُل التفاح",
  usage: ".الثعبان_الذهبي [@صديق|ai]",
  example: ".الثعبان_الذهبي",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("snake");

export { pluginConfig as config, handler };
