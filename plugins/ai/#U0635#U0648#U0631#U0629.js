import { runScraper } from '../../src/lib/terboo-scraper-registry.js';
import te from "../../src/lib/terboo-error.js";

const pluginConfig = {
  name: "صورة",
  alias: ["صورة", "image", "img", "generate", "رسم"],
  category: "ai",
  description: "توليد صور بالذكاء الاصطناعي",
  usage: ".صورة <وصف_الصورة>",
  example: ".صورة فتاة انمي",
  isOwner: false,
  cooldown: 30,
  isEnabled: true,
};

async function handler(m, { sock }) {
  const text = m.args.join(" ");
  
  if (!text) {
    return m.reply(`🎨 *توليد الصور*\n\n📌 ${m.prefix}${m.command} وصف الصورة`);
  }

  m.react('🎨');

  // المزوّد السابق (omegatech-api) يرفض الاتصال (docs/terboo-api-health-matrix.json) ⇒ مولّد الصور في سجل الأدوات
  // (txt2img2 + بديله الصحي + قاطع الدائرة) بدل رابط جديد داخل البلوقن
  const result = await runScraper({ id: "txt2img2", input: { prompt: text }, m, sock, lang: m.lang || "ar", prefer: "adapter" });
  if (result?.ok && result.deliveries?.length) {
    m.react('✅');
    return;
  }
  m.react('❌');
  return m.reply(te(m.prefix, m.command, m.pushName));
}

export { pluginConfig as config, handler };