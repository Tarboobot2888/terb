// تكامل كامل: كلام طبيعي ← النواة ← الموزّع ← messageHandler الحقيقي ← بلوقن الطرد الحقيقي (§13 §40)
//
// لا يُستبدَل هنا إلا ما هو خارج البوت:
//   • واتساب ← sock وهمي يسجّل groupParticipantsUpdate و sendMessage.
//   • مزوّد الذكاء (شبكة) ← مزوّد نصّي مُبرمج في ذاكرة المزوّدات.
// كل ما عدا ذلك حقيقي: serialize · allowIncomingMessageProcessing · التسجيل
// · checkPermission (مشرف/البوت مشرف) · التبريد · الطاقة · بلوقن «طرد».

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111111";
const GROUP = "120363000000000999@g.us";
const ADMIN = "201222222222@s.whatsapp.net";
const MEMBER = "201333333333@s.whatsapp.net";
const TARGET = "201444444444@s.whatsapp.net";

// مزوّد مُبرمج: يقرّر الطرد ويثبت أن الهدف المحلول هو العضو لا البوت
const decisions = [];
global.terbooProviders = {
  map: {
    GeminiAPI: async (payload) => {
      decisions.push(payload);
      assert.match(payload.instruction, /Resolved target number: 201444444444/, "الهدف المحلول هو العضو");
      return { text: JSON.stringify({ decision: "COMMAND", command: "kick", args: "", reply: "حاضر", confidence: 0.95 }) };
    },
  },
  loadedAt: Date.now() + 3_600_000,
  names: ["GeminiAPI"],
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-dispatch-"));
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");

for (const jid of [ADMIN, MEMBER]) db.setUser(jid, { isRegistered: true, regName: "مختبر", language: "ar" });

const participants = [
  { id: `${BOT}@s.whatsapp.net`, admin: "admin" },
  { id: ADMIN, admin: "admin" },
  { id: MEMBER, admin: null },
  { id: TARGET, admin: null },
];
const removed = [];
const sent = [];
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net` },
  groupMetadata: async () => ({ id: GROUP, subject: "مجموعة الاختبار", participants }),
  groupParticipantsUpdate: async (chat, jids, action) => { removed.push({ chat, jids, action }); return jids.map((jid) => ({ jid, status: "200" })); },
  sendMessage: async (chat, content) => { sent.push({ chat, content }); return { key: { id: `S${sent.length}` } }; },
  sendPresenceUpdate: async () => { },
  readMessages: async () => { },
};

let seq = 0;
function groupMessage(sender, text) {
  return {
    key: { remoteJid: GROUP, participant: sender, fromMe: false, id: `NATURAL${++seq}X` },
    message: {
      extendedTextMessage: {
        text: `@${BOT} ${text}`,
        contextInfo: { mentionedJid: [`${BOT}@s.whatsapp.net`, TARGET] },
      },
    },
    pushName: "مختبر",
    messageTimestamp: Math.floor(Date.now() / 1000),
  };
}

// ═══ 1. المشرف: «ممكن تطرد الشخص ده؟» ⇒ الطرد الحقيقي للعضو المقصود ═══
await messageHandler(groupMessage(ADMIN, "ممكن تطرد الشخص ده؟"), sock);
assert.equal(decisions.length, 1, "النواة استشارت المزوّد مرة واحدة");
assert.equal(removed.length, 1, "البلوقن الحقيقي نفّذ الطرد");
assert.deepEqual(removed[0], { chat: GROUP, jids: [TARGET], action: "remove" }, "الطرد وقع على العضو المقصود لا على البوت");
{
  const scope = memory.scopeOf("group:user", { userJid: ADMIN, chatJid: GROUP, isGroup: true });
  const snap = memory.snapshot(scope);
  assert.equal(snap.lastResult?.ok, true, "النتيجة الحقيقية (نجح) محفوظة في الذاكرة");
  assert.equal(snap.lastTarget?.number, "201444444444");
}

// ═══ 2. عضو عادي بنفس الطلب ⇒ لا ترشيح/لا طرد (الصلاحيات لا تُتجاوز) ═══
const sentBefore = sent.length;
await messageHandler(groupMessage(MEMBER, "ممكن تطرد الشخص ده؟"), sock);
assert.equal(removed.length, 1, "لم يحدث أي طرد لعضو بلا صلاحية");
{
  const scope = memory.scopeOf("group:user", { userJid: MEMBER, chatJid: GROUP, isGroup: true });
  const snap = memory.snapshot(scope);
  assert.ok(!snap?.lastResult?.ok, "لا نتيجة ناجحة مسجّلة للعضو");
}
assert.ok(sent.length > sentBefore, "العضو تلقّى رداً يشرح (لا فشل صامت)");

// ═══ 3. حلقة: رسالة الموزّع نفسها لا تُعاد للنواة ═══
assert.ok(decisions.length <= 2, "لا حلقة ذكاء (الأمر المُرسَل لا يُرسل للمزوّد مجدداً)");

console.log("✅ terboo-ai-dispatch.integration: طلب طبيعي ⇒ بلوقن الطرد الحقيقي للمشرف فقط، بكل الصلاحيات");
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { }
process.exit(0);
