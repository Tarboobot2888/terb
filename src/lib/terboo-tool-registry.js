// ═══════════════════════════════════════════════
// 🧰 Terboo Tool Registry (§24 §25 §34 §35 §60 §61)
// ───────────────────────────────────────────────
// سجل أدوات موحّد واحد فوق ما هو موجود — لا تنفيذ scraper ثانٍ ولا موجّه أوامر ثانٍ:
//   • أدوات الـscrapers الـ63: تُقرأ من terboo-scraper-registry.js (CATALOG) وتُنفَّذ عبر runScraper
//     نفسه (صلاحية · تحقق · مهلة · قاطع دائرة · بديل صحي · تسليم).
//   • أدوات الوسائط المحلية: OCR · وصف · تفريغ · TTS · فيديو · مستندات · فحص ملف
//     — تُنفَّذ عبر terboo-multimodal.js / terboo-documents.js.
//   • أدوات وسائط مسمّاة تُحال لـscraper قائم (image.edit ⇒ img2img …) بلا تكرار.
//
// لكل أداة: id · فئة · وصف · مخطط مدخلات · مخرجات · صلاحية · مهلة · حد حجم · محاولات · بدائل · صحة.
// Tool Search (§35): لا تُعرض الـ63 أداة للنموذج في كل رسالة — فقط الأنسب للطلب والسياق.
// النتائج مطبّعة بشكل واحد: {ok, id, category, source, kind, text, items, deliveries, data, error, latencyMs, attempts}.
// ═══════════════════════════════════════════════

import crypto from "node:crypto";
import { noteFailure } from "./terboo-failure-log.js";
import { CATALOG, detectPlatform, extractUrl, healthOf, isOpen, runScraper } from "./terboo-scraper-registry.js";

/** الفئات العليا (§24) */
const CATEGORIES = ["AI", "Downloaders", "Audio", "Image", "Video", "Search", "Anime-Games", "Documents", "Utility"];

/** تصنيف كل scraper في فئة عليا (الأساس: kind الموجود، مع استثناءات صريحة) */
const SCRAPER_CATEGORY = {
  spotify: "Audio", soundclouddl: "Audio", soundcloud: "Audio", topmedia: "Audio",
  konachan: "Anime-Games", kusonime: "Anime-Games", shinigami: "Anime-Games", hokinfo: "Anime-Games", wwchar: "Anime-Games", lufemboy: "Anime-Games",
  wallpapersearch: "Image", imgdrop: "Utility", videy: "Utility", dafont: "Search", gsmarena: "Search", dramabox: "Search",
};
const KIND_CATEGORY = {
  download: "Downloaders", search: "Search", info: "Search", "image-generate": "Image", "image-edit": "Image", "image-enhance": "Image",
  "video-enhance": "Video", upload: "Utility", convert: "Utility", utility: "Utility", tts: "Audio", fun: "Anime-Games", chat: "AI", agent: "AI",
};

/** كلمات قدرة لكل نوع (عربي/مصري · إنجليزي · إسباني) — تُستعمل في البحث فقط */
const KIND_TERMS = {
  download: "حمل نزل تحميل تنزيل هات رابط لينك download save get link descargar bajar",
  search: "ابحث دور دورلي بحث شوفلي هات لي search find look busca buscar",
  info: "معلومات مواصفات تفاصيل info specs details informacion especificaciones",
  "image-generate": "ارسم اعمل صوره رسمه توليد generate draw create image picture art dibuja genera imagen",
  "image-edit": "عدل الصوره شيل الخلفيه حول الصوره edit restyle background remove edita fondo",
  "image-enhance": "وضح حسن الجوده كبر الصوره hd upscale enhance quality mejora calidad",
  "video-enhance": "حسن الفيديو جوده الفيديو hd enhance video quality mejora video",
  upload: "ارفع رابط للصوره رفع upload link host sube enlace",
  convert: "حول صيغه تحويل convert format convierte formato",
  utility: "ايميل مؤقت بريد temp mail email correo temporal",
  tts: "صوت نطق اقرا text to speech voice voz",
  fun: "لعبه تسليه fun game juego",
  chat: "دردشه chat",
  agent: "وكيل agent",
};

/** أسماء المنصات والأدوات كما يكتبها الناس بالعربية (للبحث فقط) */
const PLATFORM_TERMS = {
  tiktok: "تيك توك تيكتوك", youtube: "يوتيوب يوتوب", instagram: "انستا انستجرام انستقرام ريلز", facebook: "فيس فيسبوك",
  twitter: "تويتر اكس", spotify: "سبوتيفاي", soundcloud: "ساوند كلاود", pinterest: "بنترست", reddit: "ريديت",
  mediafire: "ميديا فاير ميديافاير", terabox: "تيرابوكس", capcut: "كاب كات", threads: "ثريدز", douyin: "دوين",
  dailymotion: "ديلي موشن", likee: "لايكي", rednote: "ريد نوت", sfile: "اس فايل",
};
const SCRAPER_TERMS = {
  google: "جوجل قوقل نت ويب web", tiktoksearch: "تيك توك تيكتوك فيديوهات", soundcloud: "ساوند كلاود اغنيه اغاني song music",
  wallpapersearch: "خلفيات خلفيه wallpaper", konachan: "رسومات انمي fanart", kusonime: "انمي anime", dramabox: "دراما مسلسل مسلسلات",
  shinigami: "مانجا مانهوا manga", dafont: "خط خطوط font", gsmarena: "موبايل هاتف جوال تليفون phone", hokinfo: "هونر اوف كينجز بطل",
  wwchar: "ويذرنج ويفز شخصيه", spotify: "اغنيه اغاني song music", soundclouddl: "اغنيه song", tempmail: "ايميل بريد",
};

const MB = 1024 * 1024;

// ═══════════════════════════════════════════════
// أدوات الوسائط (§34)
// ═══════════════════════════════════════════════

const BIN = (description) => ({ type: "binary", description });
const STR = (description) => ({ type: "string", description });

/**
 * أدوات محلية (source:"local") تنفّذها طبقة الوسائط، وأدوات مسمّاة (source:"scraper", target)
 * تُحال لـscraper قائم. لا شيء هنا يعيد تنفيذ scraper.
 */
const MEDIA_TOOLS = {
  "image.describe": { category: "Image", output: "text", timeoutMs: 45_000, maxBytes: 16 * MB, terms: "صف الصوره حلل ايه في الصوره describe image what is in photo analyze describe imagen",
    purpose: "Describe or answer questions about an image with a provider that actually receives the image.",
    input: { required: ["image"], properties: { image: BIN("image bytes"), question: STR("what to look for") } } },
  "image.ocr": { category: "Image", output: "text", timeoutMs: 90_000, maxBytes: 16 * MB, terms: "استخرج النص اقرا المكتوب ocr read text extract text lee el texto",
    purpose: "Extract the text written inside an image (OCR, Arabic/English).",
    input: { required: ["image"], properties: { image: BIN("image bytes"), languages: STR("tesseract codes, e.g. ara+eng") } } },
  "image.edit": { category: "Image", target: "img2img", output: "image", terms: "عدل الصوره حولها انمي edit image restyle edita imagen" },
  "image.generate": { category: "Image", target: "txt2img2", output: "image", terms: "ارسم اعمل صوره generate draw image genera imagen" },
  "image.upscale": { category: "Image", target: "hd", output: "image", terms: "وضح كبر الصوره hd upscale enhance mejora" },
  "image.remove_background": { category: "Image", target: "removebackground", output: "image", terms: "شيل الخلفيه احذف الخلفيه remove background quita el fondo" },
  "audio.transcribe": { category: "Audio", output: "text", timeoutMs: 120_000, maxBytes: 25 * MB, terms: "فرغ التسجيل اكتب الكلام الفويس transcribe voice note speech to text transcribe audio",
    purpose: "Transcribe speech in an audio or voice note (Whisper when a key is configured); never invents words.",
    input: { required: ["audio"], properties: { audio: BIN("audio bytes"), language: STR("ISO language hint") } } },
  "audio.tts": { category: "Audio", output: "audio", timeoutMs: 60_000, maxChars: 1_200, terms: "رد بصوت اقراهولي صوت tts voice reply read aloud lee en voz",
    purpose: "Turn text into a WhatsApp voice note (Opus PTT).",
    input: { required: ["text"], properties: { text: STR("text to speak"), lang: STR("ar|en|es") } } },
  "video.inspect": { category: "Video", output: "data", timeoutMs: 30_000, maxBytes: 64 * MB, terms: "مده الفيديو ابعاد معلومات الفيديو video info duration resolution",
    purpose: "Read video metadata: duration, resolution, audio track.",
    input: { required: ["video"], properties: { video: BIN("video bytes") } } },
  "video.transcribe": { category: "Video", output: "text", timeoutMs: 180_000, maxBytes: 64 * MB, terms: "اكتب كلام الفيديو فرغ الفيديو transcribe video subtitles speech",
    purpose: "Extract the audio track of a video and transcribe it with timestamps.",
    input: { required: ["video"], properties: { video: BIN("video bytes") } } },
  "video.keyframes": { category: "Video", output: "list", timeoutMs: 90_000, maxBytes: 64 * MB, terms: "لقطات الفيديو صور من الفيديو keyframes frames thumbnails",
    purpose: "Extract evenly spaced keyframes (JPEG) from a video.",
    input: { required: ["video"], properties: { video: BIN("video bytes"), count: { type: "number", description: "1-12" } } } },
  "document.extract": { category: "Documents", output: "text", timeoutMs: 180_000, maxBytes: 100 * MB, terms: "استخرج نص الملف اقرا الملف pdf docx excel extract document text lee el documento",
    purpose: "Extract text and structure from PDF, DOCX, XLSX, PPTX, CSV, JSON, code and text files (safe, no execution).",
    input: { required: ["file"], properties: { file: BIN("file bytes"), fileName: STR("original name"), mimetype: STR("MIME type") } } },
  "document.summarize": { category: "Documents", output: "text", timeoutMs: 240_000, maxBytes: 100 * MB, terms: "لخص الملف لخص المستند حلل الملف summarize document summarize pdf resume el documento",
    purpose: "Pick the parts of a document most relevant to a question and prepare them for the model.",
    input: { required: ["file"], properties: { file: BIN("file bytes"), fileName: STR("original name"), question: STR("what to summarize or answer") } } },
  "file.inspect": { category: "Utility", output: "data", timeoutMs: 10_000, maxBytes: 100 * MB, terms: "نوع الملف حجم الملف افحص الملف file type inspect file size",
    purpose: "Identify a file's real type, size and SHA-256 without opening or executing it.",
    input: { required: ["file"], properties: { file: BIN("file bytes"), fileName: STR("original name"), mimetype: STR("MIME type") } } },
  "group.members": { category: "Utility", output: "data", timeoutMs: 15_000, maxChars: 200, terms: "اعضاء الجروب مين في الجروب مين الادمن كام عضو موجود group members who is in the group admins how many members miembros del grupo",
    purpose: "List the real participants of the current WhatsApp group from its metadata: names, admin roles, owner, count and the last added member (no registration needed; numbers are masked).",
    input: { required: [], properties: { refresh: { type: "boolean", description: "re-read the group from WhatsApp" } } } },
};

const SCRAPER_INPUT_SCHEMA = {
  url: { required: ["url"], properties: { url: { type: "string", format: "uri" } } },
  "url|query": { required: [], anyOf: [["url"], ["query"]], properties: { url: { type: "string", format: "uri" }, query: STR("search text") } },
  query: { required: ["query"], properties: { query: STR("search text") } },
  name: { required: ["name"], properties: { name: STR("name to look up") } },
  prompt: { required: ["prompt"], properties: { prompt: STR("description") } },
  image: { required: ["image"], properties: { image: BIN("image bytes") } },
  "image+prompt": { required: ["image", "prompt"], properties: { image: BIN("image bytes"), prompt: STR("instruction") } },
  video: { required: ["video"], properties: { video: BIN("video bytes") } },
  file: { required: ["file"], properties: { file: BIN("file bytes") } },
  none: { required: [], properties: {} },
};

// ═══════════════════════════════════════════════
// البناء: سجل واحد
// ═══════════════════════════════════════════════

/** صحة الأدوات المحلية (الـscrapers صحتها في سجلها) */
const localHealth = new Map();
function localHealthOf(id) {
  return localHealth.get(id) || { calls: 0, failures: 0, consecutiveFailures: 0, lastLatencyMs: null, lastError: "", lastOkAt: 0 };
}
function recordLocal(id, ok, latencyMs, error = "") {
  const h = { ...localHealthOf(id) };
  h.calls += 1;
  h.lastLatencyMs = latencyMs;
  if (ok) { h.consecutiveFailures = 0; h.lastOkAt = Date.now(); } else { h.failures += 1; h.consecutiveFailures += 1; h.lastError = String(error).slice(0, 120); }
  localHealth.set(id, h);
}

function scraperTool(id, entry) {
  return {
    id, name: id, source: "scraper", target: id,
    category: SCRAPER_CATEGORY[id] || KIND_CATEGORY[entry.kind] || "Utility",
    kind: entry.kind, purpose: entry.purpose, platforms: [...entry.platforms],
    input: SCRAPER_INPUT_SCHEMA[entry.input] || { required: [], properties: {} }, inputKind: entry.input, output: entry.output,
    permission: entry.permission, auth: entry.auth, safety: entry.safety,
    timeoutMs: entry.timeoutMs, retries: entry.retries, maxAttempts: entry.maxAttempts, fallbacks: [...entry.fallbacks],
    autoSelect: entry.autoSelect !== false, modelVisible: entry.autoSelect !== false && entry.kind !== "chat" && entry.kind !== "agent",
    terms: [KIND_TERMS[entry.kind] || "", SCRAPER_TERMS[id] || "", ...entry.platforms.map((p) => PLATFORM_TERMS[p] || ""), ...(entry.examples || []).map((e) => (typeof e === "string" ? e : e?.text || ""))].join(" "),
  };
}

function mediaTool(id, spec) {
  if (spec.target) {
    const base = CATALOG[spec.target];
    if (!base) return null;
    const scraper = scraperTool(spec.target, base);
    return { ...scraper, id, name: id, category: spec.category, target: spec.target, output: spec.output, modelVisible: false, terms: `${spec.terms} ${scraper.terms}`, alias: true };
  }
  return {
    id, name: id, source: "local", target: id, category: spec.category, kind: id.split(".")[0], purpose: spec.purpose, platforms: [],
    input: spec.input, inputKind: spec.input.required.join("+"), output: spec.output, permission: "public", auth: "none",
    safety: "user-media", timeoutMs: spec.timeoutMs, maxBytes: spec.maxBytes || 0, maxChars: spec.maxChars || 0,
    retries: 0, maxAttempts: 1, fallbacks: [], autoSelect: true, modelVisible: false, terms: spec.terms,
  };
}

let registry = null;
function build() {
  if (registry) return registry;
  registry = new Map();
  for (const [id, entry] of Object.entries(CATALOG)) registry.set(id, scraperTool(id, entry));
  for (const [id, spec] of Object.entries(MEDIA_TOOLS)) {
    const tool = mediaTool(id, spec);
    if (tool) registry.set(id, tool);
  }
  index = null;
  return registry;
}

/** كل الأدوات (بيانات وصفية بلا دوال) */
function allTools({ category = "", source = "" } = {}) {
  return [...build().values()].filter((tool) => (!category || tool.category === category) && (!source || tool.source === source));
}

function getTool(id) {
  return build().get(String(id || "")) || null;
}

function healthOfTool(id) {
  const tool = getTool(id);
  if (!tool) return null;
  if (tool.source === "scraper") return { ...healthOf(tool.target), open: isOpen(tool.target) };
  const h = localHealthOf(id);
  return { ...h, open: false };
}

function categories() {
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const tool of build().values()) counts[tool.category] = (counts[tool.category] || 0) + 1;
  return counts;
}

// ═══════════════════════════════════════════════
// Tool Search (§35): BM25 على id/الوصف/الفئة/المنصات/كلمات القدرة/الأمثلة + السياق
// ═══════════════════════════════════════════════

function normalize(text) {
  return String(text || "").toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s.]/gu, " ");
}
/** جذع عربي خفيف: يزيل «ال» وأدوات السوابق (و/ف/ب/ل) وضمائر اللواحق (لي/لك/ها/هم/ه/ي) — «دورلي» ⇒ «دور» */
function stem(word) {
  let w = word;
  if (/^[\u0600-\u06FF]+$/.test(w)) {
    if (/^(?:وال|فال|بال|لل)[\u0600-\u06FF]{3,}/.test(w)) w = w.slice(w.startsWith("لل") ? 2 : 3);
    else if (/^ال[\u0600-\u06FF]{3,}/.test(w)) w = w.slice(2);
    else if (/^[وف][\u0600-\u06FF]{4,}/.test(w)) w = w.slice(1);
    const suffix = w.match(/(?:لي|لك|لنا|ها|هم|كم|نا|ه|ي)$/);
    if (suffix && w.length - suffix[0].length >= 3) w = w.slice(0, -suffix[0].length);
  }
  return w;
}

function tokens(text) {
  const out = [];
  for (const w of normalize(text).split(/[\s.]+/)) {
    if (w.length < 2) continue;
    const base = /^ال[\u0600-\u06FF]{3,}/.test(w) ? w.slice(2) : w;
    out.push(base);
    const root = stem(w);
    if (root !== base && root.length >= 2) out.push(root);
  }
  return out;
}

/** الأداة العامة لكل نوع: تتقدّم حين يكون الطلب عاماً */
const GENERALIST = { google: "search", aio: "download" };
const kindWordCache = new Map();
function kindWords(kind) {
  if (!kindWordCache.has(kind)) kindWordCache.set(kind, new Set(tokens(KIND_TERMS[kind] || "")));
  return kindWordCache.get(kind);
}

let index = null;
function buildIndex() {
  if (index) return index;
  const docs = [...build().values()].map((tool) => {
    const words = tokens(`${tool.id.replace(/[._-]/g, " ")} ${tool.category} ${tool.kind} ${tool.platforms.join(" ")} ${tool.purpose} ${tool.terms}`);
    const tf = new Map();
    for (const w of words) tf.set(w, (tf.get(w) || 0) + 1);
    return { id: tool.id, tf, length: words.length };
  });
  const df = new Map();
  for (const doc of docs) for (const w of doc.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length);
  index = { docs, df, avg, n: docs.length };
  return index;
}

/**
 * أنسب الأدوات لطلب وسياق.
 * @param {string} query
 * @param {{limit?:number, hasImage?:boolean, hasVideo?:boolean, hasAudio?:boolean, hasDocument?:boolean,
 *          modelVisibleOnly?:boolean, category?:string, isOwner?:boolean}} [options]
 * @returns {Array<{id:string, score:number, category:string, reason:string[]}>}
 */
function searchTools(query, { limit = 8, hasImage = false, hasVideo = false, hasAudio = false, hasDocument = false, modelVisibleOnly = false, category = "", isOwner = false } = {}) {
  const { docs, df, avg, n } = buildIndex();
  const words = [...new Set(tokens(query))];
  const url = extractUrl(String(query || ""));
  const platform = url ? detectPlatform(url) : "";
  const k1 = 1.4;
  const b = 0.7;
  const scored = [];
  for (const doc of docs) {
    const tool = getTool(doc.id);
    if (modelVisibleOnly && !tool.modelVisible) continue;
    if (category && tool.category !== category) continue;
    if (tool.permission === "owner" && !isOwner) continue;
    const reason = [];
    let score = 0;
    for (const w of words) {
      const f = doc.tf.get(w) || 0;
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(w) || 0) + 0.5) / ((df.get(w) || 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (doc.length / avg))));
    }
    if (score > 0) reason.push("text");
    // السياق: منصة الرابط · نوع الوسيط المرفق
    if (platform && tool.platforms.includes(platform)) { score += 6; reason.push(`platform:${platform}`); }
    else if (url && tool.inputKind.startsWith("url") && !tool.platforms.length) { score += 1; reason.push("url"); }
    if (hasImage && /image/.test(tool.inputKind)) { score += 2.5; reason.push("image"); }
    if (hasVideo && /video/.test(tool.inputKind)) { score += 2.5; reason.push("video"); }
    if (hasAudio && /audio/.test(tool.inputKind)) { score += 2.5; reason.push("audio"); }
    if (hasDocument && /file/.test(tool.inputKind)) { score += 2.5; reason.push("document"); }
    // طلب بحث/تحميل عام بلا منصة محددة ⇒ الأداة العامة أولاً (جوجل · aio) قبل المتخصصة
    if (GENERALIST[tool.id] && !platform && words.some((w) => kindWords(GENERALIST[tool.id]).has(w))) { score += 3; reason.push("generalist"); }
    // الأداة التي فتح قاطعها لا تُقدَّم (§60)
    if (tool.source === "scraper" && isOpen(tool.target)) { score *= 0.3; reason.push("circuit-open"); }
    if (score > 0) scored.push({ id: tool.id, score: Math.round(score * 100) / 100, category: tool.category, reason });
  }
  return scored.sort((x, y) => y.score - x.score || x.id.localeCompare(y.id)).slice(0, Math.max(1, limit));
}

/**
 * قائمة أدوات للنموذج: الأنسب فقط بدل السجل كاملاً (نفس صيغة السطر القديمة).
 * @returns {string} أسطر «- id [kind|input:…|platforms] purpose» أو "" إن لم يكن هناك ما يناسب
 */
function toolsForModel(query, context = {}) {
  const picked = searchTools(query, { ...context, limit: context.limit || 8, modelVisibleOnly: true });
  return picked.map(({ id }) => {
    const tool = getTool(id);
    return `- ${tool.id} [${tool.kind}|input:${tool.inputKind}${tool.platforms.length ? `|${tool.platforms.join(",")}` : ""}] ${tool.purpose}`;
  }).join("\n");
}

// ═══════════════════════════════════════════════
// التنفيذ + نتيجة مطبّعة
// ═══════════════════════════════════════════════

function validate(tool, input = {}) {
  for (const field of tool.input.required || []) {
    const value = input[field];
    const schema = tool.input.properties?.[field] || {};
    if (schema.type === "binary" ? !Buffer.isBuffer(value) || !value.length : !String(value ?? "").trim()) return `missing:${field}`;
  }
  if (tool.input.anyOf && !tool.input.anyOf.some((set) => set.every((f) => String(input[f] ?? "").trim()))) return `missing:${tool.input.anyOf.map((s) => s.join("+")).join("|")}`;
  for (const [field, schema] of Object.entries(tool.input.properties || {})) {
    if (schema.type === "binary" && Buffer.isBuffer(input[field]) && tool.maxBytes && input[field].length > tool.maxBytes) return `too-large:${field}`;
  }
  if (tool.maxChars && String(input.text || "").length > tool.maxChars) return "too-long:text";
  return null;
}

function withTimeout(promise, ms, signal) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error("tool_timeout"), { code: "TOOL_TIMEOUT" })), ms); timer.unref?.(); }),
    ...(signal ? [new Promise((_, reject) => signal.addEventListener?.("abort", () => reject(Object.assign(new Error("tool_cancelled"), { code: "TOOL_CANCELLED" })), { once: true }))] : []),
  ]).finally(() => clearTimeout(timer));
}

/** منفّذو الأدوات المحلية — كلها عبر طبقة الوسائط الموجودة */
const LOCAL_RUNNERS = {
  "image.describe": async (mm, input, deps) => {
    const out = await mm.describeImage(input.image, { question: input.question || "", lang: input.lang || "ar", ask: deps.ask || null });
    return { ok: out.ok, kind: "text", text: out.text, data: { provider: out.provider }, error: out.ok ? "" : "no-vision-provider" };
  },
  "image.ocr": async (mm, input) => {
    const out = await mm.ocrImage(input.image, { languages: input.languages || "ara+eng" });
    return { ok: out.ok, kind: "text", text: out.text, data: { confidence: out.confidence, width: out.width, height: out.height }, error: out.ok ? "" : "no-text" };
  },
  "audio.transcribe": async (mm, input, deps) => {
    const out = await mm.transcribeAudio(input.audio, { language: input.language || "", providers: deps.stt || null });
    return { ok: out.ok, kind: "text", text: out.text, data: { language: out.language, seconds: out.seconds, segments: out.segments, provider: out.provider }, error: out.error || "" };
  },
  "audio.tts": async (mm, input, deps) => {
    const out = await mm.textToVoice(input.text, { lang: input.lang || "ar", synthesize: deps.synthesize || null });
    return { ok: out.ok, kind: "media", deliveries: out.ok ? [{ type: "audio", buffer: out.buffer, mimetype: out.mimetype, ptt: true }] : [], data: { seconds: out.seconds }, error: out.error || "" };
  },
  "video.inspect": async (mm, input) => {
    const meta = await mm.probe(input.video, "mp4");
    return { ok: Boolean(meta?.seconds || meta?.video), kind: "data", data: meta, error: "" };
  },
  "video.transcribe": async (mm, input, deps) => {
    const audio = await mm.extractAudioTrack(input.video);
    const out = await mm.transcribeAudio(audio, { providers: deps.stt || null });
    return { ok: out.ok, kind: "text", text: out.text, data: { segments: out.segments, seconds: out.seconds }, error: out.error || "" };
  },
  "video.keyframes": async (mm, input) => {
    const frames = await mm.keyframes(input.video, { count: Math.max(1, Math.min(12, Number(input.count) || 4)) });
    return { ok: frames.length > 0, kind: "list", items: frames.map((f) => ({ at: f.at, type: "image", buffer: f.buffer })), error: frames.length ? "" : "no-frames" };
  },
  "document.extract": async (mm, input) => {
    const doc = await mm.extractDocument(input.file, { fileName: input.fileName || "", mimetype: input.mimetype || "", ocr: true });
    return { ok: doc.ok, kind: "text", text: doc.text, data: { fileName: doc.fileName, kind: doc.kind, structure: doc.structure, warnings: doc.warnings || [] }, error: doc.error || "" };
  },
  "document.summarize": async (mm, input, deps) => {
    const doc = await mm.extractDocument(input.file, { fileName: input.fileName || "", mimetype: input.mimetype || "", ocr: true });
    if (!doc.ok) return { ok: false, kind: "text", error: doc.error || "extract-failed" };
    const context = mm.representationForModel("document", doc, input.question || "");
    if (typeof deps.ask !== "function") return { ok: true, kind: "text", text: context, data: { fileName: doc.fileName, kind: doc.kind, preparedForModel: true } };
    const answer = await deps.ask({ message: input.question || "Summarize this document.", instruction: `${context}\n\nAnswer using only the data above.`, history: [], language: input.lang || "ar" });
    return { ok: Boolean(answer?.text), kind: "text", text: answer?.text || "", data: { fileName: doc.fileName, kind: doc.kind, provider: answer?.provider || "" }, error: answer?.text ? "" : "model-empty" };
  },
  "group.members": async (mm, input, deps) => {
    const { groupMembersTool } = await import("./terboo-action-engine.js");
    const out = await groupMembersTool({ m: deps.m, sock: deps.sock, refresh: Boolean(input.refresh) });
    return { ok: out.ok, kind: "data", data: out.data || {}, error: out.ok ? "" : out.code };
  },
  "file.inspect": async (mm, input) => {
    const { detectDocument } = await import("./terboo-documents.js");
    const detected = detectDocument(input.file, { fileName: input.fileName || "", mimetype: input.mimetype || "" });
    return { ok: true, kind: "data", data: { ...detected, bytes: input.file.length, sha256: crypto.createHash("sha256").update(input.file).digest("hex") } };
  },
};

function shape(tool, out, started, attempts) {
  return {
    ok: Boolean(out.ok), id: tool.id, category: tool.category, source: tool.source, kind: out.kind || "data",
    text: out.text || "", items: out.items || [], deliveries: out.deliveries || [], data: out.data || {},
    error: out.ok ? "" : String(out.error || "failed"), latencyMs: Date.now() - started, attempts,
  };
}

/**
 * تنفيذ أي أداة من السجل الموحّد.
 * @param {{id:string, input?:Object, m?:Object, sock?:Object, lang?:string, signal?:AbortSignal,
 *          deliver?:boolean, deps?:Object}} request
 */
async function runTool({ id, input = {}, m = null, sock = null, lang = "ar", signal = null, deliver = true, deps = {} }) {
  const started = Date.now();
  const tool = getTool(id);
  if (!tool) return { ok: false, id, category: "", source: "", kind: "data", text: "", items: [], deliveries: [], data: {}, error: "unknown-tool", latencyMs: 0, attempts: [] };
  if (signal?.aborted) return shape(tool, { ok: false, error: "cancelled" }, started, []);

  // أداة scraper (أو اسم وسائط يُحال لها): نفس runScraper — لا تنفيذ ثانٍ
  if (tool.source === "scraper") {
    const result = await runScraper({ id: tool.target, input, m, sock, lang, deliver, deps, signal });
    const normalized = result.result || {};
    return {
      ...shape(tool, {
        ok: result.ok,
        kind: normalized.media?.length ? "media" : normalized.items?.length ? "list" : normalized.text ? "text" : "data",
        text: normalized.text || "",
        // عنصر مطبّع واحد لكل وسيط/نتيجة: {type,url,…} بلا raw
        items: normalized.media?.length ? normalized.media.map(({ keyPath, ...item }) => item) : normalized.items || [],
        deliveries: result.deliveries || [],
        data: { via: result.via || "", command: result.command || "", servedBy: result.id || tool.target, title: normalized.title || "" },
        error: result.reason || "",
      }, started, result.attempts || []),
      messageKey: result.messageKey || "",
    };
  }

  // أداة محلية: صلاحية · تحقق · حدود · مهلة · إلغاء
  const invalid = validate(tool, input);
  if (invalid) return shape(tool, { ok: false, error: `invalid-input:${invalid}` }, started, []);
  const runner = LOCAL_RUNNERS[tool.id];
  const t0 = Date.now();
  try {
    const mm = await import("./terboo-multimodal.js");
    const out = await withTimeout(runner(mm, { ...input, lang }, { ...deps, m, sock }), deps.timeoutMs || tool.timeoutMs, signal);
    recordLocal(tool.id, out.ok, Date.now() - t0, out.error);
    return shape(tool, out, started, [{ id: tool.id, via: "local", ok: Boolean(out.ok), latencyMs: Date.now() - t0 }]);
  } catch (error) {
    const message = error?.code === "TOOL_TIMEOUT" ? "timeout" : error?.code === "TOOL_CANCELLED" ? "cancelled" : String(error?.message || error).slice(0, 160);
    recordLocal(tool.id, false, Date.now() - t0, message);
    if (message !== "cancelled") noteFailure("tool-registry", error, { where: "src/lib/terboo-tool-registry.js:runTool", stage: tool.id });
    return shape(tool, { ok: false, error: message }, started, [{ id: tool.id, via: "local", ok: false, error: message, latencyMs: Date.now() - t0 }]);
  }
}

/** لقطة السجل للتوثيق والتقارير (بلا دوال ولا أسرار) */
function registrySnapshot() {
  return {
    categories: categories(),
    total: build().size,
    scrapers: allTools({ source: "scraper" }).filter((tool) => !tool.alias).length,
    mediaTools: Object.keys(MEDIA_TOOLS).length,
    tools: allTools().map(({ terms, ...tool }) => ({ ...tool, health: healthOfTool(tool.id) })),
  };
}

function _resetToolRegistry() {
  registry = null;
  index = null;
  localHealth.clear();
}

export { CATEGORIES, MEDIA_TOOLS, _resetToolRegistry, allTools, categories, getTool, healthOfTool, registrySnapshot, runTool, searchTools, toolsForModel };
export default { allTools, getTool, runTool, searchTools, toolsForModel, registrySnapshot };
