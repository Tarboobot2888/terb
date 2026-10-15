import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import config from "../config.js";
import { handleAutoAI } from "../src/lib/terboo-auto-ai.js";
import { formatAutoAIStatus, handler as autoAiCommandHandler } from "../plugins/group/autoai.js";
import { initDatabase } from "../src/lib/terboo-database.js";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.message || e); process.exit(1); });

const originalPrimary = config.bot.primaryNumber;
config.bot.primaryNumber = "201034648449";
const chat = "autoai-test@g.us";
const settings = { enabled: true, instruction: "أجب باختصار.", character: "assistant", responseType: "text", sessions: {} };
const dbRoot = await fs.mkdtemp(path.join(os.tmpdir(), "terboo-autoai-"));
const db = await initDatabase(path.join(dbRoot, "main"));
db.db.data.autoai = { [chat]: settings };
db.db.data.autoai_global = { enabled: false };
const replies = [];
const baseMessage = {
  // v4 §23: داخل المجموعة يُخاطَب البوت باسمه «تيربو» أو بالمنشن أو بالرد على رسالته
  isGroup: true, fromMe: false, isCommand: false, chat, sender: "201999999999@s.whatsapp.net", body: "تيربو رسالة اختبار عادية",
  groupMembers: [{ id: "201034648449@s.whatsapp.net" }], quoted: null,
  reply: async (text) => replies.push(text), react: async () => {},
};
const sock = { user: { id: "201034648449:1@s.whatsapp.net" }, sendPresenceUpdate: async () => {}, sendMessage: async () => {} };

// المحادثة العامة بين الأعضاء: لا معالجة ولا نداء مزوّد (v4 §23 §24)
let providerCalls = 0;
const general = await handleAutoAI({ ...baseMessage, sender: "201999999990@s.whatsapp.net", body: "رسالة عادية بين الأعضاء" }, sock, { db, geminiChat: async () => { providerCalls += 1; return { text: "لا يجب" }; } });
assert.equal(general, false, "Auto AI عالج محادثة عامة في المجموعة");
assert.equal(providerCalls, 0, "نداء مزوّد لرسالة عامة");
assert.equal(replies.length, 0);

const handled = await handleAutoAI(baseMessage, sock, { db, geminiChat: async () => ({ text: "تم الرد تلقائياً" }) });
assert.equal(handled, true);
assert.match(replies.at(-1), /تم الرد تلقائياً/);
assert.equal(settings.lastError, "", "تنظيف آخر خطأ بعد استجابة ناجحة");

const failureMessage = { ...baseMessage, sender: "201999999998@s.whatsapp.net", body: "تيربو رسالة تسبب اختبار فشل" };
await handleAutoAI(failureMessage, sock, { db, geminiChat: async () => { throw new Error("تعذر الوصول إلى المزود"); } });
assert.match(settings.lastError, /تعذر الوصول/);
// الموجّه يضيف اسم المزوّد قبل رسالة الخطأ الأصلية، فتبقى الرسالة الأصلية ظاهرة كاملة
assert.match(formatAutoAIStatus(settings), /آخر خطأ: .*GeminiAPI: تعذر الوصول إلى المزود/);
assert.match(formatAutoAIStatus({ enabled: true }), /الرد التلقائي: منشن أو رد أو «تيربو» فقط/, "نطاق المجموعات: منشن/رد/اسم");
assert.match(formatAutoAIStatus({ enabled: true, replyScope: "خاص" }), /الرد التلقائي: مفعّل في الخاص/);
assert.match(formatAutoAIStatus({ enabled: true, alwaysReply: false }), /الرد التلقائي: منشن أو رد أو «تيربو» فقط/);

const privateOwnerReplies = [];
await autoAiCommandHandler({
  isGroup: false,
  isOwner: true,
  isAdmin: false,
  chat,
  args: ["حالة"],
  fullArgs: "حالة",
  text: "حالة",
  body: ".autoai حالة",
  reply: async (text) => privateOwnerReplies.push(text),
  react: async () => {},
});
assert.match(privateOwnerReplies[0], /حالة Auto AI/, "المالك يتجاوز قيد المجموعة المباشر لأمر الحالة");

delete db.db.data.autoai[chat];
db.db.data.autoai_global = { enabled: true, characterName: "Global", lastError: "خطأ عام محفوظ" };
const globalStatusReplies = [];
await autoAiCommandHandler({
  isGroup: false, isOwner: true, isAdmin: false, chat, args: ["حالة"], fullArgs: "حالة", text: "حالة", body: ".autoai حالة",
  reply: async (text) => globalStatusReplies.push(text), react: async () => {},
});
assert.match(globalStatusReplies[0], /المصدر: الإعداد العام/);
assert.match(globalStatusReplies[0], /آخر خطأ: خطأ عام محفوظ/);

db.db.data.autoai[chat] = { enabled: true, alwaysReply: false, lastError: "خطأ محلي محفوظ" };
const localStatusReplies = [];
await autoAiCommandHandler({
  isGroup: true, isOwner: true, isAdmin: false, chat, args: ["حالة"], fullArgs: "حالة", text: "حالة", body: ".autoai حالة",
  reply: async (text) => localStatusReplies.push(text), react: async () => {},
});
assert.match(localStatusReplies[0], /المصدر: إعداد المجموعة/);
assert.match(localStatusReplies[0], /الرد التلقائي: منشن أو رد أو «تيربو» فقط/);
assert.match(localStatusReplies[0], /آخر خطأ: خطأ محلي محفوظ/);

config.bot.primaryNumber = originalPrimary;
await fs.rm(dbRoot, { recursive: true, force: true });
console.log("autoai behavioral tests: passed");
process.exit(0);
