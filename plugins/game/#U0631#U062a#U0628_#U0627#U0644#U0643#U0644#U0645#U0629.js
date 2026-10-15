import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'رتب_الكلمة',
    alias: ['susunkata'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_susunkata',
    description: 'رتب الكلمة من الحروف',
    usage: '.رتب_الكلمة',
    example: '.رتب_الكلمة',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('رتب_الكلمة', {
    alias: ['susunkata'],
    emoji: '🔠',
    title: 'رتب الكلمة',
    description: 'رتب الكلمة من الحروف',
    dataFile: 'susunkata.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_susunkata')

export { pluginConfig as config, handler }