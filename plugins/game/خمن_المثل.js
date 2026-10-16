import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_المثل',
    alias: ['tebakkalimat'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakkalimat',
    description: 'خمن المثل أو المقولة',
    usage: '.خمن_المثل',
    example: '.خمن_المثل',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_المثل', {
    alias: ['tebakkalimat'],
    emoji: '📖',
    title: 'خمن المثل',
    description: 'خمن المثل أو المقولة',
    dataFile: 'tebakkalimat.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakkalimat')

export { pluginConfig as config, handler }