// تغيير صورة terboo3 - أمر لتغيير صورة terboo3.jpg

import fs from 'fs'
import path from 'path'
import te from '../../src/lib/terboo-error.js'
import { updateAssetUrl } from '../../src/lib/terboo-uploader.js'

const pluginConfig = {
    name: 'تغيير_صورة_terboo3',
    alias: ["تغيير_صورة_tarboo3", "ganti-tarboo3.jpg", 'ganti-terboo3.jpg', 'تغيير_صورة_maro3', 'ganti-maro3.jpg'],
    category: 'owner',
    description: 'تغيير صورة terboo3.jpg',
    usage: '.تغيير_صورة_terboo3 (رد/إرسال صورة)',
    example: '.تغيير_صورة_terboo3',
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
        return m.reply(`🖼️ *تغيير صورة terboo3*\n\n> أرسل/رد على صورة لتغييرها\n> الملف: assets/image/terboo3.jpg`)
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
            const newUrl = await updateAssetUrl('terboo3', buffer, 'terboo3.jpg')
            m.reply(`✅ *تم بنجاح*\n\n> تم تغيير صورة terboo3.jpg إلى رابط جديد:\n> ${newUrl}\n> تم تحديث التكوين في الوقت الفعلي!`)
        } catch (e) {
            m.reply(`❌ فشل رفع الصورة: ${e.message}`)
        }
    } catch (error) {
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }