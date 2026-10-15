import { createErrorMessage } from '../../src/lib/terboo-formatter.js';
import config from '../../config.js';
import fs from 'fs';

const pluginConfig = {
    name: 'اعلان',
    alias: ['announce', 'إعلان'],
    category: 'owner',
    description: '📢 إعلان تفاعلي',
    usage: '.اعلان <النص>',
    example: '.اعلان مرحبا بالجميع',
    isOwner: true,
    isPremium: false,
    isGroup: true,
    isPrivate: true,
    cooldown: 5,
    energi: 0,
    isEnabled: true
};

// بطاقة إعلان باسم البوت نفسه — بلا انتحال Meta AI (v4 §44): لا forwardedAiBotMessageInfo
// ولا رسائل توزيع مفاتيح مزيّفة؛ رسالة نصية عادية ببطاقة معاينة (externalAdReply).
async function thumbnailOf() {
    const imgPath = config.assets.terboo2 || config.assets.terboo;
    if (!imgPath || !fs.existsSync(imgPath)) return null;
    try {
        const sharp = (await import('sharp')).default;
        return await sharp(fs.readFileSync(imgPath)).resize(300, 300).jpeg().toBuffer();
    } catch (error) {
        console.warn('[announce] صورة البطاقة:', error.message);
        return null;
    }
}

async function handler(m, { sock }) {
    const text = m.text?.trim();
    if (!text) return m.reply('📢 .اعلان مرحبا بالجميع');

    try {
        const thumbnail = await thumbnailOf();
        await sock.sendMessage(m.chat, {
            text,
            contextInfo: {
                externalAdReply: {
                    title: config.bot?.name || 'Bot Terboo',
                    body: '',
                    mediaType: 1,
                    renderLargerThumbnail: false,
                    showAdAttribution: false,
                    sourceUrl: config.saluran?.link || 'https://whatsapp.com/channel/0029Vb5Vczr7j6g3foFrXM2x',
                    ...(thumbnail ? { thumbnail } : { thumbnailUrl: 'https://i.imgur.com/TuItj4L.png' }),
                },
            },
        });

        await m.react('📢');
    } catch (e) {
        return m.reply(createErrorMessage(e.message));
    }
}

export { pluginConfig as config, handler };