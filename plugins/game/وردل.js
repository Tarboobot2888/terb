// وردل عربي — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/wordle_ar.js)
// نفس سلوك «.اركيد wordle_ar»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "وردل",
  alias: ["wordle"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "wordle_ar",
  description: "خمّن الكلمة العربية من 5 حروف في 6 محاولات",
  usage: ".وردل [@صديق|ai]",
  example: ".وردل",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("wordle_ar");

export { pluginConfig as config, handler };
