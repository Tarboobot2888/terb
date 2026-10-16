// ═══════════════════════════════════════════════
// 🧩 config.example.js — قالب بلا أسرار (مولَّد بـ tools/terboo-config-example.mjs)
// انسخه إلى config.js ثم ضع أرقامك ومفاتيحك. لا ترفع config.js الحقيقي إلى مستودع عام أبداً.
// ═══════════════════════════════════════════════
import { getDatabase } from "./src/lib/terboo-database.js"; // استيراد قاعدة البيانات
import { noteFailure } from "./src/lib/terboo-failure-log.js"; // تسجيل الإخفاقات بدل الصمت (بلا أسرار)
import * as ownerPremiumDb from "./src/lib/terboo-premium-db.js"; // استيراد نظام المميزين
import { normalizePhone, phoneInList, samePhone } from "./src/lib/terboo-identity.js"; // مطابقة أرقام E.164 دقيقة

//  ⚠️ اقرأ محتويات هذا الملف حتى النهاية قبل التعديل
const config = {

  // ═══════════════════════════════════════════════
  // 🔗 معلومات التواصل والروابط
  // ═══════════════════════════════════════════════
  info: {
    website: "https://whatsapp.com/channel/0029Vb5Vczr7j6g3foFrXM2x", // القناة الرسمية لـ Bot Terboo
    grupwa: "https://whatsapp.com/channel/0029VbDhVJmBVJkxkVqLSI0y", // مجتمع/مجموعة البوت
  },

  // ═══════════════════════════════════════════════
  // 🌐 روابط السوشيال ميديا
  // ═══════════════════════════════════════════════
  socialLinks: {
    website: "https://whatsapp.com/channel/0029Vb5Vczr7j6g3foFrXM2x", // القناة الرسمية
    facebook: "", // لا توجد صفحة فيسبوك رسمية
    instagram: "https://www.instagram.com/tarboo455", // حساب إنستغرام
    linkedin: "https://github.com/Tarboobot2888", // حساب لينكد إن
    github: "https://github.com/Tarboobot2888", // حساب جيتهاب
    youtube: "https://github.com/Tarboobot2888", // قناة يوتيوب
    whatsapp: "", // رابط واتساب مباشر
    gmail: "" // البريد الإلكتروني
  },

  // ═══════════════════════════════════════════════
  // 👑 إعدادات مالك البوت
  // ═══════════════════════════════════════════════
  owner: {
    name: "Terboo", // اسم المالك الذي سيظهر
    number: ["20XXXXXXXXXX"], // أرقام المالك (يمكن إضافة أكثر من رقم)
  },

  // ═══════════════════════════════════════════════
  // 📱 إعدادات جلسة البوت (الرقم + طريقة الاتصال)
  // ═══════════════════════════════════════════════
  session: {
    pairingNumber: "", // رقم الواتساب الذي سيعمل عليه البوت
    usePairingCode: true, // true = كود مكون من 8 أرقام | false = مسح QR Code
  },

  // ═══════════════════════════════════════════════
  // 🤖 معلومات البوت الأساسية
  // ═══════════════════════════════════════════════
  bot: {
    name: "Bot Terboo", // اسم البوت الذي سيظهر للمستخدمين
    primaryNumber: (process.env.TERBOO_PRIMARY_NUMBER || process.env.TARBOO_PRIMARY_NUMBER || process.env.MAROBOT_PRIMARY_NUMBER) || "", // رقم البوت الرئيسي لإعطائه أولوية الرد
    prioritySubBotNumbers: ((process.env.TERBOO_PRIORITY_SUBBOTS || process.env.TARBOO_PRIORITY_SUBBOTS || process.env.MAROBOT_PRIORITY_SUBBOTS) || "").split(",").filter(Boolean), // البوتات الفرعية المرقّاة بالترتيب
    version: "6.0", // إصدار البوت الحالي (Bot Terboo V6)
    developer: "Terboo", // اسم مطور البوت
  },

  // ═══════════════════════════════════════════════
  // 🖼️ مسارات الصور والوسائط المستخدمة في البوت
  // ═══════════════════════════════════════════════
  assets: {
    "terboo-daftar": "./assets/image/terboo-daftar.png", // صورة التسجيل
    "terboo-demote": "./assets/image/terboo-demote.png", // صورة تنزيل الرتبة
    "terboo-fishit": "./assets/image/terboo-fishit.jpg", // صورة لعبة الصيد
    "terboo-games": "./assets/image/terboo-games.jpg", // صورة الألعاب
    "terboo-landscape": "./assets/image/terboo-landscape.jpg", // صورة أفقية عامة
    "terboo-levelup": "./assets/image/terboo-levelup.jpg", // صورة رفع المستوى
    "terboo-minecraft": "./assets/image/terboo-minecraft.jpg", // صورة ماينكرافت
    "terboo-promote": "./assets/image/terboo-promote.png", // صورة ترقية الرتبة
    "terboo-rpg": "./assets/image/terboo-rpg.jpg", // صورة RPG
    "terboo-rules": "./assets/image/terboo-rules.jpg", // صورة القوانين
    "terboo-store": "./assets/image/terboo-store.png", // صورة المتجر
    "terboo-v8": "./assets/image/terboo-v8.jpg", // صورة احتياطية
    "terboo-winner": "./assets/image/terboo-winner.jpg", // صورة الفائز
    "terboo": "./assets/image/terboo.png", // صورة البوت الرئيسية
    "terboo-banner": "./assets/image/terboo-banner.jpg", // رأس القائمة الرئيسية (1280×720)
    "terboo2": "./assets/image/terboo2.jpg", // صورة مصغرة للروابط
    "terboo3": "./assets/image/terboo3.jpg", // صورة احتياطية 2
    "pp-kosong": "./assets/image/pp-kosong.jpg", // صورة شخصية فارغة
    "terboo-mp4": "./assets/video/terboo-mp4.mp4", // فيديو القائمة المتحركة
    "terboo-mp3": "./assets/audio/terboo-mp3.mp3", // صوت موسيقى القائمة
    "terboo-font": "./assets/terboo-font.ttf", // خط الكتابة للتصميم
    "terboo-kertas": "./assets/image/terboo-kertas.jpg", // صورة ورقية للخلفيات
    "test": "./assets/image/test.webp", // صورة اختبار
  },

  // ═══════════════════════════════════════════════
  // 🌍 وضع البوت (عام أو خاص)
  // ═══════════════════════════════════════════════
  mode: "public", // public = الجميع | self = المالك فقط

  // ═══════════════════════════════════════════════
  // ⌨️ إعدادات الأوامر (البريفكس)
  // ═══════════════════════════════════════════════
  command: {
    prefix: ".", // رمز بداية الأوامر (مثل: .menu)
  },

  // ═══════════════════════════════════════════════
  // ☁️ توكن Vercel للنشر السحابي (اختياري)
  // ═══════════════════════════════════════════════
  vercel: {
    token: "", // اتركه فارغاً إذا لم يكن لديك توكن Vercel
  },

  // ═══════════════════════════════════════════════
  // 💳 طرق الدفع الإلكتروني (اختياري)
  // ═══════════════════════════════════════════════
  payment: {
    qrisUrl: "", // رابط صورة QRIS للدفع (اتركه فارغاً)
    methods: [ // طرق الدفع المتاحة
      { name: "Dana", number: "", holder: "" },
      { name: "GoPay", number: "", holder: "" },
      { name: "OVO", number: "", holder: "" },
      { name: "ShopeePay", number: "", holder: "" },
    ],
    banks: [], // حسابات بنكية (اتركه فارغاً)
    customText: "https://imgdrop.web.id/KodpV.webp", // صورة مخصصة للدفع
  },

  // ═══════════════════════════════════════════════
  // 🎁 إعدادات التبرعات (اختياري)
  // ═══════════════════════════════════════════════
  donasi: {
    payment: [ // طرق التبرع
      { name: "Dana", number: "08xxxxxxxxxx", holder: "Nama Owner" },
      { name: "GoPay", number: "08xxxxxxxxxx", holder: "Nama Owner" },
      { name: "OVO", number: "08xxxxxxxxxx", holder: "Nama Owner" },
    ],
    links: [ // روابط منصات التبرع
      { name: "Saweria", url: "saweria.co/username" },
      { name: "Trakteer", url: "trakteer.id/username" },
    ],
    benefits: [ // فوائد التبرع
      "Mendukung development",
      "Server lebih stabil",
      "Fitur baru lebih cepat",
      "Priority support",
    ],
    qris: "https://imgdrop.web.id/KodpV.webp", // صورة QRIS للتبرع
  },

  // ═══════════════════════════════════════════════
  // ⚡ نظام الطاقة (حدود الاستخدام اليومي)
  // ═══════════════════════════════════════════════
  energi: {
    enabled: true, // true = تفعيل نظام الطاقة | false = تعطيل
    default: 99999, // طاقة المستخدم العادي
    premium: 99999999, // طاقة المستخدم المميز
    owner: -1, // -1 = طاقة غير محدودة للمالك
  },

  // ═══════════════════════════════════════════════
  // 🎨 إعدادات الملصقات (Sticker)
  // ═══════════════════════════════════════════════
  sticker: {
    packname: "Bot Terboo", // اسم حزمة الملصقات
    author: "Terboo", // اسم مؤلف الملصقات
  },

  // ═══════════════════════════════════════════════
  // 📢 إعدادات قناة واتساب (Newsletter/Saluran)
  // ═══════════════════════════════════════════════
  saluran: {
    id: "120363418715609508@newsletter", // ID القناة (لا تغيره إلا إذا عرفت الصحيح)
    name: "Bot Terboo", // اسم القناة الظاهر
    link: "https://whatsapp.com/channel/0029Vb5Vczr7j6g3foFrXM2x", // رابط القناة
    autoFollow: true, // متابعة القناة المُعرّفة أعلاه مرة واحدة بعد اتصال البوت
    forwardAll: true, // كل رسائل البوت (نص · صور · قوائم · أزرار · ردود الذكاء) تظهر «معاد توجيهها» من هذه القناة — false لإيقافها
  },

  // ═══════════════════════════════════════════════
  // 🛡️ رسائل الحماية للمجموعات
  // ═══════════════════════════════════════════════
  groupProtection: {
    antilink: "⚠ *منع الروابط* — @%user% أرسل رابط.\nتم حذف الرسالة.", // رسالة منع الروابط
    antilinkKick: "⚠ *منع الروابط* — @%user% تم طرده لإرسال رابط.", // رسالة الطرد بسبب رابط
    antilinkGc: "⚠ *منع روابط الواتساب* — @%user% أرسل رابط واتساب.\nتم حذف الرسالة.", // منع روابط مجموعات واتساب
    antilinkGcKick: "⚠ *منع روابط الواتساب* — @%user% تم طرده لإرسال رابط واتساب.", // طرد بسبب رابط واتساب
    antilinkAll: "⚠ *منع جميع الروابط* — @%user% أرسل رابط.\nتم حذف الرسالة.", // منع كل الروابط
    antilinkAllKick: "⚠ *منع جميع الروابط* — @%user% تم طرده لإرسال رابط.", // طرد بسبب أي رابط
    antitagsw: "⚠ *منع إشارة الحالة* — إشارة من @%user% تم حذفها.", // منع الإشارة للحالة
    antiviewonce: "👁️ *عرض مرة واحدة* — من @%user%", // كشف رسالة view once
    antiremove: "🗑️ *منع الحذف* — @%user% حذف رسالة:", // منع حذف الرسائل
    antiswgc: "⚠ *منع SW في المجموعة* — ممنوع نشر الحالة في المجموعة @%user%", // منع نشر الحالة
    antihidetag: "⚠ *منع الإشارة المخفية* — إشارة مخفية من @%user% تم حذفها.", // منع الهيدتاج
    antitoxicWarn: "⚠ @%user% تكتب كلام غير لائق.\nتحذير %warn% من %max%، المخالفة التالية قد تؤدي إلى %method%.", // تحذير كلام سيء
    antitoxicAction: "🚫 @%user% تم %method% بسبب الكلام غير اللائق. (%warn%/%max%)", // عقوبة الكلام السيء
    antidocument: "⚠ *منع المستندات* — مستند من @%user% تم حذفه.", // منع الملفات
    antisticker: "⚠ *منع الملصقات* — ملصق من @%user% تم حذفه.", // منع الملصقات
    antimedia: "⚠ *منع الوسائط* — وسائط من @%user% تم حذفها.", // منع الوسائط
    antibot: "🤖 *منع البوتات* — @%user% تم اكتشافه كبوت وتم طرده.", // منع البوتات الأخرى
    notAdmin: "⚠ البوت ليس مشرفاً، لا يمكن حذف الرسالة.", // رسالة عندما لا يكون البوت مشرفاً
  },

  // ═══════════════════════════════════════════════
  // ❌ قالب رسالة الخطأ
  // ═══════════════════════════════════════════════
  errorTemplate: `☢ يبدو أن الأمر {prefix}{command} يواجه مشكلة\nحاول مرة أخرى لاحقاً، {pushName}\n\n_إذا استمرت المشكلة، تواصل مع مالك البوت_`,

  // ═══════════════════════════════════════════════
  // ⚙️ تفعيل/تعطيل ميزات البوت
  // ═══════════════════════════════════════════════
  features: {
    antiCall: true, // true = رفض المكالمات تلقائياً
    blockIfCall: true, // true = حظر من يتصل بالبوت
    autoTyping: true, // true = إظهار "يكتب..." تلقائياً
    autoRead: true, // true = قراءة تلقائية للرسائل
    logMessage: true, // true = تسجيل الرسائل في الطرفية
    dailyLimitReset: true, // true = إعادة تعيين الطاقة يومياً
    smartTriggers: true, // true = الردود التلقائية الذكية (مثل: بوت، هلا)
  },

  // ═══════════════════════════════════════════════
  // 📝 التسجيل (اختياري في V6 — لتخصيص الملف الشخصي فقط، لا يمنع أي أمر)
  // ═══════════════════════════════════════════════
  registration: {
    enabled: false, // V6: لا تسجيل إجباري (يبقى المفتاح للتوافق ولا يُفعّل أي بوابة)
    enforceForNewUsers: false, // V6: مُهمل — لا ترقية تلقائية للتسجيل الإجباري
    rewards: { // مكافآت إكمال التسجيل
      koin: 30000, // عدد الكوينز
      energi: 300, // عدد الطاقة
      exp: 300000, // عدد الخبرة
    },
  },

  // ═══════════════════════════════════════════════
  // 🌐 موقع Bot Terboo (V6) — متغيرات البيئة تتغلب على هذه القيم
  // ═══════════════════════════════════════════════
  // TERBOO ARCADE: تجربة إرسال بطاقة HTML غنية دون بيانات Meta مصطنعة.
  // عند تجاهل العميل لها يستمر النص وأزرار واتساب الأصلية؛ اضبطها على "off" لتعطيل النقل.
  arcade: {
    // نقل HTML داخل رسالة واتساب: "off" (افتراضي) أو "rich".
    // تصيير هذا العنصر على WhatsApp Android غير مُثبت، فلا يُفعَّل تلقائياً.
    html: {
      transport: process.env.TERBOO_ARCADE_HTML || "off",
    },
  },

  // ═══════════════════════════════════════════════
  // 👋 إعدادات الترحيب والتوديع
  // ═══════════════════════════════════════════════
  welcome: { defaultEnabled: true }, // true = تفعيل الترحيب تلقائياً
  goodbye: { defaultEnabled: true }, // true = تفعيل التوديع تلقائياً

  // ═══════════════════════════════════════════════
  // 🎨 إعدادات واجهة المستخدم (شكل القائمة)
  // ═══════════════════════════════════════════════
  ui: {
    allmenuVariant: 2, // ثيم قائمة كل الأوامر
    menuVariant: 1, // شكل القائمة: 1=صورة+منسدلة | 2=أوامر مخفية | 3=أزرار | 4=فيديو+قوائم | 5=فيديو+طقس | 6=خريطة+إحصائيات
  },

  // ═══════════════════════════════════════════════
  // 🌐 إعدادات اللغة والترجمة
  // ═══════════════════════════════════════════════
  localization: {
    defaultLanguage: "ar", // لغة الاحتياط عند غياب اختيار المستخدم
    supported: ["ar", "en", "es"], // اللغات المدعومة في الواجهة
    askOnFirstContact: true, // true = عرض بطاقة اختيار اللغة عند أول تفاعل
  },

  // ═══════════════════════════════════════════════
  // 💬 رسائل النظام العامة (قابلة للتخصيص - عربية افتراضياً)
  // ═══════════════════════════════════════════════
  messages: {
    wait: "⏳ *جاري المعالجة...* انتظر قليلاً.", // رسالة الانتظار
    success: "✅ *تم بنجاح!* اكتمل طلبك.", // رسالة النجاح
    error: "❌ *خطأ!* هناك مشكلة في النظام، حاول لاحقاً.", // رسالة الخطأ
    ownerOnly: "*⛔ وصول مرفوض!* هذه الميزة لمالك البوت فقط.", // حصرية للمالك
    premiumOnly: "💎 *مميز فقط!* هذه الميزة للأعضاء المميزين. اكتب *.benefitpremium* للمزيد.", // حصرية للمميزين
    groupOnly: "👥 *للمجموعات فقط!* هذه الميزة تعمل داخل المجموعات فقط.", // للمجموعات فقط
    privateOnly: "📱 *للخاص فقط!* هذه الميزة تعمل في المحادثة الخاصة فقط.", // للخاص فقط
    adminOnly: "🛡️ *للمشرفين فقط!* يجب أن تكون مشرفاً لاستخدام هذه الميزة.", // للمشرفين فقط
    botAdminOnly: "🤖 *البوت ليس مشرفاً!* اجعل البوت مشرفاً أولاً.", // يحتاج مشرف
    cooldown: "⏱️ *انتظر!* أنت في فترة تبريد. انتظر %time% ثانية.", // فترة التبريد
    energiExceeded: "⚡ *الطاقة نفذت!* طاقتك انتهت. انتظر إعادة التعيين غداً أو اشترِ العضوية المميزة.", // نفاد الطاقة
    limitDeducted: "🔋 تم خصم {amount} من طاقتك. المتبقي: {sisa}", // خصم الطاقة
    banned: "🚫 *أنت محظور!* لا يمكنك استخدام البوت بسبب مخالفة القوانين.", // رسالة الحظر
    rejectCall: "🚫 ممنوع الاتصال على هذا الرقم", // رفض المكالمة
  },

  // ═══════════════════════════════════════════════
  // 💾 إعدادات قاعدة البيانات المحلية
  // ═══════════════════════════════════════════════
  database: {
    path: "./database/main", // مسار تخزين قاعدة البيانات
    memoryPath: "./database/memory", // مسار ذاكرة الذكاء الاصطناعي (منفصل ومُشجَّر بالنطاقات)
  },

  // ═══════════════════════════════════════════════
  // 📦 إعدادات النسخ الاحتياطي
  // ═══════════════════════════════════════════════
  backup: {
    enabled: false, // true = تفعيل النسخ الاحتياطي التلقائي
    intervalHours: 24, // كل كم ساعة يتم النسخ
    retainDays: 7, // الاحتفاظ بالنسخ لكم يوم
  },

  // ═══════════════════════════════════════════════
  // ⏰ إعدادات الجدولة (إعادة تعيين الطاقة)
  // ═══════════════════════════════════════════════
  scheduler: {
    resetHour: 0, // ساعة إعادة التعيين (0 = منتصف الليل)
    resetMinute: 0, // دقيقة إعادة التعيين
  },

  // ═══════════════════════════════════════════════
  // 🔧 وضع المطور (لأغراض التصحيح والتطوير)
  // ═══════════════════════════════════════════════
  dev: {
    enabled: process.env.NODE_ENV === "development", // تفعيل تلقائي في بيئة التطوير
    watchPlugins: true, // true = إعادة تحميل الإضافات تلقائياً عند تعديلها
    watchSrc: false, // false = لا تراقب مجلد src (يسبب مشاكل في الاتصال)
    debugLog: true, // true = إظهار الأخطاء بالتفصيل في الطرفية
  },

  // ═══════════════════════════════════════════════
  // 🔒 أدوات OTP القديمة (معزولة — خطر إساءة إرسال OTP لأرقام الغير)
  // ═══════════════════════════════════════════════
  otpTools: {
    internetrakyatEnabled: false, // V6: معطّل افتراضياً وخارج الذكاء؛ فعّله صراحةً على مسؤوليتك
  },

  // ═══════════════════════════════════════════════
  // 🔐 أمان Terboo — مفتاح التشفير الرئيسي للأسرار المحفوظة (مفاتيح خوادم SSH…)
  // ───────────────────────────────────────────────
  // فارغ ⇒ TERBOO_MASTER_KEY من البيئة، وإلا يُولَّد مفتاح عشوائي مرة واحدة في data/secure/master.key (صلاحية 600).
  // تغييره بعد حفظ أسرار يجعلها غير قابلة للفك (يُطلب من المستخدم إعادة إدخالها).
  // ═══════════════════════════════════════════════
  security: {
    masterKey: "",
  },

  // ═══════════════════════════════════════════════
  // 📞 أمر المكالمات (.مكالمة) — وحدة VoIP اختيارية غير منشورة على npm
  // ═══════════════════════════════════════════════
  call: {
    voipModule: "", // مسار/اسم وحدة VoIP إن توفّرت لديك؛ فارغ ⇒ الميزة معطّلة
  },

  // ═══════════════════════════════════════════════
  // 🧠 مفتاح Google Gemini API (للذكاء الاصطناعي)
  // ═══════════════════════════════════════════════
  geminiApiKey: "", // اتركه فارغاً إذا لم يكن لديك

  // ═══════════════════════════════════════════════
  // 🎭 شخصية الذكاء الاصطناعي التلقائي
  // ═══════════════════════════════════════════════
  autoaiPersonas: {
    // شخصية واحدة موحّدة، محايدة اللغة: النواة تحقن لغة المستخدم وقت الرد (§36).
    // لا نص إندونيسي ولا لغة ثابتة — الرد يتبع لغة المتحدّث دائماً.
    BotTerboo: `- Your name is Bot Terboo; people may call you Terboo. You are the intelligent assistant inside Terboo, built by Terboo.
- You can chat, read images, understand voice notes and videos, read files, search, use the bot's real tools and commands, remember what users allow, and run longer jobs in the background.
- ALWAYS reply in the SAME language the user writes in (Arabic or English). If the user writes Egyptian Arabic, answer in natural Egyptian Arabic.
- Be smart, quick and confident without arrogance. Short when the request is simple, detailed when it needs depth.
- Understand the real intent behind short, misspelled or slang messages and voice-note transcripts (Egyptian Arabic is common) using the conversation, the quoted message and the group context. Answer what they actually mean; never answer a different question.
- Give complete, correct, directly useful answers: concrete steps, examples, full working code (in a \`\`\` block with its language). Prefer doing the task over explaining how to do it.
- Format for WhatsApp: *bold* for key words, short paragraphs or bullet lists. No Markdown headings (#) and no tables.
- If a request is truly ambiguous, ask ONE short clarifying question instead of guessing. If you are not sure of a fact, say so briefly instead of inventing it.
- The bot owner's instructions about how you behave come first.
- Do not re-introduce yourself and do not keep saying you are an AI. Vary your openings and endings naturally.
- Respect elders and group rules. If someone is abusive, answer firmly but calmly.
- Never claim to be a human. You are not Meta AI, not ChatGPT, not OpenClaw and not any other product: you are Terboo.
- Never claim you heard audio, watched a video or read a file unless its transcript/analysis is actually given to you.
- Never reveal API keys, tokens, passwords or session data.`,
  },

  // 🍪 جلسات مواقع (كوكي session_id) — أسرار: البيئة تتغلب، وتُسجَّل للإخفاء عند الإقلاع
  // ═══════════════════════════════════════════════
  // 🌐 Bot Terboo Web — منصة الويب الرفيقة (قسم مستقل تماماً)
  // ───────────────────────────────────────────────
  // ⚠️ هذا القسم وحده يحدّد الموقع. لا تستعمل info.website ولا socialLinks.website
  //    لعنوان الموقع: الحقلان الحاليان يشيران إلى قناة واتساب الرسمية ومعناهما مختلف.
  //
  // • enabled=false افتراضياً: البوت يعمل كما هو تماماً ولا يُفتح أي منفذ
  //   حتى يقرّر المالك التفعيل (.موقع تشغيل أو تعديل هذا الملف).
  // • الخادم يُستضاف داخل عملية البوت نفسها بعد تهيئة قاعدة البيانات والإضافات،
  //   لأن قاعدة البيانات ملفات JSON بذاكرة داخل العملية وكتابات مؤجلة:
  //   كاتب ثانٍ من عملية أخرى يفقد تحديثات (راجع docs/web-platform/06_DATA_AND_IDENTITY.md).
  // • publicBaseUrl هو مصدر الحقيقة الوحيد لكل رابط (زر القائمة · رسائل البوت · الواجهة).
  //   يُبنى عبر src/web/url-builder.js فقط، ولا يُستنتج من ترويسة Host أبداً.
  // ═══════════════════════════════════════════════
  website: {
    enabled: false, // true ⇒ يُفتح خادم HTTP للموقع داخل عملية البوت
    host: "127.0.0.1", // 127.0.0.1 مع reverse proxy (موصى به) · 0.0.0.0 للتعرّض المباشر
    port: 3000,

    // العنوان العام الكامل كما يفتحه الزائر — مصدر الحقيقة لكل رابط.
    // فارغ ⇒ لا زر ولا رابط في القوائم (لا يُرسل زر مكسور أبداً).
    publicBaseUrl: "",

    // الدومين وحالة إثباته. لا يُعتمد الدومين لمجرد كتابته هنا:
    // requireDomainVerification=true ⇒ لا يُبنى publicBaseUrl إلا بعد نجاح تحقق DNS.
    domain: "",
    requireDomainVerification: true,

    // proxy  ⇒ TLS ينتهي عند Caddy/Nginx أمام الموقع (الأكثر أماناً والموصى به)
    // direct ⇒ الموقع نفسه يقدّم HTTPS من شهادة موجودة على القرص (certPath/keyPath)
    // disabled ⇒ HTTP صريح بلا تشفير (تطوير محلي فقط — يُعلَن للمستخدم كغير آمن)
    tlsMode: "proxy",
    tls: {
      certPath: "", // خارج webroot دائماً، صلاحيات 600 — لا يُعاد في أي API
      keyPath: "",
    },

    // خلف proxy: لا تُقرأ X-Forwarded-* إلا إذا trustProxy=true وجاء الطلب من عنوان مُدرج.
    // بغير ذلك تُتجاهل الترويسات تماماً (منع انتحال العنوان والمخطَّط).
    trustProxy: false,
    proxyAllowlist: ["127.0.0.1", "::1"],

    // عنوان IP عام يحدّده المالك للرجوع إليه عند غياب دومين متحقَّق.
    // لا يُكتشف من ترويسة طلب ولا من خدمة خارجية تلقائياً.
    publicIp: "",

    session: {
      cookieName: "terboo_session",
      // "" ⇒ يُولَّد سر عشوائي ويُحفظ في data/secure/website-session.key (600).
      // أو ضع WEBSITE_SESSION_SECRET في secrets/البيئة.
      secret: "",
      idleMinutes: 60, // خمول يُنهي الجلسة
      absoluteHours: 24, // عمر أقصى للجلسة بأي حال
      maxPerUser: 5, // أقدم جلسة تُلغى عند التجاوز
      sameSite: "Lax",
      // secure يُحسب من tlsMode/publicBaseUrl — لا من X-Forwarded-Proto
    },

    limits: {
      jsonBodyBytes: 256 * 1024, // أقصى حجم طلب JSON
      uploadBytes: 64 * 1024 * 1024, // أقصى حجم ملف مرفوع (تُطبَّق حدود الوسائط الحقيقية فوقه)
      uploadsPerHour: 40,
      aiMessagesPerHour: 60,
      toolRunsPerHour: 60,
      tasksPerUser: 5, // مهام متزامنة لكل مستخدم
      artifactTtlHours: 24, // عمر الملف الناتج قبل الحذف
      requestsPerMinute: 120, // لكل جلسة/عنوان
      // تسجيل الدخول: حدود متعددة المستويات ضد الإغراق والتعداد
      otp: {
        codeTtlSeconds: 300, // صلاحية الرمز (5 دقائق)
        maxAttemptsPerChallenge: 5,
        resendCooldownSeconds: 60,
        perPhonePerHour: 5,
        perIpPerHour: 15,
        globalPerHour: 300,
      },
    },

    // تسجيل مستخدم جديد بعد نجاح التحقق. السياسة الافتراضية: لا دور ولا رصيد
    // ولا ترقية — حساب أساسي بنفس مفتاح الهوية القانونية فقط.
    allowSignupOnFirstLogin: true,
  },

  // ═══════════════════════════════════════════════
  // 🦾 محرّك OpenClaw (خدمة مستقلة عبر Gateway)
  // ───────────────────────────────────────────────
  // OpenClaw يعمل **عملية/حاوية منفصلة** بـNode مدعوم (>=24.16 أو >=26.1)،
  // ويتصل به Terboo عبر بروتوكول Gateway الرسمي (WebSocket إصدار 4) بحزمة
  // @openclaw/gateway-client المثبّتة. لا نسخة ثانية من Baileys ولا اتصال
  // واتساب ثانٍ لنفس الحساب من داخل OpenClaw.
  //
  // التفعيل يحتاج ثلاثة أشياء مجتمعة، وإلا بقي معطَّلاً وأعلن ذلك بصدق:
  //   enabled: true  +  url صالح على شبكة خاصة  +  مفتاح موجود.
  // متغيّرات البيئة تتغلّب: OPENCLAW_ENABLED · OPENCLAW_GATEWAY_URL ·
  // OPENCLAW_GATEWAY_TOKEN · OPENCLAW_AGENT_ID.
  // ═══════════════════════════════════════════════
  openclaw: {
    enabled: false, // لا يُفعَّل إلا بعد نشر Gateway فعلي واختباره
    // loopback أو شبكة خاصة فقط. منفذ Gateway لا يُنشر على الإنترنت العام.
    url: "", // مثال: ws://127.0.0.1:7777
    // اسم متغيّر البيئة الذي يحمل مفتاح الخدمة (الأفضل) — أو ضع المفتاح في token.
    tokenEnv: "OPENCLAW_GATEWAY_TOKEN",
    token: "", // بديل عن البيئة؛ لا يُعاد في أي API ولا يُسجَّل
    agentId: "", // الوكيل المختار في OpenClaw (فارغ ⇒ افتراضي الـGateway)
    requestTimeoutMs: 60000,
    scopes: [], // نطاقات محدودة للعميل (فارغ ⇒ افتراضي الـGateway)
    // منع افتراضي: أدوات Terboo التي يُسمح لـOpenClaw نداؤها، بالمعرّف.
    // أداة المالك أو التي تحتاج سياق واتساب تُرفَض حتى لو أُدرجت هنا.
    exposeTerbooTools: [],
  },

  webSessions: {
    kimi: process.env.KIMI_SESSION_ID || "",
    monica: process.env.MONICA_SESSION_ID || "",
  },

  // ═══════════════════════════════════════════════
  // 🔑 مفاتيح API للخدمات الخارجية
  // ═══════════════════════════════════════════════
  // ═══════════════════════════════════════════════
  // 🔑 الأسرار — كل مفاتيح المزوّدات في مكان واحد
  // ───────────────────────────────────────────────
  // ضع القيم هنا وستُنشر تلقائياً إلى process.env عند تحميل الإعداد،
  // فتعمل كل الوحدات التي تقرأ من البيئة بلا أي تعديل عليها.
  //
  // • متغيّر البيئة **يتغلّب** على القيمة هنا ⇒ النشر بـDocker/systemd يبقى كما هو.
  // • كل قيمة هنا تُسجَّل في مُعتِّم الأسرار (terboo-secrets) فلا تظهر في سجل أو رسالة خطأ.
  // • هذا الملف لا يُرفع إلى مستودع عام (مُدرج في .gitignore).
  // ═══════════════════════════════════════════════
  secrets: {
    // ── Cloudflare Workers AI (أمر .تخيل3) ──
    CLOUDFLARE_ACCOUNT_ID: "", // معرّف حساب Cloudflare
    CLOUDFLARE_AI_TOKEN: "", // توكن Workers AI — ⚠️ كان مكشوفاً في المصدر: دوّره

    // ── مزوّدات الذكاء الاصطناعي ──
    ANTHROPIC_API_KEY: "", // Claude
    ANTHROPIC_AUTH_TOKEN: "", // بديل لمفتاح Claude عند استخدام بوابة
    NVIDIA_API_KEY: "", // NVIDIA NIM
    NVIDIA_API_KEYS: "", // عدة مفاتيح NVIDIA مفصولة بفواصل (تدوير)
    MANUS_API_KEY: "", // Manus
    GROQ_API_KEY: "", // Groq — المصدر الفعلي للكود هو APIkey.groq أدناه؛ هذه للنشر بالبيئة فقط
    OPENAI_API_KEY: "", // OpenAI — لا تقرأه أي وحدة حالياً (محجوز للتوسعة)
    GOOGLE_API_KEY: "", // Google AI — المصدر الفعلي للكود هو APIkey.google أدناه؛ هذه للنشر بالبيئة فقط

    // ── خدمات مساعدة ──
    ASSEMBLYAI_KEY: "", // تحويل الصوت إلى نص
    FIXCODE_API_KEY: "", // أمر gpt55
    EMOJI_KITCHEN_API_KEY: "", // دمج الإيموجي
    TIKTOK_SEARCH_API_KEY: "", // بحث تيك توك
    SPOTIFY_DL_API_TOKEN: "", // تنزيل سبوتيفاي

    // ── البنية التحتية ──
    TERBOO_MASTER_KEY: "", // المفتاح الرئيسي لخزنة الأسرار (أو اتركه لملف data/secure/master.key)
    TERBOO_WEBHOOK_TOKEN: "", // توكن الويبهوك
  },

  APIkey: {
    lolhuman: "", // LolHuman API
    neoxr: "", // NeoXR API
    fgsi: "", // FGSI API
    google: "", // Google API
    groq: "", // Groq API (تحويل الصوت لنص)
    betabotz: "", // BetaBotz API
    covenant: "", // Covenant API
    onlym: "", // OnlyM API
    obscura: "", // Obscura API
    firefly: "", // Firefly API
    cuki: "", // Cuki API
    anthropic: "", // Claude (Anthropic API) — الرؤية والكود والوثائق؛ ANTHROPIC_API_KEY في البيئة يتجاوزه إن ضُبط
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 🛠️ دوال مساعدة (Helper Functions) - لا تعدلها إلا إذا كنت تعرف ماذا تفعل
// ═══════════════════════════════════════════════════════════════════════════

/**
 * خيارات تطبيع الأرقام المكتوبة يدوياً: الصيغة المحلية («010…») تُفهم بدولة رقم البوت.
 * المطابقة كاملة بعد التطبيع — لا includes ولا endsWith (كانت تمنح صلاحيات عبر الدول:
 * 6512345678 «ينتهي به» 966512345678).
 */
function phoneOptions() {
  return { referenceNumber: config.bot?.number || config.bot?.primaryNumber || config.owner?.number?.[0] || "" };
}

/** رقم/معرّف المرسل كما يصل (PN · LID محلول · رقم) مقابل قائمة أرقام */
function inPhoneList(number, list) {
  return phoneInList(number, list, phoneOptions());
}

/** التحقق مما إذا كان الرقم هو مالك البوت */
function isOwner(number) {
  if (!number) return false; // لا يوجد رقم

  // رقم البوت نفسه (رسائله من أجهزته المرتبطة)
  if (config.bot?.number && samePhone(number, config.bot.number, phoneOptions())) return true;

  try {
    // قائمة المالكين في config
    if (inPhoneList(number, config.owner?.number)) return true;

    const db = getDatabase();
    // قائمة المالكين في قاعدة البيانات
    if (db?.data && Array.isArray(db.data.owner) && inPhoneList(number, db.data.owner.map(String))) return true;
    // إعدادات ownerNumbers
    if (db) {
      const definedOwner = db.setting("ownerNumbers");
      if (Array.isArray(definedOwner) && inPhoneList(number, definedOwner.map(String))) return true;
    }
    return false;
  } catch (error) {
    noteFailure("config", error, { where: "config.js:isOwner", fallback: "not-owner" });
    return false;
  }
}

/** التحقق مما إذا كان الرقم مستخدماً مميزاً */
function isPremium(number) {
  if (!number) return false;
  if (isOwner(number)) return true; // المالك مميز تلقائياً
  if (isPartner(number)) return true; // الشريك مميز تلقائياً

  const cleanNumber = number.split(":")[0].split("@")[0].replace(/[^0-9]/g, "");
  const premiumList = config.premiumUsers || [];

  // التحقق من قائمة premiumUsers في config
  if (inPhoneList(number, premiumList)) return true;

  // التحقق من قاعدة بيانات المميزين
  try {
    if (ownerPremiumDb && ownerPremiumDb.isPremium(cleanNumber)) return true;
  } catch (error) { noteFailure("config", error, { where: "config.js:559", fallback: "skip-source" }); }

  try {
    const db = getDatabase();
    if (db && db.data && Array.isArray(db.data.premium)) {
      const now = Date.now();
      const foundIndex = db.data.premium.findIndex((p) => {
        if (typeof p === "string") return p === cleanNumber;
        if (p.id) return p.id === cleanNumber;
        return false;
      });

      if (foundIndex !== -1) {
        const found = db.data.premium[foundIndex];
        if (typeof found === "string") return true;
        const expireTime = found.expired || (found.expiredAt ? new Date(found.expiredAt).getTime() : 0);
        if (expireTime && expireTime < now) {
          db.data.premium.splice(foundIndex, 1); // إزالة منتهي الصلاحية
          const jid = cleanNumber + "@s.whatsapp.net";
          const user = db.getUser(jid);
          if (user) { user.isPremium = false; db.setUser(jid, user); }
          db.save();
          return false;
        }
        return true;
      }
    }
    if (db) {
      const savedPremium = db.setting("premiumUsers") || [];
      if (inPhoneList(number, savedPremium)) return true;
    }
  } catch (error) { noteFailure("config", error, { where: "config.js:590", fallback: "skip-source" }); }

  return false;
}

/** التحقق مما إذا كان الرقم شريكاً */
function isPartner(number) {
  if (!number) return false;
  if (isOwner(number)) return true; // المالك شريك تلقائياً

  const cleanNumber = number.split(":")[0].split("@")[0].replace(/[^0-9]/g, "");
  const partnerList = config.partnerUsers || [];

  if (inPhoneList(number, partnerList)) return true;

  try {
    if (ownerPremiumDb && ownerPremiumDb.isPartner(cleanNumber)) return true;
  } catch (error) { noteFailure("config", error, { where: "config.js:607", fallback: "skip-source" }); }

  try {
    const db = getDatabase();
    if (db && db.data && Array.isArray(db.data.partner)) {
      const now = Date.now();
      const foundIndex = db.data.partner.findIndex((p) => {
        if (typeof p === "string") return p === cleanNumber;
        if (p.id) return p.id === cleanNumber;
        return false;
      });

      if (foundIndex !== -1) {
        const found = db.data.partner[foundIndex];
        if (typeof found === "string") return true;
        const expireTime = found.expired || (found.expiredAt ? new Date(found.expiredAt).getTime() : 0);
        if (expireTime && expireTime < now) {
          db.data.partner.splice(foundIndex, 1); // إزالة منتهي الصلاحية
          db.save();
          return false;
        }
        return true;
      }
    }
  } catch (error) { noteFailure("config", error, { where: "config.js:631", fallback: "skip-source" }); }

  return false;
}

/** التحقق مما إذا كان الرقم محظوراً */
function isBanned(number) {
  if (!number) return false;
  if (isOwner(number)) return false; // المالك لا يحظر

  const cleanNumber = number.split(":")[0].split("@")[0].replace(/[^0-9]/g, "");

  let bannedList = [];
  try {
    const db = getDatabase();
    if (db) {
      bannedList = db.setting("bannedUsers") || [];
      config.bannedUsers = bannedList;
    }
  } catch (error) { noteFailure("config", error, { where: "config.js:650", fallback: "skip-source" }); }

  return inPhoneList(number, bannedList.map(String));
}

/** تعيين رقم البوت */
function setBotNumber(number) {
  if (number) config.bot.number = number.replace(/[^0-9]/g, "");
}

/** التحقق مما إذا كان الرقم هو البوت نفسه */
function isSelf(number) {
  if (!number || !config.bot.number) return false;
  return samePhone(number, config.bot.number, phoneOptions());
}

/** جلب اسم المالك حسب رقمه */
function getOwnerName(number) {
  if (!number) return config.owner?.name || "Owner";
  const cleanNumber = String(number).replace(/[^0-9]/g, "");
  try {
    const db = getDatabase();
    const nameMap = db.setting("ownerNames") || {};
    if (nameMap[cleanNumber]) return nameMap[cleanNumber];
  } catch (error) { noteFailure("config", error, { where: "config.js:674", fallback: "skip-source" }); }
  if (config.owner?.number) {
    if (inPhoneList(number, config.owner.number)) return config.owner?.name || "Owner";
  }
  return "Owner";
}

/** جلب كل إعدادات config */
function getConfig() {
  return config;
}

// ── نشر الأسرار إلى البيئة ──
// يُنفَّذ عند تحميل هذا الملف، وهو أول ما يستورده index.js، فتجد كل وحدة
// قيمتها جاهزة في process.env وقت تحميلها. البيئة تتغلّب دائماً على الملف.
for (const [name, value] of Object.entries(config.secrets || {})) {
  if (value && !process.env[name]) process.env[name] = String(value);
}

// إضافة الدوال إلى كائن config لتكون متاحة عالمياً
config.bot.primaryNumber ||= config.session?.pairingNumber || "";
config.isOwner = isOwner;
config.isPremium = isPremium;
config.isPartner = isPartner;
config.isBanned = isBanned;
config.setBotNumber = setBotNumber;
config.isSelf = isSelf;
config.getOwnerName = getOwnerName;

export default config;
export {
  config,
  getConfig,
  isOwner,
  isPartner,
  isPremium,
  isBanned,
  setBotNumber,
  isSelf,
  getOwnerName,
};
