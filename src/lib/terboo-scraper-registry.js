// ═══════════════════════════════════════════════
// 🧰 Terboo Scraper Registry — كل ملفات src/scraper كأدوات للذكاء (§19–§27 §49 §50)
// ───────────────────────────────────────────────
// لكل ملف في src/scraper سجلّ واحد: الغرض، الفئة، المنصات، نوع المدخل والمخرج،
// نقطة الاستدعاء الفعلية (export حقيقي يُتحقَّق منه عند التشغيل)، المهلة،
// المصادقة، الصلاحية، والبدائل.
//
// مسار التنفيذ (§23):
//   Tool Intent {scraper, input} → Validate → Permission → Input validation
//   → البلوقن الموجود أولاً إن كان يغلّف هذا الـscraper (§26: لا نسخة ثانية)
//   → وإلا محوّل صغير بمهلة وقاطع دائرة → Validate result → إرسال ذكي (§24)
//
// قواعد ثابتة:
//   • لا يُنفَّذ أي كود من النموذج: النموذج يختار اسماً ومدخلاً فقط، والاستدعاء محدّد هنا.
//   • فشل الأداة الأساسية ⇒ بديل واحد على الأكثر (استدعاءان كحد أقصى — §25).
//   • كل أداة لها مهلة وحالة صحة وعدّاد فشل وقاطع دائرة.
//   • لا تُقرأ ولا تُعرض أي مفاتيح أو جلسات.
// ═══════════════════════════════════════════════

import { noteFailure } from "./terboo-failure-log.js";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { fileURLToPath, pathToFileURL } from "url";
import { t } from "./terboo-localization.js";
import * as UI from "./terboo-ui-theme.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRAPER_DIR = path.join(ROOT, "src", "scraper");
const PLUGIN_DIR = path.join(ROOT, "plugins");

// ═══════════════════════════════════════════════
// المنصات: التعرّف على الرابط من اسم النطاق
// ═══════════════════════════════════════════════

const PLATFORMS = {
  tiktok: { label: "TikTok", hosts: ["tiktok.com"] },
  instagram: { label: "Instagram", hosts: ["instagram.com", "instagr.am"] },
  twitter: { label: "X", hosts: ["twitter.com", "x.com"] },
  youtube: { label: "YouTube", hosts: ["youtube.com", "youtu.be"] },
  spotify: { label: "Spotify", hosts: ["spotify.com", "spotify.link"] },
  soundcloud: { label: "SoundCloud", hosts: ["soundcloud.com"] },
  mediafire: { label: "MediaFire", hosts: ["mediafire.com"] },
  terabox: { label: "TeraBox", hosts: ["terabox.com", "1024terabox.com", "teraboxapp.com", "terabox.app", "4funbox.com", "mirrobox.com", "nephobox.com", "freeterabox.com"] },
  douyin: { label: "Douyin", hosts: ["douyin.com", "iesdouyin.com"] },
  dailymotion: { label: "Dailymotion", hosts: ["dailymotion.com", "dai.ly"] },
  likee: { label: "Likee", hosts: ["likee.video", "likee.com"] },
  rednote: { label: "RedNote", hosts: ["xiaohongshu.com", "xhslink.com"] },
  pinterest: { label: "Pinterest", hosts: ["pinterest.com", "pin.it"] },
  reddit: { label: "Reddit", hosts: ["reddit.com", "redd.it"] },
  sfile: { label: "Sfile", hosts: ["sfile.mobi", "sfile.co"] },
  facebook: { label: "Facebook", hosts: ["facebook.com", "fb.watch", "fb.com"] },
  threads: { label: "Threads", hosts: ["threads.net", "threads.com"] },
  capcut: { label: "CapCut", hosts: ["capcut.com"] },
};

/** أول رابط http(s) في النص */
function extractUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s<>"'`]+/i);
  return match ? match[0].replace(/[)\].,،؛!?]+$/, "") : "";
}

/** منصة الرابط حسب النطاق (لا حسب نص عشوائي داخل الرابط) */
function detectPlatform(url) {
  let host = "";
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, ""); } catch (error) { noteFailure("scraper-registry", error, {where: "src/lib/terboo-scraper-registry.js:66",stage: "URL"}); return null; }
  for (const [id, platform] of Object.entries(PLATFORMS)) {
    if (platform.hosts.some((h) => host === h || host.endsWith(`.${h}`))) return id;
  }
  return null;
}

function platformLabel(id) {
  return PLATFORMS[id]?.label || id || "";
}

// ═══════════════════════════════════════════════
// مساعدات المحوّلات
// ═══════════════════════════════════════════════

/** يكتب المخزن المؤقت في ملف داخل temp ثم يحذفه بعد الاستدعاء */
async function withTempFile(buffer, ext, fn) {
  if (!Buffer.isBuffer(buffer)) throw new Error("input_buffer_required");
  const dir = path.join(ROOT, "temp", "terboo-tools");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${crypto.randomUUID()}.${ext}`);
  fs.writeFileSync(file, buffer);
  try {
    return await fn(file);
  } finally {
    fs.rmSync(file, { force: true });
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** استطلاع محدود بعدد مرات ثابت — لا حلقات بلا نهاية */
async function pollUntil(fn, { tries = 12, delayMs = 5000, done }) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    last = await fn();
    if (done(last)) return last;
    await sleep(delayMs);
  }
  return last;
}

// ═══════════════════════════════════════════════
// السجل: ملف واحد = سجل واحد
// kind: download | search | chat | image-generate | image-edit | image-enhance
//       | video-enhance | info | upload | convert | tts | utility | fun | agent
// input: url | query | prompt | image | image+prompt | video | name | none | file
// ═══════════════════════════════════════════════

const CATALOG = {
  // ── تحميل من روابط ──
  aio: { kind: "download", platforms: ["instagram", "youtube", "tiktok", "facebook", "pinterest", "capcut", "twitter", "threads", "reddit"], input: "url", output: "media", timeoutMs: 45000,
    purpose: "All-in-one downloader for Instagram, YouTube, TikTok, Facebook, Pinterest, CapCut, X, Threads and Reddit links.",
    call: (mod, x) => mod.aiodl(x.url) },
  tiktok: { kind: "download", platforms: ["tiktok"], input: "url", output: "video", timeoutMs: 40000, fallbacks: ["aio"],
    purpose: "Download a TikTok video (no watermark) or its audio from a TikTok link.",
    call: (mod, x) => mod.default(x.url) },
  douyin: { kind: "download", platforms: ["douyin"], input: "url", output: "video", timeoutMs: 40000,
    purpose: "Download a Douyin (Chinese TikTok) video and audio from a link.",
    call: (mod, x) => mod.DouyinDL(x.url) },
  ig: { kind: "download", platforms: ["instagram"], input: "url", output: "media", timeoutMs: 40000, fallbacks: ["aio"],
    purpose: "Download Instagram posts, reels and stories from a link.",
    call: (mod, x) => mod.default(x.url) },
  reelsvideo: { kind: "download", platforms: ["instagram"], input: "url", output: "media", timeoutMs: 40000, fallbacks: ["aio"], autoSelect: false,
    purpose: "Alternative Instagram reels/photos downloader.",
    call: (mod, x) => mod.reelsvideo(x.url) },
  twitter: { kind: "download", platforms: ["twitter"], input: "url", output: "media", timeoutMs: 40000, fallbacks: ["aio"],
    purpose: "Download videos and images from an X (Twitter) post link.",
    call: (mod, x) => mod.default(x.url) },
  reddit: { kind: "download", platforms: ["reddit"], input: "url", output: "media", timeoutMs: 30000, fallbacks: ["aio"],
    purpose: "Download images, galleries and videos from a Reddit post link.",
    call: (mod, x) => mod.RedditDL(x.url) },
  youtube: { kind: "download", platforms: ["youtube"], input: "url", output: "media", timeoutMs: 60000, fallbacks: ["ytdl"],
    purpose: "Download a YouTube video from a link (ssyoutube converter).",
    call: (mod, x) => mod.default.download(x.url) },
  yt: { kind: "download", platforms: ["youtube"], input: "url", output: "media", timeoutMs: 60000, fallbacks: ["ytdl"], autoSelect: false,
    purpose: "Secondary YouTube link downloader (ssyoutube variant).",
    call: (mod, x) => mod.default.download(x.url) },
  ytdl: { kind: "download", platforms: ["youtube"], input: "url|query", output: "audio", timeoutMs: 90000, fallbacks: ["youtube"],
    purpose: "Download YouTube audio (mp3) or video (mp4) from a link; play a song by name through the play command.",
    call: (mod, x) => {
      if (!x.url) throw new Error("play_by_name_requires_command");
      return mod.ytdl(x.url, x.format === "mp4" ? "mp4" : "mp3");
    } },
  spotify: { kind: "download", platforms: ["spotify"], input: "url", output: "audio", timeoutMs: 60000,
    purpose: "Download a Spotify track as mp3 from a Spotify link.",
    call: (mod, x) => mod.downloadSpotify(x.url) },
  soundclouddl: { kind: "download", platforms: ["soundcloud"], input: "url", output: "audio", timeoutMs: 45000,
    purpose: "Download a SoundCloud track from a link.",
    call: (mod, x) => mod.default(x.url) },
  mediafire: { kind: "download", platforms: ["mediafire"], input: "url", output: "file", timeoutMs: 40000,
    purpose: "Get the file from a MediaFire download link.",
    call: (mod, x) => mod.default(x.url) },
  terabox: { kind: "download", platforms: ["terabox"], input: "url", output: "file", timeoutMs: 45000,
    purpose: "Get the direct download of a TeraBox shared file.",
    call: (mod, x) => mod.TeraBoxDL(x.url) },
  sfiledl: { kind: "download", platforms: ["sfile"], input: "url", output: "file", timeoutMs: 40000,
    purpose: "Get the file from an Sfile download link.",
    call: (mod, x) => mod.default(x.url) },
  dailymotion: { kind: "download", platforms: ["dailymotion"], input: "url", output: "video", timeoutMs: 45000,
    purpose: "Download a Dailymotion video from a link.",
    call: (mod, x) => mod.DailymotionDL(x.url) },
  likee: { kind: "download", platforms: ["likee"], input: "url", output: "video", timeoutMs: 40000,
    purpose: "Download a Likee video from a link.",
    call: (mod, x) => mod.default(x.url) },
  rednote: { kind: "download", platforms: ["rednote"], input: "url", output: "media", timeoutMs: 40000,
    purpose: "Download RedNote (Xiaohongshu) videos and images from a link.",
    call: (mod, x) => mod.RedNoteDL(x.url) },
  pindl: { kind: "download", platforms: ["pinterest"], input: "url", output: "media", timeoutMs: 30000, fallbacks: ["aio"],
    purpose: "Download the image or video of a Pinterest pin link.",
    call: (mod, x) => mod.default(x.url) },

  // ── بحث ──
  google: { kind: "search", input: "query", output: "list", timeoutMs: 20000,
    purpose: "General Google web search; returns titles and links.",
    call: (mod, x) => mod.GoogleSearch(x.query) },
  tiktoksearch: { kind: "search", platforms: ["tiktok"], input: "query", output: "list", timeoutMs: 25000,
    purpose: "Search TikTok videos by keywords.",
    call: (mod, x) => mod.tiktokSearchVideo(x.query) },
  soundcloud: { kind: "search", platforms: ["soundcloud"], input: "query", output: "list", timeoutMs: 20000,
    purpose: "Search SoundCloud tracks by name.",
    call: (mod, x) => mod.default(x.query) },
  wallpapersearch: { kind: "search", input: "query", output: "list", timeoutMs: 20000,
    purpose: "Search phone/desktop wallpapers by keyword.",
    call: (mod, x) => mod.default(x.query) },
  konachan: { kind: "search", input: "query", output: "list", timeoutMs: 20000,
    purpose: "Search safe-for-work anime artwork (konachan.net) by tags.",
    call: (mod, x) => mod.default(x.query) },
  kusonime: { kind: "search", input: "query", output: "list", timeoutMs: 20000,
    purpose: "Search anime titles and download pages on Kusonime.",
    call: (mod, x) => mod.kusonime.search(x.query) },
  dramabox: { kind: "search", input: "query", output: "list", timeoutMs: 20000,
    purpose: "Search short dramas/series by title (DramaBox) and get watch links.",
    call: (mod, x) => mod.default(x.query) },
  shinigami: { kind: "search", input: "query", output: "list", timeoutMs: 20000,
    purpose: "Search manga/manhwa titles.",
    call: (mod, x) => new mod.ShinigamiClass().search({ q: x.query, page_size: 10 }) },
  dafont: { kind: "search", input: "query", output: "list", timeoutMs: 20000,
    purpose: "Search free fonts on DaFont by name or style.",
    call: (mod, x) => mod.DaFont(x.query) },
  gsmarena: { kind: "info", input: "query", output: "list", timeoutMs: 20000,
    purpose: "Look up phone models and their specifications (GSMArena).",
    call: (mod, x) => mod.search(x.query) },
  hokinfo: { kind: "info", input: "name", output: "text", timeoutMs: 20000,
    purpose: "Honor of Kings hero information by hero name.",
    call: (mod, x) => mod.default(x.name || x.query) },
  wwchar: { kind: "info", input: "name", output: "text", timeoutMs: 20000,
    purpose: "Wuthering Waves character information by name.",
    call: (mod, x) => mod.default(x.name || x.query) },

  // ── توليد وتحرير الصور ──
  txt2img2: { kind: "image-generate", input: "prompt", output: "image", timeoutMs: 90000, fallbacks: ["seaart"],
    purpose: "Generate an image from a text description.",
    call: (mod, x) => mod.Txt2Img2(x.prompt) },
  seaart: { kind: "image-generate", input: "prompt", output: "image", timeoutMs: 90000, fallbacks: ["deepai-scraper"],
    purpose: "Generate an image from text with the Flux model (SeaArt).",
    call: (mod, x) => mod.fluxImage(x.prompt, x.ratio || "1:1") },
  "deepai-scraper": { kind: "image-generate", input: "prompt", output: "image", timeoutMs: 60000,
    purpose: "Generate an image from text (DeepAI); also has a basic chat model.",
    call: (mod, x) => mod.generateImage(x.prompt) },
  txt2img: { kind: "image-generate", input: "prompt", output: "image", timeoutMs: 90000, autoSelect: false,
    purpose: "Generate an anime-style image from text.",
    call: (mod, x) => mod.default(x.prompt, x.style || "anime") },
  img2img: { kind: "image-edit", input: "image+prompt", output: "image", timeoutMs: 120000,
    purpose: "Edit or restyle an image following a text instruction.",
    call: (mod, x) => mod.Img2Img(x.prompt, x.image) },
  removebackground: { kind: "image-edit", input: "image", output: "image", timeoutMs: 60000,
    purpose: "Remove the background of an image.",
    call: (mod, x) => withTempFile(x.image, "jpg", (file) => mod.pixa(file)) },
  img2prompt: { kind: "image-edit", input: "image", output: "text", timeoutMs: 45000,
    purpose: "Describe an image as a detailed generation prompt.",
    call: (mod, x) => withTempFile(x.image, "jpg", (file) => mod.default(file)) },

  // ── تحسين الجودة ──
  hd: { kind: "image-enhance", input: "image", output: "image", timeoutMs: 120000, fallbacks: ["upscaler"],
    purpose: "Enhance and upscale a photo to HD.",
    call: (mod, x) => withTempFile(x.image, "jpg", async (file) => {
      const job = await mod.upload(file);
      const code = job?.code || job;
      return pollUntil(() => mod.get(code), { tries: 15, delayMs: 6000, done: (r) => r && r.status !== "waiting" });
    }) },
  upscaler: { kind: "image-enhance", input: "image", output: "image", timeoutMs: 90000, fallbacks: ["imglarger"],
    purpose: "Upscale an image to higher resolution.",
    call: (mod, x) => withTempFile(x.image, "jpg", (file) => mod.default(file)) },
  imglarger: { kind: "image-enhance", input: "image", output: "image", timeoutMs: 120000, autoSelect: false,
    purpose: "Upscale an image (ImgLarger).",
    call: (mod, x) => withTempFile(x.image, "jpg", (file) => new mod.default().process(file)) },
  wink: { kind: "video-enhance", input: "video", output: "video", timeoutMs: 180000,
    purpose: "Enhance video quality (Wink).",
    call: (mod, x) => mod.winkEnhance(x.video, {}) },
  hdvid: { kind: "video-enhance", input: "video", output: "video", timeoutMs: 180000, fallbacks: ["hdvid2"], autoSelect: false,
    purpose: "Enhance a video to HD.",
    call: (mod, x) => withTempFile(x.video, "mp4", (file) => mod.default(file)) },
  hdvid2: { kind: "video-enhance", input: "video", output: "video", timeoutMs: 180000, autoSelect: false,
    purpose: "Alternative video HD enhancer.",
    call: (mod, x) => mod.default(x.video, {}) },

  // ── رفع وتحويل وأدوات ──
  imgdrop: { kind: "upload", input: "image", output: "text", timeoutMs: 30000,
    purpose: "Upload an image and return a public link.",
    call: (mod, x) => mod.default(x.image, `image-${Date.now()}.jpg`) },
  videy: { kind: "upload", input: "video", output: "text", timeoutMs: 90000, autoSelect: false,
    purpose: "Upload a video and return a public link.",
    call: (mod, x) => withTempFile(x.video, "mp4", (file) => mod.default(file)) },
  mconverter: { kind: "convert", input: "file", output: "file", timeoutMs: 90000, autoSelect: false,
    purpose: "Convert a file between formats (used by the converter command).",
    call: (mod, x) => withTempFile(x.file, x.ext || "bin", (file) => mod.mconverter.convert(file, x.format)) },
  tempmail: { kind: "utility", input: "none", output: "text", timeoutMs: 20000,
    purpose: "Create a temporary email address and read its inbox.",
    call: (mod) => mod.TempMailCreate() },
  topmedia: { kind: "tts", input: "prompt", output: "audio", timeoutMs: 45000, autoSelect: false,
    purpose: "Turn text into speech audio.",
    call: (mod, x) => mod.default(null, x.prompt) },
  lufemboy: { kind: "fun", input: "name", output: "text", timeoutMs: 5000, autoSelect: false,
    purpose: "Fun name-check game used by its own command.",
    call: (mod, x) => mod.default(x.name || x.query) },

  // ── مزوّدات ذكاء (محادثة) — المحادثة العادية تمر عبر موجّه المزوّدات في النواة ──
  gemini: { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "Gemini chat model (rich tables/code).",
    call: (mod, x) => mod.default({ message: x.prompt }) },
  geminiVision: { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "Gemini chat with image understanding (vision).",
    call: (mod, x) => mod.chat({ message: x.prompt, imageBuffer: x.image || null }) },
  gpt5: { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "GPT-5 chat model.",
    call: (mod, x) => mod.GPT5(x.prompt) },
  gpt52: { kind: "chat", input: "prompt", output: "text", timeoutMs: 60000, auth: "session", permission: "owner", autoSelect: false,
    purpose: "ChatGPT web client (needs its own session; owner diagnostics only).",
    call: (mod, x) => new mod.ChatGPT().send(x.prompt) },
  deepseek: { kind: "chat", input: "prompt", output: "text", timeoutMs: 60000, autoSelect: false,
    purpose: "DeepSeek reasoning chat model.",
    call: (mod, x) => mod.DeepSeekThinking(x.prompt) },
  claudehaiku: { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "Claude Haiku chat model.",
    call: (mod, x) => mod.ClaudeHaiku(x.prompt) },
  qwen3: { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "Qwen 3 chat model.",
    call: (mod, x) => mod.Qwen3(x.prompt) },
  multiAI: { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "Multi-model chat (Gemini/Claude).",
    call: (mod, x) => mod.chat({ message: x.prompt }) },
  "logic-bell": { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "Logic Bell chat model.",
    call: (mod, x) => mod.chat({ message: x.prompt }) },
  chatday: { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "ChatDay multi-model chat (default gpt-4o-mini).",
    call: (mod, x) => mod.chat({ content: x.prompt }) },
  unlimitedai: { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "UnlimitedAI character chat (Terboo persona by default).",
    call: (mod, x) => mod.UnlimitedAI(x.prompt, "تيربو") },
  feeb: { kind: "chat", input: "prompt", output: "text", timeoutMs: 45000, autoSelect: false,
    purpose: "Supportive emotional-wellbeing chat.",
    call: (mod, x) => mod.FeelBetter(x.prompt) },
  "manus-agent": { kind: "agent", input: "prompt", output: "text", timeoutMs: 120000, auth: "config", permission: "owner", autoSelect: false,
    purpose: "Manus remote agent (owner only, requires its own configuration).",
    call: async (mod, x) => {
      if (!mod.isManusConfigured()) throw new Error("manus_not_configured");
      return new mod.ManusAgent().run(x.prompt);
    } },
};

const DEFAULTS = { platforms: [], fallbacks: [], auth: "none", permission: "public", autoSelect: true, timeoutMs: 30000 };

// ═══════════════════════════════════════════════
// وصف v4 الكامل لكل أداة (§12): الفئة · المدخلات/المخرجات · نوع الوسائط · المهلة · المحاولات
// · المصادقة · السلامة · الصلاحية · أمثلة طبيعية (تمر على نفس محلّل النية الذي يستعمله الذكاء)
// ═══════════════════════════════════════════════

const CATEGORY_OF = {
  download: "downloader", search: "search", info: "information", "image-generate": "image-generation",
  "image-edit": "image-editing", "image-enhance": "image-enhancement", "video-enhance": "video-enhancement",
  upload: "upload", convert: "conversion", utility: "utility", tts: "text-to-speech", fun: "entertainment",
  chat: "ai-chat", agent: "ai-agent",
};
const MEDIA_TYPE_OF = { video: "video", audio: "audio", image: "image", media: ["video", "image", "audio"].join("|"), file: "file", list: "list", text: "text" };
const INPUT_FIELDS = {
  url: ["url"], "url|query": ["url", "query"], query: ["query"], name: ["name"], prompt: ["prompt"],
  image: ["image"], "image+prompt": ["image", "prompt"], video: ["video"], file: ["file"], none: [],
};

/**
 * تصنيف السلامة: public-data (قراءة محتوى عام) · user-media (يرفع وسائط المستخدم لخدمة خارجية)
 * · generative (محتوى مُولَّد بالذكاء) · restricted (مالك/جلسة/إعداد خاص).
 */
function safetyOf(entry) {
  if (entry.permission === "owner" || entry.auth !== "none") return "restricted";
  if (/image|video|file/.test(entry.input)) return "user-media";
  if (["image-generate", "chat", "tts"].includes(entry.kind)) return "generative";
  return "public-data";
}

/**
 * أمثلة طبيعية لكل أداة (عربي · إنجليزي) — بيانات وصفية للأداة (لا نصوص واجهة) في ملف JSON مستقل.
 * المختارة تلقائياً منها تُختبر على محلّل النية نفسه (tests/terboo-scrapers-each.test.mjs).
 */
const EXAMPLES = JSON.parse(fs.readFileSync(new URL("./terboo-scraper-examples.json", import.meta.url), "utf8"));

for (const [id, entry] of Object.entries(CATALOG)) {
  const merged = { id, file: `src/scraper/${id}.js`, ...DEFAULTS, ...entry };
  CATALOG[id] = {
    ...merged,
    filename: `${id}.js`,
    category: CATEGORY_OF[merged.kind] || merged.kind,
    inputs: INPUT_FIELDS[merged.input] || [merged.input],
    outputs: merged.output,
    mediaType: MEDIA_TYPE_OF[merged.output] || merged.output,
    // لا إعادة لنفس الأداة: فشلها ⇒ بديل صحي واحد على الأكثر (استدعاءان كحد أقصى — §16)
    retries: 0,
    maxAttempts: 1 + Math.min(1, merged.fallbacks.length),
    safety: safetyOf(merged),
    examples: EXAMPLES[id] || [],
  };
}

// ═══════════════════════════════════════════════
// الاكتشاف: exports الحقيقية + البلوقنات التي تغلّف كل scraper
// ═══════════════════════════════════════════════

const moduleCache = new Map();
async function loadScraper(id) {
  if (!moduleCache.has(id)) {
    const file = path.join(SCRAPER_DIR, `${id}.js`);
    moduleCache.set(id, import(pathToFileURL(file).href));
  }
  return moduleCache.get(id);
}

/** كل ملفات src/scraper الموجودة فعلاً على القرص */
function scraperFiles() {
  return fs.readdirSync(SCRAPER_DIR).filter((name) => name.endsWith(".js")).map((name) => name.slice(0, -3)).sort();
}

/** نوع قيمة مُصدَّرة: class | function | object | value */
function exportKind(value) {
  if (typeof value === "function") return /^class\s/.test(Function.prototype.toString.call(value)) ? "class" : "function";
  if (value && typeof value === "object") return "object";
  return "value";
}

/** exports الفعلية لملف scraper (§21): أسماء، default، أصنافها، وهل نقطة الاستدعاء موجودة */
async function discoverExports(id) {
  const mod = await loadScraper(id);
  const names = Object.keys(mod);
  const kinds = Object.fromEntries(names.map((name) => [name, exportKind(mod[name])]));
  const methods = {};
  for (const name of names) {
    const value = mod[name];
    if (value && typeof value === "object") {
      methods[name] = Object.keys(value).filter((key) => typeof value[key] === "function");
    } else if (kinds[name] === "class") {
      methods[name] = Object.getOwnPropertyNames(value.prototype).filter((key) => key !== "constructor" && !key.startsWith("_"));
    }
  }
  return { id, file: `src/scraper/${id}.js`, exports: names, hasDefault: names.includes("default"), kinds, methods };
}

let pluginIndex = null;
/** يبني فهرس «scraper ← ملفات البلوقنات التي تستورده» من المصدر مرة واحدة */
function buildPluginIndex() {
  if (pluginIndex) return pluginIndex;
  pluginIndex = new Map();
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) {
        const source = fs.readFileSync(full, "utf8");
        for (const match of source.matchAll(/src\/scraper\/([\w.-]+?)(?:\.js)?["']/g)) {
          const id = match[1];
          if (!pluginIndex.has(id)) pluginIndex.set(id, []);
          const rel = path.relative(ROOT, full).split(path.sep).join("/");
          if (!pluginIndex.get(id).includes(rel)) pluginIndex.get(id).push(rel);
        }
      }
    }
  };
  if (fs.existsSync(PLUGIN_DIR)) walk(PLUGIN_DIR);
  return pluginIndex;
}

/** ملفات البلوقنات التي تستعمل scraper معيّن (§27) */
function pluginsUsingScraper(id) {
  return [...(buildPluginIndex().get(id) || [])];
}

/** اسم الأمر المسجّل لملف بلوقن (من سجل البلوقنات إن كان محمّلاً، وإلا اسم الملف) */
async function commandForPluginFile(rel) {
  try {
    const { getAllPlugins } = await import("./terboo-plugins.js");
    const abs = path.join(ROOT, rel);
    const found = getAllPlugins().find((plugin) => plugin?.filePath && path.resolve(plugin.filePath) === abs);
    const name = Array.isArray(found?.config?.name) ? found.config.name[0] : found?.config?.name;
    if (name) return String(name);
  } catch (error) { noteFailure("scraper-registry", error, {where: "src/lib/terboo-scraper-registry.js:460",stage: "import:terboo-plugins"}); }
  return path.basename(rel, ".js");
}

/** ترتيب تفضيل البلوقن حسب نوع الأداة: التحميل من downloader، البحث من search… */
const CATEGORY_PREFERENCE = {
  download: ["downloader", "search", "tools"],
  search: ["search", "downloader", "tools"],
  "image-generate": ["ai", "tools"],
  "image-edit": ["tools", "ai"],
  "image-enhance": ["tools", "ai"],
  "video-enhance": ["tools"],
};

/** البلوقن الموجود الذي يغلّف هذا الـscraper (§26) — null إن لم يوجد */
async function pluginFor(id, { format = "", byQuery = false } = {}) {
  const files = pluginsUsingScraper(id);
  if (!files.length) return null;
  const order = CATEGORY_PREFERENCE[CATALOG[id]?.kind] || [];
  const rank = (rel) => {
    const folder = rel.split("/")[1] || "";
    const index = order.indexOf(folder);
    let score = index === -1 ? order.length : index;
    // يوتيوب: الصوت والفيديو لكل منهما أمره
    const audioPlugin = /صوت|audio|mp3/i.test(path.basename(rel));
    if (id === "ytdl" && byQuery) score += /\/search\/شغل\.js$/.test(rel) ? -20 : /\/search\//.test(rel) ? -15 : 0;
    else if (format === "mp3") score += audioPlugin ? -10 : 0;
    else if (format === "mp4") score += /فيديو|video/i.test(path.basename(rel)) ? -10 : audioPlugin ? 5 : 0;
    else score += audioPlugin ? 5 : 0; // بلا تحديد: الفيديو/الأصل قبل الصوت
    return score;
  };
  const best = [...files].sort((a, b) => rank(a) - rank(b))[0];
  return { file: best, command: await commandForPluginFile(best) };
}

// ═══════════════════════════════════════════════
// الصحة وقاطع الدائرة (§25)
// ═══════════════════════════════════════════════

const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;
const health = new Map();

function healthOf(id) {
  if (!health.has(id)) {
    health.set(id, { calls: 0, failures: 0, consecutive: 0, openUntil: 0, lastSuccess: null, lastFailure: null, lastLatencyMs: null, lastError: "" });
  }
  return health.get(id);
}

function isOpen(id, now = Date.now()) {
  return healthOf(id).openUntil > now;
}

function recordOutcome(id, ok, latencyMs, error = "") {
  const h = healthOf(id);
  h.calls++;
  h.lastLatencyMs = latencyMs;
  if (ok) {
    h.consecutive = 0;
    h.openUntil = 0;
    h.lastSuccess = Date.now();
  } else {
    h.failures++;
    h.consecutive++;
    h.lastFailure = Date.now();
    h.lastError = String(error || "").slice(0, 160);
    if (h.consecutive >= CIRCUIT_THRESHOLD) h.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
  }
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`timeout:${label}:${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// ═══════════════════════════════════════════════
// توحيد النتائج (§24): استخراج وسائط وقوائم ونص من أي شكل رجوع
// ═══════════════════════════════════════════════

const VIDEO_KEY = /video|mp4|nowm|nowatermark|\bhd\b|\bsd\b|play|stream|reel/i;
const AUDIO_KEY = /audio|mp3|music|sound|track|voice/i;
const IMAGE_KEY = /image|img|photo|picture|cover|jpg|png|webp|wallpaper|result_url|output/i;
const THUMB_KEY = /thumb|avatar|profile|cover|poster|preview|icon|logo/i;
const EXT_TYPE = [
  [/\.(mp4|mov|webm|mkv|m3u8)(\?|$)/i, "video"],
  [/\.(mp3|m4a|aac|ogg|opus|wav|flac)(\?|$)/i, "audio"],
  [/\.(jpe?g|png|webp|gif|bmp)(\?|$)/i, "image"],
  [/\.(pdf|zip|rar|7z|apk|docx?|xlsx?|pptx?|txt|exe|iso|tar|gz)(\?|$)/i, "document"],
];

function guessTypeFromBuffer(buffer) {
  const head = buffer.subarray(0, 12);
  if (head[0] === 0xff && head[1] === 0xd8) return "image";
  if (head.subarray(0, 4).toString("hex") === "89504e47") return "image";
  if (head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP") return "image";
  if (head.subarray(4, 8).toString() === "ftyp") return "video";
  if (head.subarray(0, 3).toString() === "ID3" || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return "audio";
  if (head.subarray(0, 4).toString() === "OggS") return "audio";
  return "document";
}

/** مخزن يبدو نصاً قابلاً للطباعة (HTML/JSON/رسالة خطأ) لا بيانات ثنائية */
function looksLikeText(buffer) {
  const head = buffer.subarray(0, 512);
  if (!head.length) return true;
  let printable = 0;
  for (const byte of head) if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte < 127) || byte >= 0xc2) printable += 1;
  return printable / head.length > 0.95;
}

function typeOf(url, keyPath) {
  for (const [re, type] of EXT_TYPE) if (re.test(url)) return type;
  if (/^data:image\//.test(url)) return "image";
  if (VIDEO_KEY.test(keyPath)) return "video";
  if (AUDIO_KEY.test(keyPath)) return "audio";
  if (IMAGE_KEY.test(keyPath)) return "image";
  return "unknown";
}

const ERROR_STATUS = new Set(["error", "eror", "failed", "fail", "false"]);
/** حقول حالة/وصف لا تُعد محتوى */
const META_KEYS = new Set(["status", "success", "model", "language", "raw", "error", "message", "msg", "sessionId", "creator", "author", "code", "statusCode"]);

function normalizeResult(raw, { expected = "media" } = {}) {
  if (raw === null || raw === undefined || raw === "") return { ok: false, error: "empty_result", media: [], items: [], text: "" };
  if (typeof raw === "string") {
    if (/^https?:\/\//i.test(raw.trim())) {
      const url = raw.trim();
      return { ok: true, media: [{ url, type: typeOf(url, expected), keyPath: "" }], items: [], text: "" };
    }
    return { ok: Boolean(raw.trim()), media: [], items: [], text: raw.trim() };
  }
  if (Buffer.isBuffer(raw)) {
    const type = guessTypeFromBuffer(raw);
    // مخزن نصّي (صفحة خطأ) حيث يُنتظر وسيط ⇒ فشل، لا «ملف» يُرسل للمستخدم
    if (["image", "video", "audio"].includes(expected) && type === "document" && looksLikeText(raw)) {
      return { ok: false, error: ["non_media_result", raw.subarray(0, 80).toString("utf8").replace(/\s+/g, " ")].join(": "), media: [], items: [], text: "" };
    }
    return { ok: true, media: [{ buffer: raw, type, keyPath: "" }], items: [], text: "" };
  }

  // فشل مغلّف داخل نجاح ظاهري ({status:true, raw:{status:false, error}}) فشلٌ لا نجاح (v4 §41: لا نجاح مزيّف)
  const isFailure = (value) => value && typeof value === "object" && !Array.isArray(value) && !Buffer.isBuffer(value)
    && (value.status === false || ERROR_STATUS.has(String(value.status).toLowerCase()) || value.error === true || value.success === false);
  const nested = [raw.raw, raw.data, raw.result, raw.response].find(isFailure);
  const failed = isFailure(raw) || Boolean(nested);
  const media = [];
  const items = [];
  const seen = new Set();

  const visit = (value, keyPath, depth) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (Buffer.isBuffer(value)) { media.push({ buffer: value, type: guessTypeFromBuffer(value), keyPath }); return; }
    if (typeof value === "string") {
      const v = value.trim();
      if (!/^https?:\/\/|^data:image\//i.test(v) || seen.has(v)) return;
      seen.add(v);
      if (/^data:image\//i.test(v)) {
        const base64 = v.slice(v.indexOf(",") + 1);
        media.push({ buffer: Buffer.from(base64, "base64"), type: "image", keyPath });
        return;
      }
      media.push({ url: v, type: typeOf(v, keyPath), keyPath, thumb: THUMB_KEY.test(keyPath) });
      return;
    }
    if (Array.isArray(value)) {
      const listy = value.length && value.every((item) => item && typeof item === "object" && !Array.isArray(item))
        && value.some((item) => (item.title || item.name || item.judul) && (item.url || item.link || item.play_url || item.href || item.id));
      if (listy && depth <= 3) {
        for (const item of value.slice(0, 10)) {
          items.push({
            title: String(item.title || item.name || item.judul || "").trim().slice(0, 120),
            url: item.url || item.link || item.play_url || item.href || "",
            extra: String(item.snippet || item.description || item.desc || item.duration || item.artist || item.author || "").trim().slice(0, 140),
          });
        }
        return;
      }
      value.slice(0, 20).forEach((item, index) => visit(item, `${keyPath}[${index}]`, depth + 1));
      return;
    }
    if (typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) visit(inner, keyPath ? `${keyPath}.${key}` : key, depth + 1);
    }
  };
  visit(raw, "", 0);

  // الصورة المصغّرة لا تُرسل إن وُجدت وسائط حقيقية
  const real = media.filter((item) => !item.thumb);
  const chosen = (real.length ? real : media).filter((item) => item.buffer || item.type !== "unknown" || /download|url|link|result|file/i.test(item.keyPath));
  const text = [raw.text, raw.answer, raw.result, raw.response, raw.reply, raw.content, raw.output, raw.prompt, raw.message, raw.description, raw.email, raw.address]
    .find((value) => typeof value === "string" && value.trim() && !/^https?:\/\//.test(value.trim())) || "";
  // مخرج نصي منظَّم (معلومات بطل/شخصية…): حقلان فعليان على الأقل غير حقول الحالة والبيانات الوصفية
  const substantive = Object.keys(raw).filter((key) => !META_KEYS.has(key) && raw[key] !== null && raw[key] !== undefined && raw[key] !== "");
  const structured = expected === "text" && !raw.error && substantive.length >= 2;

  const ok = !failed && (chosen.length > 0 || items.length > 0 || Boolean(text) || structured);
  const source = nested || raw;
  const error = failed ? String(source.error && source.error !== true ? source.error : source.message || source.msg || "scraper_reported_failure") : ok ? "" : "no_usable_output";
  return { ok, error, media: chosen, items, text: String(text).trim(), title: String(raw.title || raw.caption || "").trim().slice(0, 200), raw };
}

// ═══════════════════════════════════════════════
// الإرسال الذكي (§24): النوع الصحيح + اقتباس + تعليق + اسم ملف + حدود الحجم
// ═══════════════════════════════════════════════

const MB = 1024 * 1024;
const LIMITS = { image: 16 * MB, video: 64 * MB, audio: 64 * MB, document: 100 * MB };
const MIME = { image: "image/jpeg", video: "video/mp4", audio: "audio/mpeg", document: "application/octet-stream" };

async function probe(url) {
  if (!/^https?:\/\//.test(url)) return {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    clearTimeout(timer);
    return { contentType: res.headers.get("content-type") || "", size: Number(res.headers.get("content-length")) || 0 };
  } catch (error) { noteFailure("scraper-registry", error, {where: "src/lib/terboo-scraper-registry.js:682",stage: "AbortController"}); return {}; }
}

function typeFromMime(mime) {
  if (/^image\//.test(mime)) return "image";
  if (/^video\//.test(mime)) return "video";
  if (/^audio\//.test(mime)) return "audio";
  if (mime) return "document";
  return "";
}

function humanSize(bytes) {
  if (!bytes) return "?";
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

/** يرسل نتيجة موحّدة للمستخدم ويعيد سجل التسليم الحقيقي (نوع/هدف/مفتاح الرسالة) */
async function deliverResult(sock, m, result, { lang = "ar", platform = "", query = "", caption = "", maxMedia = 4 } = {}) {
  const deliveries = [];
  // مهمة مستأنفة بعد إعادة التشغيل لا تملك الرسالة الأصلية: تُسلَّم في نفس الدردشة بلا اقتباس
  const quoted = m?.key ? { quoted: m } : {};
  const sendLogged = async (content, type, note = "") => {
    const sent = await sock.sendMessage(m.chat, content, quoted);
    deliveries.push({ type, target: m.chat, messageId: sent?.key?.id || null, note });
    return sent;
  };

  if (result.media.length) {
    const list = result.media.slice(0, maxMedia);
    for (let index = 0; index < list.length; index++) {
      const item = list[index];
      const cap = index === 0 ? (caption || result.title || "") : "";
      if (item.buffer) {
        const type = item.type === "unknown" ? guessTypeFromBuffer(item.buffer) : item.type;
        if (item.buffer.length > LIMITS.document) {
          await sendLogged({ text: t(lang, "scraper.tooLarge", { size: humanSize(item.buffer.length) }) }, "text", "oversize-buffer");
          continue;
        }
        const asDoc = type !== "image" && item.buffer.length > (LIMITS[type] || LIMITS.document);
        const kind = asDoc ? "document" : type;
        await sendLogged({ [kind]: item.buffer, mimetype: MIME[type] || MIME.document, ...(kind === "document" ? { fileName: `terboo-${Date.now()}.${type === "audio" ? "mp3" : type === "video" ? "mp4" : "bin"}` } : {}), ...(cap && kind !== "audio" ? { caption: cap } : {}) }, kind);
        continue;
      }
      let type = item.type;
      let mimetype = MIME[type] || "";
      let size = 0;
      if (type === "unknown" || type === "document") {
        const info = await probe(item.url);
        type = typeFromMime(info.contentType) || (type === "unknown" ? "document" : type);
        mimetype = info.contentType?.split(";")[0] || MIME[type] || MIME.document;
        size = info.size || 0;
      }
      if (size > LIMITS.document) {
        await sendLogged({ text: `${t(lang, "scraper.tooLarge", { size: humanSize(size) })}\n${item.url}` }, "text", "oversize-url");
        continue;
      }
      const asDoc = size && type !== "image" && size > (LIMITS[type] || LIMITS.document);
      const kind = asDoc ? "document" : type;
      const fileName = decodeURIComponent((item.url.split("?")[0].split("/").pop() || "").slice(0, 80)) || `terboo-${Date.now()}`;
      await sendLogged({
        [kind]: { url: item.url },
        mimetype: mimetype || MIME[kind] || MIME.document,
        ...(kind === "document" ? { fileName } : {}),
        ...(cap && kind !== "audio" ? { caption: cap } : {}),
      }, kind);
    }
    return deliveries;
  }

  if (result.items.length) {
    const blocks = result.items.slice(0, 8).map((item, index) => [
      UI.menuItem(item.title || item.url, item.extra || "", { lang, index: index + 1 }),
      item.url ? UI.quote(UI.isolate(item.url), lang) : "",
    ].filter(Boolean).join("\n"));
    const text = UI.card({ title: t(lang, "scraper.results", { query: query || platform }), blocks, lang, kind: "info" });
    await sendLogged({ text }, "text", "list");
    return deliveries;
  }

  if (result.text) {
    await sendLogged({ text: result.text.slice(0, 4000) }, "text");
  }
  return deliveries;
}

// ═══════════════════════════════════════════════
// التحقق من المدخل والصلاحية
// ═══════════════════════════════════════════════

function checkPermission(entry, m) {
  if (entry.permission === "owner" && !m?.isOwner) return "common.ownerOnly";
  if (entry.permission === "premium" && !(m?.isOwner || m?.isPremium)) return "common.premiumOnly";
  return null;
}

/** يتحقق من المدخل حسب نوع الأداة ويعيد مفتاح رسالة الخطأ أو null */
function validateInput(entry, input) {
  const need = entry.input === "url|query" ? (input.url ? "url" : "query") : entry.input;
  if (need === "url") {
    if (!input.url || !/^https?:\/\//i.test(input.url)) return "scraper.needUrl";
    if (entry.platforms.length) {
      const platform = detectPlatform(input.url);
      if (!platform || !entry.platforms.includes(platform)) return "scraper.invalidUrl";
    }
  }
  if ((need === "query" || need === "name") && !String(input.query || input.name || "").trim()) return "scraper.needQuery";
  if (need === "prompt" && !String(input.prompt || "").trim()) return "scraper.needPrompt";
  if ((need === "image" || need === "image+prompt") && !Buffer.isBuffer(input.image) && !input.hasImage) return "scraper.needImage";
  if (need === "image+prompt" && !String(input.prompt || "").trim()) return "scraper.needPrompt";
  if (need === "video" && !Buffer.isBuffer(input.video) && !input.hasVideo) return "scraper.needVideo";
  if (String(input.query || input.prompt || "").length > 1000) return "scraper.needQuery";
  return null;
}

/** وسيط نصي للبلوقن الموجود: الرابط أو البحث أو الوصف */
function pluginArgs(entry, input) {
  if (entry.input === "url" || entry.input === "url|query") return input.url || input.query || "";
  if (entry.input === "query" || entry.input === "name") return input.query || input.name || "";
  if (entry.input === "prompt" || entry.input === "image+prompt") return input.prompt || "";
  return input.args || "";
}

// ═══════════════════════════════════════════════
// التنفيذ
// ═══════════════════════════════════════════════

/**
 * تشغيل أداة scraper بأمان.
 * @param {{id:string, input:Object, m?:Object, sock?:Object, lang?:string,
 *          prefer?:"auto"|"plugin"|"adapter", deliver?:boolean,
 *          deps?:{dispatch?:Function, load?:Function}}} request
 * @returns {Promise<{ok:boolean, via?:string, id?:string, reason?:string, messageKey?:string,
 *          result?:Object, deliveries?:Array, attempts:Array, latencyMs:number}>}
 */
async function runScraper({ id, input = {}, m = null, sock = null, lang = "ar", prefer = "auto", deliver = true, deps = {}, signal = null }) {
  const started = Date.now();
  const attempts = [];
  const entry = CATALOG[id];
  // إلغاء المستخدم (Task Control Plane): لا بدء ولا تسليم بعد الإلغاء (§85)
  const cancelled = () => Boolean(signal?.aborted);
  if (cancelled()) return { ok: false, id, reason: "cancelled", messageKey: "scraper.failed", attempts, latencyMs: 0 };
  if (!entry) return { ok: false, reason: "unknown-tool", messageKey: "scraper.unknownTool", attempts, latencyMs: 0 };

  const denied = checkPermission(entry, m);
  if (denied) return { ok: false, id, reason: "permission", messageKey: denied, attempts, latencyMs: 0 };

  const invalid = validateInput(entry, input);
  if (invalid) return { ok: false, id, reason: "invalid-input", messageKey: invalid, attempts, latencyMs: 0 };

  // (§26) البلوقن الموجود أولاً: يعيد استخدام الكود الحالي بكل صلاحياته وتبريده وطاقته
  if (prefer !== "adapter" && m && sock && typeof deps.dispatch === "function") {
    const plugin = await pluginFor(id, { format: input.format, byQuery: !input.url && Boolean(input.query) });
    if (plugin) {
      const outcome = await deps.dispatch(m, sock, { command: plugin.command, args: pluginArgs(entry, input) });
      attempts.push({ id, via: "plugin", command: plugin.command, ok: Boolean(outcome?.ok), status: outcome?.status || "" });
      return { ok: Boolean(outcome?.ok), via: "plugin", id, command: plugin.command, result: outcome, attempts, latencyMs: Date.now() - started };
    }
  }

  // المحوّل يحتاج المخزن الفعلي: يُنزَّل الوسيط الآن فقط (لا تنزيل مسبق حين يتولّى البلوقن)
  if (!Buffer.isBuffer(input.image) && typeof input.loadImage === "function" && /image/.test(entry.input)) {
    input = { ...input, image: await input.loadImage().catch((error) => { noteFailure("scraper-registry", error, {where: "src/lib/terboo-scraper-registry.js:841",stage: "input.loadImage"}); return null; }) };
    if (!Buffer.isBuffer(input.image)) return { ok: false, id, reason: "invalid-input", messageKey: "scraper.needImage", attempts, latencyMs: Date.now() - started };
  }
  if (!Buffer.isBuffer(input.video) && typeof input.loadVideo === "function" && entry.input === "video") {
    input = { ...input, video: await input.loadVideo().catch((error) => { noteFailure("scraper-registry", error, {where: "src/lib/terboo-scraper-registry.js:845",stage: "input.loadVideo"}); return null; }) };
    if (!Buffer.isBuffer(input.video)) return { ok: false, id, reason: "invalid-input", messageKey: "scraper.needVideo", attempts, latencyMs: Date.now() - started };
  }

  // محوّل مباشر: الأداة ثم بديل صحي واحد على الأكثر (§25)
  const chain = [id, ...entry.fallbacks.filter((fid) => CATALOG[fid] && !isOpen(fid))].filter((fid, index) => index === 0 || !isOpen(fid)).slice(0, 2);
  for (const current of chain) {
    const tool = CATALOG[current];
    if (isOpen(current)) {
      attempts.push({ id: current, via: "adapter", ok: false, skipped: "circuit-open" });
      continue;
    }
    if (current !== id && validateInput(tool, input)) continue;
    const t0 = Date.now();
    try {
      const mod = await (deps.load || loadScraper)(current);
      // deps.timeoutMs للاختبارات فقط (إثبات مسار المهلة بسرعة)؛ الإنتاج يستعمل مهلة الأداة
      const raw = await withTimeout(Promise.resolve().then(() => tool.call(mod, input)), deps.timeoutMs || tool.timeoutMs, current);
      const result = normalizeResult(raw, { expected: tool.output });
      if (!result.ok) throw new Error(result.error || "no_usable_output");
      recordOutcome(current, true, Date.now() - t0);
      attempts.push({ id: current, via: "adapter", ok: true, latencyMs: Date.now() - t0 });
      // أُلغيت المهمة أثناء الجلب: النتيجة لا تُرسل (نقطة إلغاء قبل التسليم)
      if (cancelled()) return { ok: false, id: current, reason: "cancelled", messageKey: "scraper.failed", result, deliveries: [], attempts, latencyMs: Date.now() - started };
      const deliveries = deliver && sock && m
        ? await deliverResult(sock, m, result, { lang, platform: platformLabel(tool.platforms[0]), query: input.query || input.prompt || "" })
        : [];
      return { ok: true, via: "adapter", id: current, result, deliveries, attempts, latencyMs: Date.now() - started };
    } catch (error) {
      const message = String(error?.message || error).slice(0, 200);
      recordOutcome(current, false, Date.now() - t0, message);
      attempts.push({ id: current, via: "adapter", ok: false, error: message, latencyMs: Date.now() - t0 });
    }
  }
  return { ok: false, id, reason: "failed", messageKey: "scraper.failed", attempts, latencyMs: Date.now() - started };
}

// ═══════════════════════════════════════════════
// اختيار الأداة من الطلب الطبيعي بسرعة (بلا نموذج) — §22
// ═══════════════════════════════════════════════

const norm = (value) => String(value || "").toLowerCase()
  .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[ًٌٍَُِّْـ]/g, "");

/** مفردات النية بالعربية (فصحى/مصري) والإنجليزية والإسبانية */
const INTENT_WORDS = {
  download: /(?:حمل|حملي|نزل|نزلي|تحميل|تنزيل|هات|جيب|download|save|descarga|descargar|baja|bajar)/,
  audio: /(?:صوت|mp3|اغنيه|اغنية|موسيقي|audio|song|music|cancion|canción|musica|música)/,
  video: /(?:فيديو|mp4|video)/,
  play: /(?:شغل|شغلي|play|reproduce|pon|ponme)/,
  search: /(?:ابحث|دور|دورلي|بحث|search|find|look up|busca|buscar|encuentra)/,
  // «عايز صورة لقطة…» · «I want a picture of…» · «quiero una imagen de…» (v4 §11) — لا «صورة البروفايل» ولا «صورة لي»
  imageGen: /(?:(?:اعمل|اعملي|ولد|ولدلي|صمم|صمملي|انش(?:ئ|يء|ي|ا|اء)(?:لي)?|اصنع|اصنعلي|سوي|سويلي)\s+(?:لي\s+)?(?:صوره|صورة|لوجو|شعار|بوستر|تصميم|رسمه)|ارسم|تخيل|generate (?:an )?image|draw|imagine|create (?:an )?image|genera (?:una )?imagen|dibuja|crea (?:una )?imagen|(?:عايز|عاوز|اريد|بدي|ابغي|ابي)\s+صوره\s+(?:ل(?!ي(?:ا)?(?:\s|$))\S|عن\s|فيها\s)|i (?:want|need) (?:an? )?(?:image|picture|photo) of\s|quiero una (?:imagen|foto) de\s)/,
  enhance: /(?:حسن|وضح|جوده|جودة|عالي الدقه|hd|upscale|enhance|sharpen|mejora|mejorar|nitidez)/,
  removeBg: /(?:شيل الخلفيه|احذف الخلفيه|ازاله الخلفيه|بدون خلفيه|remove (?:the )?background|no background|quita(?:r)? (?:el )?fondo|sin fondo)/,
  // «حلل الصورة» ⇒ أداة الرؤية (v4 §14)
  describe: /(?:(?:اي|ايش|شو|وش|ماذا|ما)\s+(?:هو\s+)?(?:الموجود|اللي|الي|يوجد|موجود)\s+(?:في|ف)\s+(?:ال)?صوره|وصف الصوره|اوصف الصوره|برومبت|image to prompt|describe (?:this|the) image|prompt from|describe la imagen|حلل(?:لي)? (?:ال)?صوره|تحليل (?:ال)?صوره|(?:ايه|ماذا|شو) (?:اللي )?في (?:ال)?صوره|analy[sz]e (?:this|the) (?:image|photo|picture)|what(?:'s| is) in (?:this|the) (?:image|photo|picture)|analiza (?:la|esta) (?:imagen|foto)|qu[eé] hay en (?:la|esta) (?:imagen|foto))/,
  wallpaper: /(?:خلفيه|خلفيات|وولبيبر|wallpaper|fondo de pantalla)/,
  font: /(?:خط|خطوط|font|fonts|fuente|tipografia)/,
  phone: /(?:مواصفات|سعر موبايل|موبايل|هاتف|specs|specification|phone|especificaciones|celular|movil)/,
  movie: /(?:فيلم|افلام|مسلسل|دراما|drama|movie|film|series|pelicula|película|serie)/,
  anime: /(?:انمي|انيمي|anime)/,
  manga: /(?:مانجا|مانهوا|manga|manhwa)/,
  tempmail: /(?:بريد مؤقت|ايميل مؤقت|temp mail|temporary email|correo temporal)/,
  tiktokSearch: /(?:تيك توك|تيكتوك|tiktok)/,
  soundcloud: /(?:ساوند كلاود|ساوندكلاود|soundcloud)/,
  upload: /(?:ارفع|اعمل رابط|لينك للصوره|رابط للصوره|upload|sube|subir)/,
  video_enhance: /(?:حسن الفيديو|جوده الفيديو|enhance (?:the )?video|mejora (?:el )?video)/,
  // «جيب معلومات الجهاز X» · «هات Font X» بلا كلمة بحث (v4 §14)
  phoneInfo: /(?:معلومات|مواصفات)\s+(?:ال)?(?:جهاز|موبايل|هاتف|تليفون|فون)|(?:phone )?specs? (?:of|for)|specifications (?:of|for)|especificaciones (?:del|de)/,
  fontGet: /(?:هات|جيب|نزل|حمل|get|download|descarga)\s+(?:لي\s+)?(?:ال)?(?:خط|فونت|font|fuente)/,
};

/** يزيل كلمات النية الخاصة (جهاز/خط/أغنية/اسم إشارة) من البحث بعد stripIntentWords */
function cleanQuery(text, extra) {
  return stripIntentWords(text)
    .replace(/^(?:هات|جيب|نزل|حمل|get|download|descarga)\s+(?:لي\s+)?/i, "")
    .replace(extra, " ")
    .replace(/(?:^|\s)(?:دي|ده|دا|هذه|هذا|this|esta|este)(?=\s|$)/gi, " ")
    .replace(/\s+/g, " ").trim();
}
const PHONE_WORDS = /(?:معلومات|مواصفات)\s+(?:ال)?(?:جهاز|موبايل|هاتف|تليفون|فون)|(?:phone )?specs? (?:of|for)|specifications (?:of|for)|especificaciones (?:del|de)/gi;
const FONT_WORDS = /(?:^|\s)(?:ال)?(?:خط|فونت|font|fuente)(?=\s|$)/gi;
const SONG_WORDS = /(?:^|\s)(?:ال)?(?:أغنية|أغنيه|اغنية|اغنيه|song|canci[oó]n)(?=\s|$)/gi;

function stripIntentWords(text) {
  return String(text || "").replace(/https?:\/\/\S+/g, " ")
    .replace(/^(?:\s*(?:يا\s*)?(?:تيربو|terboo)[,،]?\s*)/i, "")
    .replace(/(?:ممكن|لو سمحت|من فضلك|please|por favor|عايز|عاوز|اريد|أريد|بدي|i want|quiero)\s*/gi, "")
    .replace(/(?:ابحث|دور|دورلي|بحث|search(?: for)?|find|look up|busca(?:r)?|encuentra)\s*(?:عن|على|في|for|on|about|en|sobre)?\s*/gi, "")
    .replace(/(?:شغل|شغلي|play|reproduce|pon(?:me)?)\s*(?:لي|me)?\s*/gi, "")
    .replace(/(?:اعمل|ارسم|تخيل|ولد|صمم|انش(?:ئ|يء|ي|ا|اء)|اصنع|سوي|generate|draw|imagine|create|genera|dibuja|crea)\s*(?:لي|me)?\s*(?:صوره|صورة|an image of|image of|una imagen de|imagen de|an image|image|imagen)?\s*(?:(?:of|de)\s+)?/gi, "")
    // «صورة عن الفضاء» ⇒ «الفضاء» · «a picture of a cat» ⇒ «a cat» (اللام الملتصقة تبقى: «ليمون» ليست «يمون»)
    .replace(/^\s*(?:صوره|صورة)\s+(?:عن\s+|فيها\s+)?/i, "")
    .replace(/^\s*(?:an? )?(?:image|picture|photo) of\s+/i, "")
    .replace(/^\s*una (?:imagen|foto) de\s+/i, "")
    .replace(/\s+/g, " ").trim();
}

/**
 * يحدد أداة الـscraper المناسبة لطلب طبيعي بسرعة (بلا نموذج).
 * @returns {null | {id:string, input:Object, platform?:string, reason:string, confidence:number}}
 */
function resolveScraperIntent(text, { hasImage = false, hasVideo = false } = {}) {
  const raw = String(text || "");
  const value = norm(raw);
  const url = extractUrl(raw);

  if (url) {
    const platform = detectPlatform(url);
    const wantsAudio = INTENT_WORDS.audio.test(value);
    const format = wantsAudio ? "mp3" : INTENT_WORDS.video.test(value) ? "mp4" : "";
    const byPlatform = {
      tiktok: "tiktok", instagram: "ig", twitter: "twitter", reddit: "reddit", spotify: "spotify",
      soundcloud: "soundclouddl", mediafire: "mediafire", terabox: "terabox", douyin: "douyin",
      dailymotion: "dailymotion", likee: "likee", rednote: "rednote", pinterest: "pindl", sfile: "sfiledl",
      facebook: "aio", threads: "aio", capcut: "aio",
      youtube: format === "mp4" ? "youtube" : "ytdl",
    };
    const id = byPlatform[platform];
    if (!id) return null;
    const confidence = INTENT_WORDS.download.test(value) || value.replace(/https?:\/\/\S+/g, "").trim().length < 3 ? 0.95 : 0.8;
    return { id, input: { url, format: format || (id === "ytdl" ? "mp3" : "") }, platform, reason: "url-platform", confidence };
  }

  if (hasImage) {
    if (INTENT_WORDS.removeBg.test(value)) return { id: "removebackground", input: {}, reason: "image-remove-bg", confidence: 0.9 };
    if (INTENT_WORDS.describe.test(value)) return { id: "img2prompt", input: {}, reason: "image-describe", confidence: 0.85 };
    if (INTENT_WORDS.upload.test(value)) return { id: "imgdrop", input: {}, reason: "image-upload", confidence: 0.8 };
    if (INTENT_WORDS.enhance.test(value)) return { id: "hd", input: {}, reason: "image-enhance", confidence: 0.9 };
    if (/(?:عدل|غير|خلي|حول|اعملي?(?:ها|ه|هم)(?=\s|$)|edit|change|turn|make it|edita|cambia|convierte|hazla|hazlo)/.test(value)) {
      // «اعملها كرتون» ⇒ «كرتون»: الفعل وضميره الملتصق يُحذفان معاً (لا «ها كرتون»)
      const prompt = stripIntentWords(raw.replace(/(^|\s)اعمل(?:ي)?(?:ها|ه|هم)(?=\s|$)/, "$1")) || raw.trim();
      return { id: "img2img", input: { prompt }, reason: "image-edit", confidence: 0.75 };
    }
  }
  if (hasVideo && (INTENT_WORDS.video_enhance.test(value) || INTENT_WORDS.enhance.test(value))) {
    return { id: "wink", input: {}, reason: "video-enhance", confidence: 0.85 };
  }

  if (INTENT_WORDS.imageGen.test(value)) {
    const prompt = stripIntentWords(raw);
    if (prompt.length >= 2) return { id: "txt2img2", input: { prompt }, reason: "image-generate", confidence: 0.9 };
  }
  if (INTENT_WORDS.tempmail.test(value)) return { id: "tempmail", input: {}, reason: "tempmail", confidence: 0.9 };
  if (INTENT_WORDS.phoneInfo.test(value)) {
    const query = cleanQuery(raw, PHONE_WORDS);
    if (query) return { id: "gsmarena", input: { query }, reason: "phone-info", confidence: 0.9 };
  }
  if (INTENT_WORDS.fontGet.test(value)) {
    const query = cleanQuery(raw, FONT_WORDS);
    if (query) return { id: "dafont", input: { query }, reason: "font-get", confidence: 0.9 };
  }

  const query = stripIntentWords(raw).replace(/(?:في|على|من|on|in|en)?\s*(?:تيك توك|تيكتوك|tiktok|ساوند ?كلاود|soundcloud|يوتيوب|youtube|جوجل|google)\s*/gi, " ").replace(/\s+/g, " ").trim();
  const searching = INTENT_WORDS.search.test(value);
  const playing = INTENT_WORDS.play.test(value);
  if (!query) return null;

  if (playing || (INTENT_WORDS.download.test(value) && INTENT_WORDS.audio.test(value))) {
    return { id: "ytdl", input: { query, format: INTENT_WORDS.video.test(value) ? "mp4" : "mp3" }, reason: "play-by-name", confidence: 0.85, play: true };
  }
  if (!searching) return null;
  if (INTENT_WORDS.tiktokSearch.test(value)) return { id: "tiktoksearch", input: { query }, reason: "search-tiktok", confidence: 0.9 };
  if (INTENT_WORDS.soundcloud.test(value)) return { id: "soundcloud", input: { query }, reason: "search-soundcloud", confidence: 0.9 };
  if (INTENT_WORDS.wallpaper.test(value)) return { id: "wallpapersearch", input: { query }, reason: "search-wallpaper", confidence: 0.85 };
  if (INTENT_WORDS.font.test(value)) return { id: "dafont", input: { query }, reason: "search-font", confidence: 0.8 };
  if (INTENT_WORDS.phone.test(value)) return { id: "gsmarena", input: { query }, reason: "search-phone", confidence: 0.85 };
  if (INTENT_WORDS.manga.test(value)) return { id: "shinigami", input: { query }, reason: "search-manga", confidence: 0.85 };
  if (INTENT_WORDS.anime.test(value)) return { id: "kusonime", input: { query }, reason: "search-anime", confidence: 0.8 };
  // «ابحث عن الأغنية دي …» ⇒ بحث أغانٍ (لا بحث ويب عام)
  if (INTENT_WORDS.audio.test(value)) {
    const song = cleanQuery(query, SONG_WORDS);
    if (song) return { id: "soundcloud", input: { query: song }, reason: "search-song", confidence: 0.85 };
  }
  if (INTENT_WORDS.movie.test(value)) return { id: "google", input: { query: `${query} ${/مسلسل|دراما|drama|serie/.test(value) ? "series" : "movie"}` }, reason: "search-movie", confidence: 0.75 };
  return { id: "google", input: { query }, reason: "search-web", confidence: 0.7 };
}

/** فحص رخيص: هل قد يحتاج الطلب أداة؟ (يحدد متى تُضاف قائمة الأدوات لموجّه النموذج) */
function mightNeedTool(text, { hasImage = false, hasVideo = false } = {}) {
  const value = norm(text);
  if (extractUrl(text)) return true;
  if ((hasImage || hasVideo) && value.length > 1) return true;
  return Object.values(INTENT_WORDS).some((re) => re.test(value));
}

// ═══════════════════════════════════════════════
// واجهة القراءة (للنواة وللمالك — §27)
// ═══════════════════════════════════════════════

/** السجل كاملاً (بلا دوال الاستدعاء) */
function listScrapers({ kind = "", includeInternal = true } = {}) {
  return Object.values(CATALOG)
    .filter((entry) => (!kind || entry.kind === kind) && (includeInternal || entry.autoSelect))
    .map(({ call, ...meta }) => ({ ...meta, plugins: pluginsUsingScraper(meta.id), health: { ...healthOf(meta.id), open: isOpen(meta.id) } }));
}

function getScraper(id) {
  const entry = CATALOG[id];
  if (!entry) return null;
  const { call, ...meta } = entry;
  return meta;
}

/** قائمة مختصرة للنموذج: الأدوات التي يجوز له اختيارها تلقائياً */
function toolListForModel() {
  return Object.values(CATALOG)
    .filter((entry) => entry.autoSelect && entry.kind !== "chat" && entry.kind !== "agent")
    .map((entry) => `- ${entry.id} [${entry.kind}|input:${entry.input}${entry.platforms.length ? `|${entry.platforms.join(",")}` : ""}] ${entry.purpose}`)
    .join("\n");
}

/** تقرير فحص scraper واحد للمالك: exports حقيقية + بلوقنات + صحة (§27) */
async function inspectScraper(id) {
  const meta = getScraper(id);
  if (!meta) return null;
  let discovered = null;
  let loadError = "";
  try { discovered = await discoverExports(id); } catch (error) { loadError = String(error?.message || error).slice(0, 200); }
  const plugins = [];
  for (const file of pluginsUsingScraper(id)) plugins.push({ file, command: await commandForPluginFile(file) });
  return { ...meta, discovered, loadError, plugins, health: { ...healthOf(id), open: isOpen(id) } };
}

/** سياسة الفشل لكل أداة (§16): مهلة · حد المحاولات · قاطع دائرة وتبريد · بديل */
function failoverOf(entry) {
  return {
    timeoutMs: entry.timeoutMs,
    retries: entry.retries,
    maxAttempts: entry.maxAttempts,
    circuitThreshold: CIRCUIT_THRESHOLD,
    cooldownMs: CIRCUIT_COOLDOWN_MS,
    fallbacks: [...entry.fallbacks],
  };
}

/**
 * الوصف الكامل لأداة كما يطلبه v4 §12 — مع exports الحقيقية المكتشفة من الملف نفسه.
 * @param {string} id
 */
async function describeScraper(id) {
  const meta = getScraper(id);
  if (!meta) return null;
  const discovered = await discoverExports(id);
  return {
    filename: meta.filename,
    file: meta.file,
    exports: discovered.exports,
    purpose: meta.purpose,
    inputs: meta.inputs,
    outputs: meta.outputs,
    category: meta.category,
    platform: meta.platforms,
    mediaType: meta.mediaType,
    timeout: meta.timeoutMs,
    retries: meta.retries,
    auth: meta.auth,
    safety: meta.safety,
    permission: meta.permission,
    examples: meta.examples,
    failover: failoverOf(meta),
    health: { ...healthOf(id), open: isOpen(id) },
    plugins: pluginsUsingScraper(id),
  };
}

/** مقارنة أداتين (§27) */
async function compareScrapers(a, b) {
  const [left, right] = await Promise.all([inspectScraper(a), inspectScraper(b)]);
  if (!left || !right) return null;
  const pick = (x) => ({ id: x.id, kind: x.kind, input: x.input, output: x.output, platforms: x.platforms, timeoutMs: x.timeoutMs, plugins: x.plugins.map((p) => p.command), exports: x.discovered?.exports || [], health: { calls: x.health.calls, failures: x.health.failures, lastLatencyMs: x.health.lastLatencyMs } });
  return { left: pick(left), right: pick(right) };
}

/** تدقيق التغطية (§49 §50): كل ملف في src/scraper مسجّل، وكل سجل له ملف ونقطة استدعاء حقيقية */
async function auditRegistry() {
  const files = scraperFiles();
  const registered = Object.keys(CATALOG).sort();
  const unregistered = files.filter((id) => !CATALOG[id]);
  const orphaned = registered.filter((id) => !files.includes(id));
  const loadFailures = [];
  const entryProblems = [];
  for (const id of registered.filter((x) => files.includes(x))) {
    try {
      const found = await discoverExports(id);
      if (!found.exports.length) entryProblems.push(`${id}: no exports`);
    } catch (error) {
      loadFailures.push(`${id}: ${String(error?.message || error).slice(0, 120)}`);
    }
  }
  return { files: files.length, registered: registered.length, unregistered, orphaned, loadFailures, entryProblems };
}

// للاختبارات فقط: تفريغ الصحة وفهرس البلوقنات
function _resetForTests() {
  health.clear();
  pluginIndex = null;
}

export {
  CATALOG,
  PLATFORMS,
  auditRegistry,
  compareScrapers,
  deliverResult,
  describeScraper,
  detectPlatform,
  discoverExports,
  extractUrl,
  failoverOf,
  getScraper,
  healthOf,
  inspectScraper,
  isOpen,
  listScrapers,
  mightNeedTool,
  normalizeResult,
  platformLabel,
  pluginFor,
  pluginsUsingScraper,
  recordOutcome,
  resolveScraperIntent,
  runScraper,
  scraperFiles,
  toolListForModel,
  validateInput,
  _resetForTests,
};

export default { CATALOG, runScraper, resolveScraperIntent, listScrapers, inspectScraper, auditRegistry, toolListForModel };
