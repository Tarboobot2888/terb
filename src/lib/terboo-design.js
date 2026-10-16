// ═══════════════════════════════════════════════
// ✧ Terboo Design Normalizer — طبقة التصميم الموحّدة لكل الرسائل (§33–§36، §47)
// ───────────────────────────────────────────────
// محرّك التصميم (terboo-ui-theme.js) يبني رسائل البلوقنات الحديثة؛ وهذه الطبقة
// تضمن أن أي نص يخرج من أي بلوقن — حتى المبني يدوياً — يظهر بنفس النظام:
//  • لا backticks للزخرفة: `قيمة` و ```قيمة``` في سطر واحد ⇒ قيمة نظيفة.
//    كتل الكود الحقيقية متعددة الأسطر (```\n…\n```) تبقى كما هي.
//  • الإطارات القديمة ⇒ عناصر المحرّك:
//      ╭┈┈⬡「 📋 *عنوان* 」  ⇒  ❋ 📋 *عنوان*        (قسم)
//      ┃ ◦ سطر · │ سطر · ➤ سطر ⇒  > ◈ سطر              (صف معلومات بعلامة >)
//      ╰┈┈┈┈┈┈┈┈⬡ · ╭──────╮   ⇒  (يُحذف)
//      ━━━━━━ · ══════          ⇒  ┄┄┄┄┄┄┄┄┄┄┄┄┄┄      (فاصل المحرّك)
//  • لوحات الألعاب (┬ ┼ ┴ أو صفوف │ x │ y │) محتوى وظيفي لا زخرفة ⇒ لا تُمس.
//  • بعد الترجمة: رموز المحرّك العربية في بداية الأسطر ⇒ رموز لغة المستلم.
// الدوال نقية (بلا حالة) وتُستعمل في: حدّ الإرسال، أداة الترحيل، وفحص التصميم.
// ═══════════════════════════════════════════════

import { THEMES } from "./terboo-ui-theme.js";

const AR = THEMES.ar;
/** سطر جديد في النص، أو سطر جديد مُهرَّب داخل مصدر JS أثناء الترحيل (علامة خاصة قبله) */
const NL = "?\n";
const NL_RE = new RegExp(`(${NL})`);

/** رموز الزخرفة القديمة (ليست من رموز المحرّك) — مرجع فحص التصميم الصارم */
const LEGACY_GLYPHS = "╭╮╰╯┃┏┓┗┛┣┫│┌┐└┘├┤║╔╗╚╝━═┈「」『』〔〕⬡⬣◦❍⌬❏⊱⊰꒰꒱➤⟡⋆";
const LEGACY_RE = new RegExp(`[${LEGACY_GLYPHS}]`, "u");
const CORNERS_TOP = "╭┌┏╔";
const CORNERS_BOTTOM = "╰└┗╚";
const VERTICALS = "┃│├┣┆┊║┤┫";
const RUNS = "━═┈─┄╌┅┉";
const ORNAMENTS = "⬡⬣◦✦⋆⋅•·➤❍⌬❏⟡◇◆◈";
const OPEN_BRACKETS = "「『〔";
const CLOSE_BRACKETS = "」』〕";

/**
 * زخارف «جمالية» قديمة بلا وظيفة (v4 §36): ☘︎ ݁˖ ⊹ ˚ ₊ ୨୧ ︶ ︵ … — تُحذف.
 * القلوب والورود (♡ ❀ ✿) محتوى قد يقصده النص فلا تُمس.
 */
const FLOURISH = "☘݁˖⊹˚₊୨୧︶︵‧ꕤ✩⭑⭒⟢⌗";
const FLOURISH_RUN = new RegExp(`\\s*\\.?(?:[${FLOURISH}][\\uFE0E\\uFE0F]?\\s*)+`, "gu");
/** إطار عنوان قديم «── .✦ عنوان ✦. ──» أو فاصل فارغ «── .✦ ──» */
const TITLE_FRAME = /^(\s*)─{2,}\s*\.?[✦✧⋆]\s*(.*?)\s*(?:[✦✧⋆]\.?)?\s*─{2,}\s*$/u;
/** كشف أي زخرفة جمالية أو إطار عنوان قديم (للمطبِّع والفحص الصارم) */
const AESTHETIC_RE = new RegExp(`[${FLOURISH}]|─{2,}\\s*\\.[✦✧⋆]|[✦✧⋆]\\.\\s*─{2,}`, "u");

const esc = (s) => s.replace(/[\]\\^-]/g, "\\$&");
const cls = (s) => `[${esc(s)}]`;

/** لوحة لعبة/جدول: محتوى وظيفي يُترك كما هو */
function isBoard(text) {
  return /[┬┼┴]/.test(text) || /[│┃]\s*\S[^\n│┃]*[│┃][^\n│┃]*\S\s*[│┃]/.test(text);
}

/** يزيل backticks الزخرفة من سطر (خارج كتل الكود متعددة الأسطر) */
function stripTicks(text) {
  return String(text)
    .replace(/```([^`\n]*?)```/g, "$1")
    .replace(/`([^`\n]*?)`/g, "$1")
    .replace(/`/g, "");
}

/** تغميق نص قسم إن لم يكن فيه تنسيق */
function sectionLine(inner, lead = "") {
  const value = inner.replace(/\s+/g, " ").trim();
  // ترويسة زخرفية بلا نص (╭───✦💕✦───╮) لا تصبح قسماً فارغاً
  if (!/[\p{L}\p{N}{]/u.test(value)) return "";
  return value.includes("*") ? `${lead}${AR.section} ${value}` : `${lead}*${AR.section} ${value}*`;
}

const RE = {
  onlyDecor: new RegExp(`^[\\s${esc(CORNERS_TOP + CORNERS_BOTTOM + VERTICALS + RUNS + ORNAMENTS + "┐┘┓┛╮╯╗╝")}\\u200d\\ufe0f]*$`, "u"),
  header: new RegExp(`^(\\s*)[${esc(CORNERS_TOP + VERTICALS + RUNS + ORNAMENTS)}\\s]*${cls(OPEN_BRACKETS)}\\s*(.*?)\\s*${cls(CLOSE_BRACKETS)}[${esc(RUNS + ORNAMENTS + "┐┓╮╗")}\\s]*$`, "u"),
  topFrame: new RegExp(`^(\\s*)${cls(CORNERS_TOP)}[${esc(RUNS + ORNAMENTS)}\\s]*(.*?)[${esc(RUNS + ORNAMENTS)}\\s]*[┐┓╮╗]?\\s*$`, "u"),
  bottomFrame: new RegExp(`^(\\s*)${cls(CORNERS_BOTTOM)}[${esc(RUNS + ORNAMENTS)}\\s]*(.*?)[${esc(RUNS + ORNAMENTS)}\\s]*[┘┛╯╝]?\\s*$`, "u"),
  row: new RegExp(`^(\\s*)(?:>\\s*)?(?:${cls(VERTICALS + "└┗")}[${esc(RUNS)}]*\\s*)+(?:${cls("◦⬡✦⋆•·➤❍-")}\\s*)?`, "u"),
  bulletRow: new RegExp(`^(\\s*)(?:>\\s*)?${cls("➤⬡◦❍")}\\s*`, "u"),
  trailingFrame: new RegExp(`\\s*${cls(VERTICALS + "┐┘┓┛╮╯╗╝")}+\\s*$`, "u"),
  longRun: /[━═┈]{3,}/g,
  cornerDecor: new RegExp(`^[\\s${esc(RUNS + ORNAMENTS)}]*${cls(CORNERS_TOP + CORNERS_BOTTOM + "┐┘┓┛╮╯╗╝")}[\\s${esc(CORNERS_TOP + CORNERS_BOTTOM + "┐┘┓┛╮╯╗╝" + RUNS + ORNAMENTS)}]*$`, "u"),
  runHeader: new RegExp(`^(\\s*)[${esc(ORNAMENTS)}]*[━═┈]{2,}\\s*(.+?)\\s*[━═┈]{2,}[${esc(ORNAMENTS)}]*\\s*$`, "u"),
  bracketHeader: new RegExp(`^(\\s*)(.*?)${cls(OPEN_BRACKETS)}\\s*(.*?)\\s*${cls(CLOSE_BRACKETS)}(.*)$`, "u"),
  legacyRunLine: /^(\s*)[*_]*[━═┈─]{6,}[*_]*\s*$/,
};

/**
 * تطبيع سطر واحد.
 * @param {string} line
 * @param {{start?:boolean, end?:boolean}} [edges] هل بداية المقطع بداية سطر؟ وهل نهايته نهاية سطر؟
 */
function designLine(line, { start = true, end = true } = {}) {
  let value = stripTicks(line);
  if (AESTHETIC_RE.test(value)) {
    const frame = start && end ? value.match(TITLE_FRAME) : null;
    if (frame) {
      const title = frame[2].replace(/[*_]/g, "").trim();
      return title ? `${frame[1]}${AR.brand} *${title}*` : "";
    }
    value = value.replace(FLOURISH_RUN, (run, offset, whole) => (offset > 0 && offset + run.length < whole.length && /\s/.test(run) ? " " : ""));
  }
  if (!LEGACY_RE.test(value)) return value;
  // بقايا إطار بلا نص (╰┈┈⬡ · ╭──╮) حتى لو كانت جزءاً من سطر يكمله متغيّر
  if (RE.cornerDecor.test(value)) return "";
  if (start && end) {
    if (RE.legacyRunLine.test(value) && /[━═┈]/.test(value)) return value.replace(RE.legacyRunLine, `$1${AR.rule}`);
    if (RE.onlyDecor.test(value)) return "";
  }
  if (start) {
    let match = end ? value.match(RE.header) : null;
    if (match) return sectionLine(match[2], match[1]);
    match = end ? value.match(RE.bracketHeader) : null;
    // 💍 ════『 عنوان 』════ 💍 : خارج القوسين رموز/فواصل/إيموجي فقط ⇒ قسم
    if (match && !/[\p{L}\p{N}]/u.test(`${match[2]}${match[4]}`)) {
      const emoji = (`${match[2]}`.match(/\p{Extended_Pictographic}/gu) || []).join("");
      return sectionLine(`${emoji} ${match[3]}`, match[1]);
    }
    match = end ? value.match(RE.runHeader) : null;
    if (match) return sectionLine(match[2], match[1]);
    match = end ? value.match(RE.topFrame) : null;
    if (match && match[2].trim()) return sectionLine(match[2].replace(new RegExp(cls(OPEN_BRACKETS + CLOSE_BRACKETS), "gu"), " "), match[1]);
    match = end ? value.match(RE.bottomFrame) : null;
    if (match) return match[2].trim() ? `> ${AR.row} ${match[2].trim()}` : "";
    if (RE.row.test(value) || RE.bulletRow.test(value)) {
      // اقتباس واتساب لا يُعرض إلا إذا بدأ السطر بـ «>» مباشرة
      const lead = "";
      const rest = value.replace(RE.row, "").replace(RE.bulletRow, "");
      const clean = (end ? rest.replace(RE.trailingFrame, "") : rest).trim();
      // مقطع يليه محتوى (فاصل join أو سطر يكمله متغيّر): بادئة صف والباقي كما هو
      if (!end) value = `${lead}> ${AR.row} ${rest.trimStart()}`;
      else value = clean ? `${lead}> ${AR.row} ${clean}` : "";
    }
  }
  return value
    .replace(new RegExp(`${cls(OPEN_BRACKETS)}\\s*`, "gu"), "")
    .replace(new RegExp(`\\s*${cls(CLOSE_BRACKETS)}`, "gu"), "")
    .replace(RE.longRun, AR.rule.slice(0, 8))
    .replace(/[━═┈]/g, "┄")
    .replace(/[⬡⬣➤❍⌬❏]/g, AR.row)
    .replace(/◦/g, AR.bullet)
    .replace(/⟡/g, AR.brand)
    .replace(/⋆/g, AR.accent)
    .replace(new RegExp(`${cls("╭╮╰╯┃┏┓┗┛┣┫│┌┐└┘├┤║╔╗╚╝")}\\s?`, "gu"), "");
}

/** يقسم النص إلى مقاطع: كتل كود متعددة الأسطر (تُحفظ) وما عداها */
function splitFences(text) {
  return String(text).split(/(```[^\n`]*\n[\s\S]*?\n```)/);
}

/**
 * تطبيع نص رسالة كامل وفق نظام التصميم.
 * @param {string} text
 * @returns {string}
 */
function designText(text) {
  if (typeof text !== "string" || !text || (!text.includes("`") && !LEGACY_RE.test(text) && !AESTHETIC_RE.test(text) && !/^\n|\n{3,}/.test(text))) return text;
  const board = isBoard(text);
  const out = splitFences(text).map((piece, index) => {
    if (index % 2 === 1) return piece;
    if (board) return stripTicks(piece);
    return piece.split(NL_RE).map((part, i) => (i % 2 === 1 ? part : designLine(part))).join("");
  }).join("");
  const collapsed = out.replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "");
  // أسطر الإطار المحذوفة في آخر الرسالة لا تترك فراغاً معلّقاً
  return /\n$/.test(text) ? collapsed.replace(/\n{2,}$/, "\n") : collapsed.replace(/\n+$/, "");
}

/** هل في النص زخرفة قديمة أو backticks زخرفية؟ (لفحص التصميم والاختبارات) */
function designViolations(text) {
  const found = [];
  for (const [index, piece] of splitFences(String(text ?? "")).entries()) {
    if (index % 2 === 1) continue;
    if (/`/.test(piece)) found.push("backtick");
    if (!isBoard(piece) && LEGACY_RE.test(piece)) found.push("legacy-glyph");
    if (AESTHETIC_RE.test(piece)) found.push("legacy-flourish");
  }
  return [...new Set(found)];
}

/**
 * بعد الترجمة: رموز المحرّك العربية في بداية الأسطر ⇒ رموز لغة المستلم.
 * @param {string} text
 * @param {"ar"|"en"|"es"} lang
 */
function themeGlyphs(text, lang) {
  const th = THEMES[lang];
  if (!th || lang === "ar" || typeof text !== "string" || !text) return text;
  return splitFences(text).map((piece, index) => (index % 2 === 1 ? piece : piece.split("\n").map((line) => {
    if (line.trim() === AR.rule) return line.replace(AR.rule, th.rule);
    if (line.trim() === AR.softRule) return line.replace(AR.softRule, th.softRule);
    return line
      .replace(/^(\s*>\s*)◈ /, `$1${th.row} `)
      .replace(/^(\s*\*?)❋ /, `$1${th.section} `)
      .replace(/^(\s*)✧ (?=\*)/, `$1${th.brand} `);
  }).join("\n"))).join("");
}

export { AESTHETIC_RE, LEGACY_GLYPHS, LEGACY_RE, designLine, designText, designViolations, isBoard, splitFences, stripTicks, themeGlyphs };
export default { designText, designLine, designViolations, themeGlyphs, stripTicks, isBoard };
