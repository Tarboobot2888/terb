// 2048 — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/g2048.js)
// نفس سلوك «.اركيد g2048»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "الفين",
  alias: ["2048"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "g2048",
  description: "العب 2048 وادمج البلاطات حتى تصل إلى 2048",
  usage: ".الفين [@صديق|ai]",
  example: ".الفين",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("g2048");

export { pluginConfig as config, handler };
