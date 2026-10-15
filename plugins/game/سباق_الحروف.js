// سباق الحروف — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/letter_rush.js)
// نفس سلوك «.اركيد letter_rush»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "سباق_الحروف",
  alias: ["letterrush"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "letter_rush",
  description: "سباق الحروف: أسرع كلمة صحيحة تفوز بالجولة",
  usage: ".سباق_الحروف [@صديق|ai]",
  example: ".سباق_الحروف",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("letter_rush");

export { pluginConfig as config, handler };
