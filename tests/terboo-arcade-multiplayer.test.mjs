// ═══════════════════════════════════════════════
// 🧪 TERBOO ARCADE — اختبار تعدد اللاعبين عبر المسار الحقيقي (messageHandler)
// ───────────────────────────────────────────────
// رسائل واتساب حقيقية الشكل (نص · رد · زر Native Flow) تمر من src/handler.js:
//   1. XO في مجموعة: إنشاء ← انضمام ← حركة بزر (Action ID + nonce) ← حركة مكتوبة ← فوز
//      ← مكافأة مرة واحدة ← زر قديم مرفوض (stale) ← ليس دورك مرفوض
//   2. تحدي صديق بالمنشن: قبول/رفض/غير مدعو
//   3. ضد الكمبيوتر في الخاص: الكمبيوتر يرد بحركة قانونية
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const BOT = "201111111111";
const BOT_JID = `${BOT}@s.whatsapp.net`;
const GROUP = "120363000000000888@g.us";
const A = "201222222201@s.whatsapp.net";
const B = "201222222202@s.whatsapp.net";
const C = "201222222203@s.whatsapp.net";
const D = "201222222204@s.whatsapp.net";
const E = "201222222205@s.whatsapp.net";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-arcade-mp-"));
process.env.TERBOO_TASKS_PATH = path.join(tmp, "tasks.json");
process.env.TERBOO_VPS_STORE = path.join(tmp, "vps.json");
const config = (await import("../config.js")).default;
config.bot.primaryNumber = BOT;
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const db = getDatabase();
const memory = await import("../src/lib/terboo-ai-memory.js");
memory.initMemory(path.join(tmp, "memory"));
const { loadPlugins, getPlugin } = await import("../src/lib/terboo-plugins.js");
await loadPlugins(path.join(process.cwd(), "plugins"));
const { messageHandler } = await import("../src/handler.js");
const engine = await import("../src/lib/terboo-arcade/engine.js");
for (const jid of [A, B, C, D, E]) db.setUser(jid, { language: "ar", name: jid.slice(-2) });
for (const name of ["اكس_او", "اركيد", "ثعبان_وسلم", "حجرة_ورقة_مقص", "ساحة_المعلومات"]) if (getPlugin(name)) getPlugin(name).config.cooldown = 0;
// plugins/game/اركيد.js يشغّل مكنسة انتهاء الغرف عند تحميله. حلقة «ثعبان وسلم»
// أدناه ترسل ~1500 رمية عبر معالج الرسائل الكامل وتستغرق عشرات الثواني، فكانت
// المكنسة تُنهي الغرفة (EXPIRED) أو تُنهي مهلة سؤال المسابقة في منتصف الاختبار
// ⇒ فشل متقطّع لا علاقة له بالقواعد المُختبَرة. نوقفها: الاختبار يفحص قواعد
// اللعب الجماعي، ومهلات الانتهاء لها اختبارها في terboo-arcade-engine.
engine.stopSweeper();

const sent = [];
const relays = [];
const buttonsOf = (message) => {
  const node = message?.viewOnceMessage?.message?.interactiveMessage || message?.interactiveMessage;
  const out = [];
  for (const b of node?.nativeFlowMessage?.buttons || []) {
    let params = {};
    try { params = JSON.parse(b.buttonParamsJson || "{}"); } catch { params = {}; }
    if (params.id) out.push({ id: params.id, text: params.display_text });
    for (const s of params.sections || []) for (const r of s.rows || []) out.push({ id: r.id, text: r.title });
  }
  return { text: node?.body?.text || "", buttons: out };
};
const sock = {
  user: { id: `${BOT}:1@s.whatsapp.net` },
  groupMetadata: async () => ({ id: GROUP, subject: "جروب الألعاب", owner: A, participants: [BOT_JID, A, B, C, D, E].map((id) => ({ id, admin: id === A ? "admin" : null })) }),
  sendMessage: async (chat, content) => { sent.push({ chat, text: content?.text || content?.caption || "" }); return { key: { id: `S${sent.length}`, remoteJid: chat, fromMe: true } }; },
  relayMessage: async (chat, message, opts) => { relays.push({ chat, ...buttonsOf(message) }); return opts?.messageId || `R${relays.length}`; },
  sendPresenceUpdate: async () => {},
  readMessages: async () => {},
  onWhatsApp: async (jid) => [{ exists: true, jid }],
};

let seq = 0;
function msg(sender, text, { chat = GROUP, mentions = [], button = null } = {}) {
  const id = `ARC${++seq}X${Date.now().toString(36).toUpperCase()}`;
  const key = { remoteJid: chat, participant: chat.endsWith("@g.us") ? sender : undefined, fromMe: false, id };
  if (button) return { key, message: { interactiveResponseMessage: { body: { text: "" }, nativeFlowResponseMessage: { name: "quick_reply", paramsJson: JSON.stringify({ id: button }), version: 3 }, contextInfo: { stanzaId: "BOTMSG", participant: BOT_JID, quotedMessage: { conversation: "لوحة" } } } }, pushName: `P${sender.slice(-2)}`, messageTimestamp: Math.floor(Date.now() / 1000) };
  return { key, message: { extendedTextMessage: { text, contextInfo: { mentionedJid: mentions } } }, pushName: `P${sender.slice(-2)}`, messageTimestamp: Math.floor(Date.now() / 1000) };
}
async function say(sender, text, opts = {}) {
  const before = { sent: sent.length, relays: relays.length };
  await messageHandler(msg(sender, text, opts), sock);
  await new Promise((r) => setTimeout(r, 40));
  const outs = [...sent.slice(before.sent), ...relays.slice(before.relays)];
  return { text: outs.map((x) => x.text).join("\n"), buttons: relays.slice(before.relays).flatMap((x) => x.buttons), outs };
}
const roomOf = (jid, chat = GROUP) => engine.findRoom({ chat, jid });

// 1) XO في مجموعة
let r = await say(A, ".اكس_او");
assert.match(r.text, /إكس أو/, "بطاقة الغرفة");
assert.ok(r.buttons.some((b) => /join/.test(b.id)), "زر انضمام حقيقي");
const room = roomOf(A);
assert.equal(room.state, "WAITING");
r = await say(B, ".اكس_او");
assert.equal(roomOf(A).state, "PLAYING", "انضمام B بدأ اللعبة");
const moveButtons = r.buttons.filter((b) => / a /.test(b.id));
assert.equal(moveButtons.length, 9, "9 خانات كأزرار/قائمة");
const firstNonce = room.nonce;
// B يحاول اللعب وليس دوره
r = await say(B, "", { button: moveButtons[4].id });
assert.match(r.text, /ليس دورك/, "ليس دورك");
assert.equal(room.game.board.filter((c) => c !== null).length, 0);
// A يلعب الخانة 5 بالزر
r = await say(A, "", { button: moveButtons[4].id });
assert.equal(room.game.board[4], 0, "حركة الزر طُبّقت على الخادم");
assert.notEqual(room.nonce, firstNonce, "nonce تغيّر");
// إعادة الضغط على نفس الزر القديم ⇒ مرفوض
r = await say(B, "", { button: moveButtons[0].id });
assert.match(r.text, /قديمة/, "زر قديم مرفوض (stale)");
assert.equal(room.game.board[0], null);
// حركات مكتوبة
await say(B, "1");
await say(A, "3");
await say(B, "2");
const koinBefore = db.getUser(A).koin || 0;
r = await say(A, "7");
assert.equal(room.state, "FINISHED", "فوز A (3-5-7)");
assert.match(r.text, /الفائز/, "إعلان الفائز");
const koinAfter = db.getUser(A).koin || 0;
assert.ok(koinAfter > koinBefore, "مكافأة حقيقية");
assert.ok(engine.finishGame(room.roomId).ok === false || (db.getUser(A).koin || 0) === koinAfter, "لا صرف مزدوج");
assert.ok(r.buttons.some((b) => /rematch/.test(b.id)), "زر إعادة");

// 2) تحدي صديق بالمنشن
r = await say(C, ".اكس_او @201222222204", { mentions: [D] });
assert.match(r.text, /يتحدى/, "بطاقة تحدٍّ");
const challenge = roomOf(C);
r = await say(B, `.اركيد accept ${challenge.roomId}`);
assert.match(r.text, /لمدعوين فقط/, "غير المدعو لا يقبل");
r = await say(D, `.اركيد accept ${challenge.roomId}`);
assert.equal(roomOf(C).state, "PLAYING", "القبول بدأ اللعبة");
await say(C, "استسلام");
assert.equal(challenge.state, "FINISHED");
assert.deepEqual(challenge.result.winners, [1], "الاستسلام يمنح الخصم الفوز");

// 3) ضد الكمبيوتر في الخاص
const DM = A;
r = await say(A, ".اكس_او", { chat: DM });
const aiRoom = roomOf(A, DM);
assert.ok(aiRoom.players[1].isAI, "خصم كمبيوتر");
await say(A, "5", { chat: DM });
assert.equal(aiRoom.game.board.filter((c) => c === 1).length, 1, "الكمبيوتر رد بحركة واحدة قانونية");

// 4) ثعبان وسلم 4 لاعبين: الأوامر الفرعية القديمة + «ارمي» مكتوبة + زر 🎲
await say(A, ".ثعبان_وسلم انشاء");
const ut = roomOf(A);
assert.equal(ut.gameId, "snakes");
for (const jid of [B, C, D]) await say(jid, ".ثعبان_وسلم انضمام");
assert.equal(ut.players.length, 4, "4 لاعبين");
r = await say(B, ".ثعبان_وسلم بدء");
assert.match(r.text, /للمضيف فقط/, "البدء للمضيف فقط");
r = await say(A, ".ثعبان_وسلم بدء");
assert.equal(ut.state, "PLAYING");
// مسار الإدخال (نص «ارمي» + زر) يُختبر على عدد صغير من الرميات.
// إكمال المباراة لا يمر بمعالج الرسائل: `globalLoadLimiter` في handler.js يسمح
// بـ100 رسالة/دقيقة **للبوت بالكامل**، فإغراقه بـ1500 رمية يُسقط ~93% منها
// («البوت يواجه ضغطاً كبيراً») وتصبح نتيجة الاختبار رهن سرعة معالجة الرسالة
// لا قواعد اللعبة — وهو ما جعله يفشل متقطّعاً. القواعد تُختبر على المحرك مباشرة.
let rolls = 0, viaMessage = 0;
for (let i = 0; i < 12 && ut.state === "PLAYING"; i += 1) {
  const jid = ut.players[ut.game.turn].jid;
  const posBefore = ut.game.pos.join(",");
  if (i % 4) await say(jid, "ارمي");
  else {
    const view = engine.getView(ut.roomId);
    await say(jid, "", { button: `.اركيد a ${ut.roomId} ${view.nonce} 0` });
  }
  rolls += 1;
  if (ut.game.pos.join(",") !== posBefore) viaMessage += 1;
}
assert.ok(viaMessage > 0, `مسار الرسائل نفّذ رميات فعلاً (${viaMessage}/${rolls})`);

// إكمال المباراة عبر المحرك: نفس التحقق ونفس القواعد، بلا حد الإنتاجية العام
while (ut.state === "PLAYING" && rolls < 1500) {
  const seat = ut.game.turn;
  const res = await engine.applyAction({
    gameId: ut.gameId, sessionId: ut.sessionId, actionId: "roll",
    actor: ut.players[seat].id, timestamp: Date.now(), payload: null, source: "text",
  });
  assert.ok(res.ok || ["finished", "not-your-turn"].includes(res.code), `رمية المحرك مقبولة (${res.code || "ok"})`);
  rolls += 1;
}
assert.equal(ut.state, "FINISHED", `انتهت بعد ${rolls} رمية`);
assert.equal(ut.game.pos.filter((p) => p >= 100).length, 1, "فائز واحد وصل 100");

// 5) لعبة أسئلة جماعية: انضمام · بدء · أول إجابة صحيحة تأخذ النقاط · الخطأ يقفل اللاعب
await say(C, ".ساحة_المعلومات");
const quiz = roomOf(C);
await say(D, `.اركيد join ${quiz.roomId}`);
await say(C, `.اركيد start ${quiz.roomId}`);
assert.equal(quiz.state, "PLAYING");
const q0 = quiz.game.qs[0];
const wrong = [0, 1, 2, 3].find((o) => o !== q0.answer);
await say(D, "ABCD"[wrong]);
assert.equal(quiz.game.locked[1], true, "الإجابة الخاطئة تقفل اللاعب");
await say(D, "ABCD"[q0.answer]);
assert.equal(quiz.game.i, 0, "المقفول لا يجيب مرة أخرى");
await say(C, "ABCD"[q0.answer]);
assert.equal(quiz.game.scores[0] > 0 && quiz.game.i === 1, true, "أول إجابة صحيحة تأخذ النقاط");

// 6) حجرة ورقة مقص: الأزرار السرية تصل للخاص لا للمجموعة
const before = relays.length;
await say(A, ".حجرة_ورقة_مقص @201222222202", { mentions: [B] });
const rps = roomOf(A);
await say(B, `.اركيد accept ${rps.roomId}`);
assert.equal(rps.state, "PLAYING");
const privateCards = relays.slice(before).filter((x) => x.chat === A || x.chat === B);
assert.ok(privateCards.length >= 2 && privateCards.every((x) => x.buttons.some((b) => / a /.test(b.id))), "أزرار الاختيار في خاص كل لاعب");
const groupCards = relays.slice(before).filter((x) => x.chat === GROUP);
assert.ok(groupCards.every((x) => !x.buttons.some((b) => / a /.test(b.id))), "لا أزرار اختيار في المجموعة");
await say(A, "حجرة", { chat: A });
await say(B, "مقص", { chat: B });
assert.deepEqual(rps.game.wins, [1, 0], "الجولة حُسمت من اختيارين سريين");

// 7) بالكلام الطبيعي (عبر المساعد): «عايز ألعب أربعة في صف ضد الكمبيوتر»
r = await say(E, `@${BOT} عايز ألعب أربعة في صف ضد الكمبيوتر`, { mentions: [BOT_JID] });
const c4 = roomOf(E);
assert.equal(c4?.gameId, "connect4", "النية أنشأت اللعبة");
assert.ok(c4.players[1].isAI, "ضد الكمبيوتر");

console.log("✅ terboo-arcade-multiplayer: XO مجموعة (أزرار+كتابة+nonce+دور+فوز+مكافأة) · تحدي صديق · ضد الكمبيوتر · ثعبان وسلم 4 لاعبين · أسئلة جماعية · اختيار سري في الخاص · كلام طبيعي");
process.exit(0);
