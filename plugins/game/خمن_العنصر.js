import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_العنصر',
    alias: ['tebakkimia'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakkimia',
    description: 'خمن العنصر الكيميائي',
    usage: '.خمن_العنصر',
    example: '.خمن_العنصر',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_العنصر', {
    alias: ['tebakkimia'],
    emoji: '🧪',
    title: 'خمن العنصر',
    description: 'خمن العنصر الكيميائي',
    dataFile: 'tebakkimia.json',
    questionField: 'unsur',
    answerField: 'lambang'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakkimia')

export { pluginConfig as config, handler }