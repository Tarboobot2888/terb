import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import te from "../../src/lib/terboo-error.js";
import { sendCard } from "../../src/lib/terboo-ui-kit.js";

const pluginConfig = {
  name: "صنع_تطبيق",
  alias: ["web2apk", "makeapk"],
  category: "tools",
  description: "تحويل موقع إلى تطبيق APK",
  usage: ".صنع_تطبيق <رابط_الموقع> | <اسم_التطبيق>",
  example: ".صنع_تطبيق https://google.com | Google",
  isOwner: false,
  cooldown: 30,
  isEnabled: true,
};

async function handler(m, { sock }) {
  const args = m.args.join(" ").split("|");
  const url = args[0]?.trim();
  const appName = args[1]?.trim();
  
  if (!url || !appName) {
    return m.reply(`📱 *مثال:* \n${m.prefix}${m.command} https://google.com | Google\n\n⚠️ *رد على صورة*`);
  }

  const q = m.quoted;
  const mime = (q?.msg || q)?.mimetype || q?.type || '';

  if (!mime.includes('image')) {
    return m.reply('❌ قم بالرد على صورة للأيقونة');
  }

  m.react('📱');

  try {
    const iconBuffer = await q.download();
    
    // حفظ الصورة مؤقتاً
    const tempDir = path.join(os.tmpdir(), 'web2apk');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const iconPath = path.join(tempDir, `icon_${Date.now()}.png`);
    fs.writeFileSync(iconPath, iconBuffer);

    try {
      const FormData = (await import('form-data')).default;
      const form = new FormData();

      form.append('websiteUrl', url);
      form.append('appName', appName);
      form.append('icon', fs.createReadStream(iconPath));
      form.append('packageName', `com.${appName.toLowerCase().replace(/[^a-z0-9]/g, '')}.app`);
      form.append('versionName', '1.0.0');
      form.append('versionCode', '1');

      const response = await axios.post(
        'https://webappcreator.amethystlab.org/api/build-apk',
        form,
        {
          headers: {
            ...form.getHeaders(),
            'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36',
            'Accept': 'application/json',
            'Origin': 'https://webappcreator.amethystlab.org',
            'Referer': 'https://webappcreator.amethystlab.org/'
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 120000
        }
      );

      if (response.data?.success && response.data?.downloadUrl) {
        const downloadUrl = `https://webappcreator.amethystlab.org${response.data.downloadUrl}`;
        
        await sendCard(sock, m, {
          cardId: 'web2apk-result',
          text: `📱 *تم!*\n📌 ${appName}\n🔗 ${downloadUrl}`,
          footer: '📱 Web2Apk',
          links: [{ text: '📥 تحميل', url: downloadUrl }],
        });
        
        m.react('✅');
      } else {
        throw new Error(response.data?.message || 'فشل إنشاء التطبيق');
      }

    } finally {
      if (fs.existsSync(iconPath)) fs.unlinkSync(iconPath);
    }

  } catch (error) {
    console.log(error);
    m.react('❌');
    m.reply(`❌ *خطأ:* ${error.response?.data?.message || error.message}`);
  }
}

export { pluginConfig as config, handler };