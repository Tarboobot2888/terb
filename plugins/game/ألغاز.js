import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'ألغاز',
    alias: ['tekateki'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tekateki',
    description: 'لعبة ألغاز تقليدية',
    usage: '.ألغاز',
    example: '.ألغاز',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('ألغاز', {
    alias: ['tekateki'],
    emoji: '🧩',
    title: 'ألغاز',
    description: 'لعبة ألغاز تقليدية',
    dataFile: 'tekateki.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tekateki')

export { pluginConfig as config, handler }