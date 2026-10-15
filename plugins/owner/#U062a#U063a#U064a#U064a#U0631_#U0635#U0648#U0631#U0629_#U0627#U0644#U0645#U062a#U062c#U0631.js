// تغيير صورة المتجر - أمر لتغيير صورة terboo-store.png (صورة مصغرة للمتجر)

import fs from 'fs'
import path from 'path'
import te from '../../src/lib/terboo-error.js'
import { updateAssetUrl } from '../../src/lib/terboo-uploader.js'

const pluginConfig = {
    name: 'تغيير_صورة_المتجر',
    alias: ["ganti-tarboo-store.jpg", 'ganti-terboo-store.jpg', 'ganti-maro-store.jpg'],
    category: 'owner',
    description: 'تغيير صورة terboo-store.png (صورة مصغرة للمتجر)',
    usage: '.تغيير_صورة_المتجر (رد/إرسال صورة)',
    example: '.تغيير_صورة_المتجر',
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
        return m.reply(`🖼️ *تغيير صورة المتجر*\n\n> أرسل/رد على صورة لتغييرها\n> الملف: assets/image/terboo-store.png`)
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
            const newUrl = await updateAssetUrl('terboo-store', buffer, 'terboo-store.png')
            m.reply(`✅ *تم بنجاح*\n\n> تم تغيير صورة terboo-store.png إلى رابط جديد:\n> ${newUrl}\n> تم تحديث التكوين في الوقت الفعلي!`)
        } catch (e) {
            m.reply(`❌ فشل رفع الصورة: ${e.message}`)
        }
    } catch (error) {
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }