import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الصورة',
    alias: ['tebakgambar'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebakgambar',
    description: 'خمن الكلمة من الصورة',
    usage: '.خمن_الصورة',
    example: '.خمن_الصورة',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الصورة', {
    alias: ['tebakgambar'],
    emoji: '🖼️',
    title: 'خمن الصورة',
    description: 'خمن الكلمة من الصورة',
    dataFile: 'tebakgambar.json',
    timeout: 90000,
    hasImage: true,
    questionField: null,
    hintCount: 3
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebakgambar')

export { pluginConfig as config, handler }