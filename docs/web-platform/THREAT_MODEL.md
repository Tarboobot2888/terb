# THREAT_MODEL — Bot Terboo Web

نموذج التهديد لطبقة الموقع وحدها. كل بند: التهديد ⇒ ما يحدّ منه فعلاً ⇒ الإثبات.

## 1. حسابات المستخدمين وانتحال الرقم

| التهديد | الحدّ | الإثبات |
|---|---|---|
| انتحال رقم لا يملكه | إثبات الملكية عبر رمز يُرسَل إلى **محادثة واتساب** للرقم عبر مقبس البوت الحقيقي | `web-auth-otp` · `web-api-integration §5` |
| تخمين الرمز | 6 أرقام `crypto.randomInt`، HMAC-only، 5 محاولات ثم إبطال، TTL 5د | `web-auth-otp §5-7` |
| إعادة استعمال رمز | استعمال واحد، يُبطَل فور النجاح | `web-auth-otp §6` |
| تعداد الحسابات | رد ووقت موحّدان لرقم مسجّل/غير مسجّل/غير موجود؛ فشل التسليم رد واحد | `web-auth-otp §3`، `otp-service.deliverCode` |
| إغراق رقم آخر بالرموز | حد لكل رقم (5/س) + لكل عنوان (15/س) + عام (300/س) + تهدئة إعادة إرسال (60ث) | `web-auth-otp §8-9` |
| تسريب الرمز | لا يُسجَّل، لا يُعاد في أي رد، لا يصل واجهة المالك، HMAC فقط على القرص | `web-auth-otp §4` |

## 2. اختطاف الجلسة · CSRF · XSS

| التهديد | الحدّ | الإثبات |
|---|---|---|
| سرقة الجلسة من المخزن | المعرّف عشوائي معتم؛ المحفوظ على القرص **بصمته** (HMAC) | `session-service`، `web-api-integration §5` |
| session fixation | تدوير المعرّف بعد الدخول وعند ترقية الصلاحية | `session-service.rotateSession` |
| جلسة أبدية | خمول 60د + مطلق 24س + حد 5/مستخدم + إلغاء | `session-service` |
| CSRF | رمز مرتبط بالجلسة (double submit) + فحص Origin/Sec-Fetch على كل mutation، حتى قبل الجلسة | `web-api-integration §3,6` |
| XSS | CSP صارمة بلا سكربت مضمّن، React يهرّب النص، نتائج scraper تُعرض نصاً لا HTML | `web-static-and-assets §3` |
| token في localStorage | لا access/refresh token إطلاقاً؛ الجلسة في كوكي HttpOnly | `api.ts`، `web-api-integration §5` |
| إسقاط Secure عبر ترويسة | `Secure` يُحسب من الإعداد لا من `X-Forwarded-Proto` | `config.cookieSecure` |

## 3. تصعيد الصلاحية · IDOR · mass assignment

| التهديد | الحدّ | الإثبات |
|---|---|---|
| تزوير الدور في الجسم | `isOwner`/`role`/`canonical`/`jid` تُتجاهل؛ الدور من `config.is*` كل طلب | `web-api-integration §7` |
| مشرف مجموعة ⇒ مالك موقع | `WEB_ACTIONS` لا تمنح group-admin أي فعل إدارة عامة | `permission-service` matrix |
| قراءة/حذف مورد غيرك (IDOR) | ملكية صريحة؛ غير المملوك ⇒ 404 لا 403 | `web-api-integration §8-9,14` |
| كتابة حقل غير مسموح | `WRITABLE_PREFERENCES` (language فقط) · `sanitizeInput` يُهمل المجهول | `web-api-integration §6` |
| prototype pollution | رفض `__proto__`/`constructor`/`prototype` في جسم JSON | `server.parseJson` |
| حظر متجاوَز بجلسة قديمة | `isBanned` يُفحص كل طلب، والحظر يُلغي الجلسات | `web-api-integration §18` |

## 4. SSRF · redirect · اجتياز المسار · الرفع

| التهديد | الحدّ | الإثبات |
|---|---|---|
| SSRF إلى عنوان داخلي/ميتاداتا | `checkUrl` + `resolvePublic` قبل أي scraper | `web-api-integration §10`، `tool-service` |
| DNS rebinding | فحص DNS للعنوان؛ الإصلاح الجذري (تثبيت العنوان) في الـscrapers | `08#F-06` |
| اجتياز المسار | جذور مسموحة + `realpathSync` + رفض `..`/`\0`؛ 17 محاولة خام | `web-static-and-assets §4` |
| ملف تنفيذي باسم صورة | النوع من البايتات (`file-type`) لا الامتداد؛ رفض التنفيذيات | `upload-service`، `web-api-integration §9` |
| zip bomb · path في الاسم | حدود الحجم + `safeUnzip` (موجود) + اسم خادمي بحت | `upload-service`، `terboo-documents` |
| تخمين مسار ملف | تخزين خارج webroot بـid عشوائي؛ لا مسار في أي API | `web-api-integration §9` |

## 5. إساءة المزوّدات · حقن الأوامر · تسريب الذاكرة

| التهديد | الحدّ | الإثبات |
|---|---|---|
| استنزاف المزوّدات/التكلفة | حد لكل مستخدم (ai/tool/upload) + لكل مضيف خارجي + مهلة + قاطع دائرة | `rate-limit-service`، `tool-service` |
| prompt injection من ملف/scraper | النموذج لا يمنح صلاحية ولا ينفّذ؛ النوايا التنفيذية محجوبة؛ أدوات المالك مخفية | `05_AI_AND_TOOLS §9` |
| تسريب ذاكرة AI لغير صاحبها | قراءة بـ`digits` الخاص بالجلسة؛ لا ذاكرة غيره | `ai-service`، `me.js` |
| مهام عابرة بين المستخدمين | owner+scope على كل قراءة/إلغاء؛ لا `requester=null` | `task-service`، `web-api-integration §14` |

## 6. shell/SSH · جلسة بوت فرعي · host-header · TLS · DoS

| التهديد | الحدّ | الإثبات |
|---|---|---|
| تنفيذ shell من الويب | لا endpoint ينفّذ shell/eval/قراءة ملفات؛ المالك بقائمة أفعال بيضاء | `08#F-04`، `owner.js` |
| تسريب جلسة بوت فرعي | لا اقتران من الويب؛ عرض فقط بلا QR/رمز/مسار اعتماد | `subbot-service`، `web-api-integration §17` |
| host-header poisoning | الرابط من `publicBaseUrl` فقط؛ باني الروابط لا يلمس أي طلب | `web-domain-cta §5` |
| تسميم الدومين | لا اعتماد قبل تحقّق DNS TXT حقيقي | `web-domain-cta §2,12` |
| ادّعاء HTTPS كاذب | HTTP يُعلَن غير مشفَّر؛ TLS من ملف فعلي أو proxy | `web-domain-cta §7` |
| DoS/الحجم | حد جسم JSON (256KB) + رفع (64MB/حدود الوسائط) + 413 حقيقي + حد معدّل عام | `web-api-integration §11`، `server.readBody` |
| إسقاط البوت بخطأ HTTP | كل طلب معزول، المستمع لا يرمي للحلقة، بدء/إغلاق معزول | `server.listener`، `web/index.js` |

## 7. حدود النموذج المعروفة

- **DNS rebinding** (F-06): نظري حتى يمرّ جلب الـscrapers عبر `guardedRequest`.
- **حدود المعدّل لكل عملية:** مخزن الذاكرة ⇒ الحدود لعملية البوت الواحدة
  (الحالة المعتمدة). التوسّع لعدة عمليات يلزمه مخزن مشترك.
- **لا CAPTCHA:** الحماية من الأتمتة بالحدود متعددة المستويات والتهدئة؛ يمكن
  إضافة Turnstile لاحقاً عند الحاجة.
