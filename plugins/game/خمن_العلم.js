import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_العلم',
    alias: ['tebakbendera'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakbendera',
    description: 'خمن الدولة من العلم',
    usage: '.خمن_العلم',
    example: '.خمن_العلم',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_العلم', {
    alias: ['tebakbendera'],
    emoji: '🏳️',
    title: 'خمن العلم',
    description: 'خمن الدولة من العلم',
    dataFile: 'tebakbendera2.json',
    answerField: 'name',
    hasImage: true
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakbendera')

export { pluginConfig as config, handler }