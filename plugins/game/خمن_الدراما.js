import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الدراما',
    alias: ['tebakdrakor'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakdrakor',
    description: 'خمن عنوان الدراما الكورية',
    usage: '.خمن_الدراما',
    example: '.خمن_الدراما',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الدراما', {
    alias: ['tebakdrakor'],
    emoji: '🇰🇷',
    title: 'خمن الدراما',
    description: 'خمن عنوان الدراما الكورية',
    dataFile: 'tebakdrakor.json',
    hasImage: true,
    questionField: 'deskripsi',
    answerField: 'jawaban'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakdrakor')

export { pluginConfig as config, handler }