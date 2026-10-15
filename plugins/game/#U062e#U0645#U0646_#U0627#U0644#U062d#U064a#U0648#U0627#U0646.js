import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الحيوان',
    alias: ['tebakhewan'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakhewan',
    description: 'خمن اسم الحيوان',
    usage: '.خمن_الحيوان',
    example: '.خمن_الحيوان',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الحيوان', {
    alias: ['tebakhewan'],
    emoji: '🐾',
    title: 'خمن الحيوان',
    description: 'خمن اسم الحيوان',
    dataFile: 'tebakhewan.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakhewan')

export { pluginConfig as config, handler }