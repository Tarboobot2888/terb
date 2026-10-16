// ═══════════════════════════════════════════════
// 📁 plugins/main/ping2.js
// ⚡ Ping 2 - بطاقة سرعة تفاعلية
// ═══════════════════════════════════════════════

import os from 'os'
import { performance } from 'perf_hooks'
import { sendCard } from '../../src/lib/terboo-ui-kit.js'

const pluginConfig = {
    name: 'ping2',
    alias: ['سرعة2', 'بينج2', 'p2'],
    category: 'main',
    description: 'عرض سرعة البوت ببطاقة تفاعلية',
    usage: '.ping2',
    example: '.ping2',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 0,
    isEnabled: true
}

const formatUptime = (sec) => {
    const d = Math.floor(sec / 86400)
    const h = Math.floor((sec % 86400) / 3600)
    const m = Math.floor((sec % 3600) / 60)
    const s = Math.floor(sec % 60)
    if (d) return `${d} يوم ${h} ساعة`
    if (h) return `${h} ساعة ${m} دقيقة`
    return `${m} دقيقة ${s} ثانية`
}

const fmtSize = b => b >= 1024**3 ? (b/1024**3).toFixed(1)+' GB' : (b/1024**2).toFixed(1)+' MB'

async function handler(m, { sock }) {
    const start = performance.now()
    const latency = Math.max(1, Date.now() - (m.messageTimestamp * 1000 || Date.now()))
    const processTime = (performance.now() - start).toFixed(0)
    const total = os.totalmem()
    const used = total - os.freemem()
    const cpu = (os.loadavg()[0] / os.cpus().length * 100).toFixed(1)
    const uptime = formatUptime(process.uptime())

    // بطاقة واحدة عبر طبقة الواجهة الموحّدة — أزرار حقيقية فقط (تحديث · القائمة)، بلا أزرار وهمية أو روابط عشوائية
    const prefix = m.prefix || '.'
    const text = `📝 *سرعة البوت*\n\n› 🏓 البينج: ${latency}ms\n› ⚙️ المعالجة: ${processTime}ms\n› 🧠 الذاكرة: ${fmtSize(used)} / ${fmtSize(total)}\n› 💻 المعالج: ${cpu}%\n› ⏱️ التشغيل: ${uptime}`
    await sendCard(sock, m, {
        cardId: 'ping2',
        text,
        footer: 'Bot Terboo',
        buttons: [
            { id: `${prefix}ping2`, text: '🔄 تحديث' },
            { id: `${prefix}menu`, text: '📋 القائمة' },
        ],
    })
}

export { pluginConfig as config, handler }