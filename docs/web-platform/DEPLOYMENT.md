# DEPLOYMENT — تشغيل Bot Terboo Web

> الموقع يُستضاف **داخل عملية البوت**. تشغيل البوت كالمعتاد يشغّل الموقع إن
> كان `website.enabled = true`. لا عملية ثانية ولا كاتب ثانٍ على قاعدة
> البيانات.

## 1. المتطلبات

- Node.js `>= 22` (نفس متطلب البوت).
- اعتماديات البوت مثبّتة: `npm ci`.
- للبناء الأمامي فقط: `npm run web:install` (قفل `web/package-lock.json`
  مستقل — لا يُسحب إلى تشغيل البوت).

## 2. أول تشغيل

```bash
# 1) اعتماديات البوت
npm ci

# 2) الإعداد الحيّ (إن لم يوجد): انسخ القالب واملأ أرقام المالك والمفاتيح
cp config.example.js config.js   # ثم حرّره

# 3) بناء الواجهة إلى web/dist
npm run web:install
npm run web:build

# 4) فعّل الموقع في config.js:
#    website: { enabled: true, host: "127.0.0.1", port: 3000,
#               publicBaseUrl: "", domain: "", tlsMode: "proxy" }

# 5) شغّل البوت (يشغّل الموقع تلقائياً بعد قاعدة البيانات والإضافات)
npm start
```

عند الإقلاع ترى: `الموقع يستمع على 127.0.0.1:3000 · الحالة: …`. الجاهزية
(`/api/v1/health/ready`) لا تصبح `ready` إلا بعد فتح المنفذ فعلاً.

## 3. أوامر npm

| الأمر | ماذا يفعل |
|---|---|
| `npm start` | البوت + الموقع (production) |
| `npm run dev` | البوت + الموقع (development، hot-reload للإضافات) |
| `npm run web:build` | يبني الواجهة إلى `web/dist` |
| `npm run web:dev` | خادم Vite على 5173 يوكّل `/api` و`/brand` إلى منفذ البوت |
| `npm run web:typecheck` | فحص أنواع TypeScript |
| `npm run test:web` | اختبارات الموقع الأربعة فقط |
| `npm test` | `test:local && audit:strict && lint` (كل اختبارات البوت) |

## 4. التطوير

```bash
# طرفية 1: البوت + API على 3000
npm run dev
# طرفية 2: واجهة Vite على 5173 (توكيل /api و/brand إلى 3000)
npm run web:dev
```

افتح `http://localhost:5173`. للتطوير اضبط `website.tlsMode = "disabled"`
حتى يسمح الكوكي بلا HTTPS و`localhost` أصلاً مقبولاً.

## 5. الإنتاج خلف reverse proxy (موصى به)

الموقع على HTTP داخلي (`127.0.0.1:3000`)، والـTLS ينتهي عند Caddy/Nginx.
`website.tlsMode = "proxy"` و`trustProxy = true` و`proxyAllowlist = ["127.0.0.1","::1"]`.

### Caddy

```
bot.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name bot.example.com;
    ssl_certificate     /etc/letsencrypt/live/bot.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/bot.example.com/privkey.pem;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

ثم في `config.js`: `publicBaseUrl: "https://bot.example.com"`،
`domain: "bot.example.com"`. تفاصيل الدومين والشهادة في `DOMAIN_AND_TLS.md`.

## 6. مدير العمليات

```ini
# systemd: /etc/systemd/system/bot-terboo.service
[Service]
WorkingDirectory=/opt/bot-terboo
ExecStart=/usr/bin/node index.js
Environment=NODE_ENV=production
Restart=on-failure
# الأسرار من البيئة (تتغلّب على config.secrets):
EnvironmentFile=/opt/bot-terboo/.env
```

`SIGTERM`/`SIGINT` يُغلقان الموقع أولاً (المنفذ يُغلق، الاتصالات الحيّة
تُنهى بمهلة 5ث) ثم يُحفظ كل شيء — إغلاق الموقع **لا يؤخّر** حفظ بيانات البوت.

## 7. الجدار الناري والمنافذ

- خلف proxy: افتح 80/443 **للـproxy فقط**، وأبقِ منفذ الموقع الداخلي (3000)
  على `127.0.0.1` غير معرَّض.
- تعرّض مباشر (غير موصى به): `host: "0.0.0.0"`، منفذ `>= 1024` (الإعداد يرفض
  منافذ النظام)، وشهادة فعلية (`tlsMode: "direct"`) وإلا يُعلَن HTTP غير آمن.

## 8. النسخ الاحتياطي

| ما يُنسخ | المسار | ملاحظة |
|---|---|---|
| بيانات المستخدمين | `database/` | يملكها البوت؛ انسخها وهو متوقف أو بعد `db.backup()` |
| حالة الموقع | `data/web/` | جلسات ومحادثات وتدقيق ودومين |
| ملفات مرفوعة | `data/web-uploads/` | عابرة (24س)؛ النسخ اختياري |
| الأسرار | `config.js` + `data/secure/` | **لا تضعها في Git** |

## 9. السجلّات والمراقبة

- `/api/v1/health/live` — نبض.
- `/api/v1/health/ready` — جاهزية حقيقية (منفذ + مخزن).
- لوحة المالك → نظرة عامة: حالة، صحة، طابور، ذاكرة، تحديات دخول.
- سجل التدقيق (`data/web/audit.json`) لكل فعل حساس، منقّح من الأسرار.

## 10. الرجوع (rollback) {#rollback}

مرتّب من الأخف إلى الأكمل — بلا أي خطر على بيانات المستخدمين:

1. **تعطيل فوري:** `.موقع ايقاف` (مالك) يغلق المنفذ حالاً. البوت يكمل.
2. **تعطيل دائم:** `website.enabled = false` في `config.js` + إعادة تشغيل.
   لا منفذ، لا زر في القائمة، البوت كما كان بالضبط.
3. **إزالة حالة الموقع:** احذف `data/web/` و`data/web-uploads/`. تعود الحالة
   إلى ما قبل الموقع بلا أثر على `database/` (مخزن منفصل، `schemaVersion`).
4. **رجوع الكود:** `git revert` لـcommits الموقع. لا migration على قاعدة
   البوت ⇒ لا ترحيل عكسي مطلوب. إصلاح أسماء الملفات العربية (`fbbb969`)
   **لا تُرجعه** — إرجاعه يكسر تحميل 15 إضافة والقائمة الرئيسية.

## 11. متغيّرات البيئة (أسماء فقط)

تتغلّب على `config.secrets`. الموقع يضيف:

| المتغيّر | الغرض |
|---|---|
| `WEBSITE_SESSION_SECRET` | سر توقيع الجلسات/الرموز (وإلا يُولَّد في `data/secure/website-session.key`) |

وكل أسماء `config.secrets` القائمة (مفاتيح المزوّدات) كما هي. لا قيمة منها
في أي ملف متتبَّع ولا في مخرجات بناء الواجهة.
