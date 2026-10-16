// ═══════════════════════════════════════════════
// 💠 Terboo Rich Response Engine + Code Renderer (v4 §4–§8، §43–§44)
// ───────────────────────────────────────────────
// إخراج قريب من تجربة Meta AI داخل واتساب، مبني حصراً على حقول WAProto الموجودة فعلاً
// في @whiskeysockets/baileys@7.0.0-rc14 (تم التحقق منها بالترميز/فك الترميز):
//   Message.richResponseMessage (AIRichResponseMessage)
//     └ submessages[]: TEXT(2) · TABLE(4) · CODE(5) · LATEX(8)
//         codeMetadata { codeLanguage, codeBlocks[{ highlightType, codeContent }] }
//         highlightType: DEFAULT 0 · KEYWORD 1 · METHOD 2 · STRING 3 · NUMBER 4 · COMMENT 5
//
// مساران واضحان:
//   • buildRichContent(): richResponseMessage العام للنص/الجداول/LaTeX.
//   • buildNativeRichCodeContent(): الحمولة التي تستخدمها منظومة الكود الموحدة،
//     مع سياق قناة WhatsApp الرسمي (forwardedNewsletterMessageInfo) عند تفعيله من config.saluran.
//
// المسار: Plugin/AI/Scraper/Owner → Output Parser → Language Detector
//        → Native Rich Code Builder → WhatsApp Sender.
//
// حماية الكود (§8): المحتوى لا يُعدَّل أبداً — لا إيموجي ولا حذف مسافات ولا تغيير نهايات
// الأسطر؛ تقطيع المحلّل بلا فقد (ضمّ الكتل = النص الأصلي حرفياً). داخل كتلة ``` لا يفسّر
// واتساب * _ ~ >؛ وإن احتوى الكود نفسه على ``` يُرسل كملف بنفس البايتات.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import config from "../../config.js";
import { channelContext } from "./terboo-brand.js";
import { t } from "./terboo-localization.js";

// ═══════════════════════════════════════════════
// اللغات
// ═══════════════════════════════════════════════

const LANGUAGES = {
  javascript: { label: "JavaScript", ext: ["js", "mjs", "cjs", "jsx"], aliases: ["js", "node", "nodejs", "jsx", "mjs", "cjs", "esm", "ecmascript"] },
  typescript: { label: "TypeScript", ext: ["ts", "tsx", "mts", "cts"], aliases: ["ts", "tsx"] },
  python: { label: "Python", ext: ["py", "pyw"], aliases: ["py", "python3", "py3"] },
  php: { label: "PHP", ext: ["php"], aliases: [] },
  ruby: { label: "Ruby", ext: ["rb", "rake", "gemspec"], aliases: ["rb"] },
  perl: { label: "Perl", ext: ["pl", "pm", "pod"], aliases: [] },
  lua: { label: "Lua", ext: ["lua"], aliases: [] },
  java: { label: "Java", ext: ["java"], aliases: [] },
  kotlin: { label: "Kotlin", ext: ["kt", "kts"], aliases: ["kt", "kts"] },
  scala: { label: "Scala", ext: ["scala", "sc"], aliases: [] },
  groovy: { label: "Groovy", ext: ["groovy", "gradle"], aliases: [] },
  swift: { label: "Swift", ext: ["swift"], aliases: [] },
  dart: { label: "Dart", ext: ["dart"], aliases: [] },
  go: { label: "Go", ext: ["go"], aliases: ["golang"] },
  rust: { label: "Rust", ext: ["rs"], aliases: ["rs"] },
  c: { label: "C", ext: ["c", "h"], aliases: [] },
  cpp: { label: "C++", ext: ["cpp", "cc", "cxx", "hpp", "hh", "hxx"], aliases: ["c++", "cxx"] },
  objectivec: { label: "Objective-C", ext: ["m", "mm"], aliases: ["objc", "objective-c"] },
  csharp: { label: "C#", ext: ["cs"], aliases: ["cs", "c#", "dotnet"] },
  fsharp: { label: "F#", ext: ["fs", "fsi", "fsx", "fsscript"], aliases: ["f#", "fsharp"] },
  powershell: { label: "PowerShell", ext: ["ps1", "psm1", "psd1"], aliases: ["ps", "pwsh", "powershell"] },
  bash: { label: "Bash", ext: ["sh", "bash", "zsh"], aliases: ["sh", "shell", "zsh", "console", "terminal"] },
  fish: { label: "Fish", ext: ["fish"], aliases: [] },
  batch: { label: "Batch", ext: ["bat", "cmd"], aliases: ["bat", "cmd"] },
  sql: { label: "SQL", ext: ["sql"], aliases: ["mysql", "postgres", "postgresql", "sqlite", "plsql", "tsql", "mssql"] },
  graphql: { label: "GraphQL", ext: ["graphql", "gql"], aliases: ["gql"] },
  json: { label: "JSON", ext: ["json", "jsonc"], aliases: ["jsonc"] },
  yaml: { label: "YAML", ext: ["yaml", "yml"], aliases: ["yml"] },
  toml: { label: "TOML", ext: ["toml"], aliases: [] },
  ini: { label: "INI", ext: ["ini", "cfg", "conf"], aliases: ["config"] },
  xml: { label: "XML", ext: ["xml", "xsd", "xsl", "xslt"], aliases: [] },
  svg: { label: "SVG", ext: ["svg"], aliases: [] },
  html: { label: "HTML", ext: ["html", "htm"], aliases: ["xhtml"] },
  css: { label: "CSS", ext: ["css"], aliases: [] },
  scss: { label: "SCSS", ext: ["scss"], aliases: [] },
  less: { label: "Less", ext: ["less"], aliases: [] },
  markdown: { label: "Markdown", ext: ["md", "markdown", "mdown", "mkdn"], aliases: ["md"] },
  latex: { label: "LaTeX", ext: ["tex", "latex", "sty"], aliases: ["tex"] },
  dockerfile: { label: "Dockerfile", ext: ["dockerfile"], aliases: ["docker"] },
  makefile: { label: "Makefile", ext: ["makefile", "mk"], aliases: ["make"] },
  nginx: { label: "Nginx", ext: ["nginx"], aliases: [] },
  apache: { label: "Apache", ext: ["htaccess"], aliases: ["apacheconf"] },
  diff: { label: "Diff", ext: ["diff", "patch"], aliases: ["patch"] },
  r: { label: "R", ext: ["r", "rmd"], aliases: [] },
  matlab: { label: "MATLAB", ext: ["m"], aliases: ["matlab"] },
  julia: { label: "Julia", ext: ["jl"], aliases: ["julia"] },
  elixir: { label: "Elixir", ext: ["ex", "exs"], aliases: [] },
  erlang: { label: "Erlang", ext: ["erl", "hrl"], aliases: [] },
  haskell: { label: "Haskell", ext: ["hs", "lhs"], aliases: ["hs"] },
  clojure: { label: "Clojure", ext: ["clj", "cljs", "cljc", "edn"], aliases: ["clj", "cljs"] },
  zig: { label: "Zig", ext: ["zig"], aliases: [] },
  nim: { label: "Nim", ext: ["nim"], aliases: [] },
  crystal: { label: "Crystal", ext: ["cr"], aliases: [] },
  solidity: { label: "Solidity", ext: ["sol"], aliases: [] },
  verilog: { label: "Verilog", ext: ["v", "vh", "sv", "svh"], aliases: ["systemverilog", "sv"] },
  vhdl: { label: "VHDL", ext: ["vhd", "vhdl"], aliases: [] },
  asm: { label: "Assembly", ext: ["asm", "s", "S"], aliases: ["assembly", "x86asm", "armasm"] },
  protobuf: { label: "Protocol Buffers", ext: ["proto"], aliases: ["proto", "protobuf"] },
  terraform: { label: "Terraform", ext: ["tf", "tfvars"], aliases: ["hcl"] },
  hcl: { label: "HCL", ext: ["hcl"], aliases: [] },
  vue: { label: "Vue", ext: ["vue"], aliases: [] },
  svelte: { label: "Svelte", ext: ["svelte"], aliases: [] },
  astro: { label: "Astro", ext: ["astro"], aliases: [] },
  mermaid: { label: "Mermaid", ext: ["mmd", "mermaid"], aliases: [] },
  regex: { label: "RegExp", ext: ["regex", "regexp"], aliases: ["regexp", "regular-expression"] },
  plaintext: { label: "Plain Text", ext: ["txt", "text", "log"], aliases: ["text", "txt", "plain", "plaintext", "output", "log", "ascii", "art"] },
};

const ALIAS = new Map();
for (const [id, spec] of Object.entries(LANGUAGES)) {
  ALIAS.set(id, id);
  for (const alias of spec.aliases) ALIAS.set(alias, id);
}

const PLAIN_FENCES = new Set(["text", "txt", "plain", "plaintext", "output", "log", "ascii", "art"]);

/** معرّف لغة معتمد من اسم/اختصار، أو null */
function normalizeLanguage(value) {
  const key = String(value || "").trim().toLowerCase();
  return key ? ALIAS.get(key) || null : null;
}

function safeLanguageTag(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  const known = ALIAS.get(raw);
  if (known) return known;
  const normalized = raw.replace(/^language[-_]?/, "").replace(/\s+/g, "-");
  return /^[a-z0-9][a-z0-9+#._-]{0,31}$/i.test(normalized) ? normalized : null;
}

function languageFromFileName(fileName) {
  const base = String(fileName || "").split(/[\\/]/).pop()?.toLowerCase() || "";
  if (!base) return null;
  if (base === "dockerfile") return "dockerfile";
  if (base === "makefile" || base === "gnumakefile") return "makefile";
  if (base === "cmakelists.txt") return "makefile";
  if (base === ".env" || base.endsWith(".env")) return "ini";
  const ext = base.match(/\.([a-z0-9+#-]+)$/)?.[1];
  if (!ext) return null;
  return Object.keys(LANGUAGES).find((id) => LANGUAGES[id].ext.some((item) => String(item).toLowerCase() === ext)) || safeLanguageTag(ext);
}

/** تحليل معجمي/أنماط: درجة لكل لغة، والأعلى فوق العتبة يفوز */
const SIGNALS = {
  python: [/^\s*def \w+\(.*\)\s*(->\s*[\w\[\], ]+)?:\s*$/m, /^\s*(from [\w.]+ )?import [\w., ]+$/m, /\bprint\(/, /^\s*(elif|except|finally)\b.*:\s*$/m, /\bself\.\w+/, /^\s*class \w+(\(.*\))?:\s*$/m, /\bNone\b|\bTrue\b|\bFalse\b/],
  typescript: [/:\s*(string|number|boolean|any|void|unknown|never)(\[\])?\s*[,)=;{]/, /\binterface \w+\s*\{/, /\btype \w+\s*=/, /\bexport (type|interface)\b/, /\bas const\b/, /<\w+>\s*\(/, /\bimplements \w+/],
  javascript: [/\b(const|let|var) \w+\s*=/, /\bfunction\s*\w*\s*\(/, /=>\s*[{(]?/, /\brequire\(['"]/, /\bmodule\.exports\b/, /\bconsole\.log\(/, /^\s*import .+ from ['"]/m, /\bexport (default|const|function|async)\b/, /\bawait\b/],
  json: [],
  html: [/<!doctype html/i, /<html[\s>]/i, /<\/?(div|span|head|body|p|a|ul|li|script|style|section|header|footer|button|img|form|input)\b[^>]*>/i],
  xml: [/^\s*<\?xml\b/, /<\/[\w:-]+>\s*$/m, /<[\w:-]+(\s+[\w:-]+="[^"]*")*\s*\/?>/],
  // محدّد CSS بلا مكمّمات متداخلة (خطية؛ الشكل السابق كان يتراجع أُسّياً على الأسطر الطويلة)
  css: [/^[ \t]*(?:[.#:][\w-]|(?:html|body|div|span|p|a|ul|ol|li|h[1-6]|section|header|footer|nav|main|button|img|input|table|td|th|tr|form|label)\b|\*)[^{};()=\n]*\{[ \t]*$/m, /^\s*[\w-]+\s*:\s*[^;{}]+;\s*$/m, /@media\s*\(|@import\s|:root\s*\{/],
  bash: [/^#!\/(usr\/)?bin\/(env )?(ba|z)?sh/, /^\s*(sudo |apt(-get)? |npm |npx |pip |cd |ls |mkdir |rm |echo |export |chmod |curl |wget |git )/m, /^\s*(fi|then|done|esac)\s*$/m, /\$\{?[A-Za-z_]\w*\}?/],
  php: [/<\?php/, /\$\w+\s*=/, /->\w+\(/, /\becho\s+['"$]/, /\bfunction \w+\(\$/],
  java: [/\bpublic (static )?(final )?(class|void|int|String)\b/, /System\.out\.println\(/, /^\s*import java\./m, /\bprivate (final )?\w+ \w+;/, /@Override/],
  c: [/#include\s*<\w+\.h>/, /\bprintf\(/, /\bint main\s*\(/, /\bmalloc\(|\bfree\(/],
  cpp: [/#include\s*<(iostream|vector|string|map|algorithm|memory)>/, /\bstd::/, /\bcout\s*<</, /\bnamespace \w+/, /\btemplate\s*</],
  csharp: [/^\s*using System(\.\w+)*;/m, /Console\.Write(Line)?\(/, /^\s*namespace [\w.]+/m, /\bpublic (partial |static )?class \w+/, /\bvar \w+ = new\b/],
  go: [/^package \w+\s*$/m, /\bfunc (\(\w+ \*?\w+\) )?\w+\(/, /\bfmt\.(Print|Sprint)/, /\b\w+ := /, /^import \($/m],
  rust: [/\bfn \w+(<.*>)?\(/, /\blet mut \w+/, /\bprintln!\(/, /\bimpl(<.*>)? \w+/, /^\s*use (std|crate)::/m, /->\s*(Result|Option|Self|i32|u8|String)\b/],
  sql: [/^\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE (TABLE|INDEX|VIEW)|ALTER TABLE|DROP TABLE|WITH \w+ AS)\b/im, /\bFROM \w+/i, /\bWHERE\b/i, /\bJOIN \w+ ON\b/i],
  yaml: [/^---\s*$/m, /^\s*[\w-]+:\s+[^{};]+$/m, /^\s*-\s+[\w-]+:\s/m, /^\s{2,}[\w-]+:\s/m],
  lua: [/\blocal \w+\s*=/, /\bfunction [\w.:]+\(.*\)\s*$/m, /^\s*end\s*$/m, /\bthen\s*$/m, /\.\.\s*["'\w]/, /\bnil\b/],
};

/** حد التحليل المعجمي: بداية الكود تكفي لمعرفة لغته، وتحدّ زمن الأنماط على المدخلات الضخمة */
const LEXICAL_SAMPLE = 20000;

function lexicalScores(code) {
  const text = String(code || "").slice(0, LEXICAL_SAMPLE);
  const scores = {};
  for (const [id, patterns] of Object.entries(SIGNALS)) scores[id] = patterns.filter((re) => re.test(text)).length;
  const trimmed = text.trim();
  if (/^[[{]/.test(trimmed)) {
    // مجسّ لا إخفاق: فشل التحليل يعني ببساطة «ليس JSON» (لا شيء يُرسل أو يضيع)
    try { JSON.parse(trimmed); scores.json = 10; } catch (notJson) { scores.json = 0; }
  }
  if (scores.typescript) scores.typescript += Math.min(scores.javascript, 2);
  if (scores.cpp) scores.c = Math.max(0, scores.c - 1);
  if (scores.html) scores.xml = Math.max(0, scores.xml - 2);
  if (scores.php) scores.html = Math.max(0, scores.html - 1);
  if (scores.lua && !/\bthen\b|\bend\b/.test(text)) scores.lua = 0;
  if (scores.yaml && /[;{}()]/.test(text)) scores.yaml = Math.max(0, scores.yaml - 2);
  if (scores.bash && scores.php) scores.bash -= 1;
  return scores;
}

/**
 * اكتشاف لغة الكود بالترتيب (§7): وسم السياج ← بيانات صريحة ← امتداد الملف ← سياق الأمر
 * ← تحليل معجمي/أنماط. لا افتراض javascript: لا لغة واضحة ⇒ null.
 * @param {string} code
 * @param {{fence?:string, language?:string, fileName?:string, context?:string}} [hints]
 * @returns {{language:string|null, source:string, confidence:number}}
 */
function detectLanguage(code, { fence = "", language = "", fileName = "", context = "" } = {}) {
  // وسم صريح بأنه نص (فن ASCII، مخرجات، سجلات) ⇒ لا لغة ولا تخمين
  if (PLAIN_FENCES.has(String(fence || language || "").trim().toLowerCase())) return { language: null, source: "fence", confidence: 1 };
  const fromFence = safeLanguageTag(fence);
  if (fromFence) return { language: fromFence, source: "fence", confidence: 1 };
  const explicit = safeLanguageTag(language);
  if (explicit) return { language: explicit, source: "metadata", confidence: 1 };
  const fromFile = languageFromFileName(fileName) || languageFromFileName(fence) || languageFromFileName(language);
  if (fromFile) return { language: fromFile, source: "extension", confidence: 0.95 };
  for (const word of String(context || "").toLowerCase().split(/[^a-z0-9+#]+/)) {
    const fromContext = normalizeLanguage(word) || (/^(cjs|esm)$/.test(word) ? "javascript" : null);
    if (fromContext) return { language: fromContext, source: "context", confidence: 0.85 };
  }
  const scores = lexicalScores(code);
  const [best, score] = Object.entries(scores).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  const second = Object.entries(scores).sort((a, b) => b[1] - a[1])[1]?.[1] || 0;
  if (!best || score < 2 || score === second) return { language: null, source: "lexical", confidence: 0 };
  return { language: best, source: "lexical", confidence: Math.min(0.9, 0.4 + score * 0.1) };
}

// ═══════════════════════════════════════════════
// التلوين النحوي (بلا فقد)
// ═══════════════════════════════════════════════

const HIGHLIGHT = { DEFAULT: 0, KEYWORD: 1, METHOD: 2, STRING: 3, NUMBER: 4, COMMENT: 5 };

const KEYWORDS = {
  javascript: "await async break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield",
  python: "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return self True try while with yield",
  bash: "if then else elif fi for while until do done case esac function in select return exit export local readonly echo cd sudo",
  php: "abstract and array as break case catch class clone const continue declare default do echo else elseif empty endforeach endif endwhile extends final finally fn for foreach function global if implements include instanceof interface isset list namespace new null or print private protected public require return static switch this throw trait try unset use var while true false",
  java: "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for if implements import instanceof int interface long native new null package private protected public return short static super switch synchronized this throw throws transient try void volatile while true false var record",
  c: "auto break case char const continue default do double else enum extern float for goto if int long register return short signed sizeof static struct switch typedef union unsigned void volatile while NULL",
  cpp: "auto bool break case catch char class const constexpr continue default delete do double else enum explicit extern false float for friend if inline int long namespace new nullptr operator private protected public return short signed sizeof static struct switch template this throw true try typedef typename union unsigned using virtual void volatile while std",
  csharp: "abstract as async await base bool break byte case catch char class const continue decimal default delegate do double else enum event false finally float for foreach if int interface internal is lock long namespace new null object override private protected public readonly ref return sealed static string struct switch this throw true try typeof using var virtual void while",
  go: "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false",
  rust: "as async await break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while Some None Ok Err",
  sql: "select from where insert into values update set delete create table alter drop index view join inner left right outer on and or not null is in as order by group having limit offset distinct union all primary key foreign references default case when then else end",
  lua: "and break do else elseif end false for function goto if in local nil not or repeat return then true until while",
  css: "important media import supports keyframes font-face root",
  yaml: "true false null yes no on off",
  json: "true false null",
  typescript: "await async break case catch class const continue debugger default delete do else export extends false finally for from function if import in instanceof let new null of return static super switch this throw true try typeof undefined var void while with yield interface type enum implements private public protected readonly declare namespace abstract as any unknown never keyof infer is",
};
const KEYWORD_SETS = Object.fromEntries(Object.entries(KEYWORDS).map(([id, list]) => [id, new Set(list.split(" "))]));

const BACKTICK = String.fromCharCode(96);

/** مواصفات المُعجم لكل لغة */
function lexerFor(language) {
  const hashComment = ["python", "bash", "yaml", "php"].includes(language);
  const dashComment = ["sql", "lua"].includes(language);
  const slashComment = !["python", "bash", "yaml", "sql", "html", "xml", "json", "css"].includes(language);
  return {
    lineComments: [...(slashComment ? ["//"] : []), ...(hashComment ? ["#"] : []), ...(dashComment ? ["--"] : [])],
    blockComments: [
      ...(["html", "xml"].includes(language) ? [["<!--", "-->"]] : []),
      ...(!["python", "bash", "yaml", "html", "xml", "json"].includes(language) ? [["/*", "*/"]] : []),
      ...(language === "lua" ? [["--[[", "]]"]] : []),
    ],
    quotes: language === "python" ? ['"""', "'''", '"', "'"]
      : ["javascript", "typescript"].includes(language) ? ['"', "'", BACKTICK]
        : language === "go" || language === "bash" ? ['"', "'", BACKTICK]
          : ['"', "'"],
    keywords: KEYWORD_SETS[language] || new Set(),
    caseInsensitive: language === "sql",
  };
}

/**
 * يقطّع الكود إلى كتل ملوّنة. الضمان: ضمّ codeContent لكل الكتل = الكود الأصلي حرفياً.
 * @param {string} code
 * @param {string|null} language
 * @returns {Array<{highlightType:number, codeContent:string}>}
 */
function tokenize(code, language) {
  const source = String(code ?? "");
  if (!language) return [{ highlightType: HIGHLIGHT.DEFAULT, codeContent: source }];
  const lex = lexerFor(language);
  const blocks = [];
  const push = (type, text) => {
    if (!text) return;
    const last = blocks[blocks.length - 1];
    if (last && last.highlightType === type) last.codeContent += text;
    else blocks.push({ highlightType: type, codeContent: text });
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i);
    const block = lex.blockComments.find(([open]) => rest.startsWith(open));
    if (block) {
      const end = source.indexOf(block[1], i + block[0].length);
      const stop = end === -1 ? source.length : end + block[1].length;
      push(HIGHLIGHT.COMMENT, source.slice(i, stop));
      i = stop;
      continue;
    }
    const line = lex.lineComments.find((open) => rest.startsWith(open)
      && !(open === "#" && language === "php" && rest.startsWith("#[")));
    if (line) {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      push(HIGHLIGHT.COMMENT, source.slice(i, stop));
      i = stop;
      continue;
    }
    const quote = lex.quotes.find((q) => rest.startsWith(q));
    if (quote) {
      let j = i + quote.length;
      while (j < source.length) {
        if (source[j] === "\\") { j += 2; continue; }
        if (source.startsWith(quote, j)) { j += quote.length; break; }
        if (quote.length === 1 && quote !== BACKTICK && source[j] === "\n") break;
        j += 1;
      }
      const stop = Math.min(j, source.length);
      push(HIGHLIGHT.STRING, source.slice(i, stop));
      i = stop;
      continue;
    }
    const number = rest.match(/^(0x[0-9a-fA-F]+|\d+(\.\d+)?([eE][+-]?\d+)?)\b/);
    if (number && !/[\w$]/.test(source[i - 1] || "")) {
      push(HIGHLIGHT.NUMBER, number[0]);
      i += number[0].length;
      continue;
    }
    const word = rest.match(/^[A-Za-z_$][\w$]*/);
    if (word) {
      const value = word[0];
      const after = source.slice(i + value.length).match(/^\s*\(/);
      const isKeyword = lex.keywords.has(lex.caseInsensitive ? value.toLowerCase() : value);
      push(isKeyword ? HIGHLIGHT.KEYWORD : after ? HIGHLIGHT.METHOD : HIGHLIGHT.DEFAULT, value);
      i += value.length;
      continue;
    }
    push(HIGHLIGHT.DEFAULT, source[i]);
    i += 1;
  }
  return blocks;
}

// ═══════════════════════════════════════════════
// محلّل المخرجات (Output Parser)
// ═══════════════════════════════════════════════

/** كتلة ``` متعددة الأسطر؛ كما في CommonMark، سطر الكود الأخير يحتفظ بنهايته (المحتوى حرفياً) */
const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;

/**
 * يقسم نصاً إلى أجزاء: نص وكود (من كتل ``` متعددة الأسطر فقط).
 * @param {string} text
 * @param {{context?:string}} [hints]
 * @returns {Array<{type:"text", text:string}|{type:"code", code:string, language:string|null, fence:string, source:string}>}
 */
function parseOutput(text, { context = "" } = {}) {
  const value = String(text ?? "");
  const parts = [];
  let last = 0;
  for (const match of value.matchAll(FENCE_RE)) {
    const before = value.slice(last, match.index);
    if (before.trim()) parts.push({ type: "text", text: before.replace(/^\n+|\n+$/g, "") });
    const fence = match[1].trim();
    const code = match[2];
    const detected = detectLanguage(code, { fence, context });
    parts.push({ type: "code", code, language: detected.language, fence, source: detected.source });
    last = match.index + match[0].length;
  }
  const tail = value.slice(last);
  if (tail.trim()) parts.push({ type: "text", text: tail.replace(/^\n+|\n+$/g, "") });
  return parts;
}

/** هل في النص كتلة كود fenced تستحق المسار الغني؟ حتى بدون اسم لغة ستُعرض كـ text. */
function hasRenderableCode(text) {
  if (typeof text !== "string" || !text.includes("```")) return false;
  return parseOutput(text).some((part) => part.type === "code" && Boolean(part.language));
}

// ═══════════════════════════════════════════════
// البناء: رسالة غنية (proto) ونص احتياطي
// ═══════════════════════════════════════════════

const SUB = { TEXT: 2, INLINE_IMAGE: 3, TABLE: 4, CODE: 5, LATEX: 8 };
/** حد أمان لطول الكود في الرسالة الواحدة — ما زاد يُقسَّم على أسطر كاملة */
const MAX_CODE_CHARS = 3500;

/** يقسم الكود على حدود الأسطر (بلا فقد: ضمّ القطع = الأصل) */
function splitCode(code, max = MAX_CODE_CHARS) {
  const source = String(code ?? "");
  if (source.length <= max) return [source];
  const chunks = [];
  let current = "";
  for (const line of source.split(/(?<=\n)/)) {
    if (current && current.length + line.length > max) {
      chunks.push(current);
      current = "";
    }
    if (line.length > max) {
      for (let k = 0; k < line.length; k += max) chunks.push(line.slice(k, k + max));
      continue;
    }
    current += line;
  }
  if (current) chunks.push(current);
  return chunks;
}

function languageLabel(language) {
  return LANGUAGES[language]?.label || null;
}

function extensionOf(language) {
  return LANGUAGES[language]?.ext?.[0] || "txt";
}

/** سياق الاقتباس فقط — بلا أي هوية بوت ذكاء (§44) */
function quoteContext(quoted) {
  const key = quoted?.key;
  if (!key?.id) return undefined;
  return {
    stanzaId: key.id,
    participant: key.participant || quoted.sender || key.remoteJid,
    quotedMessage: quoted.message,
  };
}

function imageUrlOf(part) {
  const candidates = [
    part?.imageUrl,
    part?.url,
    part?.source?.url,
    part?.source,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
    if (value && typeof value === "object" && typeof value.url === "string" && /^https?:\/\//i.test(value.url.trim())) return value.url.trim();
  }
  return null;
}

function inlineImageSubmessage(part) {
  const imageUrl = imageUrlOf(part);
  if (!imageUrl) return null;
  return {
    messageType: SUB.INLINE_IMAGE,
    imageMetadata: {
      imageUrl: {
        imagePreviewUrl: imageUrl,
        imageHighResUrl: imageUrl,
        ...(part?.sourceUrl && /^https?:\/\//i.test(String(part.sourceUrl)) ? { sourceUrl: String(part.sourceUrl) } : {}),
      },
      ...(part?.imageText ? { imageText: String(part.imageText) } : {}),
      ...(part?.alignment ? { alignment: String(part.alignment) } : {}),
      ...(part?.tapLinkUrl && /^https?:\/\//i.test(String(part.tapLinkUrl)) ? { tapLinkUrl: String(part.tapLinkUrl) } : {}),
    },
  };
}

function nativeCodeBlocks(code, language) {
  const source = String(code ?? "");
  const blocks = [];
  const tokens = tokenize(source, language);
  for (const token of tokens) {
    let text = String(token.codeContent ?? "");
    if (!text) continue;
    const type = Number.isInteger(token.highlightType) && token.highlightType >= HIGHLIGHT.DEFAULT && token.highlightType <= HIGHLIGHT.COMMENT
      ? token.highlightType : HIGHLIGHT.DEFAULT;
    while (text.length > MAX_NATIVE_CODE_BLOCK_CHARS) {
      const cut = text.lastIndexOf("\n", MAX_NATIVE_CODE_BLOCK_CHARS);
      const end = cut > 0 ? cut + 1 : MAX_NATIVE_CODE_BLOCK_CHARS;
      blocks.push({ highlightType: type, codeContent: text.slice(0, end) });
      text = text.slice(end);
    }
    if (text) blocks.push({ highlightType: type, codeContent: text });
  }
  return blocks.length ? blocks : [{ highlightType: HIGHLIGHT.DEFAULT, codeContent: source }];
}

/**
 * أجزاء ← submessages بروتو (TEXT/INLINE_IMAGE/CODE/TABLE/LATEX).
 * @param {Array} parts
 */
function toSubmessages(parts) {
  const out = [];
  for (const part of parts || []) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "media") {
      const inline = inlineImageSubmessage(part);
      if (inline) out.push(inline);
      continue;
    }
    if (part.type === "text" && String(part.text || "").trim()) {
      out.push({ messageType: SUB.TEXT, messageText: String(part.text) });
    } else if (part.type === "code") {
      const detected = detectLanguage(part.code, {
        fence: part.fence,
        language: part.language,
        fileName: part.fileName || part.title,
        context: part.context,
      });
      const language = detected.language || safeLanguageTag(part.language) || safeLanguageTag(part.fence) || "text";
      out.push({
        messageType: SUB.CODE,
        codeMetadata: { codeLanguage: language, codeBlocks: nativeCodeBlocks(part.code, language === "text" ? null : language) },
      });
    } else if (part.type === "table" && part.rows?.length) {
      out.push({
        messageType: SUB.TABLE,
        tableMetadata: { title: part.title || "", rows: part.rows.map((row) => ({ items: (row.items || []).map(String), ...(row.isHeading ? { isHeading: true } : {}) })) },
      });
    } else if (part.type === "latex") {
      out.push({ messageType: SUB.LATEX, latexMetadata: { text: part.text || "", expressions: part.expressions || [] } });
    }
  }
  return out;
}

/** «مُعاد توجيهها» من قناة البوت نفسها (config.saluran) — بلا هوية Meta AI */
function channelForward() {
  if (config.saluran?.forwardAll === false || !String(config.saluran?.id || "").endsWith("@newsletter")) return null;
  const { isForwarded, forwardingScore, forwardedNewsletterMessageInfo } = channelContext();
  return { isForwarded, forwardingScore, forwardedNewsletterMessageInfo };
}

const MAX_NATIVE_CODE_BLOCK_CHARS = 12000;
const NATIVE_RICH_CODE_HIGHLIGHT = HIGHLIGHT.DEFAULT;

function stripOuterCodeFence(code) {
  const source = String(code ?? "");
  const match = source.match(/^```[^\n`]*\n([\s\S]*?)```$/);
  return match ? match[1] : source;
}

function nativeContextInfo(quoted) {
  const quote = quoteContext(quoted);
  const forward = channelForward();
  return quote || forward ? { ...(quote || {}), ...(forward || {}) } : undefined;
}

function buildNativeRichCodeContent(parts, { quoted = null } = {}) {
  const normalized = [];
  for (const part of parts || []) {
    if (!part || typeof part !== "object") continue;
    if (part.type === "media") {
      const inline = inlineImageSubmessage(part);
      if (inline) normalized.push(inline);
      continue;
    }
    if (part.type === "text" && String(part.text || "").trim()) {
      normalized.push({ messageType: SUB.TEXT, messageText: String(part.text) });
      continue;
    }
    if (part.type === "code") {
      const code = stripOuterCodeFence(part.code);
      const detected = detectLanguage(code, {
        fence: part.fence,
        language: part.language,
        fileName: part.fileName || part.title,
        context: part.context,
      });
      const language = detected.language || safeLanguageTag(part.language) || safeLanguageTag(part.fence) || "text";
      normalized.push({
        messageType: SUB.CODE,
        codeMetadata: {
          codeLanguage: language,
          codeBlocks: nativeCodeBlocks(code, language === "text" ? null : language),
        },
      });
      continue;
    }
    if (part.type === "table" && part.rows?.length) {
      normalized.push({ messageType: SUB.TABLE, tableMetadata: { title: part.title || "", rows: part.rows.map((row) => ({ items: (row.items || []).map(String), ...(row.isHeading ? { isHeading: true } : {}) })) } });
      continue;
    }
    if (part.type === "latex") {
      normalized.push({ messageType: SUB.LATEX, latexMetadata: { text: part.text || "", expressions: part.expressions || [] } });
    }
  }
  if (!normalized.length) return null;
  const contextInfo = nativeContextInfo(quoted);
  return {
    messageContextInfo: { messageSecret: crypto.randomBytes(32) },
    richResponseMessage: {
      messageType: 1,
      submessages: normalized,
      ...(contextInfo ? { contextInfo } : {}),
    },
  };
}

function buildRichContent(parts, { quoted = null } = {}) {
  const forward = channelForward();
  const quote = quoteContext(quoted);
  const contextInfo = quote || forward ? { ...(quote || {}), ...(forward || {}) } : undefined;
  return {
    messageContextInfo: { messageSecret: crypto.randomBytes(32) },
    richResponseMessage: {
      messageType: 1,
      submessages: toSubmessages(parts),
      ...(contextInfo ? { contextInfo } : {}),
    },
  };
}

/** عنوان بطاقة الكود بلغة المستخدم: «💻 Python» */
function codeTitle(language, lang = "ar", title = "") {
  const label = languageLabel(language) || t(lang, "code.plain");
  const head = t(lang, "code.title", { language: label });
  return title ? `${head} · ${title}` : head;
}

/** جدول نصي بنفس نظام التصميم (> ◈ عمود · عمود) */
function tableText(part) {
  const lines = [];
  if (part.title) lines.push(`*${part.title}*`);
  for (const row of part.rows || []) {
    const cells = row.items.map((cell) => String(cell ?? "").trim()).filter(Boolean);
    lines.push(row.isHeading ? `*${cells.join(" · ")}*` : `> ◈ ${cells.join(" · ")}`);
  }
  return lines.join("\n");
}

/**
 * البديل النصي: رسائل واتساب عادية بكتل ``` (أحادية المسافة) — الكود حرفياً.
 * @returns {Array<{text?:string, document?:{buffer:Buffer, fileName:string, caption:string}}>}
 */
function renderFallback(parts, { lang = "ar" } = {}) {
  const messages = [];
  let buffer = [];
  const flush = () => {
    const text = buffer.join("\n\n").trim();
    if (text) messages.push({ text });
    buffer = [];
  };
  for (const part of parts) {
    if (part.type === "text") buffer.push(part.text);
    else if (part.type === "table") buffer.push(tableText(part));
    else if (part.type === "latex") buffer.push(`\`\`\`\n${part.text || (part.expressions || []).map((e) => e.latexExpression).join("\n")}\n\`\`\``);
    else if (part.type === "code") {
      const header = `*${codeTitle(part.language, lang, part.title)}*`;
      if (part.code.includes("```")) {
        // الكود نفسه يحوي ``` ⇒ ملف بنفس البايتات بدل كسر التنسيق أو تعديل الكود
        flush();
        messages.push({ document: { buffer: Buffer.from(part.code, "utf8"), fileName: `code.${extensionOf(part.language)}`, caption: header } });
        continue;
      }
      const chunks = splitCode(part.code);
      chunks.forEach((chunk, index) => {
        const label = chunks.length > 1 ? `${header} ${t(lang, "code.part", { n: index + 1, total: chunks.length })}` : header;
        buffer.push(`${label}\n\`\`\`\n${chunk.replace(/\n$/, "")}\n\`\`\``);
        if (chunks.length > 1) flush();
      });
    }
  }
  flush();
  return messages;
}

/** يقسّم أجزاء الكود الطويلة لرسائل غنية متتالية (كل رسالة بحد آمن) */
function richBatches(parts) {
  const batches = [[]];
  for (const part of parts) {
    if (part.type !== "code" || part.code.length <= MAX_CODE_CHARS) {
      batches[batches.length - 1].push(part);
      continue;
    }
    const chunks = splitCode(part.code);
    chunks.forEach((chunk, index) => {
      if (index > 0) batches.push([]);
      batches[batches.length - 1].push({ ...part, code: chunk });
    });
  }
  return batches.filter((batch) => batch.length);
}

export {
  HIGHLIGHT,
  LANGUAGES,
  MAX_CODE_CHARS,
  MAX_NATIVE_CODE_BLOCK_CHARS,
  NATIVE_RICH_CODE_HIGHLIGHT,
  SUB,
  buildNativeRichCodeContent,
  buildRichContent,
  imageUrlOf,
  inlineImageSubmessage,
  nativeCodeBlocks,
  codeTitle,
  detectLanguage,
  extensionOf,
  hasRenderableCode,
  languageLabel,
  normalizeLanguage,
  safeLanguageTag,
  parseOutput,
  renderFallback,
  richBatches,
  splitCode,
  stripOuterCodeFence,
  tableText,
  tokenize,
  toSubmessages,
};
