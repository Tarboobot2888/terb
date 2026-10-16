import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'من_أنا',
    alias: ['siapakahaku'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_siapakahaku',
    description: 'خمن من الوصف',
    usage: '.من_أنا',
    example: '.من_أنا',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('من_أنا', {
    alias: ['siapakahaku'],
    emoji: '🎭',
    title: 'من أنا',
    description: 'خمن من الوصف',
    dataFile: 'siapakahaku.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_siapakahaku')

export { pluginConfig as config, handler }