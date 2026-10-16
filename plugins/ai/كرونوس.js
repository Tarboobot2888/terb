import { noteFailure } from "../../src/lib/terboo-failure-log.js";
import axios from 'axios'

const pluginConfig = {
    name: 'كرونوس',
    alias: ['chrunos', 'chrun', 'كرون'],
    category: 'ai',
    description: 'محادثة مانوس AI Think',
    usage: '.كرونوس <سؤال>',
    example: '.كرونوس من هو رئيس مصر؟',
    isOwner: false,
    isPremium: false,
    isGroup: false,
    isPrivate: false,
    cooldown: 8,
    energi: 2,
    isEnabled: true
}

async function chrunosAI(prompt) {
    try {
        const { data } = await axios({
            method: 'POST',
            url: 'https://tecuts-chat.hf.space/chat/stream',
            responseType: 'stream',
            headers: {
                'Accept': 'text/event-stream',
                'Content-Type': 'application/json',
                'Origin': 'https://chrunos.com',
                'Referer': 'https://chrunos.com/',
                'User-Agent': 'Mozilla/5.0'
            },
            data: {
                message: prompt + ' /no_think',
                history: [
                    { role: 'system', content: 'ااسمه مانوس (manus AI). أنت مساعد ذكي متطور.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.6,
                use_search: false
            },
            timeout: 60000
        })

        return new Promise((resolve) => {
            let result = ''
            let buffer = ''

            data.on('data', chunk => {
                buffer += chunk.toString()
                const events = buffer.split('\n\n')
                buffer = events.pop()

                for (const event of events) {
                    const line = event.trim()
                    if (!line.startsWith('data:')) continue
                    try {
                        const json = JSON.parse(line.slice(5).trim())
                        if (json.type === 'content') {
                            if (json.data === '<think>' || json.data === '</think>') continue
                            result += json.data
                        }
                        if (json.type === 'done') {
                            data.destroy()
                            return resolve(result.trim())
                        }
                    } catch (error) { noteFailure("plugin:ai/كرونوس", error, {where: "plugins/ai/كرونوس.js:66",stage: "JSON.parse"}); }
                }
            })

            data.on('end', () => resolve(result.trim()))
            data.on('error', () => resolve(result.trim()))
        })
    } catch (e) { noteFailure("plugin:ai/كرونوس", e, {where: "plugins/ai/كرونوس.js:73",stage: "JSON.parse"}); return null; }
}

async function handler(m, { sock, text }) {
    if (!text) return m.reply(`🤖 *Chrunos AI Think*\n\n> ${m.prefix}كرونوس <سؤال>\n\n> مثال:\n> ${m.prefix}كرونوس من هو رئيس مصر؟`)

    await m.react('🤖')

    try {
        const result = await chrunosAI(text)

        if (!result || result.length === 0) {
            await m.react('❌')
            return m.reply('❌ لم يتم الحصول على رد')
        }

        await m.reply(result)
        await m.react('✅')

    } catch (e) {
        await m.react('❌')
        return m.reply(`❌ خطأ: ${e.message}`)
    }
}

export { pluginConfig as config, handler }