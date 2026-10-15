import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الشخصية',
    alias: ['tebakepep'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakepep',
    description: 'خمن شخصية فري فاير',
    usage: '.خمن_الشخصية',
    example: '.خمن_الشخصية',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الشخصية', {
    alias: ['tebakepep'],
    emoji: '🔫',
    title: 'خمن الشخصية',
    description: 'خمن شخصية فري فاير',
    dataFile: 'tebakepep.json',
    hasImage: true,
    questionField: 'deskripsi',
    answerField: 'jawaban'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakepep')

export { pluginConfig as config, handler }