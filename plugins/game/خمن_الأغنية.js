import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'خمن_الأغنية',
    alias: ['tebaklagu'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_tebaklagu',
    description: 'خمن عنوان الأغنية',
    usage: '.خمن_الأغنية',
    example: '.خمن_الأغنية',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('خمن_الأغنية', {
    alias: ['tebaklagu'],
    emoji: '🎵',
    title: 'خمن الأغنية',
    description: 'خمن عنوان الأغنية',
    dataFile: 'tebaklagu.json'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_tebaklagu')

export { pluginConfig as config, handler }