import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'فوازير',
    alias: ['tebaktebakan'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebaktebakan',
    description: 'فوازير وألغاز مضحكة',
    usage: '.فوازير',
    example: '.فوازير',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('فوازير', {
    alias: ['tebaktebakan'],
    emoji: '😄',
    title: 'فوازير',
    description: 'فوازير وألغاز مضحكة',
    dataFile: 'tebaktebakan.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebaktebakan')

export { pluginConfig as config, handler }