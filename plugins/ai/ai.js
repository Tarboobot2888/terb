// ═══════════════════════════════════════════════
// 📁 plugins/ai/gemini.js
// 🤖 Gemini AI - شات ذكي مع عرض جداول وأكواد
// ═══════════════════════════════════════════════

import gemini from '../../src/scraper/gemini.js';
import { AIRich } from '../../src/lib/terboo-builder.js';
import te from '../../src/lib/terboo-error.js';
import { brandLockPrompt, enforceBrand } from '../../src/lib/terboo-brand.js';
import { detectReplyLanguage } from '../../src/lib/terboo-ai-context.js';
import { getUserLanguage } from '../../src/lib/terboo-localization.js';
import { getDatabase } from '../../src/lib/terboo-database.js';

const pluginConfig = {
    name: 'ai',
    alias: ['ai4chat'],
    category: 'ai',
    description: 'محادثة ذكية مع Gemini AI (يدعم جداول، أكواد، تنسيق متقدم)',
    usage: '.ai <سؤال>',
    example: '.ai قارن بين JavaScript و Python في جدول',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 5,
    energi: 1,
    isEnabled: true
};

const sessions = {};

// هوية ولغة ديناميكية (§5 §36 §38): الاسم ثابت، والرد بلغة السائل
const systemPrompt = (lang) => [
    brandLockPrompt(lang),
    "Reply in the same language the user writes in (Arabic or English); Egyptian Arabic gets Egyptian Arabic.",
    "Use markdown precisely: tables start and end with |, code goes in ```language fences, **bold** only for key headings, keep answers organized.",
].join("\n");

async function handler(m, { sock, text }) {
    if (!text) {
        return m.reply(
            `🤖 *Bot Terboo AI*\n\n` +
            `> مساعد ذكي متقدم\n\n` +
            `*الاستخدام:*\n` +
            `> .ai <سؤال>\n\n` +
            `*أمثلة:*\n` +
            `> .ai قارن بين JS و Python في جدول\n` +
            `> .ai اكتبلي كود Fibonacci في بايثون\n` +
            `> .ai اشرحلي يعني ايه API`
        );
    }

    m.react('⏳');

    const userJid = m.sender;
    const sessionId = sessions[userJid] || null;

    try {
        const result = await gemini({
            message: text,
            instruction: systemPrompt(detectReplyLanguage(text, getUserLanguage(getDatabase()?.getUser?.(m.sender)))),
            sessionId: sessionId
        });

        if (result && result.sessionId) {
            sessions[userJid] = result.sessionId;
        }

        const replyText = enforceBrand(result.text || '');
        const aiRich = new AIRich(sock);
        const lines = replyText.split('\n');
        let currentTable = [];
        let currentCode = [];
        let inCode = false;
        let codeLang = '';
        let textBuffer = [];

        const flushText = () => {
            if (textBuffer.length > 0) {
                aiRich.addText(textBuffer.join('\n').trim());
                textBuffer = [];
            }
        };

        const flushTable = () => {
            if (currentTable.length > 0) {
                const tableData = currentTable.map(line => {
                    return line.split('|').map(c => c.trim()).filter((_, i, arr) => i !== 0 && i !== arr.length - 1);
                });
                const filteredTableData = tableData.filter(row => !row.every(c => /^[-:]+$/.test(c)));
                if (filteredTableData.length > 0 && filteredTableData.every(row => row.length > 0)) {
                    aiRich.addTable(filteredTableData);
                } else {
                    aiRich.addText(currentTable.join('\n'));
                }
                currentTable = [];
            }
        };

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.trim().startsWith('```')) {
                if (!inCode) {
                    flushText();
                    flushTable();
                    inCode = true;
                    codeLang = line.trim().substring(3).trim() || 'text';
                } else {
                    inCode = false;
                    aiRich.addCode(codeLang, currentCode.join('\n'));
                    currentCode = [];
                }
                continue;
            }
            if (inCode) {
                currentCode.push(line);
                continue;
            }
            if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
                flushText();
                currentTable.push(line.trim());
                continue;
            }
            flushTable();
            textBuffer.push(line);
        }

        flushText();
        flushTable();
        // رد الذكاء نص حر بلغة المستخدم أصلاً ⇒ يُرسل كما هو (raw) عبر Rich Response Engine
        await aiRich.send(m.chat, { quoted: m, raw: true });
        m.react('✅');
    } catch (error) {
        console.error('[AI Error]', error);
        m.react('❌');
        return m.reply(te(m.prefix, m.command, m.pushName));
    }
}

export { pluginConfig as config, handler };