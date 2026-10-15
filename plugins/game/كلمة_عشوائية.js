import { games } from '../../src/lib/terboo-games.js'

import { loadArcade } from '../../src/lib/terboo-arcade/index.js'
import { quickCommand } from '../../src/lib/terboo-arcade/commands.js'
const pluginConfig = {
    name: 'كلمة_عشوائية',
    alias: ['kataacak'],
    category: 'game',
    // لعبة TERBOO ARCADE المرتبطة (السجل الموحّد): نفس الأمر، Mini App تفاعلية
    game: 'q_kataacak',
    description: 'رتب الحروف العشوائية',
    usage: '.كلمة_عشوائية',
    example: '.كلمة_عشوائية',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
}

games.register('كلمة_عشوائية', {
    alias: ['kataacak'],
    emoji: '🔤',
    title: 'كلمة عشوائية',
    description: 'رتب الحروف العشوائية'
})

await loadArcade()

// الحركات المكتوبة يلتقطها answerHandler الموحّد في plugins/game/اركيد.js
const handler = quickCommand('q_kataacak')

export { pluginConfig as config, handler }