import { noteFailure } from '../../src/lib/terboo-failure-log.js'
import { checkTarget } from '../../src/lib/terboo-middleware.js'
import te from '../../src/lib/terboo-error.js'
import { getDatabase } from '../../src/lib/terboo-database.js'
import { getUserLanguage, t } from '../../src/lib/terboo-localization.js'
import * as UI from '../../src/lib/terboo-ui-theme.js'
const pluginConfig = {
    name: 'طرد',
    alias: ['kick'],
    category: 'group',
    description: 'طرد عضو من المجموعة',
    usage: '.طرد @مستخدم',
    example: '.طرد @مستخدم',
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
    let targetJid = null

    if (m.quoted) {
        targetJid = m.quoted.sender
    } else if (m.mentionedJid && m.mentionedJid.length > 0) {
        targetJid = m.mentionedJid[0]
    }

    if (!targetJid) {
        await m.reply(UI.errorCard(t(lang, 'group.noTarget'), [
            t(lang, 'group.noTargetHint'),
            t(lang, 'group.example', { command: UI.isolate(`${m.prefix}${m.command} @user`) }),
        ].join('\n'), { lang }))
        return
    }

    const targetNumber = targetJid.replace(/@.*$/, '')
    // حماية الهدف من طبقة الصلاحيات الموحّدة: البوت · النفس · المالك · المشرف · العضوية (PN/LID)
    const guard = checkTarget(m, sock, targetJid, { protectAdmins: true })
    if (!guard.ok) {
        await m.reply(UI.errorCard(t(lang, 'group.failTitle'), t(lang, guard.reasonKey), { lang }))
        return
    }

    try {
        const targetParticipant = guard.participant
        await sock.groupParticipantsUpdate(m.chat, [targetParticipant.id], 'remove')

        await m.reply(UI.successCard(t(lang, 'group.failTitle').slice(0,0) || t(lang, 'common.success'), t(lang, 'group.kicked', { user: `@${targetNumber}` }), { lang }), { mentions: [targetJid] })

    } catch (error) {
        noteFailure("plugin:group/طرد", error, { where: "plugins/group/طرد.js:groupParticipantsUpdate", stage: "remove", target: targetJid })
        m.reply(te(m.prefix, m.command, m.pushName))
    }
}

export { pluginConfig as config, handler }