# 05 — نواة الذكاء والأدوات: ما يمرّ إلى الويب وما لا يمرّ

## 1. مسار القرار في البوت (كما هو)

```
رسالة واتساب
  └─ src/handler.js
       ├─ أمر ببادئة ⇒ terboo-command-dispatch ⇒ plugin.handler(m, {sock, text, …})
       └─ بلا بادئة (خاص · منشن · رد) ⇒ terboo-ai-core.js:runKernel(m, sock, db)
            ├─ preRoute()         سياق · ذاكرة · متابعات · تحكّم المالك
            ├─ intent gate        terboo-intent-gate.js:classify()  ← حتمي
            ├─ runKernelDecision  CHAT · COMMAND · TOOL · AGENT · MEMORY · OWNER …
            │     ├─ runCommandDecision ⇒ Dispatcher الحقيقي (الصلاحية فيه)
            │     ├─ runToolDecision    ⇒ terboo-tool-registry:runTool()
            │     └─ composeReply      ⇒ ask() ⇒ terboo-ai-router
            └─ التسليم: m.reply / m.react / replyWithButtons(m, sock, …)
```

`terboo-auto-ai.js` يشارك نفس النواة ويمنع الإجابة المزدوجة — هذا العقد لم
يُمسّ.

## 2. لماذا لا يستدعي الموقع `runKernel()`

`runKernel` **يسلّم الرد بنفسه** عبر `m.reply` ويبني أزرار Native Flow.
توقيعه `(m, sock, db)` يتطلّب رسالة مُسلسَلة حقيقية ومقبساً. استدعاؤه من
HTTP يعني تزييف `m` و`sock` — وهو ممنوع صراحةً، ويكسر الذاكرة والتسليم.

## 3. ما يستعمله الموقع فعلاً (نفس المكوّنات، لا نسخة ثانية)

| الملف | الدالة | ما تضمنه للويب |
|---|---|---|
| `terboo-ai-providers.js` | `ask(payload, routeHint, opts)` | `redactPayload` قبل أي مزوّد · بوابة الرؤية (`supportsVision`) · `enforceBrand` على الرد · fallback |
| | `loadProviders()` · `providerNames()` · `PROVIDER_CAPS` | حالة المزوّدات بالأسماء فقط |
| `terboo-ai-router.js` | `classifyAiTask` · `chooseProviderRoute` · `runRoutedChat` | نفس التوجيه و hedge والميزانية |
| `terboo-intent-gate.js` | `classify()` · `detectLanguage()` | نفس بوابة النوايا الحتمية |
| `terboo-brand.js` | `brandLockPrompt()` | قفل الهوية في تعليمات النظام |
| `terboo-ai-memory.js` | `factsOf` · `forget` · `forgetUserEverywhere` · `redact` | قراءة/نسيان ذاكرة المستخدم فقط — **لا كتابة من الويب** |
| `terboo-tool-registry.js` | `allTools` · `getTool` · `runTool` · `searchTools` · `healthOfTool` | تنفيذ واحد للأدوات |
| `terboo-scraper-registry.js` | `CATALOG` · `healthOf` · `isOpen` | مرجع وحالة صحة |
| `terboo-multimodal.js` / `terboo-documents.js` | عبر `runTool` | الحدود الحقيقية |
| `terboo-net-guard.js` | `checkUrl` · `resolvePublic` | حماية SSRF قبل أي scraper |
| `terboo-task-queue.js` | `enqueueTask` · `listTasks` · `cancelTask` | طابور واحد بملكية |
| `terboo-arcade/engine.js` | `createRoom` · `applyAction` · `getView` | محرّك ألعاب واحد |

## 4. النوايا الفعلية (20، من الكود لا من تقرير)

```
CHAT · QUESTION · COMMAND · TOOL · SEARCH · SCRAPER · VISION · AUDIO
VIDEO · DOCUMENT · IMAGE · CREATIVE · MEMORY · AGENT · OWNER · PROJECT
AUTOMATION · TASK_CONTROL · CLARIFICATION · REFUSAL
```

### سلوك الويب لكل مجموعة

| النوايا | سلوك الموقع |
|---|---|
| `CHAT` `QUESTION` `CREATIVE` | تُجاب عبر `ask()` بنفس التوجيه |
| `TOOL` `SCRAPER` `SEARCH` `IMAGE` `VISION` `AUDIO` `VIDEO` `DOCUMENT` | تُنفَّذ عبر `runTool` من صفحة الأدوات/الوسائط بمخطّط مدخلات صريح |
| `MEMORY` | قراءة/نسيان من `/me/memory` بتأكيد |
| `COMMAND` `AGENT` `OWNER` `PROJECT` `AUTOMATION` `TASK_CONTROL` | **لا تُنفَّذ** — يُعاد إرشاد صادق إلى واتساب (`executed: false`, `reason: "not-available-in-web"`) |
| `CLARIFICATION` `REFUSAL` | تمرّ كنص من المزوّد |

قائمة الحجب في `src/web/services/ai-service.js:WHATSAPP_ONLY_INTENTS`.

## 5. المزوّدات المهيّأة الآن

| المزوّد | رؤية؟ | ملاحظة |
|---|---|---|
| GPTVision | ✅ يرفع بايتات الصورة | `src/scraper/gpt52.js` |
| GeminiAPI | ✅ | `src/scraper/geminiVision.js` |
| GPT | ✗ نصّي | التاريخ يُطوى في النص |
| DeepSeek | ✗ نصّي | |
| **Claude** | — | **غير مهيَّأ**: لا مفتاح ⇒ لا يُحمَّل |

**الصدق عن الرؤية:** `ask()` يرشّح المزوّدات القادرة فعلاً حين توجد
`imageBuffer`، ويرمي `NO_VISION_PROVIDER` إن لم يوجد أي منها. الموقع يحوّله
إلى `PROVIDER_UNAVAILABLE` برسالة صريحة، **ولا يُنتَج وصف مُختلق للصورة**،
وزر الإرفاق نفسه معطَّل مع سبب حين لا توجد رؤية.

## 6. سجل الأدوات: 78 أداة

| الفئة | المصدر | عدد |
|---|---|---|
| scraper (محال إلى `runScraper`) | `terboo-scraper-registry.CATALOG` | 63 |
| محلية (وسائط/مستندات/ملفات) | `LOCAL_RUNNERS` | 11 |
| أسماء وسائط محالة إلى scraper | `MEDIA_TOOLS.target` | 4 |

### الأدوات المحلية ومخططاتها (المصدر: `MEDIA_TOOLS`)

| الأداة | مطلوب | مخرج | مهلة | حد |
|---|---|---|---|---|
| `image.describe` | image | text | 45s | 16MB |
| `image.ocr` | image | text | 90s | 16MB |
| `audio.transcribe` | audio | text | 120s | 25MB |
| `audio.tts` | text | audio | 60s | 1200 حرف |
| `video.inspect` | video | data | 30s | 64MB |
| `video.transcribe` | video | text | 180s | 64MB |
| `video.keyframes` | video | list | 90s | 64MB |
| `document.extract` | file | text | 180s | 100MB |
| `document.summarize` | file | text | 240s | 100MB |
| `file.inspect` | file | data | 10s | 100MB |
| `group.members` | — | data | 15s | **تحتاج واتساب** |

### حدود الوسائط الحقيقية (`terboo-multimodal.js:LIMITS`)

```
image    16MB · 40,000,000px · maxSide 2048
audio    25MB · 900s
video    64MB · 600s (quick 90s · 4 إطارات · deep 12)
document 100MB
ffmpeg timeout 120s · OCR timeout 90s · TTS 1200 حرف
```

هذه الأرقام تُعرض في الواجهة كما هي، ويُفرَض حدّها على الخادم قبل أي تحويل مكلف.

## 7. التحقق قبل التشغيل من الويب

```
POST /tools/:toolId/run
  1  getTool(id)                       أداة مجهولة ⇒ 404
  2  NEEDS_WHATSAPP?                   ⇒ 501 NOT_AVAILABLE_IN_WEB + سبب
  3  requirePermission(action)          decide() بسياسة الويب
  4  premium/owner                      فحص ثانٍ صريح
  5  limits.toolRuns(canonical)         حد ساعي لكل مستخدم
  6  sanitizeInput(tool, input)         حقل غير معروف يُهمل · مطلوب يُفرض
  7  checkUrl(url)                      مخطَّط · بيانات دخول · منفذ · مضيف داخلي · عنوان خاص
  8  resolvePublic(host)                كل عناوين DNS يجب أن تكون عامة
  9  limits.perExternalHost(host)       حد لكل مضيف
 10  runTool({ m: ctx, sock: null, deliver: false, signal })
 11  shapeResult()                      بلا مسار محلي وبلا بايتات خام
```

نتائج الـscraper **بيانات غير موثوقة**: تُعاد كقيم موصوفة، الروابط تُعلَن
`external: true` وتُفتح بـ`rel="noopener noreferrer nofollow"`، ولا يُنفَّذ
أي HTML مسترجَع ولا يُقدَّم رابط خارجي كملف محلي.

## 8. ذاكرة الذكاء ومحادثات الويب — مخزنان منفصلان

ذاكرة البوت مُشجَّرة بـ`private:<digits>` و`group:<gid>:<digits>`. الكتابة
فيها من الموقع تخلط محادثة الويب بمحادثة واتساب الخاصة لنفس الشخص. القرار:

| | المخزن | الوصول من الويب |
|---|---|---|
| محادثات الويب | `data/web/conversations.json` (schema v1، ملكية صريحة) | قراءة · إنشاء · تسمية · أرشفة · حذف — لصاحبها فقط |
| ذاكرة الذكاء | `database/memory/` عبر محرّك الذاكرة | **قراءة ونسيان فقط** (`factsOf` · `forget` · `forgetUserEverywhere`) |

نص كل رسالة محفوظة يمرّ على `redact()` من محرّك الذاكرة نفسه، فما يشبه سراً
لا يُحفظ. التاريخ المرسل للنموذج هو آخر 14 دوراً — نفس حدّ الذاكرة القصيرة.

## 9. حقن الأوامر عبر المحتوى (prompt injection)

نص OCR أو تفريغ صوت أو ناتج scraper أو مستند = **بيانات غير موثوقة**. ما
يحمي الموقع:

1. تعليمات النظام تُبنى على الخادم من `brandLockPrompt` + حدود القناة، ولا
   يصل العميل إليها.
2. النموذج **لا يمنح صلاحية ولا ينفّذ أمراً**: كل فعل يمرّ على
   `decide()`، والنوايا التنفيذية محجوبة أصلاً على الويب.
3. أدوات المالك لا تُدرَج لغير المالك — لا في القائمة ولا في البحث ولا في
   أي قائمة تُرسل للنموذج.
4. الأسرار تُعتَّم قبل الإرسال (`redactPayload`) وبعد الرد (`redactSecrets`
   في التدقيق).
