// سودوكو — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/sudoku.js)
// نفس سلوك «.اركيد sudoku»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "سودوكو",
  alias: ["sudoku"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "sudoku",
  description: "حل لغز سودوكو يولّده البوت",
  usage: ".سودوكو [@صديق|ai]",
  example: ".سودوكو",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("sudoku");

export { pluginConfig as config, handler };
