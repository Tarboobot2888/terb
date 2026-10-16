import { getDatabase } from '../../src/lib/terboo-database.js'

const pluginConfig = {
    name: "levelup",
    alias: ["lvlup"],
    category: 'user',
    description: 'تفعيل/إلغاء إشعارات رفع المستوى',
    usage: '.levelup <تشغيل/إيقاف>',
    example: '.levelup تشغيل',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 0,
    isEnabled: true
}

function handler(m, { sock }) {
    const db = getDatabase()
    const user = db.getUser(m.sender)
    const args = m.args || []
    const rawSub = args[0]?.toLowerCase()
    // تشغيل/إيقاف بالعربية والإسبانية أيضاً
    const sub = { تشغيل: 'on', تفعيل: 'on', activar: 'on', encender: 'on',
        ايقاف: 'off', إيقاف: 'off', تعطيل: 'off', الغاء: 'off', إلغاء: 'off', desactivar: 'off', apagar: 'off' }[rawSub] || rawSub
    
    if (!user.settings) user.settings = {}
    
    if (sub === 'on') {
        user.settings.levelupNotif = true
        db.save()
        return m.reply(
            `✅ *إشعارات رفع المستوى*\n\n` +
            `> الحالة: *مفعّل* ✅\n` +
            `> ستتلقى إشعارات عند رفع مستواك!`
        )
    }
    
    if (sub === 'off') {
        user.settings.levelupNotif = false
        db.save()
        return m.reply(
            `❌ *إشعارات رفع المستوى*\n\n` +
            `> الحالة: *معطّل* ❌\n` +
            `> تم إلغاء إشعارات رفع المستوى.`
        )
    }
    
    const status = user.settings.levelupNotif !== false ? 'مفعّل ✅' : 'معطّل ❌'
    return m.reply(
        `🔔 *إشعارات رفع المستوى*\n\n` +
        `> الحالة الحالية: *${status}*\n\n` +
        `❋ 📋 *الاستخدام*\n` +
        `> ◈ > .levelup تشغيل - تفعيل\n` +
        `> ◈ > .levelup إيقاف - إلغاء\n` +
        ``
    )
}

export { pluginConfig as config, handler }