import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_العضوة',
    alias: ['tebakjkt48'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakjkt48',
    description: 'خمن عضوة JKT48',
    usage: '.خمن_العضوة',
    example: '.خمن_العضوة',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_العضوة', {
    alias: ['tebakjkt48'],
    emoji: '🎀',
    title: 'خمن العضوة',
    description: 'خمن عضوة JKT48',
    dataFile: 'tebakjkt48.json',
    hasImage: true
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakjkt48')

export { pluginConfig as config, handler }