import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'أسئلة_ذكاء',
    alias: ['asahotak'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_asahotak',
    description: 'لعبة أسئلة ذكاء - خمن الإجابة',
    usage: '.أسئلة_ذكاء',
    example: '.أسئلة_ذكاء',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('أسئلة_ذكاء', {
    alias: ['asahotak'],
    emoji: '🧠',
    title: 'أسئلة ذكاء',
    description: 'لعبة أسئلة ذكاء - خمن الإجابة'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_asahotak')

export { pluginConfig as config, handler }