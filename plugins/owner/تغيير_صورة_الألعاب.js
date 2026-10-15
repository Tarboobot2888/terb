// تغيير صورة الألعاب - أمر لتغيير صورة terboo-games.jpg (صورة مصغرة للألعاب)

import fs from 'fs'
import path from 'path'
import te from '../../src/lib/terboo-error.js'
import { updateAssetUrl } from '../../src/lib/terboo-uploader.js'

const pluginConfig = {
    name: 'تغيير_صورة_الألعاب',
    alias: ["ganti-tarboo-games.jpg", 'ganti-terboo-games.jpg', 'ganti-maro-games.jpg'],
    category: 'owner',
    description: 'تغيير صورة terboo-games.jpg (صورة مصغرة للألعاب)',
    usage: '.تغيير_صورة_الألعاب (رد/إرسال صورة)',
    example: '.تغيير_صورة_الألعاب',
    isOwner: true,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 0,
    isEnabled: true
}

async function handler(m, { sock }) {
    const isImage = m.isImage || (m.quoted && m.quoted.type === 'imageMessage')
    
    if (!isImage) {
        return m.reply(`🖼️ *تغيير صورة الألعاب*\n\n> أرسل/رد على صورة لتغييرها\n> الملف: assets/image/terboo-games.jpg`)
    }
    
    try {
        let buffer
        if (m.quoted && m.quoted.isMedia) {
            buffer = await m.quoted.download()
        } else if (m.isMedia) {
            buffer = await m.download()
        }
        
        if (!buffer) {
            return m.reply(`❌ فشل تحميل الصورة`)
        }
        
        await m.reply(`⏳ جاري رفع الصورة...`)
        try {
            const newUrl = await updateAssetUrl('terboo-games', buffer, 'terboo-games.jpg')
            m.reply(`✅ *تم بنجاح*\n\n> تم تغيير صورة terboo-games.jpg إلى رابط جديد:\n> ${newUrl}\n> تم تحديث التكوين في الوقت الفعلي!`)
        } catch (e) {
            m.reply(`❌ فشل رفع الصورة: ${e.message}`)
        }
    } catch (error) {
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }