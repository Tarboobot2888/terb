import { sendCarousel } from '../../src/lib/terboo-ui-kit.js';

const pluginConfig = {
    name: 'اطار',
    alias: ['twibbon', 'frame', 'twibbonize', 'إطار'],
    category: 'search',
    description: 'بحث عن إطارات Twibbonize مع كاروسل',
    usage: '.اطار <بحث>',
    example: '.اطار رمضان',
    isOwner: false,
    isPremium: false,
    isGroup: true,
    isPrivate: true,
    cooldown: 10,
    energi: 1,
    isEnabled: true,
};

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

async function handler(m, { sock }) {
    const query = m.args?.join(' ')?.trim();
    
    if (!query) {
        return m.reply(`🖼️ *إطارات*\n\n.اطار رمضان\n.اطار عيد\n.اطار حب`);
    }

    await m.react('🖼️');

    try {
        const res = await fetch(`https://virix-api.vercel.app/api/twibbonize/search?q=${encodeURIComponent(query)}`, { headers: HEADERS });
        const data = await res.json();

        if (!data?.status || !data?.campaigns?.length) {
            await m.react('❌');
            return m.reply(`❌ لا توجد إطارات لـ: *${query}*`);
        }

        const camps = data.campaigns.slice(0, 8);
        // نية: بطاقات نتائج بصورها وروابطها — الرفع والبناء والبدائل في طبقة الواجهة
        const sent = await sendCarousel(sock, m, {
            cardId: 'twibbon-search',
            text: `🖼️ *إطارات: ${query}*\n📊 ${data.total} إطار\n👆 اسحب لليسار`,
            footer: 'Bot Terboo',
            cards: camps.filter((c) => /^https:\/\//.test(String(c.thumbnail || ''))).map((c) => ({
                media: { type: 'image', url: c.thumbnail },
                title: c.name,
                body: `*${c.name}*\n👁️ ${c.hit} مشاهد`,
                footer: 'اضغط للمشاهدة',
                links: [{ text: '🔗 فتح', url: `https://twibbonize.com/${c.url}` }],
            })),
        });
        if (sent.stage === 'none') throw new Error('فشل إنشاء البطاقات');
        await m.react('✅');

    } catch (e) {
        await m.react('❌');
        console.error('[اطار]', e.message);
    }
}

export { pluginConfig as config, handler };