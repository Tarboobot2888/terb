import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الفيلم',
    alias: ['tebakfilm'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakfilm',
    description: 'خمن عنوان الفيلم',
    usage: '.خمن_الفيلم',
    example: '.خمن_الفيلم',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الفيلم', {
    alias: ['tebakfilm'],
    emoji: '🎬',
    title: 'خمن الفيلم',
    description: 'خمن عنوان الفيلم',
    dataFile: 'tebakfilm.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakfilm')

export { pluginConfig as config, handler }