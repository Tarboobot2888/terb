// ═══════════════════════════════════════════════
// 📁 plugins/ai/سمسمي.js
// 🤖 سمسمي - محادثة عربية
// ═══════════════════════════════════════════════

import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import axios from 'axios'

const pluginConfig = {
    name: 'سمسمي',
    alias: ['سيمي'],
    category: 'ai',
    description: 'محادثة مع سمسمي بالعربية',
    usage: '.سمسمي <رسالة>',
    example: '.سمسمي ازيك',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 3,
    energi: 1,
    isEnabled: true
}

async function handler(m, { sock, text }) {
    if (!text) {
        return m.reply(`🤖 *سمسمي*\n\n📝 .سمسمي <رسالة>\n💡 .سمسمي ازيك`)
    }

    m.react('🤪')

    try {
        const { data } = await axios.get(`https://engez.a7a.online/api/v1/ai/ai/simsimi?action=تكلم&message=${encodeURIComponent(text)}`)

        if (data?.success && data?.response?.reply) {
            await m.reply(data.response.reply)
        }

    } catch (e) { noteFailure("plugin:ai/سمسمي", e, {where: "plugins/ai/سمسمي.js:38",stage: "axios.get"}); }
}

export { pluginConfig as config, handler }