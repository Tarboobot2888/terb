import fs from "fs";
import config from "../../config.js";
import { AIRich } from "../../src/lib/terboo-builder.js";

const pluginConfig = {
  name: "تست2",
  alias: ["meta2", "rich2"],
  category: "main",
  description: "رسالة غنية للاختبار",
  usage: ".تست2",
  isOwner: false,
  isPremium: false,
  isGroup: true,
  isPrivate: true,
  cooldown: 5,
  energi: 0,
  isEnabled: true,
};

// عرض للرد الغني عبر Rich Response Engine — بلا انتحال Meta AI (v4 §44): لا botForwardedMessage
// ولا اقتباس مزيّف من رقم Meta AI. الصورة من أصول البوت المحلية، والباقي نص/جدول حقيقي.
async function handler(m, { sock }) {
  const rich = new AIRich(sock).setTitle(config.bot?.name || "Bot Terboo");
  const imagePath = config.assets?.terboo;
  if (imagePath && fs.existsSync(imagePath)) rich.addImage(fs.readFileSync(imagePath));
  rich.addTable([
    ["⚡ الأوامر", "🚀 السرعة"],
    [".menu", ".ping"],
  ]);
  rich.addSuggest(["شغل أغنية", "صور قطط", "حالة البوت"]);
  rich.addSource([
    ["", config.saluran?.link || "https://whatsapp.com/channel/0029Vb5Vczr7j6g3foFrXM2x", "الموقع الرسمي"],
    ["", "https://github.com/Tarboobot2888", "المستودع"],
  ]);
  rich.setFooter(config.bot?.name || "Bot Terboo");
  await rich.send(m.chat, { quoted: m });
}

export { pluginConfig as config, handler };