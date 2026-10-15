import config from '../../config.js'
import { getDatabase } from '../../src/lib/terboo-database.js'
import { getUserLanguage, t } from '../../src/lib/terboo-localization.js'
import * as UI from '../../src/lib/terboo-ui-theme.js'
import * as brand from '../../src/lib/terboo-brand.js'

const pluginConfig = {
    name: 'القوانين',
    alias: ['rules', 'normas'],
    category: 'main',
    description: 'عرض قوانين البوت',
    usage: '.القوانين',
    example: '.القوانين',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 10,
    energi: 0,
    isEnabled: true
}

async function handler(m, { sock, config: botConfig }) {
    try {
        const db = getDatabase()
        const lang = getUserLanguage(db.getUser(m.sender))
        const customRules = db.setting('botRules')

        // القوانين الافتراضية تأتي من حزمة اللغة، والقوانين المخصصة للمالك تبقى كما هي
        let rulesList = t(lang, 'rules.list')
        if (!Array.isArray(rulesList)) rulesList = []

        if (customRules) {
            if (Array.isArray(customRules)) {
                rulesList = customRules
            } else if (typeof customRules === 'string') {
                rulesList = customRules
                    .split('\n')
                    .map(v => v.replace(/^[^a-zA-Z0-9]+/, '').trim())
                    .filter(Boolean)
            }
        }

        const tableData = rulesList.map((rule, i) => [
            `${i + 1}`,
            rule
        ])

        await sock.sendTable(
            m.chat,
            `📜 ${t(lang, 'rules.title')}`,
            [t(lang, 'rules.columnNumber'), t(lang, 'rules.columnRule')],
            tableData,
            m,
            {
                headerText: `${brand.botName()} — *${t(lang, 'rules.title')}*`,
                footer: t(lang, 'rules.footer')
            }
        )
    } catch (e) {
        try {
            const db = getDatabase()
            const lang = getUserLanguage(db.getUser(m.sender))
            const rules = t(lang, 'rules.list')
            const list = Array.isArray(rules) ? rules : []
            await m.reply(
                UI.card({
                    title: t(lang, 'rules.title'),
                    icon: '📜',
                    blocks: [list.map((r, i) => UI.quote(`${i + 1}. ${r}`, lang)).join('\n')],
                    lang,
                    footer: t(lang, 'rules.footer'),
                })
            )
        } catch {
            m.reply(config.messages?.error || '❌')
        }
    }
}

export { pluginConfig as config, handler }
