// ═══════════════════════════════════════════════
// 🖼️ نصوص الصور المرسومة (Canvas) بلغة المستلم (§30)
// ───────────────────────────────────────────────
// الترجمة عند الإرسال لا تصل إلى النص المرسوم داخل الصورة، لذلك تأخذ
// بطاقات الترحيب والوداع والمستوى ولوحة البنغ لغتها من هنا مباشرة.
// ═══════════════════════════════════════════════

const CANVAS_TEXT = {
  newUser: { ar: "● عضو جديد", en: "● NEW USER" },
  joined: { ar: "انضم إلى: {0}", en: "Joined: {0}" },
  members: { ar: "الأعضاء: #{0}", en: "MEMBERS: #{0}" },
  memberTag: { ar: "العضو #{0}", en: "Member #{0}" },
  disconnected: { ar: "● غادر", en: "● DISCONNECTED" },
  left: { ar: "غادر: {0}", en: "Left: {0}" },
  remaining: { ar: "المتبقون: #{0}", en: "REMAINING: #{0}" },
  remainingTag: { ar: "المتبقون #{0}", en: "Remaining #{0}" },
  welcome: { ar: "أهلاً بك", en: "WELCOME" },
  memberJoined: { ar: "عضو جديد", en: "NEW MEMBER" },
  memberLeft: { ar: "غادر المجموعة", en: "MEMBER LEFT" },
  hello: { ar: "أهلاً وسهلاً", en: "Welcome," },
  farewell: { ar: "مع السلامة", en: "Goodbye," },
  newcomer: { ar: "عضو جديد", en: "New member" },
  toGroup: { ar: "في {0}", en: "to {0}" },
  goodbye: { ar: "وداعاً", en: "GOODBYE" },
  fromGroup: { ar: "من {0}", en: "from {0}" },
  levelUp: { ar: "ارتقيت مستوى!", en: "LEVEL UP!" },
  congrats: { ar: "مبروك يا {0}!", en: "Congratulations, {0}!" },
  level: { ar: "المستوى", en: "LEVEL" },
  diagnostics: { ar: "{0} - تشخيص النظام", en: "{0} - SYSTEM DIAGNOSTICS" },
  statusLine: { ar: "الحالة: متصل | المالك: {0}", en: "STATUS: ONLINE | OWNER: {0}" },
  connection: { ar: "الاتصال: {0}", en: "CONNECTION: {0}" },
  cores: { ar: "الأنوية:", en: "Cores:" },
  threads: { ar: "{0} خيط", en: "{0} Threads" },
  speed: { ar: "السرعة:", en: "Speed:" },
  memoryUsage: { ar: "استخدام الذاكرة", en: "MEMORY USAGE" },
  used: { ar: "المستخدم: {0}", en: "Used: {0}" },
  free: { ar: "المتاح: {0}", en: "Free: {0}" },
  total: { ar: "الإجمالي: {0}", en: "TOTAL: {0}" },
  heapUsed: { ar: "Heap المستخدم:", en: "Heap Used:" },
  heapTotal: { ar: "Heap الإجمالي:", en: "Heap Total:" },
  engine: { ar: "محرك V8:", en: "V8 Engine:" },
  os: { ar: "النظام:", en: "OS:" },
  arch: { ar: "المعمارية:", en: "Arch:" },
  server: { ar: "الخادم:", en: "Server:" },
  bot: { ar: "البوت:", en: "Bot:" },
  latencyPing: { ar: "زمن الاستجابة", en: "LATENCY PING" },
  cpuProcessor: { ar: "المعالج", en: "CPU PROCESSOR" },
  systemLoad: { ar: "حمل النظام", en: "SYSTEM LOAD" },
  usedRam: { ar: "الذاكرة المستخدمة", en: "USED RAM" },
  nodeEngine: { ar: "محرك Node.js", en: "NODE.JS ENGINE" },
  systemSpecs: { ar: "مواصفات النظام", en: "SYSTEM SPECS" },
  uptime: { ar: "مدة التشغيل", en: "UPTIME" },
  excellent: { ar: "ممتاز", en: "EXCELLENT" },
  moderate: { ar: "متوسط", en: "MODERATE" },
  poor: { ar: "ضعيف", en: "POOR" },
};

const LANGS = new Set(["ar", "en"]);

/**
 * نص صورة بلغة معيّنة مع تعبئة {0} {1}…
 * @param {"ar"|"en"} lang
 * @param {keyof typeof CANVAS_TEXT} key
 */
function canvasText(lang, key, ...values) {
  const entry = CANVAS_TEXT[key];
  if (!entry) return key;
  const template = entry[LANGS.has(lang) ? lang : "ar"];
  return template.replace(/\{(\d+)\}/g, (match, index) => (values[Number(index)] ?? match));
}

export { CANVAS_TEXT, canvasText };
export default canvasText;
