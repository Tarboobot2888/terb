// معركة السفن — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/battleship.js)
// نفس سلوك «.اركيد battleship»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "معركة_السفن",
  alias: ["battleship"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "battleship",
  description: "العب معركة السفن مع صديق أو ضد الكمبيوتر",
  usage: ".معركة_السفن [@صديق|ai]",
  example: ".معركة_السفن",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("battleship");

export { pluginConfig as config, handler };
