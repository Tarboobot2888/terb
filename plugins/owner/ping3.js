import { createErrorMessage } from '../../src/lib/terboo-formatter.js';
import { AIRich } from '../../src/lib/terboo-builder.js';

const pluginConfig = {
    name: 'ping3',
    alias: ['testmeta', 'metatest'],
    category: 'owner',
    description: '🧪 اختبار الرسائل الغنية',
    usage: '.ping3',
    example: '.ping3',
    isOwner: true,
    isPremium: false,
    isGroup: true,
    isPrivate: true,
    cooldown: 10,
    energi: 0,
    isEnabled: true
};

// اختبار الرد الغني عبر Rich Response Engine (نص · جدول · كود) — بلا هوية Meta AI (v4 §44).
// إن لم يعرض جهاز المستلم الرسالة الغنية تصل بطاقة نصية تلقائياً ويُسجَّل ذلك في سجل التسليم.
async function handler(m, { sock }) {
    try {
        const started = Date.now();
        const rich = new AIRich(sock).setTitle('🧪 PING3');
        rich.addTable([
            ['الصيغة', 'الحالة'],
            ['نص غني', '✅'],
            ['جدول', '✅'],
            ['كود', '✅'],
        ]);
        rich.addCode('javascript', 'const started = Date.now();\nconsole.log("pong", Date.now() - started, "ms");\n');
        rich.setFooter(`© Bot Terboo · ${Date.now() - started}ms`);
        await rich.send(m.chat, { quoted: m });
    } catch (e) {
        return m.reply(createErrorMessage(e.message));
    }
}

export { pluginConfig as config, handler };