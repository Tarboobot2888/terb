import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الدولة',
    alias: ['tebaknegara'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebaknegara',
    description: 'خمن اسم الدولة',
    usage: '.خمن_الدولة',
    example: '.خمن_الدولة',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الدولة', {
    alias: ['tebaknegara'],
    emoji: '🌍',
    title: 'خمن الدولة',
    description: 'خمن اسم الدولة',
    dataFile: 'tebaknegara.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebaknegara')

export { pluginConfig as config, handler }