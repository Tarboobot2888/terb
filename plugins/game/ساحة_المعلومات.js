// ساحة المعلومات — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/trivia_arena.js)
// نفس سلوك «.اركيد trivia_arena»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "ساحة_المعلومات",
  alias: ["trivia"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "trivia_arena",
  description: "ساحة المعلومات: أسئلة عامة بأربعة خيارات ومساعدات",
  usage: ".ساحة_المعلومات [@صديق|ai]",
  example: ".ساحة_المعلومات",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("trivia_arena");

export { pluginConfig as config, handler };
