import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_المهنة',
    alias: ['tebakprofesi'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakprofesi',
    description: 'خمن اسم المهنة',
    usage: '.خمن_المهنة',
    example: '.خمن_المهنة',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_المهنة', {
    alias: ['tebakprofesi'],
    emoji: '👨‍💼',
    title: 'خمن المهنة',
    description: 'خمن اسم المهنة',
    dataFile: 'tebakprofesi.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakprofesi')

export { pluginConfig as config, handler }