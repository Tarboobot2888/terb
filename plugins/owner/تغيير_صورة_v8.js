// تغيير صورة v8 - أمر لتغيير صورة terboo-v8.jpg

import fs from 'fs'
import path from 'path'
import te from '../../src/lib/terboo-error.js'
import { updateAssetUrl } from '../../src/lib/terboo-uploader.js'

const pluginConfig = {
    name: 'تغيير_صورة_v8',
    alias: ["ganti-tarboo-v8.jpg", 'ganti-terboo-v8.jpg', 'ganti-maro-v8.jpg'],
    category: 'owner',
    description: 'تغيير صورة terboo-v8.jpg',
    usage: '.تغيير_صورة_v8 (رد/إرسال صورة)',
    example: '.تغيير_صورة_v8',
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
        return m.reply(`🖼️ *تغيير صورة v8*\n\n> أرسل/رد على صورة لتغييرها\n> الملف: assets/image/terboo-v8.jpg`)
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
            const newUrl = await updateAssetUrl('terboo-v8', buffer, 'terboo-v8.jpg')
            m.reply(`✅ *تم بنجاح*\n\n> تم تغيير صورة terboo-v8.jpg إلى رابط جديد:\n> ${newUrl}\n> تم تحديث التكوين في الوقت الفعلي!`)
        } catch (e) {
            m.reply(`❌ فشل رفع الصورة: ${e.message}`)
        }
    } catch (error) {
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }