import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الطعام',
    alias: ['tebakmakanan'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakmakanan',
    description: 'خمن اسم الطعام',
    usage: '.خمن_الطعام',
    example: '.خمن_الطعام',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الطعام', {
    alias: ['tebakmakanan'],
    emoji: '🍲',
    title: 'خمن الطعام',
    description: 'خمن اسم الطعام',
    dataFile: 'tebakmakanan.json',
    hasImage: true
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakmakanan')

export { pluginConfig as config, handler }