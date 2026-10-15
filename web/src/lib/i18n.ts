// ═══════════════════════════════════════════════
// الترجمة والاتجاه — عربي/إنجليزي
// ───────────────────────────────────────────────
// محرّك لغات البوت يدعم ar و en فقط (LANGUAGE_ORDER في terboo-localization.js)،
// فالواجهة تتبعه ولا تَعِد بلغة لا يفهمها الخادم.
// العربية RTL حقيقية: الاتجاه على <html> وكل المسافات منطقية (inline-start/end).
// الأرقام والأكواد والروابط تبقى LTR عبر الصنف .num/.ltr.
// ═══════════════════════════════════════════════

import type { Lang } from "./types";

export const LANGS: Lang[] = ["ar", "en"];
export const DIR: Record<Lang, "rtl" | "ltr"> = { ar: "rtl", en: "ltr" };

type Dict = Record<string, string>;

const ar: Dict = {
  "brand.name": "Bot Terboo",
  "brand.web": "Bot Terboo Web",
  "splash.tagline": "مساعدك الذكي على واتساب",

  "landing.heroTitle": "مساعدك الذكي على واتساب — الآن في مساحة عمل كاملة",
  "landing.heroBody": "اسأل الذكاء، حمّل ما تريد، افهم ملفاتك، شغّل الأدوات والألعاب، وتابع حسابك — بنفس حسابك وصلاحياتك على واتساب.",
  "landing.cta": "ادخل برقم واتساب",
  "landing.capabilities": "ما يعمل فعلاً",
  "landing.status": "حالة الخدمة",
  "landing.sections": "الأقسام",
  "landing.footerNote": "الدخول بإثبات ملكية رقم واتساب. لا كلمة مرور.",

  "login.title": "تسجيل الدخول",
  "login.subtitle": "سيصلك رمز في محادثتك مع Bot Terboo على واتساب.",
  "login.phone": "رقم واتساب",
  "login.phoneHint": "بالصيغة الدولية، مثال: +201012345678",
  "login.send": "أرسل رمز التحقق",
  "login.sending": "جاري الإرسال…",
  "login.codeTitle": "أدخل الرمز",
  "login.codeSubtitle": "٦ أرقام وصلتك على واتساب",
  "login.code": "رمز التحقق",
  "login.verify": "تحقق وادخل",
  "login.verifying": "جاري التحقق…",
  "login.resend": "إعادة الإرسال",
  "login.resendIn": "إعادة الإرسال بعد {0} ثانية",
  "login.changeNumber": "تغيير الرقم",
  "login.expiresIn": "ينتهي الرمز بعد {0}",
  "login.expired": "انتهت صلاحية الرمز. اطلب رمزاً جديداً.",
  "login.botOffline": "اتصال واتساب غير متاح الآن، فلا يمكن إرسال الرمز. حاول بعد قليل.",

  "nav.dashboard": "الرئيسية",
  "nav.ai": "الذكاء",
  "nav.tools": "الأدوات",
  "nav.media": "الوسائط",
  "nav.games": "الألعاب",
  "nav.groups": "المجموعات",
  "nav.subbots": "البوتات الفرعية",
  "nav.account": "الحساب",
  "nav.owner": "لوحة المالك",
  "nav.commands": "أوامر واتساب",
  "nav.workspace": "مساحة العمل",
  "nav.manage": "الإدارة",

  "dash.greeting": "أهلاً",
  "dash.role": "الصلاحية",
  "dash.level": "المستوى",
  "dash.energy": "الطاقة",
  "dash.coins": "العملات",
  "dash.xp": "الخبرة",
  "dash.unlimited": "غير محدود",
  "dash.quick": "اختصارات",
  "dash.tasks": "مهامك",
  "dash.files": "ملفاتك",
  "dash.usage": "استخدامك",
  "dash.noTasks": "لا مهام جارية.",
  "dash.noFiles": "لا ملفات بعد.",
  "dash.notInDb": "حسابك جديد على الموقع ولم يُسجَّل في البوت بعد. راسل Bot Terboo على واتساب لتفعيل كل الميزات.",

  "ai.title": "مساحة الذكاء",
  "ai.new": "محادثة جديدة",
  "ai.placeholder": "اكتب سؤالك…",
  "ai.send": "إرسال",
  "ai.stop": "إيقاف",
  "ai.thinking": "يفكّر…",
  "ai.attach": "إرفاق صورة",
  "ai.noProviders": "لا يوجد مزوّد ذكاء مُعدّ الآن، فالمحادثة غير متاحة. يضبط المالك المفاتيح في الإعداد.",
  "ai.noVision": "لا يوجد مزوّد يستقبل الصور فعلاً، فلا يمكن وصف الصورة.",
  "ai.empty": "ابدأ محادثة جديدة.",
  "ai.emptyThread": "اكتب أول رسالة.",
  "ai.rename": "إعادة تسمية",
  "ai.delete": "حذف",
  "ai.whatsappOnly": "هذا الطلب ينفَّذ من واتساب",
  "ai.conversations": "المحادثات",

  "tools.title": "الأدوات والتحميل",
  "tools.search": "ابحث في الأدوات…",
  "tools.run": "تشغيل",
  "tools.running": "جاري التشغيل…",
  "tools.background": "تشغيل في الخلفية",
  "tools.result": "النتيجة",
  "tools.unavailable": "غير متاحة الآن",
  "tools.needsWhatsapp": "تحتاج سياق واتساب",
  "tools.externalLink": "رابط خارجي",
  "tools.all": "الكل",
  "tools.empty": "لا أدوات مطابقة.",
  "tools.inputRequired": "أكمل الحقول المطلوبة.",

  "media.title": "استوديو الوسائط",
  "media.drop": "أفلت ملفاً هنا أو اختر من جهازك",
  "media.choose": "اختر ملفاً",
  "media.uploading": "جاري الرفع…",
  "media.files": "ملفاتك",
  "media.download": "تنزيل",
  "media.delete": "حذف",
  "media.expires": "ينتهي",
  "media.limits": "الحدود المسموحة",
  "media.pickTool": "اختر ما تريد عمله بالملف",

  "games.title": "الألعاب",
  "games.play": "ابدأ",
  "games.vsAI": "ضد الكمبيوتر",
  "games.yourTurn": "دورك",
  "games.waiting": "انتظر…",
  "games.leave": "مغادرة",
  "games.groupOnly": "للمجموعات على واتساب فقط",
  "games.over": "انتهت اللعبة",

  "groups.title": "المجموعات",
  "groups.members": "الأعضاء",
  "groups.admin": "مشرف",
  "groups.notAdmin": "لست مشرفاً في هذه المجموعة",
  "groups.botNotAdmin": "البوت ليس مشرفاً، فلا يمكن تنفيذ الإجراءات",
  "groups.confirmBulk": "تأكيد الإجراء الجماعي",
  "groups.offline": "اتصال واتساب غير متاح، فلا تظهر المجموعات.",

  "subbots.title": "البوتات الفرعية",
  "subbots.pairingWeb": "الاقتران لا يتم من الموقع: الرمز يمنح تحكّماً كاملاً بالحساب ويُسلَّم في محادثتك على واتساب فقط.",
  "subbots.none": "لا بوتات فرعية لحسابك.",
  "subbots.active": "يعمل",
  "subbots.stopped": "متوقف",

  "account.title": "الحساب",
  "account.language": "لغة الواجهة",
  "account.sessions": "الجلسات",
  "account.current": "هذه الجلسة",
  "account.revoke": "إلغاء",
  "account.revokeAll": "إنهاء كل الجلسات الأخرى",
  "account.logout": "خروج",
  "account.memory": "ذاكرة الذكاء",
  "account.memoryBody": "ما يتذكّره البوت عنك. يمكنك مسحه في أي وقت.",
  "account.forget": "امسح ذاكرتي",
  "account.noMemory": "لا ذكريات محفوظة.",
  "account.premium": "بريميوم",

  "owner.title": "لوحة المالك",
  "owner.site": "الموقع",
  "owner.users": "المستخدمون",
  "owner.jobs": "المهام",
  "owner.providers": "المزوّدات",
  "owner.audit": "سجل التدقيق",
  "owner.domain": "الدومين",
  "owner.verify": "تحقق",
  "owner.ban": "حظر",
  "owner.unban": "رفع الحظر",
  "owner.search": "ابحث برقم أو اسم…",
  "owner.tls": "الشهادة",

  "common.loading": "جاري التحميل…",
  "common.retry": "إعادة المحاولة",
  "common.cancel": "إلغاء",
  "common.confirm": "تأكيد",
  "common.close": "إغلاق",
  "common.save": "حفظ",
  "common.saved": "تم الحفظ",
  "common.error": "حدث خطأ",
  "common.empty": "لا يوجد شيء هنا بعد",
  "common.online": "متصل",
  "common.offline": "غير متصل",
  "common.yes": "نعم",
  "common.no": "لا",
  "common.copy": "نسخ",
  "common.copied": "تم النسخ",
  "common.menu": "القائمة",
  "common.theme": "الثيم",
  "common.language": "اللغة",
  "common.why": "السبب",
  "common.of": "من",
  "common.remaining": "متبقٍ",
  "common.unknown": "غير معروف",
  "common.notAvailable": "غير متاح",
};

const en: Dict = {
  "brand.name": "Bot Terboo",
  "brand.web": "Bot Terboo Web",
  "splash.tagline": "Your AI assistant on WhatsApp",

  "landing.heroTitle": "Your AI assistant on WhatsApp — now in a full web workspace",
  "landing.heroBody": "Ask the AI, download what you need, understand your files, run tools and games, and follow your account — with the same account and permissions you have on WhatsApp.",
  "landing.cta": "Sign in with WhatsApp",
  "landing.capabilities": "What actually works",
  "landing.status": "Service status",
  "landing.sections": "Sections",
  "landing.footerNote": "Sign in by proving you own a WhatsApp number. No password.",

  "login.title": "Sign in",
  "login.subtitle": "A code will arrive in your WhatsApp chat with Bot Terboo.",
  "login.phone": "WhatsApp number",
  "login.phoneHint": "International format, e.g. +201012345678",
  "login.send": "Send verification code",
  "login.sending": "Sending…",
  "login.codeTitle": "Enter the code",
  "login.codeSubtitle": "6 digits sent to you on WhatsApp",
  "login.code": "Verification code",
  "login.verify": "Verify and continue",
  "login.verifying": "Verifying…",
  "login.resend": "Resend",
  "login.resendIn": "Resend in {0}s",
  "login.changeNumber": "Change number",
  "login.expiresIn": "Code expires in {0}",
  "login.expired": "The code expired. Request a new one.",
  "login.botOffline": "The WhatsApp connection is unavailable, so the code cannot be sent. Try again shortly.",

  "nav.dashboard": "Home",
  "nav.ai": "AI",
  "nav.tools": "Tools",
  "nav.media": "Media",
  "nav.games": "Games",
  "nav.groups": "Groups",
  "nav.subbots": "Sub-bots",
  "nav.account": "Account",
  "nav.owner": "Owner console",
  "nav.commands": "WhatsApp commands",
  "nav.workspace": "Workspace",
  "nav.manage": "Manage",

  "dash.greeting": "Welcome",
  "dash.role": "Role",
  "dash.level": "Level",
  "dash.energy": "Energy",
  "dash.coins": "Coins",
  "dash.xp": "XP",
  "dash.unlimited": "unlimited",
  "dash.quick": "Shortcuts",
  "dash.tasks": "Your tasks",
  "dash.files": "Your files",
  "dash.usage": "Your usage",
  "dash.noTasks": "No running tasks.",
  "dash.noFiles": "No files yet.",
  "dash.notInDb": "Your account is new here and is not registered with the bot yet. Message Bot Terboo on WhatsApp to unlock everything.",

  "ai.title": "AI workspace",
  "ai.new": "New conversation",
  "ai.placeholder": "Type your question…",
  "ai.send": "Send",
  "ai.stop": "Stop",
  "ai.thinking": "Thinking…",
  "ai.attach": "Attach an image",
  "ai.noProviders": "No AI provider is configured, so chat is unavailable. The owner sets the keys in the config.",
  "ai.noVision": "No provider that actually receives images is configured, so the image cannot be described.",
  "ai.empty": "Start a new conversation.",
  "ai.emptyThread": "Write the first message.",
  "ai.rename": "Rename",
  "ai.delete": "Delete",
  "ai.whatsappOnly": "This request runs on WhatsApp",
  "ai.conversations": "Conversations",

  "tools.title": "Tools and downloads",
  "tools.search": "Search tools…",
  "tools.run": "Run",
  "tools.running": "Running…",
  "tools.background": "Run in background",
  "tools.result": "Result",
  "tools.unavailable": "Unavailable right now",
  "tools.needsWhatsapp": "Needs WhatsApp context",
  "tools.externalLink": "External link",
  "tools.all": "All",
  "tools.empty": "No matching tools.",
  "tools.inputRequired": "Fill in the required fields.",

  "media.title": "Media studio",
  "media.drop": "Drop a file here, or pick one from your device",
  "media.choose": "Choose a file",
  "media.uploading": "Uploading…",
  "media.files": "Your files",
  "media.download": "Download",
  "media.delete": "Delete",
  "media.expires": "Expires",
  "media.limits": "Allowed limits",
  "media.pickTool": "Pick what to do with the file",

  "games.title": "Games",
  "games.play": "Start",
  "games.vsAI": "Against the computer",
  "games.yourTurn": "Your turn",
  "games.waiting": "Waiting…",
  "games.leave": "Leave",
  "games.groupOnly": "WhatsApp groups only",
  "games.over": "Game over",

  "groups.title": "Groups",
  "groups.members": "Members",
  "groups.admin": "Admin",
  "groups.notAdmin": "You are not an admin in this group",
  "groups.botNotAdmin": "The bot is not an admin, so actions cannot run",
  "groups.confirmBulk": "Confirm the bulk action",
  "groups.offline": "The WhatsApp connection is unavailable, so groups are not shown.",

  "subbots.title": "Sub-bots",
  "subbots.pairingWeb": "Pairing does not happen on the web: the code grants full control of an account and is delivered only in your WhatsApp chat.",
  "subbots.none": "No sub-bots on your account.",
  "subbots.active": "running",
  "subbots.stopped": "stopped",

  "account.title": "Account",
  "account.language": "Interface language",
  "account.sessions": "Sessions",
  "account.current": "This session",
  "account.revoke": "Revoke",
  "account.revokeAll": "End all other sessions",
  "account.logout": "Sign out",
  "account.memory": "AI memory",
  "account.memoryBody": "What the bot remembers about you. You can clear it at any time.",
  "account.forget": "Clear my memory",
  "account.noMemory": "Nothing remembered.",
  "account.premium": "Premium",

  "owner.title": "Owner console",
  "owner.site": "Website",
  "owner.users": "Users",
  "owner.jobs": "Jobs",
  "owner.providers": "Providers",
  "owner.audit": "Audit log",
  "owner.domain": "Domain",
  "owner.verify": "Verify",
  "owner.ban": "Ban",
  "owner.unban": "Unban",
  "owner.search": "Search by number or name…",
  "owner.tls": "Certificate",

  "common.loading": "Loading…",
  "common.retry": "Retry",
  "common.cancel": "Cancel",
  "common.confirm": "Confirm",
  "common.close": "Close",
  "common.save": "Save",
  "common.saved": "Saved",
  "common.error": "Something went wrong",
  "common.empty": "Nothing here yet",
  "common.online": "online",
  "common.offline": "offline",
  "common.yes": "yes",
  "common.no": "no",
  "common.copy": "Copy",
  "common.copied": "Copied",
  "common.menu": "Menu",
  "common.theme": "Theme",
  "common.language": "Language",
  "common.why": "Why",
  "common.of": "of",
  "common.remaining": "remaining",
  "common.unknown": "unknown",
  "common.notAvailable": "not available",
};

const DICTS: Record<Lang, Dict> = { ar, en };

/** ترجمة بمفتاح مع عناصر نائبة {0} {1} */
export function translate(lang: Lang, key: string, ...args: (string | number)[]): string {
  const value = DICTS[lang][key] ?? DICTS.ar[key] ?? key;
  return args.reduce<string>((text, arg, index) => text.split(`{${index}}`).join(String(arg)), value);
}

export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem("terboo.lang");
    if (stored === "ar" || stored === "en") return stored;
  } catch {
    // التخزين المحلي قد يكون محجوباً (نافذة خاصة) — نكمل بالافتراضي
  }
  const navLang = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "ar";
  return navLang.startsWith("en") ? "en" : "ar";
}

export function rememberLang(lang: Lang): void {
  try {
    localStorage.setItem("terboo.lang", lang);
  } catch {
    // تفضيل عرض فقط: تعذُّر حفظه لا يؤثر على العمل
  }
}

export function applyDocumentLang(lang: Lang): void {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = DIR[lang];
}
