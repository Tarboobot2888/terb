// ═══════════════════════════════════════════════
// 🔤 Terboo Languages — دليل لغات البرمجة
// ───────────────────────────────────────────────
// أكثر من 60 لغة: الاسم المعروض · الامتدادات · الاختصارات · أسماء ملفات بلا امتداد
// (Dockerfile · Makefile · .env …) · الأسماء العربية («كود بلغة روبي»).
//
// يستعمله:
//   terboo-documents        نوع ملف الكود المرسل ولغته
//   terboo-file-intelligence قبول ملفات الكود في «حلل هذا الملف»
//   terboo-intent-gate       التعرّف على طلب كود بلغة معيّنة
//   terboo-ai-router/ai-core مسار الكود + وسم السياج الصحيح في تعليمات النموذج
//   terboo-documents (contextForModel) اسم لغة الملف للنموذج
//
// عرض الكود نفسه (terboo-rich-response وما يتبعه) خارج هذا الملف عمداً — له دليله الخاص.
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
  asm: { label: "Assembly", ext: ["asm", "s"], aliases: ["assembly", "x86asm", "armasm"] },
  protobuf: { label: "Protobuf", ext: ["proto"], aliases: ["proto", "protobuf"] },
  terraform: { label: "Terraform", ext: ["tf", "tfvars"], aliases: ["hcl"] },
  hcl: { label: "HCL", ext: ["hcl"], aliases: [] },
  vue: { label: "Vue", ext: ["vue"], aliases: [] },
  svelte: { label: "Svelte", ext: ["svelte"], aliases: [] },
  astro: { label: "Astro", ext: ["astro"], aliases: [] },
  mermaid: { label: "Mermaid", ext: ["mmd", "mermaid"], aliases: [] },
  regex: { label: "RegExp", ext: ["regex", "regexp"], aliases: ["regexp", "regular-expression"] },
  plaintext: { label: "Text", ext: ["txt", "text", "log"], aliases: ["text", "txt", "plain", "plaintext", "output", "log", "ascii", "art"] },
};

/** الأسماء العربية الشائعة (بعد التطبيع: ه بدل ة، ا بدل أ/إ/آ) */
const ARABIC_ALIASES = {
  javascript: ["جافاسكربت", "جافا سكربت", "جافاسكريبت", "جافا سكريبت", "نود جي اس"],
  typescript: ["تايب سكربت", "تايبسكربت", "تايب سكريبت", "تايبسكريبت"],
  python: ["بايثون", "بيثون"],
  php: ["بي اتش بي"],
  ruby: ["روبي"],
  perl: ["بيرل"],
  lua: ["لوا"],
  java: ["جافا"],
  kotlin: ["كوتلن", "كوتلين"],
  scala: ["سكالا"],
  groovy: ["جروفي"],
  swift: ["سويفت"],
  dart: ["دارت", "فلاتر"],
  go: ["جو", "جولانج", "جولانغ"],
  rust: ["رست"],
  c: ["سي"],
  cpp: ["سي بلس بلس", "سي++"],
  objectivec: ["اوبجكتيف سي"],
  csharp: ["سي شارب"],
  fsharp: ["اف شارب"],
  powershell: ["باورشيل", "باور شيل"],
  bash: ["باش", "شيل"],
  batch: ["باتش"],
  sql: ["اس كيو ال", "سيكوال"],
  graphql: ["جراف كيو ال"],
  json: ["جيسون"],
  yaml: ["يامل"],
  html: ["اتش تي ام ال"],
  css: ["سي اس اس"],
  markdown: ["ماركداون"],
  latex: ["لاتك"],
  dockerfile: ["دوكر"],
  matlab: ["ماتلاب"],
  julia: ["جوليا"],
  elixir: ["اليكسير"],
  haskell: ["هاسكل"],
  solidity: ["سوليديتي"],
  asm: ["اسمبلي"],
  vue: ["فيو"],
  regex: ["ريجكس"],
};

/** ملفات بلا امتداد معروف تُعرف باسمها */
const SPECIAL_FILES = {
  dockerfile: "dockerfile", containerfile: "dockerfile",
  makefile: "makefile", gnumakefile: "makefile", "cmakelists.txt": "makefile",
  gemfile: "ruby", rakefile: "ruby", podfile: "ruby", vagrantfile: "ruby",
  jenkinsfile: "groovy",
  ".bashrc": "bash", ".zshrc": "bash", ".bash_profile": "bash", ".profile": "bash",
  "nginx.conf": "nginx",
};

/** لغات نصية (نثر/سجلات) لا تُعامل ككود */
const TEXT_LANGUAGES = new Set(["plaintext", "markdown", "latex"]);

const BY_NAME = new Map();
const BY_EXT = new Map();
for (const [id, spec] of Object.entries(LANGUAGES)) {
  for (const name of [id, spec.label, ...spec.aliases]) if (!BY_NAME.has(name.toLowerCase())) BY_NAME.set(name.toLowerCase(), id);
  for (const ext of spec.ext) if (!BY_EXT.has(ext.toLowerCase())) BY_EXT.set(ext.toLowerCase(), id);
}
for (const [id, names] of Object.entries(ARABIC_ALIASES)) for (const name of names) BY_NAME.set(name, id);

/** تطبيع عربي خفيف (نفس قواعد بوابة النية) */
function normalize(text) {
  return String(text || "").toLowerCase()
    .replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
    .replace(/\s+/g, " ").trim();
}

/** معرّف لغة معتمد من اسم/اختصار/اسم معروض/اسم عربي، أو null */
function languageId(value) {
  const key = normalize(value);
  return key ? BY_NAME.get(key) || null : null;
}

/** لغة الملف من اسمه (المسار يُتجاهل · حالة الأحرف لا تهم · Dockerfile/Makefile/.env …) — المعروف فقط */
function languageFromFileName(fileName) {
  const base = String(fileName || "").split(/[\\/]/).pop()?.trim().toLowerCase() || "";
  if (!base) return null;
  if (SPECIAL_FILES[base]) return SPECIAL_FILES[base];
  if (base.startsWith("dockerfile.") || base.endsWith(".dockerfile")) return "dockerfile";
  if (base === ".env" || base.startsWith(".env.") || base.endsWith(".env")) return "ini";
  const ext = base.match(/\.([a-z0-9+#-]+)$/)?.[1];
  return ext ? BY_EXT.get(ext) || null : null;
}

/** لغة كود (لا نثر) من اسم الملف — لتصنيف المستندات */
function codeLanguageFromFileName(fileName) {
  const id = languageFromFileName(fileName);
  return id && !TEXT_LANGUAGES.has(id) ? id : null;
}

function languageLabel(id) {
  return LANGUAGES[id]?.label || null;
}

// ── «كود بلغة X» ─────────────────────────────────
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const END = "(?![\\w\\u0600-\\u06FF+#])";
const CODE_NOUN_AR = "(?:كود|اكواد|سكربت|سكريبت|برنامج|داله|فنكشن|كلاس)";
const CODE_NOUN_EN = "(?:code|script|program|function|class|snippet)";

function namesPattern(filter = () => true) {
  const names = [...BY_NAME.entries()].filter(([name, id]) => !TEXT_LANGUAGES.has(id) && filter(name, id)).map(([name]) => name);
  return `(${names.sort((a, b) => b.length - a.length).map(escape).join("|")})`;
}
// أسماء هي كلمات عادية أيضاً («make code» ≠ Makefile) لا تُقبل إلا بعد «كود/بلغة»
const COMMON_WORDS = new Set(["make", "config", "console", "terminal", "node", "art", "patch", "text", "log"]);
const ALL = namesPattern();
const SAFE = namesPattern((name) => !COMMON_WORDS.has(name));
// الصيغة الحرة «write … in X» تستبعد الأسماء القصيرة أيضاً (go · c · r …)
const FREE = namesPattern((name) => /^[ -~]+$/.test(name) && name.length > 2 && !COMMON_WORDS.has(name) && name !== "shell");

const REQUEST_PATTERNS = [
  new RegExp(`${CODE_NOUN_AR}\\s+(?:(?:ب|بال)(?=\\S)|(?:بلغه|بلغت|باللغه)\\s+(?:البرمجه\\s+)?(?:ال)?)?${ALL}${END}`, "i"),
  new RegExp(`(?:^|\\s)(?:بلغه|بلغت|باللغه)\\s+(?:البرمجه\\s+)?(?:ال)?${ALL}${END}`, "i"),
  new RegExp(`(?:^|\\s)${CODE_NOUN_EN}\\s+(?:in|using|with)\\s+${SAFE}${END}`, "i"),
  new RegExp(`(?:^|\\s)${SAFE}\\s+${CODE_NOUN_EN}s?${END}`, "i"),
  new RegExp(`(?:^|\\s)(?:write|make|create|build|give me|show me)\\b.{0,60}?\\s(?:in|using)\\s+${FREE}${END}`, "i"),
];

/**
 * اللغة المطلوبة في نص طلب كود («اكتب كود بلغة روبي» · «كود كوتلن» · «write it in rust»)، أو null.
 * @param {string} text
 * @returns {string|null}
 */
function requestedLanguage(text) {
  const value = normalize(text);
  if (!value) return null;
  for (const pattern of REQUEST_PATTERNS) {
    const name = value.match(pattern)?.[1];
    if (name) return BY_NAME.get(name) || null;
  }
  return null;
}

export {
  LANGUAGES,
  TEXT_LANGUAGES,
  codeLanguageFromFileName,
  languageFromFileName,
  languageId,
  languageLabel,
  requestedLanguage,
};
export default { languageFromFileName, languageId, languageLabel, requestedLanguage };
