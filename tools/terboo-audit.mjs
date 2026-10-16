// ═══════════════════════════════════════════════
// 🔍 Bot Terboo — Static Audit
// ───────────────────────────────────────────────
// ثلاثة فحوص ثابتة على كامل المشروع:
//   1. localization : كل نص معروض مغطّى في كتالوجات ar/en/es (بنفس العناصر النائبة، بلا إندونيسي).
//   2. branding     : بقايا الهوية القديمة الظاهرة للمستخدم.
//   3. fonts        : استخدام خطوط النظام مباشرة داخل التصميم.
//   4. filenames / legacyRefs : أسماء ملفات ومراجع محلية قديمة.
//   5. design       : Strict Design Audit (§47) على كل نص يراه المستخدم:
//        backticks الزخرفة · الزخارف/الإطارات القديمة · الخطوط المزخرفة = 0
//        (كتل الكود متعددة الأسطر ولوحات الألعاب محتوى وظيفي لا زخرفة).
//
// يعمل بنظام Baseline: المخالفات القديمة المعروفة مسجّلة في
// tools/audit-baseline.json، والأداة تفشل فقط عند ظهور مخالفة **جديدة**.
//
// الاستخدام:
//   node tools/terboo-audit.mjs                # فحص (يفشل عند مخالفة جديدة)
//   node tools/terboo-audit.mjs --update       # تحديث الـbaseline
//   node tools/terboo-audit.mjs --report       # تقرير مفصّل بلا فشل
// ═══════════════════════════════════════════════

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { distinctUnits, extractUnits } from "./terboo-i18n-extract.mjs";
import { sourceLanguage } from "../src/lib/terboo-i18n/units.js";
import { AESTHETIC_RE, LEGACY_RE, isBoard } from "../src/lib/terboo-design.js";
import { STYLED_FONT, designFiles, userFacingLiterals } from "./terboo-design-migrate.mjs";

const args = process.argv.slice(2);
const UPDATE = args.includes("--update");
const REPORT = args.includes("--report");
const STRICT = args.includes("--strict");

const ROOT = process.cwd();
const BASELINE_FILE = path.join(ROOT, "tools", "audit-baseline.json");

const SKIP_DIRS = new Set([
  "node_modules", ".git", "database", "session", "tmp", "temp",
  "downloads", "assets", "data", "src/data", "src/tiktok",
]);

// ملفات يُسمح فيها بالنصوص المكتوبة مباشرة (هي مصدر الترجمة نفسه)
const TEXT_ALLOWED = [
  /^src\/lib\/terboo-locales\//,
  /^src\/lib\/terboo-localization\.js$/,
  /^src\/lib\/terboo-ai-intents\.js$/,
  /^src\/lib\/terboo-ui-theme\.js$/,
  /^tools\//,
  /^tests\//,
  /^config\.js$/,
];

// الهوية القديمة الظاهرة للمستخدم
const OLD_BRANDING = [
  "MAROBOT", "Maro-AI", "MaroBot", "MABROK", "Haidera",
  "MaroMD", "MaroNextGen", "Mabrok Gmal", "MaroAI", "Zann", "Mabrok", "مبروك جمال",
  "𝑴𝑨𝑹𝑶", "𝐌𝐀𝐑𝐎", "Marobot", "Bot Terboo v1",
  // اسم العرض بالإصدار القديم: الاسم الظاهر «Bot Terboo» فقط (مرادف داخلي في terboo-brand.js)
  "Bot Terboo v4.0", "Bot Terboo v4",
  // الهوية السابقة (v2) — أصبحت قديمة بعد التحول إلى Terboo/تيربو (§45)
  "Tarboo", "TARBOO", "Bot Tarboo", "تاربو", "تاربـو", "طربوش", "𝗧𝗮𝗿𝗯𝗼𝗼",
  "mabrokgmal", "mabrukgmal", "MABROKGMAL", "MABRUKGMAL", "MabrukGmal", "MabrokGmal",
  "0029VbDjKQADeOMyA4jOPk2u", "120363427123543424", "120363400911374213",
];

/** المصطلحات بعد التطبيع — لأن السطر نفسه يُطبَّع قبل المقارنة */
const OLD_BRANDING_NORMALIZED = [...new Set(OLD_BRANDING.map((term) => term.normalize("NFKC")))];
/** اسم قديم مكتوب بحروف مزخرفة */
/** مقطع اسم قديم داخل معرّف (بغض النظر عن حالة الأحرف) — maro وحده ليس منها لأنه يطابق كلمات عادية (camaron) ويُفحص في legacyRefs */
const LEGACY_SEGMENT = /^(zann+|haidera|mabr[ou]k|marobot|mabr[ou]kgmal)$/i;
const STYLED_LEGACY = /^(maro|marobot|mabrok|mabruk|haidera|zann|tarboo)/i;
/** اسم قديم بحروف متباعدة: «M A R O   B O T» · «T A R B O O» */
const SPACED_LEGACY = /(?:^|[^A-Za-z])((?:[A-Za-z] {1,3}){3,}[A-Za-z])(?![A-Za-z])/g;

// أسطر يُسمح ببقاء الاسم القديم فيها (معرّفات تقنية لا تظهر للمستخدم)
/**
 * أسطر يُسمح ببقاء الاسم القديم فيها لأنها ليست هوية معروضة:
 *  • قيم مفاتيح API الخارجية (§2 §35) — تبقى حرفياً.
 *  • أسماء متغيّرات بيئة قديمة محفوظة كاحتياط للترحيل (§34).
 *  • قائمة المصطلحات داخل هذا الفاحص نفسه.
 */
// أسماء بيئة قديمة (للتوافق) + معرّفات بروتوكول جسر لوحة Manus الخارجي (اسم ترويسة المصادقة
// ومعرّف مهمة الفحص يتحقق منهما خادم الجسر المنشور، فلا يجوز تغييرهما — §2/§35)
const BRANDING_TECHNICAL = /process\.env\.(?:MAROBOT|TARBOO)_[A-Z_]+|"x-marobot-token"|"marobot-bridge-probe"/;

/**
 * أسطر موثّقة يُسمح فيها بذكر اسم سابق لأنها تحمي الهوية ولا تعرضها (§45):
 * كل قاعدة = ملف + نمط سطر + سبب يُطبع في التقرير.
 */
const BRANDING_EXCEPTIONS = [
  { file: /^plugins\//, line: /^\s*alias(?:es)?\s*:\s*\[/,
    reason: "مصفوفات مرادفات التوافق (maro/tarboo) — للاستدعاء فقط، وتُخفى من كل عرض عبر visibleAliases" },
  { file: /^src\/lib\/terboo-brand\.js$/, line: /FORBIDDEN_NAME_FORMS =|LEGACY_ALIAS =|not طربوش, not تاربو|مرادفات توافق قديمة \(maro\/tarboo\/مارو\/تاربو\)/,
    reason: "قفل الهوية نفسه: قائمة الأشكال الممنوعة التي يصحّحها enforceBrand ويحذّر منها النموذج" },
  { file: /^src\/scraper\/unlimitedai\.js$/, line: /"مارو" و"تاربو" اسما الشخصية السابقان|character === "مارو" \|\| character === "تاربو"/,
    reason: "ترحيل مفتاح الشخصية المحفوظ من الاسمين السابقين إلى تيربو" },
  { file: /^src\/lib\/terboo-(apimanager|games)\.js$/, line: /^\s*(export \{ TerbooGames, TerbooGames as MaroGames, TerbooGames as TarbooGames, games \};|Terboo\w+ as Tarboo\w+,|terbooApi as tarbooApi,)\s*$/,
    reason: "أسماء تصدير deprecated من الإصدار السابق حتى لا تنكسر البلوقنات الخارجية المكتوبة له (§2) — لا تظهر للمستخدم" },
  { file: /^tests\/terboo-brand-lock\.test\.mjs$/, line: /.*/,
    reason: "اختبار قفل الهوية يُدخل الأشكال الممنوعة عمداً ليتحقق من تصحيحها وإخفائها" },
  { file: /^(src\/lib\/terboo-jadibot-manager\.js|src\/web\/services\/subbot-(provision|service)\.js|src\/web\/http\/routes\/subbots\.js|plugins\/owner\/موقع\.js|tests\/(web-(api-integration|subbot-provision)|owner-website-panel)\.test\.mjs)$/,
    line: /TARBOOV6/,
    reason: "وسم تدفق تنصيب البوت الفرعي TARBOOV6 الذي حدّده المالك صراحةً — تسمية تجربة تنصيب لا هوية بوت معروضة ولا رمز اقتران" },
];

// خطوط النظام التي يجب ألا تُستعمل مباشرة في أي واجهة (§20).
// المكان الوحيد المسموح بذكرها فيه هو src/lib/terboo-fonts.js (مستثنى أدناه).
const LEGACY_FAMILY = /\b(Arial|Helvetica|Courier New|Impact|Times New Roman|Comic Sans|Poppins|Verdana|Tahoma)\b/i;
/** سياق يدل على أن السطر يحدّد خطاً فعلاً */
const FONT_CONTEXT = /ctx\s*\.\s*font|font\s*-\s*family|fontFamily|GlobalFonts\s*\.\s*register|registerFromPath|font\s*:\s*[`"']/i;
/**
 * الاحتياط العام لا يُكتب خارج ملف الخطوط.
 * (monospace مستثنى: عرض الكود يحتاجه فعلاً ولا يصلح له خط متناسب.)
 */
const GENERIC_FALLBACK = /["'`][^"'`]*\b(?:sans-serif|cursive)\b[^"'`]*["'`]/;

/** خطوط قديمة بالاسم أو بالملف في أي سياق كود (§28) */
const LEGACY_FONT_NAME = /\b(?:Zahraaa|CartoonVibes|Epep|ArialNarrow)\b|["'`]Levelup["'`]/;
const LEGACY_FONT_FILE = /\b(?:Zahraaa|Epep|Levelup|arialnarrow|arial|Poppins)\.(?:ttf|otf|woff2?)\b/i;

function hasLegacyFont(line) {
  if (GENERIC_FALLBACK.test(line)) return true;
  if (LEGACY_FONT_NAME.test(line) || LEGACY_FONT_FILE.test(line)) return true;
  return LEGACY_FAMILY.test(line) && FONT_CONTEXT.test(line);
}

/**
 * مفتاح المخالفة = الملف + بصمة محتوى السطر، لا رقم السطر.
 * هكذا لا يتحوّل انتقال سطر بسبب تعديل غير ذي صلة إلى «مخالفة جديدة»،
 * بينما يظل أي نص جديد فعلاً مكشوفاً لأن بصمته لم تُسجَّل من قبل.
 */
function findingKey(file, line, extra = "") {
  const normalized = String(line).replace(/\s+/g, " ").trim();
  const hash = crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 12);
  return `${file}#${hash}${extra ? `:${extra}` : ""}`;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.relative(ROOT, path.join(dir, entry.name));
    if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(rel)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** هل هذا السطر نص يراه المستخدم؟ (إرسال/رد بنص مكتوب مباشرة) */
const USER_FACING_SEND = /(m\.reply|sendMessage|sendText|m\.statusReply|caption\s*:|contentText\s*:|footerText\s*:|display_text\s*:|displayText\s*:|body\s*:\s*\{?\s*text)/;
/** نص عربي أو لاتيني طويل بما يكفي ليكون جملة للمستخدم */
const SENTENCE = /[؀-ۿ]{4,}|[A-Za-z]{4,}\s+[A-Za-z]{3,}/;
/** استُخدم نظام الترجمة في هذا السطر */
const USES_I18N = /\bt\s*\(|getUserLanguage|t\(lang|config\.messages|UI\.|локал/;

/**
 * تغطية الترجمة (§30/§31): كل نص معروض يستخرجه tools/terboo-i18n-extract.mjs من
 * src/ و plugins/ و case/ و config.js يجب أن يملك ترجمة في كتالوجات ar/en/es،
 * بنفس العناصر النائبة {n}، ومن دون نص إندونيسي في أي لغة هدف.
 * الاستثناء الوحيد: مفاتيح مسجّلة في tools/i18n/exceptions.json بسبب موثّق،
 * ولا يُقبل استثناء لملف غير ملفه ولا استثناء لم يعد موجوداً (stale).
 */
/**
 * كشف نص إندونيسي داخل ترجمة هدف: كلمة إندونيسية صريحة واحدة، أو كلمتان مشتركتان.
 * رموز الأوامر ({0}ganti-asset · .cekjeda) تُحذف أولاً، وكلمات مثل «saldo» (إسبانية أيضاً)
 * أو «Salah» (اسم علم) لا تكفي وحدها.
 */
const INDONESIAN_STRONG = /(?<![A-Za-z])(yang|tidak|untuk|dengan|sudah|belum|kamu|anda|silakan|silahkan|berhasil|gagal|masukkan|ketik|sedang|harap|tunggu|bisa|adalah|karena|tolong|mohon|gunakan|dikirim|ditemukan|tersedia|pengguna|menit|detik|hadiah|terima kasih|maaf|jawaban|sekarang|kembali|hapus|tambah|lihat|kirim|ambil|belum|sudah|nggak|gak|aja|dong|kak)(?![A-Za-z])/i;
function looksIndonesian(text) {
  const clean = String(text).replace(/(?:\{\d+\}|[.\/])[\p{L}_\d-]+/gu, " ");
  if (INDONESIAN_STRONG.test(clean)) return true;
  if (sourceLanguage(clean) !== "id") return false;
  const words = new Set((clean.match(/[A-Za-z]+/g) || []).map((w) => w.toLowerCase()));
  const hits = [...words].filter((w) => /^(dan|dari|atau|ini|itu|akan|oleh|pada|jika|kalau|contoh|grup|pesan|gambar|lagu|nama|waktu|hari|jam|koin|selamat|benar|jawab|soal|pilih|keluar|masuk|buat|ganti|ubah|beli|jual)$/.test(w));
  return hits.length >= 2;
}

function scanLocalization() {
  const findings = [];
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const catalogs = Object.fromEntries(["ar", "en"].map((l) => [l, read(`src/lib/terboo-i18n/catalog/${l}.json`)]));
  const exceptionsFile = fs.existsSync(path.join(ROOT, "tools/i18n/exceptions.json")) ? read("tools/i18n/exceptions.json") : { entries: [], reasons: {} };
  const exceptions = new Map(exceptionsFile.entries.map((entry) => [entry.key, entry]));
  const holes = (text) => (String(text).match(/\{\d+\}/g) || []).sort().join(",");
  const units = distinctUnits(extractUnits());
  const seen = new Set();
  for (const unit of units) {
    seen.add(unit.key);
    const tag = (kind) => findingKey(unit.refs[0]?.replace(/:\d+$/, "") || "?", unit.key, kind);
    const exception = exceptions.get(unit.key);
    if (exception) {
      const allowedFiles = exception.files || [exception.file];
      const sameFile = unit.refs.every((ref) => allowedFiles.some((file) => ref.startsWith(`${file}:`)));
      if (!exceptionsFile.reasons?.[exception.reason] || !sameFile) findings.push(tag("bad-exception"));
      continue;
    }
    const targets = unit.lang === "ar" ? ["en"] : ["ar", "en"];
    for (const lang of targets) {
      const value = catalogs[lang][unit.key];
      if (typeof value !== "string" || !value.trim()) { findings.push(tag(`missing-${lang}`)); continue; }
      if (holes(value) !== holes(unit.key)) findings.push(tag(`placeholders-${lang}`));
      if (looksIndonesian(value)) findings.push(tag(`indonesian-${lang}`));
    }
  }
  for (const key of exceptions.keys()) if (!seen.has(key)) findings.push(findingKey("tools/i18n/exceptions.json", key, "stale-exception"));
  return findings;
}

/**
 * قيم مفاتيح API الحقيقية من config.js (§2 §35).
 * الاسم القديم مسموح فقط حين يكون جزءاً من قيمة مفتاح خارجي ثابتة؛
 * نحذف هذه القيم من السطر قبل الفحص، فأي ذكر آخر للاسم القديم يُكشف.
 */
function immutableApiValues() {
  // config.js غائب (نسخة توزيع بلا إعدادات) ⇒ لا قيم ثابتة لاستثنائها
  const file = path.join(ROOT, "config.js");
  if (!fs.existsSync(file)) return [];
  const src = fs.readFileSync(file, "utf8");
  const start = src.indexOf("APIkey: {");
  if (start === -1) return [];
  const end = src.indexOf("},", start);
  const block = src.slice(start, end);
  return [...block.matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]).filter(Boolean);
}
// معرّفات حسابات خارجية حقيقية للمطوّر (إنستغرام/جيتهاب/بريد) — ثابتة كقيم API ولا تُغيَّر (§3/§7)
const EXTERNAL_IDS = ["Tarboobot2888", "tarboo455", "mahmoudtarboo09"];
const API_VALUES = [...immutableApiValues(), ...EXTERNAL_IDS].sort((a, b) => b.length - a.length);

function stripApiValues(line) {
  let out = line;
  for (const value of API_VALUES) {
    if (out.includes(value)) out = out.split(value).join("");
  }
  return out;
}

function scanBranding(files) {
  const findings = [];
  for (const file of files) {
    if (/^tools\/terboo-audit\.mjs$/.test(file)) continue;
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((rawLine) => {
      if (BRANDING_TECHNICAL.test(rawLine)) return;
      if (BRANDING_EXCEPTIONS.some((rule) => rule.file.test(file) && rule.line.test(rawLine))) return;
      // NFKC: الحروف الزخرفية (𝑴𝑨𝑩𝑹𝑼𝑲 / 𝐌𝐀𝐑𝐎) تُطبَّع إلى حروفها العادية قبل المقارنة
      const line = stripApiValues(rawLine).normalize("NFKC");
      for (const term of OLD_BRANDING_NORMALIZED) {
        if (line.includes(term)) {
          findings.push(findingKey(file, rawLine, term));
          return;
        }
      }
      // مقطع معرّف بأحرف صغيرة أو مدمج: zannContext · hanya_zann · mabrokBot
      for (const word of line.match(/[A-Za-z0-9]+/g) || []) {
        for (const part of word.split(/(?<=[a-z0-9])(?=[A-Z])|\d+/)) {
          if (LEGACY_SEGMENT.test(part)) {
            findings.push(findingKey(file, rawLine, part));
            return;
          }
        }
      }
      for (const match of line.matchAll(SPACED_LEGACY)) {
        const joined = match[1].replace(/ /g, "");
        if (STYLED_LEGACY.test(joined)) {
          findings.push(findingKey(file, rawLine, joined));
          return;
        }
      }
      // كلمة مزخرفة (حروف رياضية/مزدوجة) تُطبَّع إلى اسم قديم: 𝑀ARO · 𝕸𝕬𝕽𝕺 · 𝐌𝐚𝐫𝐨
      for (const token of stripApiValues(rawLine).match(/[\p{L}\p{N}]+/gu) || []) {
        if (!/[\u{1D400}-\u{1D7FF}\u{FF00}-\u{FFEF}]/u.test(token)) continue;
        const plain = token.normalize("NFKC");
        if (STYLED_LEGACY.test(plain)) {
          findings.push(findingKey(file, rawLine, plain));
          return;
        }
      }
    });
  }
  return findings;
}

function scanFonts(files) {
  const findings = [];
  for (const file of files) {
    if (/^(tools|tests)\//.test(file)) continue;
    if (/^src\/lib\/terboo-fonts\.js$/.test(file)) continue;
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (hasLegacyFont(line)) findings.push(findingKey(file, line));
    });
  }
  return findings;
}

/**
 * فحص رابع (§44): لا يجوز بقاء أي ملف أو مجلّد محلي يحمل الهوية القديمة.
 * node_modules خارج نطاق الفحص؛ ومنذ v4 لم تعد حزمة الـfork "maro" معتمدة أصلاً.
 */
const LEGACY_NAME = /^(maro|marobot|mabrok|haidera|zann|tarboo)/i;

function scanFilenames() {
  const findings = [];
  const seen = new Set();
  const walkAll = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = path.relative(ROOT, path.join(dir, entry.name)).split(path.sep).join("/");
      if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(rel)) continue;
      if (LEGACY_NAME.test(entry.name) && !seen.has(rel)) {
        seen.add(rel);
        findings.push(`${rel}#name`);
      }
      if (entry.isDirectory()) walkAll(path.join(dir, entry.name));
    }
  };
  walkAll(ROOT);
  return findings;
}

/**
 * فحص خامس (§43 §44): أي ذكر محلي متبقٍّ للاسم القديم في الكود والإعدادات.
 * كل استثناء هنا موثّق بسببه، ويُطبع في التقرير النهائي كما هو.
 * بيانات الألعاب في src/data خارج الفحص: "maro" فيها جواب لعبة لا هوية.
 */
const LEGACY_EXCEPTIONS = [
  { file: /^src\/lib\/terboo-i18n\/(catalog\/(en|es)\.json|args\.js)$/, pattern: /(?<=\p{L})maro/giu,
    reason: "حروف داخل كلمة إسبانية/إنجليزية عادية (llamaron · tomaron · camaron) — ليست الاسم القديم" },
  { file: /^package-lock\.json$/, pattern: /"integrity":\s*"sha\d+-[^"]+"/g,
    reason: "بصمات sha512 بصيغة base64 قد تحوي الحروف صدفةً" },
  { file: /.*/, pattern: /process\.env\.(?:MAROBOT|TARBOO)_[A-Z_]+/g,
    reason: "متغيّرات بيئة سابقة (MAROBOT_* و TARBOO_*) تُقرأ كاحتياط بعد TERBOO_* (ترحيل بلا كسر)" },
  { file: /^src\/lib\/terboo-brand\.js$/, pattern: /FORBIDDEN_NAME_FORMS = .*|LEGACY_ALIAS = .*|not طربوش, not تاربو|\(maro\/tarboo\/مارو\/تاربو\)/g,
    reason: "قفل الهوية: الأشكال الممنوعة التي يصحّحها enforceBrand ومرشّح المرادفات القديمة" },
  { file: /^src\/lib\/manus-api\.js$/, pattern: /https:\/\/marobotdash-[\w-]+\.manus\.space|x-marobot-token|marobot-bridge-probe/g,
    reason: "معرّفات جسر Manus خارجي منشور بهذا الاسم — تغييرها يقطع الاتصال" },
  { file: /^(src\/lib\/terboo-apimanager\.js|tools\/probe-priority-endpoints\.mjs)$/, pattern: /https:\/\/api\.maro\.my\.id\/?|MaroMyIdHostProvider|\bmaro:\s*MaroMyIdHostProvider|id:\s*"maro-api"/g,
    reason: "مزوّد API خارجي مستضاف على api.maro.my.id — اسم نطاق طرف ثالث" },
  { file: /^src\/lib\/terboo-apimanager\.js$/, pattern: /\w+ as (?:MaroApiManager|MaroApiProvider|maroApi|TarbooApiManager|TarbooApiProvider|tarbooApi)/g,
    reason: "مرادفات تصدير deprecated للبلوقنات الخارجية المكتوبة للأساس القديم" },
  { file: /^src\/lib\/terboo-games\.js$/, pattern: /TerbooGames as MaroGames|TerbooGames as TarbooGames/g,
    reason: "مرادف تصدير deprecated للبلوقنات الخارجية" },
  { file: /^plugins\//, pattern: /['"](?:ganti-(?:maro|tarboo)[\w.-]*|تغيير_صورة_(?:maro|tarboo)[23]|(?:maro|tarboo)-large|مارو|ماروai|maro|maroai|مارووكيل|تاربو|تاربوai|tarboo|tarbooai|تاربووكيل)['"]/g,
    reason: "مرادفات أوامر سابقة (maro/tarboo) تبقى للاستدعاء فقط ولا تُعرض (visibleAliases) — §2 يمنع حذف مرادفات التوافق" },
  { file: /^(src\/lib\/terboo-ai-core\.js|tests\/terboo-group-ai-reports\.test\.mjs)$/, pattern: /· tarboo ·|"tarboo hi"/g,
    reason: "صيغ النداء المنطوقة التي طلب المالك أن يرد عليها البوت (tarboo · tarbo) — نداء للبوت لا اسم هوية معروض" },
  { file: /^(src\/lib\/terboo-jadibot-manager\.js|src\/web\/services\/subbot-(provision|service)\.js|src\/web\/http\/routes\/subbots\.js|plugins\/owner\/موقع\.js|tests\/(web-(api-integration|subbot-provision)|owner-website-panel)\.test\.mjs)$/,
    pattern: /TARBOOV6/g,
    reason: "وسم تدفق تنصيب البوت الفرعي TARBOOV6 الذي حدّده المالك صراحةً — تسمية تجربة تنصيب (badge/campaign) لا هوية بوت معروضة ولا رمز اقتران" },
  { file: /^plugins\/group\/autoai\.js$/, pattern: /tarboomode|maromode/g,
    reason: "خيارا سطر أوامر سابقان (--maromode / --tarboomode) مقبولان بجانب --persona و--terboomode" },
  { file: /^src\/lib\/terboo-auto-backup\.js$/, pattern: /"maro",|"MaroGlitch-Baileys-main",|"\.maro-temp",/g,
    reason: "أسماء مجلدات أطراف ثالثة تُستبعد من النسخ الاحتياطي" },
  { file: /^src\/lib\/terboo-asset-manager\.js$/, pattern: /maro|tarboo/gi,
    reason: "كود الترحيل التشغيلي من أسماء الأصول السابقة (maro/tarboo ← terboo)" },
  { file: /^src\/lib\/terboo-ai-memory\.js$/, pattern: /"tarboo-memory\.json"/g,
    reason: "ترحيل ملف الذاكرة من اسم الإصدار السابق مرة واحدة حتى لا تضيع ذاكرة المستخدمين" },
  { file: /^src\/scraper\/unlimitedai\.js$/, pattern: /"مارو"|"تاربو"|"مارو" و"تاربو"/g,
    reason: "ترحيل اسمي الشخصية السابقين إلى تيربو" },
  { file: /^tests\/terboo-import-graph\.test\.mjs$/, pattern: /maro-\*|maro-\[\^\/\]\*|\/maro-locales\\\/|name === "maro"/g,
    reason: "اختبار يتحقق من غياب الاستيرادات القديمة ومن غياب الـfork السابق maro" },
  { file: /^tests\/terboo-baileys-migration\.test\.mjs$/, pattern: /dependencies\.maro|node_modules\/maro/g,
    reason: "اختبار الانتقال يثبت أن الـfork السابق maro لم يعد معتمداً ولا مثبّتاً" },
  { file: /^tests\/autoai-always-reply\.test\.mjs$/, pattern: /--(?:maro|tarboo)mode/g,
    reason: "اختبار توافق يثبت أن الخيار القديم ما زال مقبولاً" },
  { file: /^tests\/terboo-brand-lock\.test\.mjs$/, pattern: /.+/g,
    reason: "اختبار قفل الهوية يُدخل الأشكال الممنوعة عمداً ليتحقق من تصحيحها وإخفائها" },
  { file: /^tools\/terboo-rename-map\.json$/, pattern: /maro|مارو|tarboo|تاربو/gi,
    reason: "سجل إعادة التسمية (قديم ← جديد) الذي تعتمد عليه مقارنة المانيفست §45 — الأسماء القديمة فيه مفاتيح تاريخية لا استخدام" },
  { file: /^(?:tools\/terboo-dependency-truth\.mjs|docs\/terboo-runtime-dependency-truth\.json)$/, pattern: /maro/gi,
    reason: "تقرير حقيقة الاعتماديات (§2) يفحص صراحةً غياب الـalias القديم «maro» — اسم مفحوص لا مستخدم" },
  { file: /^TERBOO_(?:V6_)?(?:BEFORE|AFTER)_MANIFEST\.json$/, pattern: /maro|مارو|tarboo|تاربو/gi,
    reason: "لقطتا الفحص الجنائي v5 (§1 §119): «قبل» سجل حرفي لأرشيف v4.0، و«بعد» يحوي مرادفات التوافق المخفية — بيانات مقارنة لا استخدام" },
  { file: /^tools\/manifests\/manifest-v[345](?:-prev)?-(?:before|after)\.json$/, pattern: /maro|مارو|tarboo|تاربو/gi,
    reason: "لقطتا Manifest قبل/بعد (§1 §60): «قبل» سجل تاريخي بأسماء الملفات السابقة، و«بعد» يحوي مرادفات التوافق المخفية — بيانات مقارنة لا استخدام" },
  { file: /^docs\/(?:inventory\/(?:before|after)\/[\w-]+\.json|web-platform\/[\w-]+\.json|terboo-api-health-matrix\.(?:json|md)|terboo-plugin-health\.json)$/, pattern: /maro|مارو|tarboo|تاربو/gi,
    reason: "جرد/مصفوفات مولَّدة (inventory · web-platform · api-health · plugin-health) تسجّل الملفات والمرادفات والنطاقات الخارجية كما هي فعلاً (منها نطاق طرف ثالث api.maro.my.id ومرادفات الأوامر المخفية)" },
];

const LEGACY_TOKEN = /maro|tarboo|(?<![؀-ۿ])(?:مارو|تاربو|طربوش)/i;
const LEGACY_SCAN_EXT = /\.(js|mjs|cjs|json)$/;

function scanLegacyRefs() {
  const findings = [];
  const targets = [];
  const walkCode = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(ROOT, full).split(path.sep).join("/");
      if (SKIP_DIRS.has(entry.name) || SKIP_DIRS.has(rel)) continue;
      if (rel === "tools/audit-baseline.json" || rel === "tools/terboo-audit.mjs") continue;
      if (entry.isDirectory()) walkCode(full);
      else if (LEGACY_SCAN_EXT.test(entry.name)) targets.push(rel);
    }
  };
  walkCode(ROOT);

  for (const file of targets) {
    const rules = LEGACY_EXCEPTIONS.filter((rule) => rule.file.test(file));
    const lines = fs.readFileSync(path.join(ROOT, file), "utf8").split("\n");
    lines.forEach((rawLine) => {
      if (!LEGACY_TOKEN.test(rawLine)) return;
      let line = stripApiValues(rawLine);
      for (const rule of rules) line = line.replace(rule.pattern, "");
      if (LEGACY_TOKEN.test(line)) findings.push(findingKey(file, rawLine, "legacy"));
    });
  }
  return findings;
}

/** Strict Design Audit (§47): نفس قواعد طبقة التصميم على مستوى المصدر */
function scanDesign() {
  const findings = [];
  for (const rel of designFiles()) {
    for (const { text } of userFacingLiterals(rel)) {
      // كتل الكود الحقيقية وحواجزها (```lang\n … \n```) ليست زخرفة
      const bare = text.replace(/```[^\n`]*\n[\s\S]*?\n```/g, "").replace(/```[\w-]*\n|\n```/g, "");
      if (/`/.test(bare)) findings.push(findingKey(rel, text, "backtick"));
      else if (!isBoard(text) && LEGACY_RE.test(bare)) findings.push(findingKey(rel, text, "legacy-decoration"));
      else if (AESTHETIC_RE.test(bare)) findings.push(findingKey(rel, text, "legacy-flourish"));
      else if (STYLED_FONT.test(text)) findings.push(findingKey(rel, text, "styled-font"));
    }
  }
  return findings;
}

const files = walk(ROOT);
const current = {
  localization: scanLocalization(files).sort(),
  branding: scanBranding(files).sort(),
  fonts: scanFonts(files).sort(),
  filenames: scanFilenames().sort(),
  legacyRefs: scanLegacyRefs().sort(),
  design: scanDesign().sort(),
};

if (args.includes("--exceptions")) {
  for (const rule of LEGACY_EXCEPTIONS) console.log(`• ${rule.reason}`);
  for (const rule of BRANDING_EXCEPTIONS) console.log(`• ${rule.reason}`);
  process.exit(0);
}

if (UPDATE) {
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(current, null, 2), "utf8");
  console.log("✅ تم تحديث baseline الفحص:");
  for (const [key, list] of Object.entries(current)) console.log(`   ${key}: ${list.length}`);
  process.exit(0);
}

let baseline = { localization: [], branding: [], fonts: [], filenames: [], legacyRefs: [], design: [] };
try {
  baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
} catch {
  console.log("ℹ️  لا يوجد baseline — شغّل: node tools/terboo-audit.mjs --update");
}

const newIssues = {};
let failed = false;
for (const key of Object.keys(current)) {
  const known = new Set(baseline[key] || []);
  newIssues[key] = current[key].filter((item) => !known.has(item));
  if (newIssues[key].length) failed = true;
}

console.log("═══ Bot Terboo — Static Audit ═══");
for (const key of Object.keys(current)) {
  const total = current[key].length;
  const known = (baseline[key] || []).length;
  const fresh = newIssues[key].length;
  const icon = fresh ? "❌" : "✅";
  console.log(`${icon} ${key.padEnd(14)} الحالي: ${String(total).padEnd(5)} معروف: ${String(known).padEnd(5)} جديد: ${fresh}`);
}

if (REPORT) {
  console.log("\n─── تفاصيل ───");
  for (const [key, list] of Object.entries(current)) {
    console.log(`\n[${key}] ${list.length}`);
    for (const item of list.slice(0, 40)) console.log("   " + item);
    if (list.length > 40) console.log(`   … و ${list.length - 40} أخرى`);
  }
  process.exit(0);
}

// ── وضع STRICT (§31): الـbaseline للتاريخ فقط، والمطلوب صفر مخالفات ──
if (STRICT) {
  const hard = Object.entries(current).filter(([, list]) => list.length > 0);
  console.log("\n─── STRICT ───");
  for (const [key, list] of Object.entries(current)) {
    console.log(`${list.length ? "❌" : "✅"} ${key.padEnd(14)} ${list.length}`);
  }
  if (hard.length) {
    console.error("\n❌ STRICT: المطلوب صفر مخالفات. التفاصيل:");
    for (const [key, list] of hard) {
      for (const item of list.slice(0, 25)) console.error(`   [${key}] ${item}`);
      if (list.length > 25) console.error(`   [${key}] … و ${list.length - 25} أخرى`);
    }
    process.exit(1);
  }
  console.log("\n✅ STRICT: صفر مخالفات في كل الفحوص.");
  process.exit(0);
}

if (failed) {
  console.error("\n❌ مخالفات جديدة:");
  for (const [key, list] of Object.entries(newIssues)) {
    for (const item of list) console.error(`   [${key}] ${item}`);
  }
  console.error("\nإذا كانت مقصودة: node tools/terboo-audit.mjs --update");
  process.exit(1);
}

console.log("\n✅ لا مخالفات جديدة.");
process.exit(0);
