// كاشف الألغام — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/minesweeper.js)
// نفس سلوك «.اركيد minesweeper»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "كاشف_الالغام",
  alias: ["minesweeper"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "minesweeper",
  description: "العب كاشف الألغام على لوحة 8×8",
  usage: ".كاشف_الالغام [@صديق|ai]",
  example: ".كاشف_الالغام",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("minesweeper");

export { pluginConfig as config, handler };
