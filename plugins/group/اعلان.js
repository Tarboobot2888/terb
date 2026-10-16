import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import { createErrorMessage } from '../../src/lib/terboo-formatter.js';
import config from '../../config.js';
import fs from 'fs';

const pluginConfig = {
    name: 'اعلان_مجموعة',
    alias: [],
    category: 'group',
    description: '📢 إرسال إعلان تفاعلي بصورة',
    usage: '.اعلان_مجموعة <النص>',
    example: '.اعلان_مجموعة مرحبا بالجميع',
    isOwner: false,
    isPremium: false,
    isGroup: true,
    isPrivate: false,
    cooldown: 5,
    energi: 0,
    isEnabled: true
};

async function handler(m, { sock }) {
    const text = m.text?.trim();

    if (!text) {
        return m.reply('📢 *الإعلان*\n\nاكتب النص بعد الأمر\nمثال: .اعلان مرحبا بالجميع');
    }

    try {
        const sharp = (await import('sharp')).default;
        let thumbBuffer = Buffer.alloc(0);
        
        try {
            const imgPath = config.assets.terboo2 || config.assets.terboo;
            if (fs.existsSync(imgPath)) {
                thumbBuffer = await sharp(fs.readFileSync(imgPath)).resize(300, 300).jpeg().toBuffer();
            }
        } catch (error) { noteFailure("plugin:group/اعلان", error, {where: "plugins/group/اعلان.js:37",stage: "fs.existsSync"}); }

        await sock.relayMessage(m.chat, {
            senderKeyDistributionMessage: {
                groupId: m.chat,
                axolotlSenderKeyDistributionMessage: Buffer.from(Date.now().toString())
            },
            extendedTextMessage: {
                endCardTiles: [],
                text: text + '\n\n© ' + (config.bot?.name || 'Bot Terboo'),
                contextInfo: {
                    mentionedJid: [],
                    groupMentions: [],
                    statusAttributions: [],
                    externalAdReply: {
                        thumbnailUrl: 'https://i.imgur.com/TuItj4L.png',
                        thumbnail: thumbBuffer,
                        sourceId: Date.now().toString(),
                        sourceUrl: config.saluran?.id || 'https://whatsapp.com/channel/0029VbBh4ku8aKvPx1m0l822',
                        automatedGreetingMessageShown: true,
                        greetingMessageBody: config.bot?.name || 'Bot Terboo',
                        ctaPayload: 'iniciar_chat',
                        automatedGreetingMessageCtaType: 'START_CHAT'
                    }
                }
            }
        }, {
            additionalNodes: [{
                tag: 'biz',
                attrs: {},
                content: [{
                    tag: 'interactive',
                    attrs: { type: 'native_flow', v: '1' },
                    content: [{ tag: 'native_flow', attrs: { v: '9', name: 'mixed' } }]
                }]
            }]
        });

        await m.react('📢');

    } catch (e) {
        return m.reply(createErrorMessage(e.message));
    }
}

export { pluginConfig as config, handler };