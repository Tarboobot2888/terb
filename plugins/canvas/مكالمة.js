import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import axios from 'axios'
import te from '../../src/lib/terboo-error.js'

// ═══════════════════════════════════════════════
// ⚙️ إعدادات الأمر
// ═══════════════════════════════════════════════
const pluginConfig = {
    name: 'مكالمة_وهمية',
    alias: ['fakecall'],
    category: 'canvas',
    description: 'إنشاء صورة مكالمة واتساب وهمية',
    usage: '.مكالمة_وهمية <اسم> | <مدة>',
    example: '.مكالمة_وهمية محمد | 19.00',
    isOwner: false, isPremium: false, isGroup: false, isPrivate: false,
    cooldown: 10, energi: 1, isEnabled: true
}

// ═══════════════════════════════════════════════
// 📞 دالة المعالجة
// ═══════════════════════════════════════════════
async function handler(m, { sock }) {
    const text = m.text
    
    if (!text || !text.includes('|')) {
        return m.reply(`📞 *مكالمة وهمية*\n\n📌 مثال: ${m.prefix}مكالمة محمد | 19.00`)
    }
    
    const [nama, durasi] = text.split('|').map(s => s.trim())
    if (!nama) return m.reply(`❌ الاسم مطلوب!`)
    
    await m.react('⏳')
    
    try {
        let avatar = 'https://files.catbox.moe/nwvkbt.png'
        
        // استخدام الصورة الشخصية
        try { avatar = await sock.profilePictureUrl(m.sender, 'image') } catch (error) { noteFailure("plugin:canvas/مكالمة", error, {where: "plugins/canvas/مكالمة.js:37",stage: "sock.profilePictureUrl"}); }
        
        // API بديل مباشر
        const apiUrl = `https://api.nexray.eu.cc/maker/fakecall?nama=${encodeURIComponent(nama)}&durasi=${encodeURIComponent(durasi)}&avatar=${encodeURIComponent(avatar)}`
        
        await sock.sendMedia(m.chat, apiUrl, null, m, { type: 'image' })
        m.react('📞')
        
    } catch (err) {
        m.react('❌')
        m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }