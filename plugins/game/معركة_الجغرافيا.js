// معركة الجغرافيا — لعبة TERBOO ARCADE (المنطق في src/lib/terboo-arcade/games/geo_battle.js)
// نفس سلوك «.اركيد geo_battle»: غرفة مفتوحة في المجموعة · تحدٍّ بالمنشن · ضد الكمبيوتر بـ ai · لعب فردي حيث يناسب.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "معركة_الجغرافيا",
  alias: ["geobattle"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "geo_battle",
  description: "معركة الجغرافيا: عواصم وأعلام وقارات",
  usage: ".معركة_الجغرافيا [@صديق|ai]",
  example: ".معركة_الجغرافيا",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("geo_battle");

export { pluginConfig as config, handler };
