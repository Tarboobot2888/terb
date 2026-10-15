import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'لغز',
    alias: ['riddle'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_riddle',
    description: 'ألغاز وتخمينات',
    usage: '.لغز',
    example: '.لغز',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('لغز', {
    alias: ['riddle'],
    emoji: '❓',
    title: 'لغز',
    description: 'ألغاز وتخمينات',
    dataFile: 'riddle.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_riddle')

export { pluginConfig as config, handler }