# 06 — البيانات والهوية والصلاحيات والاحتفاظ

## 1. قاعدة بيانات البوت: العقد الحقيقي

`src/lib/terboo-database.js` — صنف `Database` واحد، مثيل واحد
(`initDatabase()` ثم `getDatabase()`؛ الثاني يرمي إن لم يُهيَّأ).

### 1.1 المخازن المحمَّلة

| المفتاح | الملف | الافتراضي | في `db.data` بعد `init()`؟ |
|---|---|---|---|
| users | `users.json` | `{}` | ✅ |
| groups | `groups.json` | `{}` | ✅ |
| settings | `settings.json` | `{selfMode:false}` | ✅ |
| stats | `stats.json` | `{}` | ✅ |
| sewa | `sewa.json` | `{enabled,groups}` | ✅ |
| premium | `premium.json` | `[]` | ✅ |
| owner | `owner.json` | `[]` | ✅ |
| partner | `partner.json` | `[]` | ❌ **لا** |

**عدم اتساق مُثبت:** `partner` يُحمَّل في `this.stores` لكنه **لا يُضاف إلى
`this.db.data`** في `init()` — يُضاف فقط داخل `resetToDefaults()`. النتيجة:
`db.partner` (الـgetter) يعيد `undefined` حتى يُستدعى reset. لم يُغيَّر هذا
السلوك؛ الموقع لا يعتمد عليه ويقرأ دور الشريك من `config.isPartner()` التي
تقرأ مصادرها الخاصة.

**مصدران للمميّزين:** مخزن `premium.json` من جهة، و
`db.setting("premiumUsers")` الذي يقرأه `index.js` إلى `config.premiumUsers`
من جهة أخرى. `config.isPremium()` هي الحاكم، والموقع لا يستعمل غيرها.

### 1.2 الكتابة ولماذا كاتب واحد

```
setX() ⇒ markDirty(key) ⇒ setInterval(5s) ⇒ flushDirty()
       ⇒ _asyncWrite(): كتابة <file>.tmp ثم rename  (ذرّية)
القراءة: this.db.data في الذاكرة + LRUCache(users: 2000/10د · groups: 500/10د)
الإغلاق: process.on("exit"/"beforeExit") ⇒ flushAll()
```

الحقيقة في الذاكرة لا في الملف. **عملية ثانية تقرأ الملف لا ترى كتابات البوت
غير المُفرَّغة، وكتابتها تُمحى عند أول flush.** لذلك الموقع في نفس العملية.

### 1.3 مفتاح المستخدم

```js
const cleanJid = jid.replace(/@.+/g, "");
if (cleanJid.length > 15 || cleanJid.startsWith("120")) return null;  // رفض المجموعات
```

المفتاح = **الأرقام وحدها**. الموقع يشتقّه من الهوية القانونية
(`identity.dbKey`) لا من مدخل المتصفح.

### 1.4 حقول سجل المستخدم (من `setUser`)

`jid · name · number · energi · isPremium · isBanned · exp · level · koin ·
saldo · unlockedFeatures · registeredAt · lastRegisteredAt ·
registrationCount · hasClaimedRegisterReward · unregisteredAt · lastSeen ·
cooldowns · clanId · isRegistered · regName · regAge · regGender · rpg ·
inventory · access` (+ `language` يكتبها محرّك اللغات)

الموقع يكتب **حقلاً واحداً**: `language` (عبر `normalizeLanguage` الرسمي).
و`setUser(dbKey, {name})` مرة واحدة عند أول دخول إن سمحت السياسة. لا شيء
آخر — لا دور ولا رصيد ولا طاقة ولا XP.

## 2. مخزن الموقع المستقل

`data/web/` (0700، كل ملف 0600، كتابة ذرّية، `schemaVersion: 1`، ترحيل
idempotent قبل أي قراءة، نسخة احتياطية عند التلف):

| الملف | المحتوى | الملكية | الاحتفاظ |
|---|---|---|---|
| `sessions.json` | **بصمة** معرّف الجلسة + canonical + انتهاء + CSRF secret | canonical | خمول 60د · مطلق 24س · 5 لكل مستخدم |
| `conversations.json` | محادثات الويب ورسائلها | `owner = canonical` | 60 محادثة · 200 رسالة · 8000 حرف |
| `artifacts.json` | وصف الملفات المرفوعة والناتجة | `owner = canonical` | `artifactTtlHours` (24 افتراضاً) |
| `domain.json` | الدومين · التحقق · رمز TXT | النظام | حتى التغيير |
| `audit.json` | سجل الأفعال الحساسة | — | آخر 2000 |
| `settings.json` | إعدادات وقت تشغيل | — | — |

الملفات المرفوعة نفسها في `data/web-uploads/<hmac(owner)>/<id>.<ext>` (0700/0600)
**خارج webroot تماماً**، والاسم خادمي بحت ولا جزء منه من مدخل المستخدم.
كلا المجلدين في `.gitignore`.

## 3. الهوية القانونية

`src/lib/terboo-identity.js` + `terboo-lid.js` (مخزن ربط واحد).

```
"+20 101 234 5678" ─ normalizePhone ─▶ "201012345678"
                                        │
                        jidFromDigits ──┤ يحترم ربط LID⇄PN المتعلَّم
                                        ▼
                     identityOf() ⇒ { kind, pn, lid, number, canonical, resolved }
                                        │
                     canonical = "pn:201012345678"  (أو "lid:…")
                     dbKey     = "201012345678"
```

### 3.1 ما يضمنه المحرّك

- **لا يُختلق رقم هاتف من LID أبداً**؛ هوية غير محلولة تبقى LID.
- المطابقة دقيقة: `samePhone` يطبّع ثم يقارن كاملاً — لا `includes` ولا
  `endsWith` (الخطأ القديم: `6512345678` "ينتهي به" `966512345678`).
- الربط يُتعلَّم من مصادر Baileys الرسمية فقط: `remoteJidAlt` ·
  `participantAlt` · `lid-mapping.update` · `signalRepository.lidMapping` ·
  حقول المشاركين.
- صيغة محلية (`01012345678`) تُفهم فقط إن عُرفت دولة البوت؛ وإلا **ترفض**
  (رفض آمن) — وهو ما يحدث حين `config.bot.number` فارغ.

### 3.2 PN/LID ومنع التكرار

تسجيل دخول الموقع يبدأ دائماً من **رقم هاتف مُثبت**، فالهوية `pn:<digits>`
و`dbKey = digits`. إن كان البوت قد سجّل الشخص بأرقام LID فسجلّه مفتاحه مختلف.
الموقع **لا يدمج ولا ينقل** Premium/energy/coins/XP بين مفتاحين: الدمج يحتاج
قاعدة ربط رسمية، وبغيرها يُعرض الحساب كما هو مع
`existsInBotDatabase: false` ورسالة صادقة للمستخدم.

### 3.3 ما لا يغادر الخادم

| | يُرسل للمتصفح؟ |
|---|---|
| `canonical` (`pn:<digits>`) | ❌ — يُستبدل بـ`accountRef = hmac(canonical).slice(0,24)` |
| رقم الهاتف الكامل | ❌ — `maskPhone` (آخر 4 أرقام) |
| أرقام أعضاء المجموعات | ❌ — `label` مُقنَّع أو الاسم |
| jid لاعبي الألعاب | ❌ — تُزال في `maskView` |
| معرّف الجلسة | يُرسل في كوكي `HttpOnly` فقط، والمحفوظ على القرص بصمته |
| مسار ملف مرفوع | ❌ — `downloadPath` فقط |
| أسماء مزوّدات الذكاء | للمالك فقط |

## 4. الأدوار: من يحكم ومتى

| الدور | المصدر | وقت القراءة |
|---|---|---|
| owner | `config.isOwner(pn)` ← config.owner.number + `db.data.owner` + `db.setting("ownerNumbers")` + رقم البوت | **كل طلب** |
| premium | `config.isPremium(pn)` | كل طلب |
| partner | `config.isPartner(pn)` | كل طلب |
| banned | `config.isBanned(pn)` ← `db.setting("bannedUsers")` | كل طلب |
| group-admin | بيانات المجموعة الحيّة عبر `terboo-group-directory` | كل إجراء مجموعة |
| bot-admin | نفس المصدر | كل إجراء مجموعة |

**لا شيء من هذه يُقرأ من جسم الطلب أو الكوكي أو الجلسة.** الجلسة تحمل
`canonical` و`digits` ولغة فقط. `webPrincipal(identity)` يعيد حسابها من
المصادر أعلاه في كل طلب، فالحظر أو تغيير الدور يسري فوراً دون انتظار انتهاء
الجلسة (واختبار التكامل يثبت ذلك).

## 5. جدول ملكية البيانات

| المورد | حقل الملكية | من يراه | من يحذفه |
|---|---|---|---|
| ملف المستخدم | `dbKey` من الهوية | صاحبه · المالك (مُقنَّعاً) | — |
| محادثة ويب | `owner = canonical` | صاحبها فقط (غيره ⇒ **404**) | صاحبها |
| ملف مرفوع/ناتج | `owner = canonical` | صاحبه فقط (غيره ⇒ **404**) | صاحبه · التنظيف الدوري |
| مهمة | `owner = canonical` + `scope = web:<canonical>` | صاحبها · المالك | صاحبها (إلغاء) |
| جلسة | `canonical` | صاحبها (مرجع مُقنَّع) | صاحبها · إلغاء المالك عند الحظر |
| غرفة لعب | `chat = web:<canonical>` | صاحبها | المحرّك |
| بوت فرعي | `ownerJid` من المدير | صاحبه · المالك | واتساب فقط |
| ذاكرة الذكاء | `digits` | صاحبها | صاحبها بتأكيد |
| سجل تدقيق | — | المالك | دوران تلقائي (2000) |
| إعداد الدومين | النظام | المالك | المالك |

**القاعدة:** أي سجل بلا ملكية موثوقة لا يُعرض. وغياب الملكية يُعاد دائماً
**404** لا 403، فلا يكشف وجود سجل لغيرك.

## 6. الاحتفاظ والحذف

| البيانات | المدة | الآلية |
|---|---|---|
| تحدّي OTP | 5 دقائق | **ذاكرة فقط** — لا يُكتب على القرص أبداً |
| جلسة | خمول 60د / مطلق 24س | `pruneSessions()` كل 10د + فحص كل قراءة |
| ملف مرفوع | 24 ساعة | `pruneArtifacts()` كل 10د (يحذف الملف والسجل) |
| محادثة | حتى الحذف · 60 لكل مستخدم · 200 رسالة | الأقدم يُحذف صريحاً ويُعاد في الرد |
| سجل تدقيق | آخر 2000 | دوران |
| ذاكرة الذكاء | TTL محرّك الذاكرة | غير متأثرة بالموقع |

## 7. الترحيل والتراجع

1. **لا migration على قاعدة البوت.** الموقع لم يضف أو يغيّر أي مخزن أو حقل
   فيها، فالتراجع لا يحتاج ترحيلاً عكسياً.
2. **مخزن الموقع جديد تماماً** بـ`schemaVersion: 1` وترحيل idempotent.
   حذف `data/web/` و`data/web-uploads/` يعيد الحالة إلى ما قبل الموقع بلا
   أي أثر على بيانات المستخدمين.
3. **`website.enabled = false`** يوقف كل شيء: لا منفذ ولا مخزن ولا زر في
   القائمة. البوت يعمل كما كان بالضبط.

التفاصيل التشغيلية في `DEPLOYMENT.md#rollback`.
