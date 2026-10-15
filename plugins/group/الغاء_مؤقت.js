import { generateWAMessageFromContent } from "@whiskeysockets/baileys";
import { cancelSchedules } from "../../src/lib/terboo-group-actions.js";

const activeTimers = global.activeTimers || (global.activeTimers = {});

const pluginConfig = {
    name: 'الغاء_مؤقت',
    alias: [],
    category: 'group',
    description: 'إلغاء المؤقت النشط للشات - للمشرفين والمطور فقط',
    usage: '.الغاء_مؤقت',
    example: '.الغاء_مؤقت',
    isOwner: false,
    isPremium: false,
    isGroup: true,
    isPrivate: false,
    cooldown: 3,
    energi: 0,
    isEnabled: true,
    isAdmin: true,
    isBotAdmin: true
};

async function handler(m, { sock }) {
    // المؤقت القديم (أمر .شات) + الجدولة الجديدة («اقفل الجروب ساعة») — نفس زر الإلغاء يوقف الاثنين
    const scheduled = cancelSchedules(m.chat);
    if (!activeTimers[m.chat] && !scheduled) {
        return m.reply('⚠️ لا يوجد مؤقت نشط.');
    }

    if (activeTimers[m.chat]) {
        clearTimeout(activeTimers[m.chat].timer);
        delete activeTimers[m.chat];
    }

    await m.reply('✅ تم إلغاء المؤقت بنجاح.');
}

export { pluginConfig as config, handler }