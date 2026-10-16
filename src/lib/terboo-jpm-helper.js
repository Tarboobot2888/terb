const CACHE_TTL = 60000
const MAX_RETRIES = 3
const RETRY_DELAYS = [3000, 6000, 12000]

// مخزن لكل حساب بوت: البوتات الفرعية لها مجموعات مختلفة — مخزن واحد مشترك كان يعيد مجموعات البوت الرئيسي لأي بوت آخر
const cache = new Map()
const keyOf = (sock) => String(sock?.user?.id || '').split(':')[0] || 'default'

async function fetchGroupsSafe(sock) {
    const now = Date.now()
    const key = keyOf(sock)
    const hit = cache.get(key)
    if (hit && (now - hit.at) < CACHE_TTL) {
        return hit.groups
    }

    global.isFetchingGroups = true

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const result = await sock.groupFetchAllParticipating()
            cache.set(key, { groups: result, at: Date.now() })
            while (cache.size > 200) cache.delete(cache.keys().next().value)
            global.isFetchingGroups = false
            return result
        } catch (err) {
            const isRateLimit = err.message?.includes('rate') ||
                err.message?.includes('limit') ||
                err.message?.includes('429') ||
                err.output?.statusCode === 429

            if (isRateLimit && attempt < MAX_RETRIES - 1) {
                const delay = RETRY_DELAYS[attempt]
                await new Promise(resolve => setTimeout(resolve, delay))
                continue
            }

            global.isFetchingGroups = false
            throw err
        }
    }

    global.isFetchingGroups = false
    throw new Error('Gagal fetch groups setelah beberapa percobaan')
}

function clearGroupCache(sock = null) {
    if (sock) cache.delete(keyOf(sock))
    else cache.clear()
}

export { fetchGroupsSafe, clearGroupCache }