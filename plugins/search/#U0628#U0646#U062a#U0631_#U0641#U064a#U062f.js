import { sendCarousel } from '../../src/lib/terboo-ui-kit.js';

const pluginConfig = {
    name: 'بنتر_فيد',
    alias: ['pinvideo', 'pin4video', 'فيديو_بينترست', 'بينترست', 'pinter'],
    category: 'search',
    description: 'بحث عن فيديوهات بينترست مع كاروسل',
    usage: '.بنتر_فيد <بحث>',
    example: '.بنتر_فيد killua',
    isOwner: false,
    isPremium: false,
    isGroup: true,
    isPrivate: true,
    cooldown: 10,
    energi: 2,
    isEnabled: true,
};

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

async function handler(m, { sock }) {
    const query = m.args?.join(' ')?.trim();
    
    if (!query) {
        return m.reply(`🎬 *بنتر فيديو*\n\n.بنتر_فيد killua\n.بنتر_فيد anime`);
    }

    await m.react('🎬');

    try {
        const res = await fetch(`https://virix-api.vercel.app/api/pin4video/search?q=${encodeURIComponent(query)}`, { headers: HEADERS });
        const data = await res.json();

        if (!data?.status || !data?.results?.length) {
            await m.react('❌');
            return m.reply(`❌ لا توجد فيديوهات`);
        }

        const videos = data.results.slice(0, 8);
        await sendCarousel(sock, m, {
            cardId: 'pin-video-search',
            text: `🎬 *${query}*\n📊 ${data.total} فيديو\n👆 اسحب`,
            footer: 'Pinterest',
            cards: videos.filter((url) => /^https:\/\//.test(String(url))).map((url) => ({
                media: { type: 'video', url },
                title: query,
                body: '🎬 Pinterest',
                footer: 'بنتر_فيد',
                links: [{ text: '🔗 فتح', url }],
            })),
        });
        await m.react('✅');

    } catch (e) {
        await m.react('❌');
    }
}

export { pluginConfig as config, handler };