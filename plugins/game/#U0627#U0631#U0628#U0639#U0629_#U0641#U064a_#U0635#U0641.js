// أربعة في صف — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/connect4.js)
// نفس سلوك «.اركيد connect4»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "اربعة_في_صف",
  alias: ["connect4","c4"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "connect4",
  description: "العب أربعة في صف مع صديق أو ضد الكمبيوتر بلوحة مرئية",
  usage: ".اربعة_في_صف [@صديق|ai]",
  example: ".اربعة_في_صف",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("connect4");

export { pluginConfig as config, handler };
