// تحطيم الطوب — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/breakout.js)
// نفس سلوك «.اركيد breakout»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "تحطيم_الطوب",
  alias: ["breakout"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "breakout",
  description: "العب تحطيم الطوب وحرّك المضرب بالأزرار",
  usage: ".تحطيم_الطوب [@صديق|ai]",
  example: ".تحطيم_الطوب",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("breakout");

export { pluginConfig as config, handler };
