# 09 — خط الأساس للاختبارات (قبل أي تعديل)

قيس عند commit `fbbb969` (الـbaseline بعد استعادة المشروع وإصلاح أسماء
الملفات العربية، وقبل أي عمل على الموقع). الأمر: `node tools/terboo-run-tests.mjs`.

- Node: v22.22.0
- المجموع: **114** · نجح: **109** · فشل: **5** · live لم يُشغَّل: 3

## الفشل المسجَّل في خط الأساس

| الاختبار | النوع | السبب |
|---|---|---|
| `terboo-brand-assets` | **حقيقي ثابت** | `assets/image/shuffle/terboo-shuffle-03.jpg` غير موجود في الأرشيف |
| `terboo-typography` | **حقيقي ثابت** | "Inter لا يُستعمل داخل SVG" |
| `terboo-config-template` | عابر (ترتيب) | يمرّ منفرداً |
| `terboo-design` | عابر (ترتيب) | يمرّ منفرداً |
| `terboo-no-silent-catch` | عابر (ترتيب) | يمرّ منفرداً |

**ملاحظة عن مُشغّل الدفعات:** `tools/terboo-run-tests.mjs` يشغّل 114 اختباراً
في تسلسل واحد، وبعضها يتقاسم حالة في العملية، فتتغيّر مجموعة الفشل بين تشغيل
وآخر. التشغيل المنفرد هو الحكم: الثابت الوحيد عبر كل التشغيلات هو العطلان
الحقيقيان (`brand-assets` و`typography`)، وكلاهما سابق للموقع ولا علاقة له به.

## أوامر التشغيل

```bash
npm run test:syntax     # نحو + رسم الاستيراد
npm run test:local      # كل الاختبارات المحلية (114 في الأساس)
npm run audit:strict    # تدقيق (صفر مخالفات)
npm run lint
# غير مُشغَّل تلقائياً (يحتاج شبكة/مفاتيح/إذن):
#   npm run test:live · tools/terboo-scraper-live.mjs
```

النتيجة النهائية بعد العمل في `TEST_REPORT.md` و`TEST_RESULTS.json`.
