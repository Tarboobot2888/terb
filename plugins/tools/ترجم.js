// ═══════════════════════════════════════════════
// 📁 plugins/tools/ترجم.js
// 🌐 ترجمة النصوص
// ═══════════════════════════════════════════════

const pluginConfig = {
    name: 'ترجم',
    alias: ['translate', 'tr', 'ترجمة'],
    category: 'tools',
    description: 'ترجمة النصوص بين جميع اللغات',
    usage: '.ترجم <اللغة> <النص> أو رد على رسالة',
    example: '.ترجم ar hello world',
    isOwner: false,
    isPremium: false,
    isGroup: true,
    isPrivate: true,
    cooldown: 5,
    energi: 1,
    isEnabled: true,
};

const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };

const LANGS = {
    'عربي': 'ar', 'انجليزي': 'en', 'فرنسي': 'fr', 'اسباني': 'es',
    'الماني': 'de', 'ايطالي': 'it', 'برتغالي': 'pt', 'روسي': 'ru',
    'تركي': 'tr', 'اندونيسي': 'id', 'ياباني': 'ja', 'كوري': 'ko',
    'صيني': 'zh', 'هندي': 'hi', 'اردو': 'ur',
    // أسماء اللغات بالإنجليزية والإسبانية
    'arabic': 'ar', 'english': 'en', 'french': 'fr', 'spanish': 'es', 'german': 'de',
    'italian': 'it', 'portuguese': 'pt', 'russian': 'ru', 'turkish': 'tr', 'indonesian': 'id',
    'japanese': 'ja', 'korean': 'ko', 'chinese': 'zh', 'hindi': 'hi', 'urdu': 'ur',
    'arabe': 'ar', 'árabe': 'ar', 'ingles': 'en', 'inglés': 'en', 'frances': 'fr', 'francés': 'fr',
    'espanol': 'es', 'español': 'es', 'aleman': 'de', 'alemán': 'de', 'italiano': 'it',
    'portugues': 'pt', 'portugués': 'pt', 'ruso': 'ru', 'turco': 'tr', 'indonesio': 'id',
    'japones': 'ja', 'japonés': 'ja', 'coreano': 'ko', 'chino': 'zh'
};

async function handler(m, { sock }) {
    if (m.quoted) {
        const text = m.quoted.body || m.quoted.caption || '';
        if (!text) return m.reply('❌ لا يوجد نص');
        
        m.react('🌐');
        const res = await fetch(`https://virix-api.vercel.app/api/translate/translate?q=${encodeURIComponent(text)}&to=ar`, { headers: HEADERS });
        const data = await res.json();
        if (data?.translated) {
            await m.reply(`🌐 ${data.fromName} → العربية\n\n${data.translated}`);
            m.react('✅');
        } else {
            m.react('❌');
        }
        return;
    }

    const args = m.args || [];
    if (!args.length) {
        return m.reply(`🌐 *ترجم*\n\n.ترجم ar hello\n.ترجم انجليزي مرحبا\n.ترجم (رد على رسالة)`);
    }

    let lang = args[0].toLowerCase();
    lang = LANGS[lang] || lang;
    const text = args.slice(1).join(' ');
    if (!text) return m.reply('❌ أدخل النص');

    m.react('🌐');
    const res = await fetch(`https://virix-api.vercel.app/api/translate/translate?q=${encodeURIComponent(text)}&to=${lang}`, { headers: HEADERS });
    const data = await res.json();

    if (!data?.status) { m.react('❌'); return m.reply('❌ فشل'); }

    await m.reply(`🌐 ${data.fromName} → ${data.toName}\n\n${data.translated}`);
    m.react('✅');
}

export { pluginConfig as config, handler };