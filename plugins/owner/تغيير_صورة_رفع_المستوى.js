// تغيير صورة رفع المستوى - أمر لتغيير صورة terboo-levelup.jpg

import fs from 'fs'
import path from 'path'
import te from '../../src/lib/terboo-error.js'
import { updateAssetUrl } from '../../src/lib/terboo-uploader.js'

const pluginConfig = {
    name: 'تغيير_صورة_رفع_المستوى',
    alias: ["ganti-tarboo-levelup.jpg", 'ganti-terboo-levelup.jpg', 'ganti-maro-levelup.jpg'],
    category: 'owner',
    description: 'تغيير صورة terboo-levelup.jpg',
    usage: '.تغيير_صورة_رفع_المستوى (رد/إرسال صورة)',
    example: '.تغيير_صورة_رفع_المستوى',
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
    if (!isImage) return m.reply(`🖼️ *تغيير صورة رفع المستوى*\n\n> أرسل/رد على صورة لتغييرها\n> الملف: assets/image/terboo-levelup.jpg`)
    try {
        let buffer = m.quoted && m.quoted.isMedia ? await m.quoted.download() : await m.download()
        if (!buffer) return m.reply('❌ فشل تحميل الصورة')
        await m.reply(`⏳ جاري رفع الصورة...`)
        try {
            const newUrl = await updateAssetUrl('terboo-levelup', buffer, 'terboo-levelup.jpg')
            m.reply(`✅ *تم بنجاح*\n\n> تم تغيير صورة terboo-levelup.jpg إلى رابط جديد:\n> ${newUrl}\n> تم تحديث التكوين في الوقت الفعلي!`)
        } catch (e) {
            m.reply(`❌ فشل رفع الصورة: ${e.message}`)
        }
    } catch (error) {
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }