import { getRandomItem } from '../../src/lib/terboo-game-data.js'

const pluginConfig = {
    name: 'جرأة',
    alias: ['dare'],
    category: 'fun',
    description: 'تحدي عشوائي - لعبة جرأة',
    usage: '.جرأة',
    example: '.جرأة',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 3,
    energi: 0,
    isEnabled: true
};

async function handler(m) {
    const challenge = getRandomItem('dare.json');
    
    if (!challenge) {
        await m.reply('❌ *البيانات غير متوفرة*\n\n> جرب مرة تانية!');
        return;
    }
    
    await m.reply(`❋ 🎯 *تحدي*\n\n> ◈ ${challenge}\n\n`);
}

export { pluginConfig as config, handler }