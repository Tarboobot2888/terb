// حزمة الصور الكبيرة - أمر لتغيير مجموعة صور البوت الكبيرة دفعة واحدة

import fs from 'fs'
import path from 'path'
import te from '../../src/lib/terboo-error.js'
import config from '../../config.js'
import { updateAssetAndSave } from '../../src/lib/terboo-asset-manager.js'

const pluginConfig = {
    name: 'حزمة_الصور_الكبيرة',
    alias: ["tarboo-large", 'terboo-large', 'maro-large'],
    category: 'owner',
    description: 'حزمة مسبقة: تغيير صورة terboo.png، بالإضافة إلى terboo-v8.jpg و terboo3.jpg دفعة واحدة',
    usage: '.حزمة_الصور_الكبيرة (رد/إرسال صورة)',
    example: '.حزمة_الصور_الكبيرة',
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
        return m.reply(`🖼️ *حزمة الصور الكبيرة*\n\n> أرسل/رد على صورة لتغيير مجموعة الصور الكبيرة (terboo.png, terboo-v8.jpg, terboo3.jpg) دفعة واحدة.\n> تأكد من أن نسبة الصورة مناسبة حسب الرغبة.`)
    }
    
    await m.react('🕕')
    
    try {
        let buffer
        if (m.quoted && m.quoted.isMedia) {
            buffer = await m.quoted.download()
        } else if (m.isMedia) {
            buffer = await m.download()
        }
        
        if (!buffer) {
            await m.react('❌')
            return m.reply(`❌ فشل تحميل الصورة`)
        }
        
        // الأهداف هي مفاتيح config.assets الحقيقية (assets/images لم يكن موجوداً)
        const targetKeys = ['terboo', 'terboo-v8', 'terboo3']
        const targetImages = []

        for (const key of targetKeys) {
            const rel = config.assets?.[key]
            if (!rel || rel.startsWith('http')) continue
            const targetPath = path.resolve(process.cwd(), rel)
            fs.mkdirSync(path.dirname(targetPath), { recursive: true })
            fs.writeFileSync(targetPath, buffer)
            updateAssetAndSave(key, buffer, rel)
            targetImages.push(path.basename(rel))
        }
        
        await m.react('✅')
        m.reply(`✅ *تم بنجاح*\n\n> تم تغيير حزمة الصور *حزمة الصور الكبيرة* بنجاح.\n> تشمل: ${targetImages.join(', ')}\n> أعد تشغيل البوت إذا لم تتغير الصور فوراً.`)
        
    } catch (error) {
        await m.react('☢')
        await m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }