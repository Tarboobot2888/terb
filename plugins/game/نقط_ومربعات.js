// نقط ومربعات — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/dotsboxes.js)
// نفس سلوك «.اركيد dotsboxes»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "نقط_ومربعات",
  alias: ["dotsboxes"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "dotsboxes",
  description: "العب نقط ومربعات مع صديق أو ضد الكمبيوتر",
  usage: ".نقط_ومربعات [@صديق|ai]",
  example: ".نقط_ومربعات",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("dotsboxes");

export { pluginConfig as config, handler };
