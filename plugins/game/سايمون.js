// سايمون — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/simon.js)
// نفس سلوك «.اركيد simon»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "سايمون",
  alias: ["simon"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "simon",
  description: "تحدي سايمون: احفظ تتابع الألوان وأعده",
  usage: ".سايمون [@صديق|ai]",
  example: ".سايمون",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("simon");

export { pluginConfig as config, handler };
