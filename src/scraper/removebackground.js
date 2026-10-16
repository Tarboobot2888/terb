import fs from 'fs'
async function pixa(img) {
  const form = new FormData()
  form.append('image', new Blob([fs.readFileSync(img)], { type: 'image/jpeg' }), img.split('/').pop())
  form.append('format', 'png')
  form.append('model', 'v1')

  const res = await fetch('https://api2.pixelcut.app/image/matte/v1', {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
      'x-locale': 'en',
      'x-client-version': 'web:pixa.com:4a5b0af2',
      'sec-ch-ua-mobile': '?1',
      'sec-ch-ua-platform': '"Android"',
      'origin': 'https://www.pixa.com',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
      'sec-fetch-dest': 'empty',
      'referer': 'https://www.pixa.com/',
      'accept-language': 'id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6'
    },
    body: form
  })

  // صفحة خطأ (4xx/5xx أو نص) ليست صورة: لا تُرسل للمستخدم كنتيجة (v4 §41 — لا نجاح مزيّف)
  const type = res.headers.get('content-type') || ''
  if (!res.ok || !/^image\//i.test(type)) {
    const detail = (await res.text().catch(() => '')).slice(0, 120)
    throw new Error(`pixa HTTP ${res.status} ${type || 'no content-type'}${detail ? `: ${detail}` : ''}`)
  }
  return Buffer.from(await res.arrayBuffer())
}

export { pixa }