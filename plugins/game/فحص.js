import { nightActionHandler } from './مستذئب.js'
const pluginConfig = {
    name: 'فحص_عراف',
    alias: ['wwsorcerer'],
    category: 'game',
    description: 'حركة الساحر الليلية - افحص إذا كان الهدف عرافاً',
    usage: '.فحص_عراف <رقم>',
    example: '.فحص_عراف 3',
    isOwner: false,
    isPremium: false,
    isGroup: true,
    isPrivate: true,
    cooldown: 0,
    energi: 0,
    isEnabled: true
}

async function handler(m, { sock }) {
    return await nightActionHandler(m, { sock })
}

export { pluginConfig as config, handler }