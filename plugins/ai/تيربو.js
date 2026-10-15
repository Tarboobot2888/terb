// ═══════════════════════════════════════════════
// 📁 plugins/ai/تيربو.js
// 🤖 Bot Terboo AI - شاب مصري خبير برمجة وأمن سيبراني
// ═══════════════════════════════════════════════

import { UnlimitedAI } from "../../src/scraper/unlimitedai.js";
import te from "../../src/lib/terboo-error.js";

const pluginConfig = {
  name: "تيربو",
  // الأسماء القديمة تبقى مرادفات حتى لا يتعطل من اعتاد عليها (§1)
  alias: ["تاربو", "tarboo", "تاربوai", "تيربوai", "terboo", "tarbooai", "terbooai", "مارو", "ماروai", "maro", "maroai"],
  category: "ai",
  description: "محادثة Bot Terboo AI - شاب مصري خبير برمجة وأمن سيبراني",
  usage: ".تيربو <سؤال>",
  example: ".تيربو ازيك يا عم\n.تيربو اشرحلي يعني ايه XSS",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 10,
  energi: 2,
  isEnabled: true,
};

async function handler(m, { sock, text }) {
  if (!text) {
    await sock.sendMessage(m.chat, {
      react: { text: "🤖", key: m.key },
    });

    return m.reply(
      `🤖 *TERBOO* 🇪🇬\n\n` +
        `السلام عليكم ورحمة الله وبركاته 👋\n` +
        `أنا *TERBOO*، شاب مصري عندي 19 سنة، خبير في البرمجة والأمن السيبراني.\n\n` +
        `⚡ *كيف أقدر أساعدك النهارده يا صاحبي؟*`
    );
  }

  m.react("⏳");

  try {
    const result = await UnlimitedAI(text, "تيربو");

    if (!result.status) {
      m.react("❌");
      return m.reply(`❌ *خطأ*\n\n> ${result.error || "فشل الاتصال"}`);
    }

    m.react("✅");
    const reply = result.answer;
    await m.reply(reply.length > 4096 ? reply.slice(0, 4096) + "..." : reply);
  } catch (e) {
    console.error(e);
    m.react("❌");
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };