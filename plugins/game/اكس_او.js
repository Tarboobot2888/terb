// ❌⭕ إكس أو — على محرك TERBOO ARCADE (التنفيذ المرجعي: لوحة مرئية + أزرار + خصم كمبيوتر)
// نفس الأمر والمرادف كما كانا: «.اكس_او» في المجموعة ينضم لغرفة مفتوحة أو ينشئها،
// «.اكس_او @صديق» تحدٍّ، «.اكس_او ai صعب» ضد الكمبيوتر، وفي الخاص ضد الكمبيوتر مباشرة.
// الحركة: زر الخانة أو كتابة رقمها 1–9 (يلتقطها answerHandler الموحّد في اركيد.js).
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "اكس_او",
  alias: ["ttt"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "xo",
  description: "العب إكس أو مع صديق أو ضد الكمبيوتر بلوحة مرئية وأزرار",
  usage: ".اكس_او [@صديق|ai]",
  example: ".اكس_او",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("xo");

export { pluginConfig as config, handler };
