// بولز آند كاوز — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/bulls_cows.js)
// نفس سلوك «.اركيد bulls_cows»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "بولز",
  alias: ["bullscows"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "bulls_cows",
  description: "اكشف الرقم السري في بولز آند كاوز",
  usage: ".بولز [@صديق|ai]",
  example: ".بولز",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("bulls_cows");

export { pluginConfig as config, handler };
