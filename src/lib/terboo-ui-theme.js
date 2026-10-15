// ═══════════════════════════════════════════════
// ✧ Terboo Decoration Engine — محرّك الزخرفة المركزي (§22–§29)
// ───────────────────────────────────────────────
// كل رسالة رسمية في البوت تُبنى من هذه الدوال فقط:
//   header() title() subtitle() row() quote() code() section() divider()
//   success() error() warning() info() footer() menuItem() profile()
//   command() status()
//
// الأسلوب:
//  • السطور والمعلومات تُعرض كاقتباس واتساب «>» — هادئ وواضح وغير مزدحم:
//      > ◈ الاسم: تيربو
//      > ◈ الحالة: متصل
//  • لا backticks للزخرفة (§34): القيم والأوامر تُعرض نظيفة، والأوامر والروابط
//    معزولة اتجاهياً فقط. كتل الكود الحقيقية متعددة الأسطر وحدها تبقى ```…```.
//  • أي نص يخرج من بلوقن لا يستعمل المحرّك يمر بطبقة التصميم (terboo-design.js)
//    عند حدّ الإرسال فيظهر بنفس النظام.
//  • لكل لغة مجموعة رموز مستقلة: العربية RTL هادئة، الإنجليزية LTR حديثة
//    بسيطة، الإسبانية LTR مهنية — ولا تُعاد زخارف الإصدارات السابقة.
//  • لكل نوع رسالة (قائمة، معلومة، نجاح، خطأ، تحذير، ملف شخصي) علامته وفاصله.
//  • لا فرض لخطوط على نص واتساب: لا حروف رياضية مزخرفة افتراضياً،
//    والإسبانية تحتفظ بـ á é í ó ú ñ ü كما هي. (styleLatin متاحة للاستعمال
//    الحذر فقط ولا يستعملها المحرّك نفسه.)
//  • الأوامر والروابط تُعزل اتجاهياً بمحارف غير مرئية حتى لا تنقلب داخل العربية.
// ═══════════════════════════════════════════════

const DEFAULT_LANG = "ar";

/**
 * مجموعات الرموز لكل لغة.
 *  ar: ✧ عنوان · ❋ قسم · ◈ سطر · ┄ فاصل منقّط هادئ
 *  en: ◆ عنوان · ▸ قسم · › سطر · ─ فاصل رفيع
 */
const THEMES = {
  ar: {
    dir: "rtl",
    brand: "✧",
    section: "❋",
    row: "◈",
    bullet: "·",
    accent: "✦",
    quote: ">",
    rule: "┄┄┄┄┄┄┄┄┄┄┄┄┄┄",
    softRule: "╌╌╌╌╌╌╌",
    titleWrap: ["", ""],
    keyValue: ": ",
    progressFull: "●",
    progressEmpty: "○",
    stepActive: "◆",
    stepIdle: "◇",
  },
  en: {
    dir: "ltr",
    brand: "◆",
    section: "▸",
    row: "›",
    bullet: "·",
    accent: "◇",
    quote: ">",
    rule: "────────────────",
    softRule: "── ── ──",
    titleWrap: ["", ""],
    keyValue: ": ",
    progressFull: "■",
    progressEmpty: "□",
    stepActive: "●",
    stepIdle: "○",
  },
};

/** علامة وفاصل كل نوع رسالة — حتى لا تتشابه كل الرسائل */
const KINDS = {
  default: { icon: null, rule: "rule" },
  menu: { icon: null, rule: "rule" },
  info: { icon: "ℹ️", rule: "soft" },
  success: { icon: "✅", rule: "soft" },
  error: { icon: "⛔", rule: "soft" },
  warning: { icon: "⚠️", rule: "soft" },
  profile: { icon: "👤", rule: "rule" },
  command: { icon: "🗂️", rule: "rule" },
  registration: { icon: "📝", rule: "soft" },
  developer: { icon: "👑", rule: "rule" },
};

/** مجموعة الرموز الخاصة بلغة، مع الرجوع للعربية عند أي قيمة غير معروفة */
function theme(lang) {
  const key = String(lang || DEFAULT_LANG).toLowerCase().slice(0, 2);
  return THEMES[key] || THEMES[DEFAULT_LANG];
}

/** توافق خلفي: بعض الملفات تستخدم UI.MARK مباشرة (رموز العربية الافتراضية) */
const MARK = {
  brand: THEMES.ar.brand,
  section: THEMES.ar.section,
  row: THEMES.ar.row,
  bullet: THEMES.ar.bullet,
  active: THEMES.ar.stepActive,
  idle: THEMES.ar.stepIdle,
  filled: THEMES.ar.progressFull,
  empty: THEMES.ar.progressEmpty,
};

const RULE = THEMES.ar.rule;
const THIN_RULE = THEMES.ar.softRule;

const LATIN_BOLD = {
  A: "𝗔", B: "𝗕", C: "𝗖", D: "𝗗", E: "𝗘", F: "𝗙", G: "𝗚", H: "𝗛", I: "𝗜",
  J: "𝗝", K: "𝗞", L: "𝗟", M: "𝗠", N: "𝗡", O: "𝗢", P: "𝗣", Q: "𝗤", R: "𝗥",
  S: "𝗦", T: "𝗧", U: "𝗨", V: "𝗩", W: "𝗪", X: "𝗫", Y: "𝗬", Z: "𝗭",
  a: "𝗮", b: "𝗯", c: "𝗰", d: "𝗱", e: "𝗲", f: "𝗳", g: "𝗴", h: "𝗵", i: "𝗶",
  j: "𝗷", k: "𝗸", l: "𝗹", m: "𝗺", n: "𝗻", o: "𝗼", p: "𝗽", q: "𝗾", r: "𝗿",
  s: "𝘀", t: "𝘁", u: "𝘂", v: "𝘃", w: "𝘄", x: "𝘅", y: "𝘆", z: "𝘇",
  0: "𝟬", 1: "𝟭", 2: "𝟮", 3: "𝟯", 4: "𝟰", 5: "𝟱", 6: "𝟲", 7: "𝟳", 8: "𝟴", 9: "𝟵",
};

/** هل النص لاتيني/رقمي بالكامل؟ */
function isLatinOnly(text) {
  return /^[\x20-\x7E]*$/.test(String(text ?? ""));
}

/**
 * زخرفة لاتينية عريضة — للاستعمال الحذر فقط (§29)، لا يستعملها المحرّك.
 * العربية والإسبانية ذات العلامات تُترك كما هي تماماً.
 */
function styleLatin(text) {
  const value = String(text ?? "");
  if (!isLatinOnly(value)) return value;
  return value.split("").map((char) => LATIN_BOLD[char] || char).join("");
}

/**
 * عزل نص لاتيني (رابط، رقم، أمر) داخل فقرة عربية حتى لا تنعكس علاماته.
 * LRI/PDI محارف تنسيق غير مرئية ولا تغيّر النص المنسوخ.
 */
function isolate(text) {
  const value = String(text ?? "");
  if (!value) return value;
  return `⁦${value}⁩`;
}

/** قيمة نظيفة: بلا backticks ولا علامات تنسيق عالقة على طرفيها */
function plain(value) {
  return String(value ?? "").replace(/`/g, "").replace(/^[*_~]+|[*_~]+$/g, "").trim();
}

/** تنسيق قيمة سطر: قصيرة ⇒ نظيفة (والّاتينية معزولة اتجاهياً)، طويلة/متعددة الأسطر ⇒ كما هي */
function formatValue(value) {
  const text = String(value ?? "");
  if (!text.trim()) return "";
  if (text.includes("\n") || text.replace(/[⁦⁩]/g, "").length > 64) return text.replace(/`(?!``)/g, "");
  const clean = plain(text);
  return /^[\x20-\x7E]+$/.test(clean) && /[A-Za-z0-9]/.test(clean) ? isolate(clean) : clean;
}

/** اقتباس سطر واحد: «> …» */
function q(line, lang = DEFAULT_LANG) {
  return `${theme(lang).quote} ${line}`;
}

// ═══════════════════════════════════════════════
// الدوال الأساسية
// ═══════════════════════════════════════════════

/** فاصل رئيسي حسب اللغة */
function rule(lang = DEFAULT_LANG, width = null) {
  const line = theme(lang).rule;
  return width ? line.slice(0, Math.max(6, width)) : line;
}

/** فاصل خفيف حسب اللغة */
function thinRule(lang = DEFAULT_LANG, width = null) {
  const line = theme(lang).softRule;
  return width ? line.slice(0, Math.max(4, width)) : line;
}

/** فاصل: full للرئيسي و soft للخفيف */
function divider(lang = DEFAULT_LANG, weight = "soft") {
  return weight === "full" ? rule(lang) : thinRule(lang);
}

/** عنوان: أيقونة + نص عريض (بلا حروف مزخرفة) */
function title(text, options = {}) {
  const { icon = null, lang = DEFAULT_LANG } = typeof options === "string" ? { lang: options } : options;
  const value = String(text ?? "").trim();
  if (!value) return "";
  return `${icon || theme(lang).brand} *${value}*`;
}

/** سطر وصف تحت العنوان */
function subtitle(text) {
  const value = String(text ?? "").trim();
  return value ? `_${value}_` : "";
}

/** ترويسة: عنوان + وصف اختياري + فاصل اللغة */
function header(text, options = {}) {
  const { subtitle: sub, lang = DEFAULT_LANG, icon = null } = options;
  return [title(text, { icon, lang }), sub ? subtitle(sub) : "", rule(lang)].filter(Boolean).join("\n");
}

/** عنوان قسم داخل الرسالة */
function section(text, lang = DEFAULT_LANG) {
  return `*${theme(lang).section} ${String(text ?? "").trim()}*`;
}

/** سطر بيانات: «> ◈ التسمية: القيمة» */
function row(label_, value, lang = DEFAULT_LANG) {
  const th = theme(lang);
  const formatted = formatValue(value);
  return q(formatted ? `${th.row} ${label_}${th.keyValue}${formatted}` : `${th.row} ${label_}`, lang);
}

/** سطر نقطي */
function bullet(text, lang = DEFAULT_LANG) {
  return q(`${theme(lang).bullet} ${text}`, lang);
}

/** اقتباس: نص ثانوي هادئ (كل سطر باقتباس) */
function quote(text, lang = DEFAULT_LANG) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  return value.split("\n").map((line) => q(line, lang)).join("\n");
}

/** كود/مسار/معرّف: متعدد الأسطر ⇒ كتلة كود حقيقية، سطر واحد ⇒ قيمة نظيفة معزولة اتجاهياً */
function code(text) {
  const value = String(text ?? "").trim();
  if (!value) return "";
  if (value.includes("\n")) return `\`\`\`\n${value}\n\`\`\``;
  return isolate(plain(value));
}

/** وسم قصير عريض */
function label(text, lang = DEFAULT_LANG) {
  const value = String(text ?? "").trim();
  return value ? `${theme(lang).accent} *${value}*` : "";
}

/** سطر حالة: «> ✅ التسمية: القيمة» */
function status(label_, value, options = {}) {
  const { lang = DEFAULT_LANG, ok = null, icon = "" } = options;
  const th = theme(lang);
  const mark = icon || (ok === null ? th.accent : ok ? "✅" : "⛔");
  const formatted = formatValue(value);
  return q(`${mark} ${label_}${formatted ? `${th.keyValue}${formatted}` : ""}`, lang);
}

/** سطر حالة بأيقونة (واجهة قديمة) */
function statusLine(label_, value, icon = "", lang = DEFAULT_LANG) {
  return status(label_, value, { lang, icon: icon || theme(lang).accent });
}

/** سطر أمر: «> ◈ .menu · الوصف» */
function command(name, description = "", options = {}) {
  const { lang = DEFAULT_LANG, prefix = "" } = options;
  const th = theme(lang);
  const cmd = code(`${prefix}${name}`);
  return q(description ? `${th.row} ${cmd} ${th.bullet} ${description}` : `${th.row} ${cmd}`, lang);
}

/** عنصر قائمة: رقم أو علامة + اسم + وصف اختياري */
function menuItem(name, description = "", options = {}) {
  const { lang = DEFAULT_LANG, index = null, prefix = "" } = options;
  const th = theme(lang);
  const head = index === null ? th.row : `${index}.`;
  const shown = prefix ? code(`${prefix}${name}`) : `*${name}*`;
  return q(description ? `${head} ${shown} ${th.bullet} ${description}` : `${head} ${shown}`, lang);
}

/** تذييل موحّد */
function footer(botName, developer, lang = DEFAULT_LANG) {
  const th = theme(lang);
  return developer ? `${th.accent} ${botName} ${th.bullet} ${developer}` : `${th.accent} ${botName}`;
}

/** شريط تقدّم أفقي */
function progressBar(percent, size = 10, lang = DEFAULT_LANG) {
  const th = theme(lang);
  const safe = Math.max(0, Math.min(100, Number(percent) || 0));
  const filled = Math.round((safe / 100) * size);
  return `${th.progressFull.repeat(filled)}${th.progressEmpty.repeat(Math.max(0, size - filled))} ${safe}%`;
}

/** مؤشر خطوات لعمليات متعددة المراحل */
function stepDots(current, total, lang = DEFAULT_LANG) {
  const th = theme(lang);
  const step = Math.max(1, Math.min(total, Number(current) || 1));
  return Array.from({ length: total }, (_, i) => (i < step ? th.stepActive : th.stepIdle)).join(" ");
}

/** مؤشر خطوة كامل */
function stepIndicator(current, total, label_, lang = DEFAULT_LANG) {
  return [label_, stepDots(current, total, lang)].join("\n");
}

// ═══════════════════════════════════════════════
// البطاقات
// ═══════════════════════════════════════════════

/**
 * بطاقة عامة: الأساس الذي تُبنى عليه كل رسائل الواجهة.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} [options.icon]
 * @param {string} [options.subtitle]
 * @param {Array<string|string[]>} [options.blocks]
 * @param {string} [options.footer]
 * @param {string} [options.lang] ar | en | es
 * @param {string} [options.kind] menu | info | success | error | warning | profile | command | registration | developer
 */
function card(options = {}) {
  const { title: head, icon = null, subtitle: sub, blocks = [], footer: foot, lang = DEFAULT_LANG, kind = "default" } = options;
  const th = theme(lang);
  const style = KINDS[kind] || KINDS.default;
  const top = [];

  if (head) top.push(title(head, { icon: icon || style.icon, lang }));
  if (sub) top.push(subtitle(sub));
  if (head || sub) top.push(style.rule === "soft" ? th.softRule : th.rule);

  const parts = top.length ? [top.join("\n")] : [];
  for (const block of blocks) {
    if (!block) continue;
    const text = Array.isArray(block) ? block.filter(Boolean).join("\n") : String(block);
    if (text.trim()) parts.push(text);
  }
  if (foot) parts.push(`${th.softRule}\n_${foot}_`);

  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n");
}

function linesOf(lines, lang = DEFAULT_LANG) {
  const text = Array.isArray(lines) ? lines.filter(Boolean).join("\n") : String(lines ?? "");
  // نص عادي داخل بطاقة حالة يُعرض كاقتباس هادئ؛ الكود والعناوين والأسطر المقتبسة تبقى كما هي
  if (text.includes("```")) return text;
  return text
    .split("\n")
    .map((line) => (!line.trim() || /^\s*(?:>|\*|_|```)/.test(line) ? line : q(line, lang)))
    .join("\n");
}

/** بطاقة معلومات */
function infoCard(head, lines, options = {}) {
  return card({ title: head, kind: "info", blocks: [linesOf(lines, options.lang)], ...options });
}

/** بطاقة ملف شخصي */
function profileCard(head, sections, options = {}) {
  return card({ title: head, kind: "profile", blocks: sections, ...options });
}

/** بطاقة نجاح */
function successCard(head, lines, options = {}) {
  return card({ title: head, kind: "success", blocks: [linesOf(lines, options.lang)], ...options });
}

/** بطاقة خطأ */
function errorCard(head, lines, options = {}) {
  return card({ title: head, kind: "error", blocks: [linesOf(lines, options.lang)], ...options });
}

/** بطاقة تحذير */
function warningCard(head, lines, options = {}) {
  return card({ title: head, kind: "warning", blocks: [linesOf(lines, options.lang)], ...options });
}

/** بطاقة خطوة تسجيل: العنوان ثم مؤشر الخطوة */
function registrationCard({ title: head, step, total, stepLabel, blocks = [], footer: foot, lang = DEFAULT_LANG }) {
  const progress = step ? `${stepLabel}\n${stepDots(step, total, lang)}` : null;
  return card({ title: head, kind: "registration", blocks: [progress, ...blocks], footer: foot, lang });
}

/** بطاقة قائمة أوامر */
function commandCard(head, commands, prefix = ".", options = {}) {
  const lang = options.lang || DEFAULT_LANG;
  const body = commands.map((cmd) => command(cmd, "", { lang, prefix })).join("\n");
  return card({ title: head, kind: "command", blocks: [body], ...options });
}

/** بطاقة المطور */
function developerCard(head, lines, options = {}) {
  return card({ title: head, kind: "developer", blocks: [linesOf(lines, options.lang)], ...options });
}

/** بطاقة ملف شخصي من أزواج تسمية/قيمة */
function profile(head, fields = [], options = {}) {
  const lang = options.lang || DEFAULT_LANG;
  const body = fields
    .filter(Boolean)
    .map((field) => (Array.isArray(field) ? row(field[0], field[1], lang) : String(field)))
    .join("\n");
  return card({ title: head, kind: "profile", icon: options.icon, blocks: [body], footer: options.footer, lang });
}

// أسماء واجهة المحرّك المركزي (§24)
const botHeader = header;
const sectionHeader = section;
const success = successCard;
const error = errorCard;
const warning = warningCard;
const info = infoCard;

const api = {
  DEFAULT_LANG, THEMES, KINDS, MARK, RULE, THIN_RULE,
  theme, isLatinOnly, styleLatin, isolate, plain, rule, thinRule, divider,
  title, subtitle, header, botHeader, section, sectionHeader,
  row, bullet, quote, code, label, status, statusLine, command, menuItem, footer,
  progressBar, stepDots, stepIndicator,
  card, infoCard, profileCard, successCard, errorCard, warningCard, registrationCard, commandCard, developerCard, profile,
  success, error, warning, info,
};

export {
  DEFAULT_LANG, THEMES, KINDS, MARK, RULE, THIN_RULE,
  theme, isLatinOnly, styleLatin, isolate, plain, rule, thinRule, divider,
  title, subtitle, header, botHeader, section, sectionHeader,
  row, bullet, quote, code, label, status, statusLine, command, menuItem, footer,
  progressBar, stepDots, stepIndicator,
  card, infoCard, profileCard, successCard, errorCard, warningCard, registrationCard, commandCard, developerCard, profile,
  success, error, warning, info,
};

export default api;
