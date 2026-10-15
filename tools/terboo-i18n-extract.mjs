#!/usr/bin/env node
// ═══════════════════════════════════════════════
// 🔎 مستخرج نصوص المستخدم (§30)
// ───────────────────────────────────────────────
// يحلّل كل ملفات src و plugins و case بمحلّل AST حقيقي (acorn) ويجمع كل
// نص طبيعي قد يصل للمستخدم: ردود، تسميات، أوصاف أوامر، أخطاء معروضة،
// محتوى ألعاب، أزرار، تسميات توضيحية… ويستثني ما هو إدخال أو تقني:
//   مقارنات (=== / includes / startsWith / match / split / replace …)
//   · case · RegExp · مفاتيح الكائنات · alias/usage/example/name
//   · console/logger · import/export · قوائم كلمات الإدخال.
// الناتج: وحدات سطرية بقوالب {0} {1} (انظر src/lib/terboo-i18n/units.js).
//
//   node tools/terboo-i18n-extract.mjs            ← ملخّص
//   node tools/terboo-i18n-extract.mjs --write    ← يكتب tools/i18n/units.json
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import * as acorn from "acorn";
import { sourceLanguage, unitOf } from "../src/lib/terboo-i18n/units.js";

const ROOT = process.cwd();
const SCAN = ["src", "plugins", "case"];
const SKIP_DIR = new Set(["node_modules", ".git", "terboo-locales", "terboo-i18n", "data", "tiktok"]);
/** ملفات هي نفسها مصدر ترجمة أو قواميس إدخال */
const SKIP_FILE = [
  /^src\/lib\/terboo-localization\.js$/,
  /^src\/lib\/terboo-ai-intents\.js$/,
  /^src\/lib\/terboo-ai-context\.js$/,
  /^src\/lib\/terboo-command-index\.js$/,
  /^src\/lib\/terboo-fonts\.js$/,
  // سجل الإخفاقات (§31): نصوصه سطور سجل للمطوّر لا رسائل للمستخدم
  /^src\/lib\/terboo-failure-log\.js$/,
  // سجل قدرات واتساب (§10): بيانات وصفية وأكواد تحقق للمطوّر/التقارير — لا تُرسل للمستخدم
  /^src\/lib\/terboo-wa-capabilities\.js$/,
  // البنّاء التفاعلي (§9): يبني الحمولة فقط؛ كل نص معروض يأتي من المستدعي بلغته
  /^src\/lib\/terboo-interactive-builder\.js$/,
  // سجل الأدوات الموحّد (§24 §35): مفردات بحث القدرات ووصف مخططات المدخلات للنموذج — لا يُرسل للمستخدم
  /^src\/lib\/terboo-tool-registry\.js$/,
  // سجل القدرات الموحّد (V6 §12): بيانات وصفية للمطوّر/الموقع/المصفوفات — لا يُرسل نصه للمستخدم
  /^src\/lib\/terboo-capability-registry\.js$/,
  // محلّل التذكيرات (§21): مفردات أنماط الوقت (أجزاء RegExp) — كل نص معروض عبر t() من الكتالوج
  /^src\/lib\/terboo-reminders\.js$/,
  // كتالوج قدرات مزوّد VPS: توثيق للمطوّر ومصفوفة الصلاحيات (docs/) — الواجهة تعرض تسمياتها من terboo-locales
  /^src\/lib\/providers\/virtualizor\/virtualizor-capabilities\.js$/,
  // مُنشئ VPS: رموز حالات/ملاحظات داخلية للطلبات والتدقيق — كل نص للمستخدم من terboo-locales (vpsAdmin.* · cloudErr.*)
  /^src\/lib\/providers\/virtualizor\/virtualizor-provisioner\.js$/,
  // TERBOO ARCADE: كل نص معروض مسجّل بالثلاث لغات داخل الملف نفسه (register("g.<id>", {ar, en, es}))
  // ومحقق الاكتمال في tests/terboo-arcade-engine.test.mjs (missingKeys = 0) — مصدر ترجمة لا نص خام
  /^src\/lib\/terboo-arcade\//,
  // نظام تصميم الألعاب وبنّاء HTML: CSS وقوالب وسوم تقنية؛ كل نص معروض يأتي من terboo-arcade/locale بلغة اللاعب
  /^src\/lib\/terboo-game-design-system\.js$/,
  /^src\/lib\/terboo-html-game\.js$/,
  // محرك أهلية العرض المرئي: أسباب القرار وأسماء الأوامر بيانات وصفية للمصفوفة (docs/) — لا تُرسل للمستخدم
  /^src\/lib\/terboo-visual-response\.js$/,
];

/** دوال تبني تعليمات للنموذج (نص للنموذج لا للمستخدم) */
const MODEL_FUNCTIONS = /(Instruction|Prompt|ForModel|semanticSummary|proposeFix|refreshSummary|buildSystem|systemText)/;

/** مفاتيح خصائص قيمها ليست نصاً معروضاً (إدخال/معرّفات/تقنية) */
const NON_DISPLAY_KEYS = new Set([
  "alias", "aliases", "usage", "example", "examples", "name", "command", "cmd", "id", "buttonId", "rowId",
  "selectedId", "url", "link", "href", "apikey", "apiKey", "key", "type", "mimetype", "mime", "path", "file",
  "fileName", "filename", "ext", "method", "headers", "category", "trigger", "triggers", "pattern", "regex",
  "match", "answer", "answers", "jawaban", "value", "icon", "emoji", "flag", "code", "lang", "language",
  "locale", "format", "model", "provider", "endpoint", "host", "domain", "token", "voice", "userAgent",
  // مدخلات نماذج الذكاء/الصور: تعليمات للنموذج لا نص للمستخدم (لغتها محايدة بتوجيه لغة الرد)
  "instruction", "instructions", "prompt", "negative_prompt", "negativePrompt", "negative", "system",
  "systemPrompt", "system_prompt", "persona", "style", "stylePrompt", "query", "q", "search", "selector",
  "User-Agent", "user-agent", "referer", "Referer", "origin", "cookie", "accept", "Accept", "contentType",
  // قوائم كلمات إدخال (نوايا/مرادفات) وسياق النموذج
  "words", "args", "keyword", "keywords", "markers", "suffixes", "synonyms", "stopwords", "context",
  // بيانات وصف الأدوات للنموذج (سجل الـscrapers): غرض/نوع/مدخل/مخرج — ليست نصاً للمستخدم
  "purpose", "kind", "input", "output",
  // سجل تسليم القوائم: مرحلة/نوع الحمولة — تشخيص للمالك لا نص للمستخدم
  "stage", "payloadType", "outcome", "fallbackFrom",
  // طبقة الوسائط: تعليمات إضافية للنموذج ولغات OCR
  "extraInstruction", "languages",
]);

/** متغيرات تحمل تعليمات نماذج (لا تُعرض للمستخدم) */
const MODEL_TEXT = /(PROMPT|INSTRUCTION|PERSONA|SYSTEM|NEGATIVE)/i;

/** نص تقني بشكله: محدّدات CSS، وكيل متصفح، وسائط ffmpeg، قوالب روابط/ملفات، أنواع MIME، صيغ تاريخ */
function technicalText(text) {
  const t = String(text).trim();
  return /^use strict$/i.test(t)
    || /Mozilla\/\d|AppleWebKit|Chrome\/\d|Safari\/\d/.test(t)
    || /^[\w-]*[#.]?[\w-]+\[[^\]]+\]|^\[[\w-]+=|^[a-z]+[#.][\w-]+(\s|$)|^(meta|input|img|div|span|a|button|script|link|style)\b[\[#.:,]/i.test(t)
    || /(^|\s)-(vf|af|vcodec|acodec|c:[av]|b:[av]|filter_complex|y|i|ss|t|r|ar|ac|loop|pix_fmt|preset|crf)\b|force_original_aspect_ratio|libwebp|libopus|libx264|atempo=|asetrate=|scale=\d|scale='|silencedetect=|anullsrc=|^preset \w+$/.test(t)
    || /^\{\d+\}[?\/&.]|[?&]\w+=\{\d+\}|^[\w-]*\{\d+\}[\w.-]*$|\.(tgz|zip|mp4|mp3|jpg|png|webp|json|js)$/i.test(t)
    || /^[\w.-]+\/[\w./{}*+-]+(;|,|$)/.test(t)
    || /^(application|text|image|audio|video)\/[\w.+-]+/.test(t)
    || (/\b(YYYY|MMMM|DD|HH:mm|dddd)\b/.test(t) && !/[؀-ۿ]{2,}/.test(t))
    || /^(import|export|const|let|var|function|return|await)\s/.test(t)
    || /^[\w-]+=\{\d+\}$|^\w+\{\d+\}$/.test(t)
    || /^(italic |bold |normal )*\d+px /.test(t)
    || /^data:[\w/+.-]+;/.test(t)
    || /^\w+:\{\d+\}$|^site:\S+/.test(t)
    || /&&|\|\||chmod |apt(-get)? |\bbash |\bcurl |\bwget |\.sh\b|npm (i|install) |\bsudo /.test(t)
    || /\b\w+=[\w.]+,\w+=/.test(t)
    || /^[.#][\w-]+(\s*[>+~]?\s*[\w.#-]+)*$/.test(t)
    || /^\{\d+\}[a-z][\w-]*( |$)/i.test(t)
    || /^(string|number|boolean|object|array|any)\??(\[\])?$/i.test(t)
    // رموز لغات Tesseract: ara+eng+spa
    || /^[a-z]{3}(?:\+[a-z]{3})+$/.test(t)
    // رموز أخطاء/تحذيرات آلية: path-traversal:{0} · tts-failed:{0} · stt-unavailable({0}) · pages-truncated:{0}->{1}
    || /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+(?:[:(]\{\d+\}\)?(?:->\{\d+\})?)?$/.test(t)
    // مقطع تعبير نمطي يُبنى منه RegExp
    || /\(\?(?:[:=!]|<[=!])|\\[sdwpPbB][{+*?)|]/.test(t)
    // ترويسات/معرّفات تقنية: Bearer، معرّفات واتساب، قوالب بريد، رموز طويلة، وكيل عميل
    || /^Bearer\s|^[\w{}.-]*@(s\.whatsapp\.net|broadcast|g\.us|lid)$|^\{\d+\}@[\w-]+\.[a-z]{2,}$/i.test(t)
    || /^[\w-]+=[\w.~+/-]{40,}$|^[A-Za-z]+\/\d+(\.\d+)+ (desktop|mobile|\()/.test(t)
    // ترويسة Cookie: أزواج name=value مفصولة بـ«; » (جلسة/نطاق/مسار) — بيانات نقل لا نص معروض
    || /^(?:[\w-]+=[^;\s]*;\s*)+[\w-]+=[^;\s]*;?$/.test(t) && /(?:^|;\s*)(?:session_id|Domain|Path|i18n_set|uetvid)=/i.test(t)
    // علامات SVG/HTML تُرسم داخل صورة، ورموز كود مولَّد، وبطاقات vCard
    || /^<\/?(svg|defs|text|g|path|rect|circle|image|tspan|clipPath|linearGradient|stop|div|span|p|b|i)\b/i.test(t)
    || /^(if|for|while|switch)\s*\(|^(TEL|item\d+\.TEL|ORG|FN|BEGIN|END|VERSION);?[:;=]/i.test(t);
}

/** أسماء مصفوفات/متغيرات تحمل كلمات إدخال لا رسائل */
const INPUT_VOCAB = /(WORDS|KEYWORDS|TRIGGERS|ALIASES|PATTERNS|STOPWORDS|SYNONYMS|COMMANDS|CMDS|ACTIONS|OPTIONS_IN|YES|NO|VALID|ACCEPT|REJECT|CLUSTERS|MARKERS|SUFFIXES|DIRS|FOLDERS|PATHS|EXTENSIONS)$/i;

/** سلاسل تُبنى بها قيمة واحدة: [...].filter(Boolean).join("\n") */
const CHAIN_METHODS = new Set(["join", "filter", "map", "concat", "trim", "flat"]);

const MATCH_METHODS = new Set(["includes", "startsWith", "endsWith", "indexOf", "lastIndexOf", "match", "matchAll", "test", "search", "split", "replace", "replaceAll", "localeCompare", "has", "get", "set", "delete", "getItem", "setItem", "on", "once", "emit", "querySelector", "setting", "getGroup", "setGroup", "require", "import"]);
const LOG_OBJECTS = /^(console|logger|log|debug)$/;

function walkDir(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkDir(full, out);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function listFiles() {
  return SCAN.flatMap((dir) => walkDir(path.join(ROOT, dir)))
    .map((full) => path.relative(ROOT, full).split(path.sep).join("/"))
    .filter((rel) => !SKIP_FILE.some((re) => re.test(rel)));
}

/** مرور مع سلسلة الآباء */
function visit(node, ancestors, fn) {
  if (!node || typeof node.type !== "string") return;
  fn(node, ancestors);
  ancestors.push(node);
  for (const key of Object.keys(node)) {
    if (key === "loc" || key === "start" || key === "end") continue;
    const child = node[key];
    if (Array.isArray(child)) for (const item of child) visit(item, ancestors, fn);
    else if (child && typeof child.type === "string") visit(child, ancestors, fn);
  }
  ancestors.pop();
}

function calleeName(call) {
  const callee = call?.callee;
  if (!callee) return "";
  if (callee.type === "Identifier") return callee.name;
  if (callee.type === "MemberExpression") return callee.property?.name || callee.property?.value || "";
  return "";
}

function calleeObject(call) {
  const callee = call?.callee;
  if (callee?.type !== "MemberExpression") return "";
  const object = callee.object;
  if (object?.type === "Identifier") return object.name;
  if (object?.type === "MemberExpression") return object.property?.name || "";
  return "";
}

/** هل هذا النص في سياق إدخال/تقني يجب ألا يُترجم؟ */
function excluded(node, ancestors) {
  const parent = ancestors[ancestors.length - 1];
  const grand = ancestors[ancestors.length - 2];
  if (!parent) return true;

  // داخل دالة تبني تعليمات نموذج
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const a = ancestors[i];
    const name = a.id?.name || (a.type === "VariableDeclarator" ? a.id?.name : "") || "";
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "VariableDeclarator"].includes(a.type) && MODEL_FUNCTIONS.test(name)) return true;
  }

  if (["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(parent.type)) return true;
  if (parent.type === "Property" && parent.key === node) return true;
  if (parent.type === "MethodDefinition" || parent.type === "PropertyDefinition") return true;
  if (parent.type === "BinaryExpression" && ["===", "!==", "==", "!=", "in", "instanceof"].includes(parent.operator)) return true;
  if (parent.type === "SwitchCase" && parent.test === node) return true;
  if (parent.type === "NewExpression" && parent.callee?.name === "RegExp") return true;
  if (parent.type === "TaggedTemplateExpression") return true;

  // وسيطات دوال المطابقة والتخزين والسجلات
  for (let i = ancestors.length - 1; i >= Math.max(0, ancestors.length - 3); i -= 1) {
    const a = ancestors[i];
    if (a.type === "CallExpression") {
      const name = calleeName(a);
      const obj = calleeObject(a);
      if (LOG_OBJECTS.test(obj) || /^(log|warn|debug|info|trace)$/.test(name) && LOG_OBJECTS.test(obj)) return true;
      // وسائط استدعاءات noteFailure — scope, error, { where, stage, … } — بيانات سجل داخلية (§31)
      if (name === "noteFailure") return true;
      // stepOf(m, stage, detail) — تسميات مراحل التتبّع للتشخيص (§104) لا نص للمستخدم
      if (name === "stepOf") return true;
      // trace.step(stage, detail) — نفس تسميات التتبّع
      if (name === "step" && obj === "trace") return true;
      // مصفوفة كلمات تُمرَّر لباني تعبير نمطي أو لمطابق: wordRe(["اسمي"]) · hasAny(text, ["bot status"])
      if (a.arguments?.includes(ancestors[i + 1] ?? node) && /(?:^w|W)ords?Re$|Regex$|^buildRe$|^(hasAny|includesAny|matchesAny|containsAny|anyOf|has)$/.test(name)) return true;
      // مفتاح ترجمة: t(lang, "ns.key") أو t(lang, `ns.key_${id}`) — معرّف لا نص معروض
      if (name === "t" && a.arguments?.[1] === (ancestors[i + 1] ?? node)) return true;
      if (a.arguments?.[0] === node || (i === ancestors.length - 1 && a.arguments?.includes(node))) {
        if (MATCH_METHODS.has(name)) return true;
        if (/^(RegExp|require|fetch|axios|get|post|put|readFileSync|writeFileSync|existsSync|join|resolve|setting|getAssetBuffer|updateAssetUrl|getPlugin|findEntry)$/.test(name)) return true;
      }
      break;
    }
    if (a.type === "ArrayExpression" || a.type === "ObjectExpression" || a.type === "Property" || a.type === "ConditionalExpression") continue;
    break;
  }

  // رسالة نموذج: { role: "system" | "user" | "assistant", content: "…" } — نص للنموذج لا للمستخدم
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const a = ancestors[i];
    if (a.type === "ObjectExpression") {
      if (a.properties?.some((p) => (p.key?.name ?? p.key?.value) === "role" && /^(system|user|assistant|model)$/.test(p.value?.value || ""))) return true;
      break;
    }
    if (!["Property", "TemplateLiteral", "BinaryExpression", "ConditionalExpression", "LogicalExpression"].includes(a.type)) break;
  }

  // خاصية بمفتاح غير معروض (alias/usage/…) أو مصفوفة كلماتها
  const inWordArray = parent.type === "ArrayExpression";
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const a = ancestors[i];
    if (a.type === "Property") {
      const key = a.key?.name ?? a.key?.value;
      if (NON_DISPLAY_KEYS.has(String(key)) && !displayName(node, a, ancestors, i)) return true;
      // عنصر في مصفوفة كلمات داخل خريطة: TOPIC_CLUSTERS = { hosting: ["سيرفر", …] }
      if (inWordArray) continue;
      break;
    }
    if (a.type === "ArrayExpression" || a.type === "ObjectExpression") continue;
    if (a.type === "NewExpression" && /^(Set|Map)$/.test(a.callee?.name || "")) continue;
    if (a.type === "MemberExpression") continue;
    if (a.type === "CallExpression" && CHAIN_METHODS.has(calleeName(a))) continue;
    if (a.type === "VariableDeclarator") {
      if (INPUT_VOCAB.test(a.id?.name || "") || MODEL_TEXT.test(a.id?.name || "")) return true;
      break;
    }
    if (a.type === "AssignmentExpression") {
      const target = a.left?.name || a.left?.property?.name || "";
      if (MODEL_TEXT.test(target)) return true;
      break;
    }
    if (!["TemplateLiteral", "BinaryExpression", "ConditionalExpression", "LogicalExpression"].includes(a.type)) break;
  }

  // نص مترجم مسبقاً داخل كائن { ar, en, es } (قواميس الصور وكلمات العرض)
  if (parent.type === "Property" && parent.value === node && grand?.type === "ObjectExpression"
    && grand.properties.length >= 2
    && grand.properties.every((p) => ["ar", "en", "es"].includes(String(p.key?.name ?? p.key?.value)))) return true;

  // مجموعات نصوص مكتوبة لكل لغة: { ar: { first: [...] }, en: {...}, es: {...} } (تنويع الردود مثلاً)
  for (let i = ancestors.length - 1; i >= 1; i -= 1) {
    const a = ancestors[i];
    if (a.type === "Property" && ["ar", "en", "es"].includes(String(a.key?.name ?? a.key?.value))) {
      const holder = ancestors[i - 1];
      if (holder?.type === "ObjectExpression" && holder.properties.length >= 2
        && holder.properties.every((p) => ["ar", "en", "es"].includes(String(p.key?.name ?? p.key?.value)))) return true;
      break;
    }
    if (!["ArrayExpression", "ObjectExpression", "Property"].includes(a.type)) break;
  }

  // قيمة في خريطة مرادفات إدخال: const ACTION_ALIASES = { create: "انشاء" }
  // (خرائط العرض مثل { running: "قيد التشغيل" }[status] تبقى نصاً معروضاً)
  if (parent.type === "Property" && parent.value === node && grand?.type === "ObjectExpression") {
    const holder = ancestors[ancestors.length - 3];
    if (holder?.type === "VariableDeclarator" && INPUT_VOCAB.test(holder.id?.name || "")) return true;
  }

  // مصفوفة كلمات تُفحص بـ includes مباشرة: [...].includes(x)
  if (parent.type === "ArrayExpression" && grand?.type === "MemberExpression" && MATCH_METHODS.has(grand.property?.name)) return true;
  // لواحق/مقاطع قصيرة يُمرّ عليها: for (const suffix of ["ات", "ين"])
  if (parent.type === "ArrayExpression" && grand?.type === "ForOfStatement"
    && parent.elements.every((el) => el?.type === "Literal" && typeof el.value === "string" && el.value.length <= 4 && !/\s/.test(el.value))) return true;
  return false;
}

/**
 * اسم معروض لا معرّف: { name: "ملصقات غير محدودة" } داخل بيانات (قوائم ميزات، فلاتر، مهام)
 * — نص طبيعي بمسافة، وليس داخل config البلوقن ولا اسم أمر.
 */
function displayName(node, property, ancestors, index) {
  const key = String(property.key?.name ?? property.key?.value);
  if (!["name", "title", "label"].includes(key)) return false;
  if (property.value !== node) return false;
  const text = node.type === "Literal" ? String(node.value) : node.type === "TemplateLiteral" ? node.quasis.map((q) => q.value.cooked).join(" ") : "";
  // كلمة عربية واحدة مقبولة (تُحسم بالمعرّف المستقل أدناه)، واللاتينية كلمتان فأكثر
  if (!/[؀-ۿ]{3,}/.test(text) && !(/\s/.test(text.trim()) && /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(text))) return false;
  // اسم منتج/نموذج بإصدار («Claude Opus 4.6») اسم علم لا يُترجم
  if (/\b\d+(?:\.\d+)+\b|\b(?:GPT|Claude|Gemini|DeepSeek|Llama|Qwen|Mistral|Grok)\b/i.test(text)) return false;
  const holder = ancestors[index - 1];
  if (holder?.type !== "ObjectExpression") return false;
  const keys = new Set(holder.properties.map((p) => String(p.key?.name ?? p.key?.value)));
  // كائن إعداد بلوقن/أمر: اسمه معرّف استدعاء
  if (["alias", "aliases", "category", "usage", "handler", "run", "command", "cmd", "isOwner", "isGroup"].some((k) => keys.has(k))) return false;
  // الاسم معروض فقط حين يوجد معرّف مستقل يكتبه المستخدم/يستعمله الكود؛ وإلا فالاسم نفسه
  // هو المعرّف (أسماء عناصر الألعاب/RPG تُكتب كوسائط) فيبقى كما هو كي لا ينكسر الإدخال
  // (أو كائن تحت مفتاح رقمي: '1': { name: "أبيض وأسود" } — الاختيار بالرقم لا بالاسم)
  const owner = ancestors[index - 2];
  const numbered = owner?.type === "Property" && /^\d+$/.test(String(owner.key?.name ?? owner.key?.value));
  if (!numbered && !["id", "key", "code", "value", "slug"].some((k) => keys.has(k))) return false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const a = ancestors[i];
    if (a.type === "VariableDeclarator" && /^(config|pluginConfig|handler)$/i.test(a.id?.name || "")) return false;
    if (a.type === "ExportNamedDeclaration" || a.type === "ExportDefaultDeclaration") return false;
  }
  return true;
}

/** في السكرابر: new Error(...) أو خاصية message/msg/error نصية */
function userVisibleInScraper(ancestors) {
  for (let i = ancestors.length - 1; i >= 0; i -= 1) {
    const a = ancestors[i];
    if ((a.type === "NewExpression" || a.type === "CallExpression") && /^(Error|TypeError|RangeError)$/.test(a.callee?.name || "")) return true;
    if (a.type === "Property") return /^(message|msg|error|err|reason|info|note)$/.test(String(a.key?.name ?? a.key?.value));
    if (a.type === "ThrowStatement") return true;
    if (["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "Program"].includes(a.type)) return false;
  }
  return false;
}

/** نص القالب مع {n} مكان كل ${…} */
function templateText(node) {
  let out = "";
  node.quasis.forEach((quasi, index) => {
    out += quasi.value.cooked ?? quasi.value.raw;
    if (index < node.expressions.length) out += `{${index}}`;
  });
  return out;
}

/**
 * كل الوحدات في المشروع.
 * @returns {Array<{key:string, lang:string, file:string, line:number, placeholders:number}>}
 */
function extractUnits() {
  const out = [];
  for (const rel of listFiles()) {
    const code = fs.readFileSync(path.join(ROOT, rel), "utf8");
    let ast;
    try {
      ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: rel.endsWith(".cjs") ? "script" : "module", allowHashBang: true, allowAwaitOutsideFunction: true, allowReturnOutsideFunction: true, locations: true });
    } catch {
      continue;
    }
    visit(ast, [], (node, ancestors) => {
      let text = null;
      if (node.type === "Literal" && typeof node.value === "string") text = node.value;
      else if (node.type === "TemplateLiteral") {
        if (ancestors[ancestors.length - 1]?.type === "TaggedTemplateExpression") return;
        text = templateText(node);
      } else return;
      if (!text || !/[؀-ۿ]|[A-Za-zÀ-ÿ]{3,}/.test(text)) return;
      if (excluded(node, ancestors)) return;
      if (technicalText(text)) return;
      // داخل السكرابرات: فقط رسائل الأخطاء والرسائل المعادة قد تصل للمستخدم
      if (rel.startsWith("src/scraper/") && !userVisibleInScraper(ancestors)) return;
      text = namedSlots(text);
      for (const line of text.split("\n")) {
        const unit = unitOf(line);
        if (!unit) continue;
        out.push({ key: unit.key, lang: sourceLanguage(unit.key), file: rel, line: node.loc.start.line, placeholders: unit.placeholders });
      }
    });
  }
  out.push(...extractConfigUnits());
  return out;
}

/** عناصر نائبة مسمّاة تُعبّأ لاحقاً بـ replace (%user% · {pushName}) ← {n}، لأن الترجمة تتم بعد التعبئة */
function namedSlots(text) {
  let next = (String(text).match(/\{(\d+)\}/g) || []).reduce((max, m) => Math.max(max, Number(m.slice(1, -1)) + 1), 0);
  const slots = new Map();
  return String(text).replace(/%([A-Za-z_]\w*)%|\{([A-Za-z_]\w*)\}/g, (_, a, b) => {
    const name = a || b;
    if (!slots.has(name)) slots.set(name, next++);
    return `{${slots.get(name)}}`;
  });
}

/**
 * نصوص العرض في config.js (رسائل النظام، حماية المجموعات، قالب الخطأ، فوائد التبرع).
 * تُقرأ فقط من هذه الأقسام — لا تُلمس قيم API ولا الروابط ولا المفاتيح (§2/§35).
 * العناصر النائبة المخصّصة (%user% · {amount} · {prefix}) تتحوّل إلى {n} لأن الترجمة
 * تجري على النص بعد تعبئته، فيطابق القالبُ أي قيمة.
 */
const CONFIG_DISPLAY = [/^messages\./, /^groupProtection\./, /^errorTemplate$/, /^donasi\.benefits/, /^donasi\.payment\.holder$/];

function extractConfigUnits() {
  const rel = "config.js";
  const out = [];
  let ast;
  try {
    ast = acorn.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"), { ecmaVersion: "latest", sourceType: "module", locations: true });
  } catch {
    return out;
  }
  const take = (node, keyPath) => {
    if (!CONFIG_DISPLAY.some((re) => re.test(keyPath))) return;
    let text = node.type === "Literal" ? node.value : templateText(node);
    if (typeof text !== "string") return;
    text = namedSlots(text);
    for (const line of text.split("\n")) {
      const unit = unitOf(line);
      if (unit) out.push({ key: unit.key, lang: sourceLanguage(unit.key), file: rel, line: node.loc.start.line, placeholders: unit.placeholders });
    }
  };
  const walk = (node, keyPath) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach((child) => walk(child, keyPath));
    if (node.type === "Property") {
      const key = node.key?.name ?? node.key?.value;
      return walk(node.value, keyPath ? `${keyPath}.${key}` : String(key));
    }
    if ((node.type === "Literal" && typeof node.value === "string") || node.type === "TemplateLiteral") return take(node, keyPath);
    for (const [k, child] of Object.entries(node)) if (k !== "loc") walk(child, keyPath);
  };
  walk(ast, "");
  return out;
}

/** وحدات مميّزة مع مواضعها */
function distinctUnits(units = extractUnits()) {
  const map = new Map();
  for (const unit of units) {
    const entry = map.get(unit.key) || { key: unit.key, lang: unit.lang, placeholders: unit.placeholders, refs: [] };
    if (entry.refs.length < 5) entry.refs.push(`${unit.file}:${unit.line}`);
    entry.count = (entry.count || 0) + 1;
    map.set(unit.key, entry);
  }
  return [...map.values()];
}

export { distinctUnits, excluded, extractUnits, listFiles, technicalText, userVisibleInScraper, visit };

// ── CLI ──
if (import.meta.url === `file://${process.argv[1]}`) {
  const units = extractUnits();
  const distinct = distinctUnits(units);
  const byLang = distinct.reduce((acc, u) => ({ ...acc, [u.lang]: (acc[u.lang] || 0) + 1 }), {});
  const chars = distinct.reduce((acc, u) => acc + u.key.length, 0);
  console.log(JSON.stringify({ occurrences: units.length, distinct: distinct.length, byLang, chars }, null, 1));
  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.join(ROOT, "tools", "i18n"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, "tools", "i18n", "units.json"), JSON.stringify(distinct, null, 1));
    console.log("→ tools/i18n/units.json");
  }
}
