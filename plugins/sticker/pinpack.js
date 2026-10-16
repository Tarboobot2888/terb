import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import _sharp from 'sharp'
import axios from "axios";
import config from "../../config.js";
import te from "../../src/lib/terboo-error.js";
import { f } from "../../src/lib/terboo-http.js";
import { addExifToWebp } from "../../src/lib/terboo-exif.js";

function getSharp() {
  return _sharp;
}

const MAX_STICKERS = 20;
const DOWNLOAD_DELAY = 700;

async function downloadBuffer(url) {
  const res = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 15000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  return Buffer.from(res.data);
}

async function toWebpSticker(buffer) {
  return (await getSharp())(buffer)
    .resize(512, 512, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 80 })
    .toBuffer();
}

const pluginConfig = {
  name: "pinpack",
  alias: [],
  category: "sticker",
  description: "Cari gambar Pinterest lalu jadikan sticker pack",
  usage: ".pinpack <query>",
  example: ".pinpack cat",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 20,
  energi: 3,
  isEnabled: true,
};

async function handler(m, { sock }) {
  const query = m.args?.join(" ")?.trim();

  if (!query) {
    return m.reply(
      `✧ *PIN PACK*\n\n` +
        `Cari gambar Pinterest → jadikan sticker pack!\n\n` +
        `*❋ Cara Pakai*\n` +
        `> ◈ ${m.prefix}pinpack <query>\n` +
        `\n\n` +
        `*${m.prefix}pinpack anime cat*\n` +
        `*${m.prefix}pinpack aesthetic*\n\n` +
        ``,
    );
  }

  await m.react("🕕");

  try {
    const data = await f(`https://api.siputzx.my.id/api/s/pinterest?query=${query}`);
    const results = data?.data?.slice(0, MAX_STICKERS);

    if (!results || results.length === 0) {
      await m.react("✘");
      return m.reply(`> Tidak ditemukan hasil untuk: *${query}*`);
    }

    await m.reply(
      `> Mengunduh *${results.length}* gambar dari Pinterest\n> Lalu dikonversi ke sticker pack...`,
    );

    const stickerBuffers = [];

    for (const item of results) {
      const imageUrl = item.image_url;
      if (!imageUrl) continue;

      try {
        const buf = await downloadBuffer(imageUrl);
        const webp = await toWebpSticker(buf);
        stickerBuffers.push(webp);
        await new Promise((r) => setTimeout(r, DOWNLOAD_DELAY));
      } catch {
        continue;
      }
    }

    if (!stickerBuffers.length) {
      await m.react("✘");
      return m.reply(`> Gagal mendownload gambar`);
    }

    const packname = `Pinterest: ${query}`;
    const author = config.bot?.developer || config.sticker?.author || "Bot";

    try {
      await sock.sendStickerPack(m.chat, stickerBuffers, m, {
        name: packname,
        packname,
        publisher: author,
        author,
        description: `Sticker pack dari Pinterest: ${query}`,
        emojis: ["❤"],
      });
      await m.react("✓");
    } catch (packErr) {
      console.error("[PinPack] Pack send failed:", packErr.message);
      await m.reply(
        `> Pack gagal, mengirim satu per satu...`,
      );

      let sent = 0;
      for (const buf of stickerBuffers) {
        try {
          let exifBuf = buf;
          try {
            exifBuf = await addExifToWebp(buf, {
              packname,
              author,
              emojis: ["❤"],
            });
          } catch (error) { noteFailure("plugin:sticker/pinpack", error, {where: "plugins/sticker/pinpack.js:131",stage: "addExifToWebp"}); }
          await sock.sendMessage(
            m.chat,
            {
              sticker: exifBuf,
              contextInfo: { isForwarded: true, forwardingScore: 1 },
            },
            { quoted: m },
          );
          sent++;
          await new Promise((r) => setTimeout(r, 500));
        } catch {
          continue;
        }
      }

      if (sent > 0) {
        await m.react("✓");
        await m.reply(
          `> Berhasil kirim *${sent}* sticker dari *${packname}*`,
        );
      } else {
        await m.react("✘");
        await m.reply(`> Gagal mengirim sticker`);
      }
    }
  } catch (error) {
    console.error("[PinPack] Error:", error.message);
    await m.react("✘");
    m.reply(te(m.prefix, m.command, m.pushName));
  }
}

export { pluginConfig as config, handler };