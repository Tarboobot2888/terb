import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الكلمة',
    alias: ['tebakkata'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakkata',
    description: 'خمن الكلمة من التلميح',
    usage: '.خمن_الكلمة',
    example: '.خمن_الكلمة',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الكلمة', {
    alias: ['tebakkata'],
    emoji: '📝',
    title: 'خمن الكلمة',
    description: 'خمن الكلمة من التلميح',
    dataFile: 'tebakkata.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakkata')

export { pluginConfig as config, handler }