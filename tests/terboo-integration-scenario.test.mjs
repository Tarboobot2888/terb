// سيناريو تكامل كامل (§56) في نفس السياق، عبر messageHandler الحقيقي وحدّ الإرسال الحقيقي:
//
//   مرحبا ← بتعمل اي ← حمل لي فيديو من الرابط ← احفظ إن اسمي محمود ← فاكر اسمي؟
//   ← اعرضلي القائمة ← اختار الأدوات ← نفذ أحد أوامر الأدوات
//
// لا يُستبدَل إلا ما هو خارج البوت: واتساب (sock يسجّل)، مزوّد الذكاء (نموذج مُبرمج
// يتحقق مما يصله فعلاً)، وجسم بلوقن التحميل وحده (جاسوس بدل الشبكة يثبت أن الرابط
// وصل للبلوقن الحقيقي عبر سجل الأدوات). النواة · الذاكرة · التنويع · سجل السكرابرات
// · الموزّع · الصلاحيات · القوائم وطبقة تسليمها · بلوقن الأدوات: كلها حقيقية.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111129";
const USER = "201555500056@s.whatsapp.net";
const VIDEO = "https://www.tiktok.com/@terboo/video/7300000000000000001";

// ── نموذج مُبرمج: يرى الرسالة الحالية والسياق ويقرّر ──
const payloads = [];
let decideFor = () => ({ decision: "CHAT", reply: "…", confidence: 0.9 });
global.terbooProviders = {
  map: {
    GeminiAPI: async (payload) => {
      payloads.push(payload);
      if (!/Choose exactly one decision/.test(payload.instruction || "")) return { text: "ملخص المحادثة" };
      try {
        return { text: JSON.stringify(decideFor(payload)) };
      } catch (error) {
        // خطأ تحقق داخل النموذج المُبرمج يُفشل الاختبار فوراً (لا يبتلعه مسار فشل المزوّد)
        console.error("❌ فشل الاختبار:", error?.message);
        console.error(JSON.stringify({ message: payload.message, history: payload.history }).slice(0, 1500));
        process.exit(1);
      }
    },
  },
  loadedAt: Date.now() + 3_600_000,
  names: ["GeminiAPI"],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-scenario-"));
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
db.setting("audioMenu", false);
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");
const { installLocalization } = await import("../src/lib/terboo-i18n/runtime.js");
const { installMenuDelivery, deliveryLog } = await import("../src/lib/terboo-menu-delivery.js");
const { designViolations } = await import("../src/lib/terboo-design.js");

db.setUser(USER, { isRegistered: true, regName: "محمود", language: "ar" });

// ── واتساب: كل ما يصل للمستخدم يُسجَّل بعد حدّ الإرسال الحقيقي ──
const delivered = [];
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net`, jid: `${BOT}@s.whatsapp.net`, name: "Terboo" },
  ev: { on() { } },
  async relayMessage(jid, message, options = {}) { delivered.push({ jid, message, id: options.messageId }); return options.messageId || "R"; },
  async sendMessage(jid, content) { delivered.push({ jid, content }); return { key: { id: `S${delivered.length}`, remoteJid: jid, fromMe: true } }; },
  async sendPresenceUpdate() { }, async readMessages() { },
  async groupMetadata() { return { id: "g@g.us", subject: "G", participants: [] }; },
  async profilePictureUrl() { throw new Error("no pp"); },
  waUploadToServer: async () => ({}),
};
installLocalization(sock, { getDatabase });
installMenuDelivery(sock);

// ── جسم بلوقن التحميل وحده ← جاسوس (بدل الشبكة) ──
const downloads = [];
const tiktok = getPlugin("تيكتوك");
assert.ok(tiktok, "بلوقن تيكتوك الحقيقي موجود");
tiktok.handler = async (m) => { downloads.push({ args: (m.args || []).join(" "), sender: m.sender }); await m.reply("✅ تم تجهيز الفيديو"); };

let seq = 0;
function textOf(entry) {
  if (entry.content) return entry.content.text || entry.content.caption || "";
  return JSON.stringify(entry.message || {});
}
async function say(text) {
  const before = delivered.length;
  const raw = { key: { remoteJid: USER, fromMe: false, id: `SCENE${++seq}ABCDEF` }, message: { conversation: text }, pushName: "محمود", messageTimestamp: Math.floor(Date.now() / 1000) };
  await messageHandler(raw, sock);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const now = delivered.slice(before);
  for (const entry of now) assert.equal(entry.jid, USER, `رسالة وصلت لغير دردشة المستخدم: ${entry.jid}`);
  for (const entry of now.filter((e) => e.content)) assert.deepEqual(designViolations(textOf(entry)), [], `تصميم قديم في الرد: ${textOf(entry)}`);
  return { entries: now, text: now.map(textOf).join("\n") };
}
const lastUserMessage = (payload) => String(payload.message || "");
const scope = memory.conversationScope({ sender: USER, chat: USER, isGroup: false });

// ① مرحبا
decideFor = () => ({ decision: "CHAT", reply: "أهلاً! 👋 أنا تيربو، المساعد الذكي. كيف أساعدك؟", confidence: 0.95 });
const hello = await say("مرحبا");
assert.match(hello.text, /كيف أساعدك/, "رد التحية وصل للمستخدم");

// ② بتعمل اي — نفس السياق: التحية السابقة في history، ولا إعادة تعريف
decideFor = (payload) => {
  assert.match(lastUserMessage(payload), /بتعمل اي/);
  assert.ok(payload.history.some((turn) => turn.role === "assistant" && /كيف أساعدك/.test(turn.content)), "الرد السابق وصل للنموذج");
  return { decision: "CHAT", reply: "أهلاً! 👋 أنا تيربو، المساعد الذكي. أقدر أحمّل الفيديوهات وأبحث وأنفّذ الأوامر وأتذكّر ما تطلبه.", confidence: 0.95 };
};
const what = await say("بتعمل اي");
assert.match(what.text, /أقدر أحمّل الفيديوهات/);
assert.doesNotMatch(what.text, /أنا تيربو/, "لا إعادة تعريف في نفس المحادثة");

// ③ حمل لي فيديو من الرابط — سجل الأدوات ⇒ بلوقن تيكتوك الحقيقي بنفس الرابط
const callsBeforeDownload = payloads.length;
decideFor = () => ({ decision: "TOOL", tool: "tiktok", input: { url: VIDEO }, confidence: 0.95 });
const download = await say(`حمل لي فيديو من الرابط ${VIDEO}`);
assert.equal(downloads.length, 1, "بلوقن التحميل الحقيقي استُدعي مرة واحدة");
assert.equal(downloads[0].args, VIDEO, "الرابط وصل للبلوقن كما هو");
assert.equal(downloads[0].sender, USER);
assert.match(download.text, /تم تجهيز الفيديو/);
assert.ok(payloads.length - callsBeforeDownload <= 1, "نداء نموذج واحد على الأكثر لطلب التحميل");

// ④ احفظ إن اسمي محمود — الذاكرة المعزولة لهذه المحادثة
decideFor = () => ({ decision: "CHAT", reply: "تمام، حفظت إن اسمك محمود.", confidence: 0.95, facts: ["اسم المستخدم محمود"] });
const save = await say("احفظ إن اسمي محمود");
assert.match(save.text, /محمود/);
const facts = memory.factsOf(scope).map((fact) => fact.text).join(" | ");
assert.match(facts, /محمود/, `الاسم لم يُحفظ في ذاكرة المحادثة: ${facts}`);

// ⑤ فاكر اسمي؟ — الاسم يصل للنموذج من الذاكرة
decideFor = (payload) => {
  const context = `${payload.instruction}\n${JSON.stringify(payload.history)}`;
  assert.match(context, /محمود/, "المعلومة المحفوظة وصلت للنموذج");
  return { decision: "CHAT", reply: "أيوه طبعاً، اسمك محمود.", confidence: 0.95 };
};
const recall = await say("فاكر اسمي؟");
assert.match(recall.text, /اسمك محمود/);

// ⑥ اعرضلي القائمة — القائمة الرئيسية تصل لدردشة المستخدم عبر طبقة التسليم
decideFor = () => ({ decision: "COMMAND", command: "menu", args: "", reply: "", confidence: 0.95 });
const logBefore = deliveryLog().length;
const menu = await say("اعرضلي القائمة");
const menuRelay = menu.entries.find((entry) => entry.message && /interactiveMessage|buttonsMessage/.test(JSON.stringify(entry.message)));
assert.ok(menuRelay, "القائمة الرئيسية أُرسلت كرسالة تفاعلية");
assert.equal(menuRelay.jid, USER, "القائمة في دردشة المستخدم لا عند البوت");
const menuRows = deliveryLog().slice(logBefore).filter((row) => row.menuId === "main");
assert.ok(menuRows.length && menuRows.every((row) => row.target === USER && row.messageId), "تسليم القائمة مسجّل بالهدف ومعرّف الرسالة");

// ⑦ اختار الأدوات — قسم الأدوات يصل بصفوف أوامر حقيقية
decideFor = (payload) => {
  assert.ok(payload.history.some((turn) => /menu|القائمة/.test(turn.content)) || /menu/.test(payload.instruction), "القائمة السابقة جزء من السياق");
  return { decision: "COMMAND", command: "فئة", args: "tools", reply: "", confidence: 0.95 };
};
const category = await say("اختار الأدوات");
const categoryRelay = category.entries.find((entry) => entry.message && /interactiveMessage|buttonsMessage/.test(JSON.stringify(entry.message)));
assert.ok(categoryRelay, "قسم الأدوات أُرسل كرسالة تفاعلية");
assert.equal(categoryRelay.jid, USER);
const rowIds = [...JSON.stringify(categoryRelay.message).matchAll(/\\"id\\":\\"([^"\\]+)\\"/g)].map((match) => match[1]);
const toolRows = rowIds.filter((id) => {
  const name = id.replace(/^\./, "").split(" ")[0];
  return getPlugin(name)?.config?.category === "tools";
});
assert.ok(toolRows.length >= 5, `صفوف أوامر الأدوات في القسم: ${toolRows.length}`);

// ⑧ نفذ أحد أوامر الأدوات — أمر من صفوف القسم نفسه يُنفَّذ عبر البلوقن الحقيقي
const chosen = toolRows.find((id) => /رمز_QR|qr/i.test(id)) || toolRows[0];
const chosenName = chosen.replace(/^\./, "").split(" ")[0];
decideFor = () => ({ decision: "COMMAND", command: chosenName, args: "", reply: "", confidence: 0.95 });
const run = await say("نفذ أحد أوامر الأدوات");
assert.ok(run.entries.length > 0, `أمر الأدوات ${chosenName} لم يرد`);
const state = memory.conversationState({ sender: USER, chat: USER, isGroup: false });
assert.equal(state.lastCommand?.command, getPlugin(chosenName).config.name?.[0] ?? getPlugin(chosenName).config.name, "آخر أمر في نفس سياق المحادثة هو أمر الأدوات المنفَّذ");

// نفس السياق من البداية للنهاية: الأدوار الحديثة في سجل هذه المحادثة، والأقدم طُويت في
// ملخّصها (لا ضاعت ولا ذهبت لنطاق آخر)، والحقيقة المحفوظة باقية، ولا شيء في نطاق شخص آخر
const turns = memory.history(scope, 40).map((turn) => turn.content).join("\n");
for (const needle of ["اسمي محمود", "فاكر اسمي", "اعرضلي القائمة", "اختار الأدوات", "نفذ أحد أوامر الأدوات"]) {
  assert.ok(turns.includes(needle), `الدور «${needle}» خارج سياق المحادثة`);
}
const snap = memory.snapshot(scope);
assert.ok(snap.summaryChars > 0, "الأدوار الأقدم طُويت في ملخّص المحادثة نفسها");
assert.ok(snap.facts.some((fact) => /محمود/.test(fact.text)), "الاسم باقٍ في ذاكرة المحادثة");
const stranger = memory.conversationScope({ sender: "201555500057@s.whatsapp.net", chat: "201555500057@s.whatsapp.net", isGroup: false });
assert.equal(memory.history(stranger, 40).length, 0, "لا تسريب لسياق شخص آخر");

console.log(`✅ terboo-integration-scenario: مرحبا ← بتعمل اي ← تحميل عبر سجل الأدوات ← حفظ الاسم ← تذكّره ← القائمة ← الأدوات ← تنفيذ ${chosenName}، كلها في دردشة المستخدم وفي نفس السياق`);
process.exit(0);
