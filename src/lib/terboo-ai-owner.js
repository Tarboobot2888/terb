// ═══════════════════════════════════════════════
// 👑 Terboo Owner AI Control — تحكّم المالك بلغة طبيعية (§15–§18)
// ───────────────────────────────────────────────
// المالك يكتب بلا بادئة: «افتح handler»، «دور في الكود على recordTurn»،
// «قارن X و Y»، «افحص autoai»، «اعرض اللي اتغير»، «ارجع آخر تعديل»،
// «اعمل نسخة احتياطية من X»، «شغل اختبار الذاكرة»، «صلح X»…
// والنواة نفسها تستدعي هذه الأدوات (لا يوجد أمر «تحكم» منفصل مطلوب).
//
// الأمان:
//   • المالك المحدّد في config.owner.number فقط — ليس مالك بوت فرعي
//     ولا شريك ولا مشرف.
//   • كل الأدوات من صندوق terboo-ai-tools.js (مسارات محمية، لا shell،
//     لا eval، config.js للقراءة فقط مع حجب كل مفاتيحه).
//   • الكتابة الحسّاسة (إصلاح، إعادة تسمية، تراجع) تسير:
//     Intent → Plan → Diff → Risk → Owner Approval → Backup → Apply
//     → Syntax/Test → Verify → Success أو Rollback
//     والموافقة كلمة صريحة من المالك نفسه («نفذه»/«موافق») لا من النموذج.
// ═══════════════════════════════════════════════

import config from "../../config.js";
import * as UI from "./terboo-ui-theme.js";
import { t } from "./terboo-localization.js";
import { setPending } from "./terboo-ai-memory.js";
import * as scrapers from "./terboo-scraper-registry.js";
import { latencyReport } from "./terboo-latency.js";
import { getProviderHealth } from "./terboo-provider-health.js";
import { deliveryLog } from "./terboo-menu-delivery.js";
import { recentFailures } from "./terboo-failure-log.js";

const MAX_SHOW_LINES = 40;
/** «اختبر» بلا اسم: اختبارات سريعة من القائمة المغلقة */
const QUICK_TESTS = ["syntax", "imports", "integrity"];
const MAX_DIFF_CHARS = 1400;

function digits(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/[^0-9]/g, "");
}

/** المالك المحدّد في config فقط (§18) */
function isConfigOwner(m) {
  const sender = digits(m?.sender);
  if (!sender || m?.isBot) return false;
  const owners = (config.owner?.number || []).map(digits).filter(Boolean);
  return owners.some((owner) => owner === sender
    || (owner.length >= 9 && sender.length >= 9 && (sender.endsWith(owner) || owner.endsWith(sender))));
}

function normalize(text) {
  return String(text || "")
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

/** يزيل علامات الاقتباس والترقيم الملتصقة بالاسم */
function cleanToken(value) {
  return String(value || "").trim().replace(/^[«"'`(]+|[»"'`)?؟!.,،]+$/g, "");
}

// كلمات تسبق اسم الملف اختيارياً
const FILE_WORD = "(?:(?:لي|لى)\\s+)?(?:(?:ال)?ملف\\s+|file\\s+|the file\\s+|el archivo\\s+|archivo\\s+)?";

/** أنماط النوايا بالترتيب — الأدق أولاً */
// أدوات الـscraper (§27) — تشترط كلمة scraper/سكرابر فلا تتقاطع مع نوايا الملفات
const SCRAPER_WORD = "(?:ال)?(?:سكرابر(?:ات)?|سكريبر|scrapers?)";
const SCRAPER_INTENTS = [
  { op: "scraperCompare", re: new RegExp(`(?:قارن|compare|compara)\\s+(?:بين\\s+)?${SCRAPER_WORD}\\s+(?<sa>[\\w.-]+)\\s+(?:و|مع|with|and|y|con)\\s*(?:${SCRAPER_WORD}\\s+)?(?<sb>[\\w.-]+)`, "iu") },
  { op: "scraperTest", re: new RegExp(`(?:اختبر|جرب|test|try|prueba)\\s+${SCRAPER_WORD}\\s+(?<sid>[\\w.-]+)(?:\\s+(?:على|علي|ب|with|on|con|en)?\\s*(?<sarg>\\S.*))?`, "iu") },
  { op: "scraperOfPlugin", re: new RegExp(`(?:ايه|إيه|انهي|أنهي|اي|which|qu[eé])\\s+${SCRAPER_WORD}\\s+.*?(?:بيستخدمه|يستخدمه|تستخدمه|uses|used by|usa)\\s+(?:ال)?(?:بلوقن|امر|أمر|plugin|command|comando)?\\s*(?<plugin>\\S+)`, "iu") },
  { op: "scraperPlugins", re: new RegExp(`(?:(?:مين|انهي|أنهي|اي|which|qu[eé])\\s+(?:ال)?(?:بلوقن(?:ات)?|plugins?|comandos?)\\s+.*?${SCRAPER_WORD}\\s+(?<sid>[\\w.-]+))|(?:(?:ال)?(?:بلوقنات|plugins)\\s+(?:اللي|الي|that|que)\\s+.*?${SCRAPER_WORD}\\s+(?<sid2>[\\w.-]+))`, "iu") },
  { op: "scraperInspect", re: new RegExp(`(?:افحص|شخص|معلومات|تفاصيل|exports|inspect|diagnose|info|inspecciona|diagnostica)\\s+(?:عن\\s+)?${SCRAPER_WORD}\\s+(?<sid>[\\w.-]+)`, "iu") },
  { op: "scraperList", re: new RegExp(`(?:اعرض|وريني|list|show|lista|muestra)\\s+(?:كل\\s+)?${SCRAPER_WORD}|${SCRAPER_WORD}\\s+(?:registry|list)`, "iu") },
];

const INTENTS = [
  // v4 §26: «ابحث عن مشكلة» · «فين المشكلة» — الرسالة كاملة (لا يلتقط بحثاً عادياً يبدأ بنفس الكلمات)
  { op: "problems", re: /^(?:(?:(?:ابحث|دور|شوف|فتش)\s+(?:عن|على|علي)?\s*(?:ال)?(?:مشكله|مشاكل|اخطاء|غلط))|(?:(?:فين|وين|ايه)\s+(?:ال)?(?:مشكله|غلط)))(?:\s+(?:في|فى)\s+(?:ال)?(?:بوت|مشروع|كود))?\s*[.!؟?]*$|^(?:find|look for|search for)\s+(?:the |a |any )?(?:problems?|issues?|bugs?|errors?)(?:\s+in the (?:bot|project|code))?[.!?]?$|^what'?s (?:wrong|broken)(?: with the bot)?\??$|^busca\s+(?:el |un |los )?(?:problemas?|errores?)(?:\s+en el (?:bot|proyecto|c[oó]digo))?[.!]?$/iu },
  // v4 §26: «افحص القوائم» — اختبار القوائم الحقيقي + سجل تسليمها
  { op: "menus", re: /(?:افحص|راجع|اختبر|شيك على|check|inspect|diagnose|revisa|comprueba)\s+(?:the\s+|los\s+)?(?:ال)?(?:قوائم|منيو|menus?|men[uú]s)(?=$|[\s.!؟?])/iu },
  // v4 §26: «اعمل backup» بلا ملف ⇒ نسخة احتياطية كاملة للمشروع
  { op: "projectBackup", re: /^(?:اعمل|خد|خذ|انشئ)\s*(?:لي\s+)?(?:نسخه احتياطيه|باك ?اب|backup)(?:\s+(?:لل|ل)?(?:مشروع|بوت|كله|كامله))?\s*[.!؟?]*$|^(?:make |create )?(?:a )?(?:full |project )?backup(?:\s+(?:of )?(?:the )?(?:project|bot|everything))?[.!]?$|^(?:haz |crea )?(?:una )?copia de seguridad(?:\s+(?:del|de todo el) (?:proyecto|bot))?[.!]?$|^respalda (?:el )?(?:proyecto|bot)$/iu },
  { op: "changes", re: /(?:(?:اعرض|وريني|فرجني|ايه|شوف)\s*(?:لي\s+)?(?:اللي|الي|ال)?\s*(?:اتغير|تغير|التغييرات|التعديلات|التعديل))|(?:show (?:me )?(?:the )?(?:changes|diff|last change))|(?:what changed)|(?:muestra (?:los )?cambios)|(?:qu[eé] cambi[oó])/i },
  { op: "rollback", re: /(?:(?:ارجع|رجع|تراجع عن|الغي|الغ)\s*(?:اخر|آخر)?\s*(?:تعديل|التعديل|تغيير|التغيير))|(?:(?:undo|roll ?back|revert) (?:the )?last (?:change|edit))|(?:(?:revierte|deshaz) (?:el )?[uú]ltimo cambio)/i },
  { op: "diagnostics", re: /(?:تشخيص|حاله البوت|صحه البوت|حاله السيرفر|diagnos\w*|bot (?:status|health)|estado del bot|diagn[oó]stico)/i },
  { op: "audit", re: /(?:الفحص الصارم|فحص صارم|تدقيق|strict audit|\baudit\b|auditor[ií]a)/i },
  { op: "manifest", re: /(?:manifest|المانيفست|مانيفست|manifiesto)/i },
  { op: "test", re: /^(?:اختبر|test|prueba)(?:\s+(?:ال)?(?:بوت|مشروع|the bot|el bot))?\s*[.!؟?]*$|(?:(?:شغل|اعمل|اعمللي|نفذ|run|ejecuta|corre)\s+(?:the\s+|las\s+|los\s+|el\s+|la\s+)?(?:ال)?(?:اختبار(?:ات)?|تيست(?:ات)?|تست|tests?|pruebas?)(?:\s+(?:ال)?(?<name>[\p{L}\p{N}_-]+))?)|(?:(?:اختبر|test|prueba)\s+(?:ال)?(?<name2>ذاكره|نواه|قوائم|ترجمه|مساعد|محادثه|وكيل|استيراد|نحو|memory|kernel|menus|localization|assistant|conversation|agent|imports|syntax|integrity|interactive|onboarding|autoai))/iu },
  { op: "backup", re: /(?:(?:اعمل|خد|خذ|انشئ)\s*(?:لي\s+)?(?:نسخه احتياطيه|باك ?اب|backup)\s*(?:من|ل|لل)?\s*(?<target>\S+))|(?:backup (?:of )?(?<target2>\S+))|(?:(?:respalda|copia de seguridad de)\s+(?<target3>\S+))/iu },
  { op: "compare", re: /(?:قارن|compare|compara)\s+(?:بين\s+)?(?:(?:ال)?ملف(?:ين|ات|ان)?\s+|(?:the\s+)?(?:two\s+)?files?\s+|(?:los\s+)?(?:dos\s+)?archivos\s+)?(?:بين\s+)?(?<a>\S+)\s+(?:و|مع|ب|with|and|to|con|y)\s*(?<b>\S+)/iu },
  { op: "rename", re: /(?:(?:غير اسم|اعد تسميه|سمي)\s+(?<from>\S+)\s+(?:الي|إلى|الى|ل|لـ)\s*(?<to>\S+))|(?:rename\s+(?<from2>\S+)\s+to\s+(?<to2>\S+))|(?:renombra\s+(?<from3>\S+)\s+a\s+(?<to3>\S+))/iu },
  { op: "search", re: /(?:(?:دور|ابحث|فتش|search|find|busca)\s+(?:عن|علي|على|for)?\s*(?<q>.+?)\s+(?:في|فى|in|en)\s+(?:ال)?(?:كود|مشروع|ملفات|code|project|files|c[oó]digo|proyecto))|(?:(?:دور|ابحث|فتش)\s+(?:في|فى)\s+(?:ال)?(?:كود|مشروع|ملفات)\s+(?:عن|علي|على)\s+(?<q2>.+))|(?:(?:search|busca)\s+(?:the )?(?:code|project|el c[oó]digo)\s+(?:for|por)\s+(?<q3>.+))/iu },
  { op: "fix", re: new RegExp(`(?:صلح|اصلح|عالج|fix|repair|arregla|corrige)\\s+${FILE_WORD}(?<target>\\S+)(?<rest>.*)`, "iu") },
  { op: "syntax", re: new RegExp(`(?:افحص|راجع|check|verify|revisa|comprueba)\\s+${FILE_WORD}(?<target>\\S+)`, "iu") },
  { op: "list", re: /(?:(?:اعرض|وريني|list|lista)\s+(?:ملفات|محتويات|files in|files of|the files in|archivos de|archivos en)\s+(?<target>\S+))/iu },
  { op: "inspect", re: new RegExp(`(?:معلومات|تفاصيل|inspect|info about|inspecciona)\\s+(?:عن\\s+)?${FILE_WORD}(?<target>\\S+)`, "iu") },
  { op: "read", re: new RegExp(`(?:افتح|اعرض|اقرا|وريني|open|show|read|abre|muestra|lee)\\s+${FILE_WORD}(?<target>\\S+)(?:\\s+(?:من|from|desde)\\s+(?<from>\\d+)(?:\\s*(?:الي|إلى|الى|-|to|a|hasta)\\s*(?<to>\\d+))?)?`, "iu") },
];

/**
 * كلام عادي مثل «اعرض الملف الشخصي» لا يصير قراءة ملف بالتشابه الجزئي:
 * الاسم اللاتيني/المسار يكفي، أما الاسم العربي فيجب أن يطابق اسم ملف حرفياً.
 */
function looksLikeFileRef(token, resolvedPath) {
  const value = String(token || "");
  if (/[A-Za-z0-9]/.test(value) || /[./\\]/.test(value)) return true;
  const base = String(resolvedPath).split("/").pop().replace(/\.(js|mjs|cjs|json|md)$/, "");
  return base === value;
}

/** أدوات تحتاج مساراً حقيقياً — إن لم يُحلّ لملف فليست نيّة مالك */
const NEEDS_FILE = new Set(["fix", "syntax", "inspect", "read", "backup"]);

/**
 * يحلّل كلام المالك إلى نيّة أداة، أو null إن لم تكن نيّة ملفات/مشروع.
 * @param {string} text
 * @param {{resolveFileQuery:Function}} tools
 */
function parseOwnerIntent(text, tools) {
  const original = String(text || "").replace(/\s+/g, " ").trim();
  const value = normalize(text);
  if (!value || value.length > 300) return null;
  for (const { op, re } of SCRAPER_INTENTS) {
    const match = original.match(re);
    if (!match) continue;
    const g = match.groups || {};
    const id = cleanToken(g.sid || g.sid2 || g.sa || "");
    if (op === "scraperList") return { op };
    if (op === "scraperOfPlugin") return { op, plugin: cleanToken(g.plugin) };
    if (op === "scraperCompare") return { op, a: cleanToken(g.sa), b: cleanToken(g.sb) };
    if (op === "scraperTest") return { op, id, arg: String(g.sarg || "").trim().slice(0, 400) };
    return { op, id };
  }
  for (const { op, re } of INTENTS) {
    // النص الأصلي أولاً (أسماء الملفات العربية تبقى كما هي)، ثم المطبَّع
    const match = original.match(re) || value.match(re);
    if (!match) continue;
    const g = match.groups || {};
    const intent = { op };
    if (op === "test") intent.name = cleanToken(g.name || g.name2 || "");
    if (op === "search") intent.query = cleanToken(g.q || g.q2 || g.q3 || "");
    if (op === "compare") {
      intent.a = tools.resolveFileQuery(cleanToken(g.a)).path;
      intent.b = tools.resolveFileQuery(cleanToken(g.b)).path;
      if (!intent.a || !intent.b) return null;
    }
    if (op === "rename") {
      intent.from = tools.resolveFileQuery(cleanToken(g.from || g.from2 || g.from3)).path;
      intent.to = cleanToken(g.to || g.to2 || g.to3);
      if (!intent.from || !intent.to) return null;
      if (!intent.to.includes("/")) intent.to = `${intent.from.split("/").slice(0, -1).join("/")}/${intent.to}`.replace(/^\//, "");
    }
    if (op === "list") {
      intent.target = cleanToken(g.target);
      if (!tools.isAllowed(intent.target)) return null;
    }
    if (NEEDS_FILE.has(op)) {
      const target = cleanToken(g.target || g.target2 || g.target3);
      const resolved = tools.resolveFileQuery(target);
      if (!resolved.path || !looksLikeFileRef(target, resolved.path)) return null;
      intent.target = resolved.path;
      intent.candidates = resolved.candidates;
      if (op === "read") {
        intent.from = Number(g.from) || 1;
        intent.to = Number(g.to) || intent.from + MAX_SHOW_LINES - 1;
      }
      if (op === "fix") intent.request = cleanToken(g.rest || "");
    }
    if (op === "search" && (!intent.query || intent.query.length < 2)) return null;
    return intent;
  }
  return null;
}

function fence(text) {
  return `\`\`\`\n${String(text || "").slice(0, MAX_DIFF_CHARS)}\n\`\`\``;
}

/** ملف الاختبار المناسب بعد تعديل ملف (Test في مسار الكتابة) */
function testFor(rel) {
  if (/terboo-ai-memory/.test(rel)) return "memory";
  if (/terboo-ai-(core|agent|owner)/.test(rel)) return "kernel";
  if (/terboo-locali[sz]ation|terboo-locales\//.test(rel)) return "localization";
  if (/terboo-interactive|plugins\/main\//.test(rel)) return "interactive";
  if (/^plugins\//.test(rel)) return "integrity";
  if (/^src\//.test(rel)) return "imports";
  return null;
}

/** طلب نسخة كاملة معدّلة من النموذج (للإصلاح) — بلا أي أسرار */
async function proposeFix({ rel, content, error, request, ask }) {
  if (typeof ask !== "function") return null;
  const instruction = [
    "You are fixing one source file of a Node.js (ESM) WhatsApp bot.",
    "Return the COMPLETE corrected file inside ONE ```js fenced block and nothing else.",
    "Change as little as possible. Keep every export, command name and alias.",
    "Never add eval, child_process, network calls, or secrets.",
    error ? `Syntax error reported by node --check:\n${String(error).slice(0, 800)}` : "",
    request ? `Owner request: ${request}` : "",
  ].filter(Boolean).join("\n");
  const answer = await ask({ message: `File: ${rel}\n\n${content}`, instruction, language: "en", history: [] }, { task: "code", primary: "Claude", fallbacks: ["DeepSeek", "GeminiAPI", "GPT"] });
  const raw = String(answer?.text || "");
  const fenced = raw.match(/```(?:js|javascript|mjs)?\s*\n([\s\S]*?)```/i);
  const next = fenced ? fenced[1] : "";
  if (!next.trim() || next.trim() === content.trim()) return null;
  return next.endsWith("\n") ? next : `${next}\n`;
}

/**
 * ينفّذ نيّة المالك ويعيد كتل العرض.
 * @returns {Promise<{blocks:string[], icon?:string, pending?:boolean}>}
 */
/** زمن الاستجابة وصحة المزوّدات للمالك (§51) */
function latencyBlocks(lang) {
  const report = latencyReport();
  const pair = (x) => (x?.p50 === null || x?.p50 === undefined ? "—" : `${Math.round(x.p50)} / ${Math.round(x.p95)} ms`);
  const providers = getProviderHealth()
    .map((p) => `${p.name}: ${p.blocked ? "⛔" : "✅"}${p.latencyMs ? ` ${p.latencyMs}ms` : ""} · ${p.successes}/${p.calls}`)
    .join("\n");
  return [
    UI.section(t(lang, "kernel.latencyTitle"), lang),
    UI.row(t(lang, "kernel.latencySamples"), String(report.count), lang),
    UI.row(t(lang, "kernel.latencyFirst"), pair(report.ttft), lang),
    UI.row(t(lang, "kernel.latencyProvider"), pair(report.provider), lang),
    UI.row(t(lang, "kernel.latencyTotal"), pair(report.total), lang),
    UI.row(t(lang, "kernel.latencyFallbacks"), String(report.fallback.count), lang),
    providers ? UI.row(t(lang, "kernel.providersHealth"), UI.isolate(providers), lang) : "",
  ];
}

/** صحة أداة في سطر واحد */
function healthLine(health, lang) {
  if (health.open) return `⛔ ${t(lang, "scraper.circuitOpen")}`;
  const latency = health.lastLatencyMs ? ` · ${health.lastLatencyMs}ms` : "";
  return `${t(lang, "scraper.circuitClosed")} · ${t(lang, "scraper.calls")} ${health.calls} · ${t(lang, "scraper.failures")} ${health.failures}${latency}`;
}

/** مدخل الاختبار الحي حسب نوع الأداة */
function testInput(entry, arg) {
  const value = String(arg || "").trim();
  if (entry.input === "url" || entry.input === "url|query") return /^https?:\/\//i.test(value) ? { url: value } : entry.input === "url|query" && value ? { query: value } : {};
  if (entry.input === "prompt" || entry.input === "image+prompt") return { prompt: value || "a calm sunset over the sea" };
  if (entry.input === "query" || entry.input === "name") return { query: value || "test", name: value || "test" };
  return {};
}

async function executeScraperIntent({ m, intent, lang, sock = null }) {
  if (intent.op === "scraperList") {
    const all = scrapers.listScrapers();
    const byKind = {};
    for (const entry of all) (byKind[entry.kind] ||= []).push(entry.id);
    return {
      icon: "🧰",
      blocks: [
        UI.row(t(lang, "scraper.total"), String(all.length), lang),
        ...Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)
          .map(([kind, ids]) => UI.row(`${kind} (${ids.length})`, UI.isolate(ids.join(", ")), lang)),
      ],
    };
  }
  if (intent.op === "scraperOfPlugin") {
    const target = String(intent.plugin || "").replace(/^\./, "");
    const users = scrapers.listScrapers().filter((entry) => entry.plugins.some((file) => file.split("/").pop().replace(/\.js$/, "") === target));
    return {
      icon: "🧰",
      blocks: [UI.row(t(lang, "scraper.usedBy", { plugin: target }), users.length ? UI.isolate(users.map((e) => e.id).join(", ")) : t(lang, "scraper.none"), lang)],
    };
  }
  if (intent.op === "scraperCompare") {
    const result = await scrapers.compareScrapers(intent.a, intent.b);
    if (!result) return { icon: "⚠️", blocks: [t(lang, "scraper.unknownTool")] };
    const side = (x) => [
      UI.section(x.id, lang),
      UI.row(t(lang, "scraper.kind"), x.kind, lang),
      UI.row(t(lang, "scraper.input"), x.input, lang),
      UI.row(t(lang, "scraper.platforms"), x.platforms.join(", ") || t(lang, "scraper.none"), lang),
      UI.row(t(lang, "scraper.timeout"), `${Math.round(x.timeoutMs / 1000)}s`, lang),
      UI.row(t(lang, "scraper.plugins"), x.plugins.join(", ") || t(lang, "scraper.none"), lang),
      UI.row(t(lang, "scraper.exports"), UI.isolate(x.exports.join(", ")), lang),
    ].join("\n");
    return { icon: "🧰", blocks: [side(result.left), side(result.right)] };
  }

  const info = await scrapers.inspectScraper(intent.id);
  if (!info) return { icon: "⚠️", blocks: [t(lang, "scraper.unknownTool")] };

  if (intent.op === "scraperPlugins") {
    return {
      icon: "🧰",
      blocks: [UI.row(t(lang, "scraper.plugins"), info.plugins.length
        ? UI.isolate(info.plugins.map((p) => `${p.command} (${p.file})`).join("\n"))
        : t(lang, "scraper.noPlugins"), lang)],
    };
  }

  if (intent.op === "scraperTest") {
    const input = testInput(info, intent.arg);
    const outcome = await scrapers.runScraper({ id: info.id, input, m, sock, lang, prefer: "adapter", deliver: Boolean(sock) });
    const attempts = outcome.attempts.map((a) => `${a.id}: ${a.ok ? "✅" : "❌"}${a.latencyMs ? ` ${a.latencyMs}ms` : ""}${a.error ? ` · ${a.error.slice(0, 80)}` : ""}${a.skipped ? ` · ${a.skipped}` : ""}`);
    return {
      icon: outcome.ok ? "✅" : "⚠️",
      blocks: [
        outcome.ok ? t(lang, "scraper.testOk") : `${t(lang, "scraper.testFailed")}${outcome.messageKey ? ` — ${t(lang, outcome.messageKey, { platform: info.id })}` : ""}`,
        attempts.length ? UI.row(t(lang, "scraper.attempts"), UI.isolate(attempts.join("\n")), lang) : "",
        UI.row(t(lang, "scraper.health"), healthLine(scrapers.healthOf(info.id) && { ...scrapers.healthOf(info.id), open: scrapers.isOpen(info.id) }, lang), lang),
      ],
    };
  }

  // scraperInspect
  const methods = Object.entries(info.discovered?.methods || {}).map(([name, list]) => `${name}: ${list.join(", ")}`);
  return {
    icon: "🧰",
    blocks: [
      UI.row(t(lang, "scraper.toolTitle", { id: info.id }), UI.isolate(info.file), lang),
      UI.row(t(lang, "scraper.kind"), info.kind, lang),
      UI.row(t(lang, "scraper.input"), info.input, lang),
      UI.row(t(lang, "scraper.output"), info.output, lang),
      UI.row(t(lang, "scraper.platforms"), info.platforms.join(", ") || t(lang, "scraper.none"), lang),
      UI.row(t(lang, "scraper.timeout"), `${Math.round(info.timeoutMs / 1000)}s`, lang),
      UI.row(t(lang, "scraper.permission"), info.permission, lang),
      UI.row(t(lang, "scraper.exports"), UI.isolate([...(info.discovered?.exports || []), ...methods].join("\n") || info.loadError), lang),
      UI.row(t(lang, "scraper.plugins"), info.plugins.length ? UI.isolate(info.plugins.map((p) => p.command).join(", ")) : t(lang, "scraper.noPlugins"), lang),
      UI.row(t(lang, "scraper.health"), healthLine(info.health, lang), lang),
      info.health.lastError ? UI.row(t(lang, "scraper.lastError"), info.health.lastError, lang) : "",
    ],
  };
}

async function executeOwnerIntent({ m, intent, lang, tools, ask, sock = null }) {
  const owner = m.sender;
  if (String(intent.op || "").startsWith("scraper")) return executeScraperIntent({ m, intent, lang, sock });
  switch (intent.op) {
    case "diagnostics": {
      const info = tools.diagnostics();
      return {
        blocks: [
          UI.row("Node", info.node, lang),
          UI.row(t(lang, "kernel.uptime"), `${info.uptimeSeconds}s`, lang),
          UI.row("RSS", `${info.rssMb} MB`, lang),
          UI.row(t(lang, "kernel.files"), `${info.files.plugins} + ${info.files.lib}`, lang),
          ...latencyBlocks(lang),
        ],
      };
    }
    case "read": {
      const file = tools.read(intent.target, { from: intent.from, to: intent.to });
      return {
        blocks: [
          UI.row(t(lang, "kernel.file"), UI.isolate(`${file.path} (${file.from}-${file.to}/${file.total})`), lang),
          fence(file.content),
        ],
      };
    }
    case "inspect": {
      const info = tools.inspect(intent.target);
      return {
        blocks: [
          UI.row(t(lang, "kernel.file"), UI.isolate(info.path), lang),
          UI.row(t(lang, "kernel.lines"), String(info.lines), lang),
          info.exports.length ? UI.row("exports", UI.isolate(info.exports.slice(0, 12).join(", ")), lang) : "",
        ],
      };
    }
    case "list": {
      const items = tools.list(intent.target).slice(0, 30)
        .map((item) => UI.bullet(`${item.type === "dir" ? "📁" : "📄"} ${UI.isolate(item.name)}`, lang)).join("\n");
      return { blocks: [items || t(lang, "kernel.emptyFolder")] };
    }
    case "search": {
      const hits = tools.search(intent.query, { limit: 15 });
      const lines = hits.map((hit) => UI.bullet(UI.isolate(`${hit.path}:${hit.line}`), lang)).join("\n");
      return { blocks: [UI.row(t(lang, "kernel.ownerSearch"), UI.isolate(intent.query), lang), lines || t(lang, "kernel.noResults")] };
    }
    case "compare": {
      const result = tools.compare(intent.a, intent.b);
      return { blocks: [UI.row(t(lang, "kernel.ownerCompare"), UI.isolate(`${result.a} ↔ ${result.b}`), lang), fence(result.diff)] };
    }
    case "syntax": {
      const result = await tools.syntax(intent.target);
      return {
        blocks: [
          UI.row(t(lang, "kernel.file"), UI.isolate(result.path), lang),
          result.ok ? t(lang, "kernel.syntaxOk") : `${t(lang, "kernel.syntaxFail")}\n${fence(result.error.slice(0, 500))}`,
        ],
        icon: result.ok ? "✅" : "⚠️",
      };
    }
    case "backup": {
      const saved = tools.backup(intent.target);
      return { blocks: [t(lang, "kernel.ownerBackupDone", { path: saved.path, id: saved.id })], icon: "💾" };
    }
    case "projectBackup": {
      const saved = await tools.projectBackup();
      const size = saved.size >= 1048576 ? `${(saved.size / 1048576).toFixed(1)} MB` : `${Math.ceil(saved.size / 1024)} KB`;
      return { blocks: [t(lang, "kernel.ownerProjectBackupDone", { file: saved.file, files: saved.fileCount, size })], icon: "💾" };
    }
    case "menus": {
      const result = await tools.test("menus");
      const rows = deliveryLog().slice(-100);
      const count = (outcome) => rows.filter((row) => row.outcome === outcome).length;
      const failure = [...rows].reverse().find((row) => row.outcome === "rejected" || row.outcome === "error");
      const tail = String(result.output || "").trim().split("\n").slice(-4).join("\n");
      return {
        blocks: [
          UI.row(t(lang, "kernel.ownerTest"), UI.isolate(result.test), lang),
          result.ok ? t(lang, "kernel.testPassed") : t(lang, "kernel.testFailed"),
          t(lang, "kernel.ownerMenusDelivery", { sent: count("sent") + count("acknowledged"), rejected: count("rejected"), errors: count("error") }),
          failure ? t(lang, "kernel.ownerMenusLastFailure", { menu: failure.menuId || "?", stage: failure.stage || "?", error: String(failure.error || "").slice(0, 80) }) : "",
          fence(tail),
        ],
        icon: result.ok && !failure ? "✅" : "⚠️",
      };
    }
    case "problems": {
      // فحوص حقيقية فقط: بناء كل الملفات + الفحص الصارم + أخطاء الإرسال المسجّلة
      const syntaxRun = await tools.test("syntax");
      const audit = await tools.strictAudit();
      const sendErrors = deliveryLog().slice(-100).filter((row) => row.outcome === "error" || row.outcome === "rejected").slice(-3);
      // §31: الإخفاقات غير المميتة المسجّلة من كل catch كان صامتاً
      const logged = recentFailures(5);
      const clean = syntaxRun.ok && audit.ok && !sendErrors.length && !logged.length;
      const tailOf = (output, lines) => String(output || "").trim().split("\n").slice(-lines).join("\n");
      return {
        blocks: [
          clean ? t(lang, "kernel.ownerProblemsNone") : t(lang, "kernel.ownerProblemsFound"),
          UI.row(t(lang, "kernel.ownerProblemsSyntax"), syntaxRun.ok ? "✓" : "✗", lang),
          syntaxRun.ok ? "" : fence(tailOf(syntaxRun.output, 6)),
          UI.row(t(lang, "kernel.ownerProblemsAudit"), audit.ok ? "✓" : "✗", lang),
          audit.ok ? "" : fence(tailOf(audit.output, 8)),
          sendErrors.length ? UI.row(t(lang, "kernel.ownerProblemsDelivery"), String(sendErrors.length), lang) : "",
          sendErrors.length ? fence(sendErrors.map((row) => `${row.menuId || "?"} · ${row.stage || "?"} · ${String(row.error || row.outcome).slice(0, 80)}`).join("\n")) : "",
          logged.length ? UI.row(t(lang, "kernel.ownerProblemsFailures"), String(logged.length), lang) : "",
          logged.length ? fence(logged.map((entry) => `${entry.scope} · ${entry.stage || "?"} · ${entry.message.slice(0, 70)} · ${entry.where || ""}`).join("\n")) : "",
        ],
        icon: clean ? "✅" : "⚠️",
      };
    }
    case "changes": {
      const last = tools.lastChange();
      if (!last) return { blocks: [t(lang, "kernel.ownerNoChanges")] };
      const list = tools.changeHistory(5)
        .map((c) => UI.bullet(UI.isolate(c.kind === "move" ? `${c.from} → ${c.to}` : c.path), lang)).join("\n");
      return { blocks: [t(lang, "kernel.ownerChanges"), list, last.diff ? fence(last.diff) : ""] };
    }
    case "rollback": {
      const last = tools.lastChange();
      if (!last) return { blocks: [t(lang, "kernel.ownerNoChanges")] };
      setPending(m, { kind: "rollback", reason: last.path || last.from || "" });
      return { blocks: [t(lang, "kernel.ownerRollbackConfirm", { path: last.path || `${last.from} → ${last.to}` }), t(lang, "kernel.ownerApproveHint")], icon: "⚠️", pending: true };
    }
    case "rename": {
      const base = intent.from.split("/").pop().replace(/\.(js|mjs|cjs)$/, "");
      const refs = base.length >= 3 ? tools.search(base, { limit: 30 }).filter((hit) => hit.path !== intent.from) : [];
      setPending(m, { kind: "rename", from: intent.from, to: intent.to, reason: "rename" });
      return {
        blocks: [
          t(lang, "kernel.ownerRenameConfirm", { from: intent.from, to: intent.to }),
          refs.length ? t(lang, "kernel.ownerRenameRefs", { count: refs.length }) : "",
          t(lang, "kernel.ownerApproveHint"),
        ],
        icon: "⚠️",
        pending: true,
      };
    }
    case "test": {
      if (!intent.name) {
        // «اختبر» وحدها ⇒ اختبار سريع حقيقي: بناء · استيراد · سلامة
        const results = [];
        for (const name of QUICK_TESTS) results.push(await tools.test(name).catch((error) => ({ test: name, ok: false, output: error.message })));
        const failed = results.filter((result) => !result.ok);
        return {
          blocks: [
            t(lang, "kernel.ownerQuickTest"),
            results.map((result) => UI.row(result.test, result.ok ? "✓" : "✗", lang)).join("\n"),
            failed.length ? t(lang, "kernel.testFailed") : t(lang, "kernel.testPassed"),
            ...failed.map((result) => fence(String(result.output || "").trim().split("\n").slice(-4).join("\n"))),
          ],
          icon: failed.length ? "❌" : "✅",
        };
      }
      const result = await tools.test(intent.name);
      const tail = String(result.output || "").trim().split("\n").slice(-6).join("\n");
      return { blocks: [UI.row(t(lang, "kernel.ownerTest"), UI.isolate(result.test), lang), result.ok ? t(lang, "kernel.testPassed") : t(lang, "kernel.testFailed"), fence(tail)], icon: result.ok ? "✅" : "❌" };
    }
    case "audit": {
      const result = await tools.strictAudit();
      const tail = String(result.output || "").trim().split("\n").slice(-8).join("\n");
      return { blocks: [result.ok ? t(lang, "kernel.ownerAuditOk") : t(lang, "kernel.ownerAuditFail"), fence(tail)], icon: result.ok ? "✅" : "⚠️" };
    }
    case "manifest": {
      const result = await tools.manifest();
      if (!result.ok) return { blocks: [t(lang, "kernel.toolDenied"), fence(result.error)], icon: "⛔" };
      const c = result.counts || {};
      return { blocks: [t(lang, "kernel.ownerManifest", { commands: c.commands ?? "?", aliases: c.aliases ?? "?", plugins: c.plugins ?? "?" }), UI.row(t(lang, "kernel.file"), UI.isolate(result.file), lang)] };
    }
    case "fix": {
      const file = tools.read(intent.target);
      if (file.content.includes("[تم حجب بيانات حسّاسة]") || file.content.includes("[محجوب]")) {
        return { blocks: [t(lang, "kernel.ownerFixSensitive")], icon: "⛔" };
      }
      const check = /\.(js|mjs|cjs)$/.test(file.path) ? await tools.syntax(file.path) : { ok: true, error: "" };
      if (check.ok && !intent.request) {
        return { blocks: [t(lang, "kernel.ownerFixNoIssue", { path: file.path })], icon: "✅" };
      }
      const next = await proposeFix({ rel: file.path, content: file.content, error: check.ok ? "" : check.error, request: intent.request, ask });
      if (!next) {
        return {
          blocks: [
            check.ok ? t(lang, "kernel.ownerFixNoProposal") : `${t(lang, "kernel.ownerFixNoProvider")}\n${fence(check.error.slice(0, 500))}`,
          ],
          icon: "⚠️",
        };
      }
      const planned = tools.plan({ path: file.path, content: next, reason: intent.request || "fix", ownerJid: owner });
      setPending(m, { kind: "plan", planId: planned.id, reason: `fix ${file.path}` });
      return {
        blocks: [
          t(lang, "kernel.planReady"),
          UI.row(t(lang, "kernel.file"), UI.isolate(planned.path), lang),
          UI.row(t(lang, "kernel.ownerRisk"), `${t(lang, `kernel.risk.${planned.risk.level}`)} — ${planned.risk.reasons.join("، ")}`, lang),
          fence(planned.diff),
          t(lang, "kernel.ownerApproveHint"),
        ],
        icon: "📝",
        pending: true,
      };
    }
    default:
      return { blocks: [t(lang, "kernel.toolDenied")], icon: "⛔" };
  }
}

/**
 * تنفيذ عملية معلّقة بعد موافقة المالك الصريحة.
 * @returns {Promise<{blocks:string[], icon?:string}>}
 */
async function executeApprovedOwnerPending({ m, pending, lang, tools }) {
  if (pending.kind === "plan") {
    const plan = tools.getPlan(pending.planId);
    if (!plan) return { blocks: [t(lang, "kernel.planNone")], icon: "⛔" };
    tools.approve(pending.planId, m.sender);
    const applied = await tools.apply(pending.planId, m.sender);
    if (!applied.ok) {
      return { blocks: [t(lang, "kernel.planFailed"), applied.error ? fence(String(applied.error).slice(0, 500)) : ""], icon: "↩️" };
    }
    // Test → Verify: الاختبار المناسب للملف؛ فشله يعني تراجعاً تلقائياً
    const testName = testFor(applied.path);
    if (testName && tools.ALLOWED_TESTS?.[testName]) {
      const result = await tools.test(testName).catch((error) => ({ ok: false, output: error.message, test: testName }));
      if (!result.ok) {
        tools.rollbackLast();
        return { blocks: [t(lang, "kernel.ownerTestRolledBack", { test: testName }), fence(String(result.output || "").split("\n").slice(-6).join("\n"))], icon: "↩️" };
      }
    }
    return {
      blocks: [
        t(lang, "kernel.planApplied"),
        UI.row(t(lang, "kernel.file"), UI.isolate(applied.path), lang),
        UI.row(t(lang, "kernel.backupCreated"), UI.isolate(applied.backup), lang),
        testName ? UI.row(t(lang, "kernel.ownerTest"), `${testName} ✓`, lang) : "",
      ],
      icon: "✅",
    };
  }
  if (pending.kind === "rollback") {
    const result = tools.rollbackLast();
    return { blocks: [t(lang, "kernel.ownerRollbackDone", { path: result.restored })], icon: "↩️" };
  }
  if (pending.kind === "rename") {
    const moved = tools.move(pending.from, pending.to);
    if (/\.(js|mjs|cjs)$/.test(moved.to)) {
      const result = await tools.test("imports").catch((error) => ({ ok: false, output: error.message }));
      if (!result.ok) {
        tools.rollbackLast();
        return { blocks: [t(lang, "kernel.ownerTestRolledBack", { test: "imports" }), fence(String(result.output || "").split("\n").slice(-6).join("\n"))], icon: "↩️" };
      }
    }
    return { blocks: [t(lang, "kernel.ownerRenamed", { from: moved.from, to: moved.to })], icon: "✅" };
  }
  return { blocks: [t(lang, "kernel.planNone")], icon: "⛔" };
}

export { INTENTS, executeApprovedOwnerPending, executeOwnerIntent, isConfigOwner, parseOwnerIntent, proposeFix, testFor };
export default { parseOwnerIntent, executeOwnerIntent, executeApprovedOwnerPending, isConfigOwner };
