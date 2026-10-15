// Scraper AI End-to-End (§22 §23 §26 §57): رسالة طبيعية → runKernel → سجل الأدوات → البلوقن الحقيقي
// أو المحوّل → التسليم في دردشة المستخدم. بلا شبكة: البلوقنات تُرصد عبر dispatch،
// والمحوّلات تعمل على وحدات scraper وهمية بنفس أسماء exports الحقيقية.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmpDb = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-scraper-e2e-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmpDb);
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmpDb, "memory"));
memory.resetAll();

const core = await import("../src/lib/terboo-ai-core.js");
const registry = await import("../src/lib/terboo-scraper-registry.js");

const BOT = "2348093093240";
let counter = 0;
function makeMessage(body, overrides = {}) {
  const sender = overrides.sender || "201000000011@s.whatsapp.net";
  counter++;
  return {
    sender, chat: sender, body, type: "conversation", isCommand: false, command: "", prefix: ".",
    args: [], isGroup: false, isOwner: false, isPremium: false, isPartner: false, isAdmin: false,
    isBotAdmin: true, isBot: false, fromMe: false, isNewsletter: false, mentionedJid: [], quoted: null,
    key: { id: `MSG${counter}`, remoteJid: sender }, raw: { key: { id: `MSG${counter}`, remoteJid: sender } },
    replies: [], reactions: [],
    async reply(text) { this.replies.push(String(text)); return { key: { id: `R${counter}` } }; },
    async react(emoji) { this.reactions.push(emoji); },
    ...overrides,
  };
}

const sent = [];
const sock = {
  user: { id: `${BOT}:12@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net` },
  async sendMessage(jid, content, opts) { sent.push({ jid, content, opts }); return { key: { id: `S${sent.length}`, remoteJid: jid } }; },
};

// scrapers وهمية بنفس أسماء exports الحقيقية — لا شبكة
const FAKE = {
  RedditDL: async () => ({ status: true, title: "post", results: [{ type: "image", download_url: "https://i.redd.it/a.jpg" }] }),
  default: async () => ({ status: "success", data: { video: "https://cdn.example/v.mp4", thumbnail: "https://cdn.example/t.jpg" } }),
  aiodl: async () => ({ status: true, url: "https://cdn.example/aio.mp4" }),
  GoogleSearch: async (q) => ({ status: true, results: [{ title: `About ${q}`, url: "https://example.com/1" }, { title: "Two", url: "https://example.com/2" }] }),
};
const runTool = (request) => registry.runScraper({ ...request, deps: { ...request.deps, load: async () => FAKE } });

const dispatched = [];
const dispatch = async (_m, _s, cmd) => { dispatched.push(cmd); return { ok: true, status: "done", replies: ["plugin replied"] }; };
let asks = 0;
const askNever = async () => { asks++; return { text: '{"decision":"CHAT","reply":"x"}', provider: "fake" }; };
const deps = { ask: askNever, dispatch, runTool, rateLimit: false };

async function run(body, extraDeps = {}, overrides = {}) {
  const m = makeMessage(body, overrides);
  const result = await core.runKernel(m, sock, getDatabase(), { ...deps, ...extraDeps });
  return { m, result };
}

// ── 1. روابط المنصات: مسار سريع بلا نموذج، والبلوقن الحقيقي أولاً ──
const pluginCases = [
  ["حمل لي الفيديو ده https://vt.tiktok.com/ZS1/", /تيكتوك/, "https://vt.tiktok.com/ZS1/"],
  ["نزّل من تيك توك https://www.tiktok.com/@a/video/1", /تيكتوك/, "https://www.tiktok.com/@a/video/1"],
  ["حمل الصوت https://youtu.be/abc", /يوت_صوت/, "https://youtu.be/abc"],
  ["جيب موسيقى من سبوتيفاي https://open.spotify.com/track/1", /سبوتيفاي/, "https://open.spotify.com/track/1"],
  ["نزل الملف ده https://www.mediafire.com/file/abc/file.zip", /ميديا_فاير/, "https://www.mediafire.com/file/abc/file.zip"],
  ["download this https://www.facebook.com/watch?v=1", /^aio$/, "https://www.facebook.com/watch?v=1"],
  ["اعمل صورة لقطة بتلعب كورة", /تخيل/, "لقطة بتلعب كورة"],
  ["شغل اغنية تملي معاك", /^شغل$/, "اغنية تملي معاك"],
];
for (const [body, command, args] of pluginCases) {
  const before = asks;
  const { m, result } = await run(body);
  assert.equal(result, "answered", body);
  assert.equal(asks, before, `«${body}» استدعى النموذج رغم وضوح الأداة`);
  const last = dispatched.at(-1);
  assert.match(last.command, command, `«${body}» → ${last.command}`);
  assert.equal(last.args, args, `«${body}» وسيط خاطئ`);
  assert.equal(m.replies.length, 0, "البلوقن يرد بنفسه — لا رد مكرر من النواة");
}

// ── 2. منصات بلا بلوقن: المحوّل الحقيقي + التسليم في دردشة المستخدم نفسها ──
for (const [body, platform] of [["حمل البوست ده https://www.reddit.com/r/a/comments/b/", "reddit"], ["حمل https://x.com/u/status/1", "twitter"], ["descarga este reel https://www.instagram.com/reel/abc/", "instagram"]]) {
  const beforeSent = sent.length;
  const { m, result } = await run(body);
  assert.equal(result, "answered", body);
  const deliveries = sent.slice(beforeSent);
  assert.ok(deliveries.length >= 1, `${platform}: لم يُرسل شيء`);
  for (const d of deliveries) {
    assert.equal(d.jid, m.chat, `${platform}: الإرسال لغير دردشة المستخدم`);
    assert.equal(d.opts.quoted, m, `${platform}: الرد لا يقتبس رسالة المستخدم`);
  }
  assert.ok(deliveries.some((d) => d.content.video || d.content.image), `${platform}: لا وسائط`);
  assert.ok(!deliveries.some((d) => d.content.image?.url?.includes("/t.jpg")), "الصورة المصغّرة أُرسلت بدل الفيديو");
  assert.deepEqual(m.reactions, ["⏳", "✅"]);
}

// رابط وحده بلا طلب: السلوك الحالي محفوظ (يتولاه التحميل التلقائي إن فعّلته الدردشة) — §2
{
  const before = dispatched.length;
  const { result } = await run("https://www.mediafire.com/file/abc/file.zip");
  assert.equal(result, false);
  assert.equal(dispatched.length, before);
}

// ── 3. طلب غير حاسم ⇒ نداء نموذج واحد يختار TOOL من السجل ──
{
  let calls = 0;
  let sawTools = false;
  const ask = async (payload) => {
    calls++;
    sawTools = /Tools from the scraper registry/.test(payload.instruction || "") && /- google \[search/.test(payload.instruction || "");
    return { text: JSON.stringify({ decision: "TOOL", tool: "google", input: { query: "مطاعم في القاهرة" }, reply: "", confidence: 0.9 }), provider: "fake" };
  };
  const beforeSent = sent.length;
  const { m, result } = await run("دورلي على مطاعم كويسة في القاهرة", { ask });
  assert.equal(result, "answered");
  assert.equal(calls, 1, "نداء نموذج واحد فقط لهذه الرسالة");
  assert.ok(sawTools, "قائمة الأدوات لم تصل للنموذج");
  const card = sent.slice(beforeSent).find((d) => d.content.text);
  assert.ok(card && card.content.text.includes("مطاعم في القاهرة") && card.content.text.includes("https://example.com/1"), "نتائج البحث لم تُرسل");
  assert.equal(card.jid, m.chat);
}

// ── 4. محادثة عادية لا تمر بأي أداة ولا تحمل قائمة الأدوات ──
{
  const instructions = [];
  const ask = async (payload) => { instructions.push(payload.instruction || ""); return { text: '{"decision":"CHAT","reply":"أهلاً!","confidence":0.9}', provider: "fake" }; };
  const before = dispatched.length;
  const { m, result } = await run("ازيك عامل ايه", { ask });
  assert.equal(result, "answered");
  assert.equal(dispatched.length, before);
  const instruction = instructions.find((text) => text.includes("Choose exactly one decision")) || "";
  assert.ok(instruction, "لم يُستدعَ موجّه القرار");
  assert.ok(!/Tools from the scraper registry/.test(instruction), "قائمة الأدوات أُضيفت لمحادثة عادية (بطء بلا داع)");
  assert.ok(instruction.includes('"تيربو"'), "قفل الهوية غائب عن موجّه القرار");
  assert.ok(m.replies.join("\n").includes("أهلاً"));
}

// ── 5. حماية مدخلات النموذج: أداة مخترعة، رابط غير صالح، منصة خاطئة ──
{
  const ask = async () => ({ text: JSON.stringify({ decision: "TOOL", tool: "evilTool", input: { url: "https://x" } }), provider: "fake" });
  const { m } = await run("هاتلي حاجة غريبة من النت", { ask });
  assert.ok(m.replies.join("\n").includes("لا توجد أداة بهذا الاسم"), m.replies.join(" | "));
}
{
  const ask = async () => ({ text: JSON.stringify({ decision: "TOOL", tool: "tiktok", input: { url: "javascript:alert(1)" } }), provider: "fake" });
  const { m } = await run("نزل التيك توك اللي قلتلك عليه", { ask });
  assert.ok(m.replies.join("\n").includes("أرسل الرابط"), `رابط غير آمن لم يُرفض: ${m.replies.join(" | ")}`);
}
{
  const ask = async () => ({ text: JSON.stringify({ decision: "TOOL", tool: "tiktok", input: { url: "https://youtu.be/zzz" } }), provider: "fake" });
  const { m } = await run("download that video for me please", { ask });
  assert.ok(m.replies.join("\n").includes("valid TikTok link"), `منصة خاطئة لم تُرفض: ${m.replies.join(" | ")}`);
}
{
  const ask = async () => ({ text: JSON.stringify({ decision: "TOOL", tool: "gpt5", input: { prompt: "x" } }), provider: "fake" });
  const { m } = await run("استخدم اداة الشات", { ask });
  assert.ok(m.replies.join("\n").includes("لا توجد أداة بهذا الاسم"), "مزوّد محادثة لا يُستدعى كأداة");
}

// ── 6. أداة صور بلا صورة ⇒ رسالة مترجمة واضحة، وبالصورة ⇒ البلوقن ──
{
  const ask = async () => ({ text: JSON.stringify({ decision: "TOOL", tool: "removebackground", input: {} }), provider: "fake" });
  const { m } = await run("remove the background please", { ask });
  assert.ok(m.replies.join("\n").includes("Send an image"), m.replies.join(" | "));
  const withImage = await run("شيل الخلفية", {}, { isImage: true, download: async () => Buffer.from([0xff, 0xd8]) });
  assert.equal(withImage.result, "answered");
  assert.match(dispatched.at(-1).command, /إزالة_الخلفية/);
}

// ── 7. المالك يدير الـscrapers بكلام طبيعي (§27) — بلا شبكة ──
{
  const OWNER = "201225655220@s.whatsapp.net";
  const owner = (body) => run(body, {}, { sender: OWNER, isOwner: true });
  const inspect = await owner("افحص سكرابر tiktok");
  const text = inspect.m.replies.join("\n");
  assert.ok(text.includes("tiktok") && text.includes("default") && text.includes("تيكتوك"), `فحص scraper ناقص: ${text.slice(0, 300)}`);
  const plugins = await owner("مين البلوقنات اللي بتستخدم سكرابر ytdl");
  assert.ok(/شغل/.test(plugins.m.replies.join("\n")) && /يوت_صوت/.test(plugins.m.replies.join("\n")));
  const reverse = await owner("ايه السكرابر اللي بيستخدمه البلوقن تيكتوك");
  assert.ok(/tiktok/.test(reverse.m.replies.join("\n")) && /tiktoksearch/.test(reverse.m.replies.join("\n")));
  const compare = await owner("compare scraper tiktok and aio");
  assert.ok(/aiodl/.test(compare.m.replies.join("\n")), "المقارنة لا تعرض exports الحقيقية");
  const list = await owner("اعرض السكرابرات");
  assert.ok(list.m.replies.join("\n").includes(String(registry.scraperFiles().length)), "القائمة لا تعرض العدد الكامل");
  const liveNoUrl = await owner("اختبر scraper tiktok");
  assert.ok(liveNoUrl.m.replies.join("\n").includes("فشل الاختبار الحي") && liveNoUrl.m.replies.join("\n").includes("أرسل الرابط"), liveNoUrl.m.replies.join(" | "));
  // غير المالك لا يصل لأدوات المالك
  const stranger = await run("افحص سكرابر tiktok", { ask: async () => ({ text: '{"decision":"CHAT","reply":"لا أستطيع"}', provider: "fake" }) });
  assert.ok(!stranger.m.replies.join("\n").includes("aiodl") && !stranger.m.replies.join("\n").includes("src/scraper/tiktok.js"), "غير المالك رأى تفاصيل الأداة");
}

fs.rmSync(tmpDb, { recursive: true, force: true });
console.log(`✅ terboo-scraper-ai-e2e: ${pluginCases.length} طلبات عبر البلوقنات الحقيقية بلا نموذج، 3 منصات عبر المحوّلات، TOOL من النموذج بنداء واحد، حماية المدخلات`);
process.exit(0);
