// تغيير صورة التنزيل - أمر لتغيير صورة terboo-demote.png

import fs from 'fs'
import path from 'path'
import te from '../../src/lib/terboo-error.js'
import { updateAssetUrl } from '../../src/lib/terboo-uploader.js'

const pluginConfig = {
    name: 'تغيير_صورة_التنزيل',
    alias: ["ganti-tarboo-demote.jpg", 'ganti-terboo-demote.jpg', 'ganti-maro-demote.jpg'],
    category: 'owner',
    description: 'تغيير صورة terboo-demote.png',
    usage: '.تغيير_صورة_التنزيل (رد/إرسال صورة)',
    example: '.تغيير_صورة_التنزيل',
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
    if (!isImage) return m.reply(`🖼️ *تغيير صورة التنزيل*\n\n> أرسل/رد على صورة لتغييرها\n> الملف: assets/image/terboo-demote.png`)
    try {
        let buffer = m.quoted && m.quoted.isMedia ? await m.quoted.download() : await m.download()
        if (!buffer) return m.reply('❌ فشل تحميل الصورة')
        await m.reply(`⏳ جاري رفع الصورة...`)
        try {
            const newUrl = await updateAssetUrl('terboo-demote', buffer, 'terboo-demote.png')
            m.reply(`✅ *تم بنجاح*\n\n> تم تغيير صورة terboo-demote.png إلى رابط جديد:\n> ${newUrl}\n> تم تحديث التكوين في الوقت الفعلي!`)
        } catch (e) {
            m.reply(`❌ فشل رفع الصورة: ${e.message}`)
        }
    } catch (error) {
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }