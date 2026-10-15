// تغيير صورة الترقية - أمر لتغيير صورة terboo-promote.png

import fs from 'fs'
import path from 'path'
import te from '../../src/lib/terboo-error.js'
import { updateAssetUrl } from '../../src/lib/terboo-uploader.js'

const pluginConfig = {
    name: 'تغيير_صورة_الترقية',
    alias: ["ganti-tarboo-promote.jpg", 'ganti-terboo-promote.jpg', 'ganti-maro-promote.jpg'],
    category: 'owner',
    description: 'تغيير صورة terboo-promote.png',
    usage: '.تغيير_صورة_الترقية (رد/إرسال صورة)',
    example: '.تغيير_صورة_الترقية',
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
    if (!isImage) return m.reply(`🖼️ *تغيير صورة الترقية*\n\n> أرسل/رد على صورة لتغييرها\n> الملف: assets/image/terboo-promote.png`)
    try {
        let buffer = m.quoted && m.quoted.isMedia ? await m.quoted.download() : await m.download()
        if (!buffer) return m.reply('❌ فشل تحميل الصورة')
        await m.reply(`⏳ جاري رفع الصورة...`)
        try {
            const newUrl = await updateAssetUrl('terboo-promote', buffer, 'terboo-promote.png')
            m.reply(`✅ *تم بنجاح*\n\n> تم تغيير صورة terboo-promote.png إلى رابط جديد:\n> ${newUrl}\n> تم تحديث التكوين في الوقت الفعلي!`)
        } catch (e) {
            m.reply(`❌ فشل رفع الصورة: ${e.message}`)
        }
    } catch (error) {
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }