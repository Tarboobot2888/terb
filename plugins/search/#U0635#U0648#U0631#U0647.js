import { sendCard } from "../../src/lib/terboo-ui-kit.js";
import te from "../../src/lib/terboo-error.js";
import { f } from "../../src/lib/terboo-http.js";

// ═══════════════════════════════════════════════
// ⚙️ إعدادات الأمر
// ═══════════════════════════════════════════════
const pluginConfig = {
  name: "صوره",
  alias: ["pap"],
  category: "search",
  description: "صور عشوائية من Pinterest",
  usage: ".صوره <cewe/cowo/femboy>",
  example: ".صوره cewe",
  isOwner: false, isPremium: false, isGroup: false, isPrivate: false,
  cooldown: 5, energi: 1, isEnabled: true,
};

// ═══════════════════════════════════════════════
// 📸 دالة المعالجة
// ═══════════════════════════════════════════════
async function handler(m, { sock }) {
  const arg = m.args[0]?.toLowerCase();
  const validTypes = ["cewe", "cowo", "femboy"];

  if (!arg || !validTypes.includes(arg)) {
    return m.reply(`❌ اختر نوع: cewe, cowo, femboy\n\n📌 مثال: ${m.prefix}صوره cewe`);
  }

  await m.react("⏳");

  try {
    const data = await f(`https://api.siputzx.my.id/api/s/pinterest?query=${encodeURIComponent(arg)}`);
    const results = data?.data;
    if (!results || results.length === 0) {
      await m.react("❌");
      return m.reply(`❌ لا توجد نتائج حالياً`);
    }

    const randomItem = results[Math.floor(Math.random() * results.length)];
    const imageUrl = randomItem.image_url;
    if (!imageUrl) {
      await m.react("❌");
      return m.reply("⚠️ الصورة غير متاحة");
    }

    const raw = await f(imageUrl, "arrayBuffer");
    if (!raw) {
      await m.react("❌");
      return m.reply("⚠️ الصورة غير متاحة");
    }
    await sendCard(sock, m, {
      cardId: "image-search",
      text: `📸 *${arg.toUpperCase()}*`,
      footer: "اختر من الأسفل 👇",
      media: { type: "image", buffer: Buffer.from(raw) },
      buttons: [
        { id: `${m.prefix}صوره ${arg}`, text: "🔁 التالي" },
        { id: `${m.prefix}صوره cewe`, text: "👧 بنت" },
        { id: `${m.prefix}صوره cowo`, text: "👦 ولد" },
      ],
    });
    await m.react("✅");

  } catch (error) {
    console.error("[PAP]", error.message);
    await m.react("❌");
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };