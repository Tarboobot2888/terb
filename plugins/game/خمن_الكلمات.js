import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الكلمات',
    alias: ['tebaklirik'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebaklirik',
    description: 'خمن كلمات الأغنية',
    usage: '.خمن_الكلمات',
    example: '.خمن_الكلمات',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الكلمات', {
    alias: ['tebaklirik'],
    emoji: '🎤',
    title: 'خمن الكلمات',
    description: 'خمن كلمات الأغنية',
    dataFile: 'tebaklirik.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebaklirik')

export { pluginConfig as config, handler }