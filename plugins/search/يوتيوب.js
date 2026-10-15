import yts from "yt-search";
import { sendCard } from "../../src/lib/terboo-ui-kit.js";
import axios from "axios";
import sharp from "sharp";
import te from "../../src/lib/terboo-error.js";

// ═══════════════════════════════════════════════
// ⚙️ إعدادات الأمر
// ═══════════════════════════════════════════════
const pluginConfig = {
  name: "يوتيوب",
  alias: ["yts"],
  category: "search",
  description: "بحث عن فيديوهات يوتيوب",
  usage: ".يوتيوب <بحث>",
  example: ".يوتيوب اغاني جديدة",
  isOwner: false, isPremium: false, isGroup: false, isPrivate: false,
  cooldown: 5, energi: 2, isEnabled: true,
};

// ═══════════════════════════════════════════════
// 🎬 دالة المعالجة
// ═══════════════════════════════════════════════
async function handler(m, { sock }) {
  const text = m.text?.trim();

  if (!text) {
    return m.reply(`🎬 *يوتيوب*\n\n📌 مثال: ${m.prefix}يوتيوب اغاني جديدة`);
  }

  await m.react("⏳");

  try {
    const searchResults = await yts(text);
    const videos = searchResults.videos;

    if (!videos || videos.length === 0) {
      await m.react("❌");
      return m.reply("⚠️ لم يتم العثور على نتائج. جرب كلمة بحث أخرى.");
    }

    const firstVideo = videos[0];

    const imageResponse = await axios.get(firstVideo.thumbnail, { responseType: "arraybuffer" });
    const thumbnailBuffer = await sharp(imageResponse.data).resize(300, 170).jpeg().toBuffer();

    const contentText = `🎬 *نتائج يوتيوب*\n\n` +
      `🔎 *البحث:* ${text}\n` +
      `🎬 *العنوان:* ${firstVideo.title}\n` +
      `📺 *القناة:* ${firstVideo.author.name}\n` +
      `⏱️ *المدة:* ${firstVideo.timestamp}\n` +
      `👁️ *المشاهدات:* ${firstVideo.views}\n` +
      `📅 *الرفع:* ${firstVideo.ago}\n` +
      `🔗 ${firstVideo.url}\n\n` +
      `اختر من الأزرار أدناه للتحميل:`;

    // نية فقط (بطاقة + زرّا تحميل) — البناء والتسليم والبديل النصي في طبقة الواجهة الموحّدة
    await sendCard(sock, m, {
      cardId: "youtube-search",
      text: contentText,
      footer: "🎬 يوتيوب",
      thumbnail: { buffer: thumbnailBuffer, name: firstVideo.title, address: `📺 ${firstVideo.author.name} | ⏱️ ${firstVideo.timestamp}` },
      buttons: [
        { id: `.ytmp4 ${firstVideo.url}`, text: "🎥 تحميل فيديو" },
        { id: `.ytmp3 ${firstVideo.url}`, text: "🎵 تحميل صوت" },
      ],
    });
    await m.react("✅");

  } catch (error) {
    console.error(error);
    await m.react("❌");
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };