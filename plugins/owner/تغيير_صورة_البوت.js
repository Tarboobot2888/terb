// تغيير صورة البوت - أمر لتغيير صورة terboo.png (صورة القائمة)

import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import te from '../../src/lib/terboo-error.js'
import { updateAssetUrl } from '../../src/lib/terboo-uploader.js'

const pluginConfig = {
    name: 'تغيير_صورة_البوت',
    alias: ["ganti-tarboo.jpg", 'ganti-terboo.jpg', 'ganti-maro.jpg'],
    category: 'owner',
    description: 'تغيير صورة terboo.png (صورة القائمة)',
    usage: '.تغيير_صورة_البوت (رد/إرسال صورة)',
    example: '.تغيير_صورة_البوت',
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
        return m.reply(`🖼️ *تغيير صورة البوت*\n\n> أرسل/رد على صورة لتغييرها\n> الملف: assets/image/terboo.png`)
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
            const newUrl = await updateAssetUrl('terboo', buffer, 'terboo.png')
            // رأس القائمة صار لافتة 1280×720 (terboo-banner): «صورة القائمة» تتغير معها كما كانت
            const banner = await sharp(buffer).resize(1280, 720, { fit: 'cover' }).jpeg({ quality: 86 }).toBuffer()
            await updateAssetUrl('terboo-banner', banner, 'terboo-banner.jpg')
            m.reply(`✅ *تم بنجاح*\n\n> تم تغيير صورة terboo.png إلى رابط جديد:\n> ${newUrl}\n> تم تحديث التكوين في الوقت الفعلي!`)
        } catch (e) {
            m.reply(`❌ فشل رفع الصورة: ${e.message}`)
        }
    } catch (error) {
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }