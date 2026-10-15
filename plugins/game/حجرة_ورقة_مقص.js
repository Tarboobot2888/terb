// ✊✋✌️ حجرة ورقة مقص — على محرك TERBOO ARCADE: تحدٍّ بالمنشن/الرد، أزرار سرية في الخاص، أفضل من 3
// «.حجرة_ورقة_مقص @صديق» تحدٍّ (قبول/رفض بالأزرار) · «.حجرة_ورقة_مقص ai» ضد الكمبيوتر.
import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import { quickCommand } from "../../src/lib/terboo-arcade/commands.js";

await loadArcade();

const pluginConfig = {
  name: "حجرة_ورقة_مقص",
  alias: ["suit"],
  category: "game",
  // لعبة TERBOO ARCADE المرتبطة (سجل الألعاب الموحّد)
  game: "rps",
  description: "تحدَّ صديقاً أو الكمبيوتر في حجرة ورقة مقص باختيار سري بالأزرار",
  usage: ".حجرة_ورقة_مقص @صديق | ai",
  example: ".حجرة_ورقة_مقص @201xxx",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

const handler = quickCommand("rps");

export { pluginConfig as config, handler };
