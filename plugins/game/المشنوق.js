// الرجل المشنوق — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/hangman.js)
// نفس سلوك «.اركيد hangman»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "المشنوق",
  alias: ["hangman"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "hangman",
  description: "العب الرجل المشنوق بلغتك",
  usage: ".المشنوق [@صديق|ai]",
  example: ".المشنوق",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("hangman");

export { pluginConfig as config, handler };
