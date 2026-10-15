import { checkTarget } from '../../src/lib/terboo-middleware.js'
import te from '../../src/lib/terboo-error.js'
import { getDatabase } from '../../src/lib/terboo-database.js'
import { getUserLanguage, t } from '../../src/lib/terboo-localization.js'
import * as UI from '../../src/lib/terboo-ui-theme.js'
const pluginConfig = {
    name: 'ترقية',
    alias: ['promote'],
    category: 'group',
    description: 'ترقية عضو إلى مشرف',
    usage: '.ترقية @مستخدم',
    example: '.ترقية @مستخدم',
    isOwner: false,
    isPremium: false,
    isGroup: true,
    isPrivate: false,
    cooldown: 5,
    energi: 0,
    isEnabled: true,
    isAdmin: true,
    isBotAdmin: true
}

async function handler(m, { sock }) {
    const lang = getUserLanguage(getDatabase().getUser(m.sender))
    let target = null

    if (m.quoted) {
        target = m.quoted.sender
    } else if (m.mentionedJid && m.mentionedJid.length > 0) {
        target = m.mentionedJid[0]
    }

    if (!target) {
        await m.reply(UI.errorCard(t(lang, 'group.noTarget'), [
            t(lang, 'group.noTargetHint'),
            t(lang, 'group.example', { command: UI.isolate(`${m.prefix}${m.command} @user`) }),
        ].join('\n'), { lang }))
        return
    }

    try {
        // هدف محلول بهوية دقيقة (PN/LID) مع حماية البوت والنفس من طبقة الصلاحيات
        const guard = checkTarget(m, sock, target, { protectAdmins: false, protectOwner: false })
        if (!guard.ok) {
            await m.reply(UI.errorCard(t(lang, 'group.failTitle'), t(lang, guard.reasonKey), { lang }))
            return
        }
        const participant = guard.participant

        if (participant.admin) {
            await m.reply(UI.errorCard(t(lang, 'group.failTitle'), t(lang, 'group.alreadyAdmin'), { lang }))
            return
        }

        await sock.groupParticipantsUpdate(m.chat, [participant.id], 'promote')

        await m.reply(
            UI.successCard(t(lang, 'common.success'), t(lang, 'group.promoted', { user: `@${target.split('@')[0]}` }), { lang }),
            { mentions: [target] }
        )

    } catch (error) {
        m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }