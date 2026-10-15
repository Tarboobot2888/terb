// مبارزة الحساب — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/math_duel.js)
// نفس سلوك «.اركيد math_duel»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "مبارزة_الحساب",
  alias: ["mathduel"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "math_duel",
  description: "مبارزة حساب سريعة بأربعة خيارات",
  usage: ".مبارزة_الحساب [@صديق|ai]",
  example: ".مبارزة_الحساب",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("math_duel");

export { pluginConfig as config, handler };
