// ═══════════════════════════════════════════════
// 🧪 TERBOO ARCADE — اختبار المحرك: العقد · السجل · بروتوكول الإجراء · الحالات · المكافآت · الحفظ
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-arcade-engine-"));
const { initDatabase, getDatabase } = await import("../src/lib/terboo-database.js");
await initDatabase(tmp);
const { loadArcade, arcadeContracts } = await import("../src/lib/terboo-arcade/index.js");
const loaded = await loadArcade();
const { games } = await import("../src/lib/terboo-games.js");
const { defineGame, FORBIDDEN_PAYLOAD_KEYS, STATES } = await import("../src/lib/terboo-arcade/contract.js");
const { missingKeys } = await import("../src/lib/terboo-arcade/locale.js");
const E = await import("../src/lib/terboo-arcade/engine.js");
const { memoryRepository, dbRepository } = await import("../src/lib/terboo-arcade/repository.js");
await import("../plugins/game/خمن_العلم.js");

const credits = [];
const wallet = { credit: (jid, r) => credits.push({ jid, ...r }) };
E.configure({ repository: memoryRepository(), wallet });

const A = "201000000101@s.whatsapp.net";
const B = "201000000102@s.whatsapp.net";
const C = "201000000103@s.whatsapp.net";
const D = "201000000104@s.whatsapp.net";
const X = "201000000199@s.whatsapp.net";
const G = "120363000000000101@g.us";
const results = [];
const check = async (name, fn) => {
  await fn();
  results.push(name);
};
const act = (room, jid, actionId, payload, extra = {}) => E.applyAction({ gameId: room.gameId, sessionId: room.sessionId, actionId, actor: E.idOf(jid), nonce: room.nonce, payload, source: "button", ...extra });

await check("contract-and-single-registry", async () => {
  assert.ok(loaded.length >= 23, `ألعاب المحرك: ${loaded.length}`);
  assert.throws(() => defineGame({ id: "Bad Id" }), /id/);
  assert.throws(() => defineGame({ id: "ok_id", uiMode: "flash" }), /uiMode/);
  assert.throws(() => defineGame({ id: "ok_id" }), /init/);
  for (const c of arcadeContracts()) {
    for (const key of ["id", "name", "aliases", "category", "mode", "uiMode", "players", "supportsGroup", "supportsPrivate", "supportsAI", "supportsSolo", "sessionType", "stateSchema", "actions", "renderer", "controller", "resultHandler", "rewardPolicy", "timeout", "cooldown", "permissions", "localization", "assets"]) {
      assert.ok(key in c, `${c.id}.${key}`);
    }
    for (const lg of ["ar", "en", "es"]) assert.ok(c.name[lg], `${c.id} name ${lg}`);
  }
  // سجل واحد: لعبة الأسئلة القديمة تُحَل من أمرها العربي إلى عقد **مربوط
  // بالمحرّك**، لا إلى نسخة قديمة الشكل بلا controller.
  // قبل الترحيل كان `contracts()` يحمل الشكلين بمعرّفين (`خمن_العلم` و
  // `q_tebakbendera`) فيظهر عقد غير قابل للعب في كل سرد وعدّ. الآن مدخل واحد.
  const all = games.contracts();
  const resolved = games.resolve("خمن_العلم");
  assert.ok(resolved, "الأمر العربي لم يُحَل إلى عقد");
  assert.equal(resolved.id, "q_tebakbendera", "يُحَل إلى العقد المُرحَّل لا إلى شكل قديم");
  assert.ok(resolved.controller, "العقد المُحَل مربوط بالمحرّك");
  assert.ok(!resolved.legacy, "العقد المُحَل ليس الشكل القديم");
  assert.ok(!all.some((c) => c.id === "خمن_العلم"), "نسخة ظلّ بمعرّف خام ما زالت في السجل");
  const ids = all.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, "معرّفات مكررة في السجل");
  assert.equal(games.resolve("ttt").id, "xo");
  assert.equal(games.resolve("ut").id, "snakes");
  assert.equal(games.resolve("suit").id, "rps");
  assert.deepEqual(missingKeys(), [], "كل نصوص الأركيد بالعربية والإنجليزية والإسبانية");
});

await check("action-protocol-security", async () => {
  const r = E.createRoom({ gameId: "xo", chat: G, isGroup: true, host: { jid: A, name: "A" } });
  E.joinRoom(r.room.roomId, { jid: B, name: "B" });
  const room = r.room;
  assert.equal(room.state, STATES.PLAYING);
  // حقول ممنوعة في payload
  for (const key of ["winner", "score", "balance", "currentTurn", "admin", "isOwner", "turn"]) {
    assert.ok(FORBIDDEN_PAYLOAD_KEYS.has(key.toLowerCase()));
    const res = await act(room, A, "place", { cell: 0, [key]: true });
    assert.equal(res.code, "forbidden-field", key);
  }
  assert.equal((await act(room, A, "place", { cell: 0, nested: { winner: 1 } })).code, "forbidden-field", "متداخل");
  // ممثل مزيّف (ليس لاعباً) · جلسة غير موجودة · لعبة مختلفة · شكل سيئ
  assert.equal((await act(room, X, "place", { cell: 0 })).code, "not-a-player");
  assert.equal((await E.applyAction({ gameId: "xo", sessionId: "nope", actionId: "place", actor: E.idOf(A), nonce: room.nonce, payload: { cell: 0 } })).code, "no-session");
  assert.equal((await E.applyAction({ gameId: "connect4", sessionId: room.sessionId, actionId: "place", actor: E.idOf(A), nonce: room.nonce, payload: { cell: 0 } })).code, "session-mismatch");
  assert.equal((await E.applyAction({ gameId: "xo", sessionId: room.sessionId, actionId: "x y", actor: E.idOf(A) })).code, "bad-actionId");
  assert.equal((await act(room, A, "place", { cell: 0, pad: "x".repeat(2000) })).code, "payload-too-large");
  // حركة غير قانونية · ليس دورك
  assert.equal((await act(room, A, "place", { cell: 42 })).code, "illegal");
  assert.equal((await act(room, B, "place", { cell: 0 })).code, "not-your-turn");
  // nonce: قديم ومكرر
  const nonce = room.nonce;
  assert.equal((await act(room, A, "place", { cell: 0 })).ok, true);
  assert.equal((await act(room, B, "place", { cell: 1 }, { nonce })).code, "stale", "nonce قديم");
  assert.equal((await act(room, B, "place", { cell: 1 }, { nonce: "zzzzzz" })).code, "bad-nonce");
  assert.equal((await act(room, B, "place", { cell: 1 }, { nonce: null })).code, "stale", "زر بلا nonce");
  // رسالة مكررة (نفس messageId)
  assert.equal((await act(room, B, "place", { cell: 1 }, { source: "text", nonce: null, messageId: "M1" })).ok, true);
  assert.equal((await act(room, A, "place", { cell: 2 }, { source: "text", nonce: null, messageId: "M1" })).code, "duplicate");
  // HTML: طابع زمني قديم مرفوض
  assert.equal((await act(room, A, "place", { cell: 2 }, { source: "html", timestamp: Date.now() - 10 * 60 * 1000 })).code, "expired-action");
  // تسلسل متزامن: ضغطتان بنفس nonce ⇒ واحدة فقط تمر
  const n = room.nonce;
  const [p1, p2] = await Promise.all([act(room, A, "place", { cell: 2 }, { nonce: n }), act(room, A, "place", { cell: 3 }, { nonce: n })]);
  assert.equal([p1, p2].filter((x) => x.ok).length, 1, "القفل يمنع حركتين بنفس النسخة");
  // finishGame من الخارج لا يقبل نتيجة: يفحص status الحقيقي فقط
  assert.equal(E.finishGame(room.roomId).code, "not-over");
});

await check("states-host-spectators", async () => {
  const r = E.createRoom({ gameId: "snakes", chat: "120363000000000102@g.us", isGroup: true, host: { jid: A, name: "A" } });
  const room = r.room;
  assert.equal(room.state, STATES.WAITING);
  assert.equal(E.startGame(room.roomId, { jid: A }).code, "not-enough-players");
  E.joinRoom(room.roomId, { jid: B, name: "B" });
  assert.equal(room.state, STATES.READY);
  E.joinRoom(room.roomId, { jid: C, name: "C" });
  assert.equal(E.spectate(room.roomId, { jid: X, name: "X" }).ok, true);
  assert.equal(room.spectators.length, 1);
  // نقل المضيف + خروج المضيف
  assert.equal(E.transferHost(room.roomId, { jid: B }, C).code, "host-only");
  assert.equal(E.transferHost(room.roomId, { jid: A }, B).ok, true);
  assert.equal(room.hostId, E.idOf(B));
  E.leaveRoom(room.roomId, { jid: B });
  assert.equal(room.hostId, E.idOf(A), "المضيف ينتقل عند الخروج");
  E.joinRoom(room.roomId, { jid: D, name: "D" });
  assert.equal(E.startGame(room.roomId, { jid: C }).code, "host-only");
  assert.equal(E.startGame(room.roomId, { jid: A }).ok, true);
  assert.equal(room.state, STATES.PLAYING);
  assert.equal(E.joinRoom(room.roomId, { jid: B, name: "B" }).code, "not-joinable");
  // إيقاف/استئناف: الحركة مرفوضة أثناء الإيقاف
  assert.equal(E.pauseGame(room.roomId, { jid: A }).ok, true);
  assert.equal((await act(room, A, "roll", null)).code, "paused");
  assert.equal(E.resumeGame(room.roomId, { jid: C }).ok, true);
  // نرد الخادم: العميل لا يرسل رقم النرد
  assert.equal((await act(room, A, "roll", { n: 6 })).code, "illegal");
  let guard = 0;
  while (room.state === STATES.PLAYING && guard < 2000) {
    const turn = room.game.turn;
    const jid = room.players[turn].jid;
    await act(room, jid, "roll", null);
    guard += 1;
  }
  assert.equal(room.state, STATES.FINISHED, "ثعبان وسلم 3 لاعبين حتى 100");
  assert.equal(room.game.pos.filter((p) => p === 100).length, 1);
});

await check("rewards-idempotent-and-daily-cap", async () => {
  credits.length = 0;
  const r = E.createRoom({ gameId: "xo", chat: "120363000000000103@g.us", isGroup: true, host: { jid: C, name: "C" } });
  E.joinRoom(r.room.roomId, { jid: D, name: "D" });
  const room = r.room;
  for (const [jid, cell] of [[C, 0], [D, 3], [C, 1], [D, 4], [C, 2]]) await act(room, jid, "place", { cell });
  assert.equal(room.state, STATES.FINISHED);
  assert.equal(credits.filter((x) => x.jid === C && x.koin).length, 1, "مكافأة الفائز مرة");
  const before = credits.length;
  assert.equal(E.finishGame(room.roomId).ok, true, "إعادة الإنهاء ممكنة لكنها لا تصرف");
  assert.equal(credits.length, before, "لا صرف مزدوج (idempotent)");
  assert.ok(room.settlement.every((s) => s.duplicate), "مسجّلة كمكررة");
  // الإنجازات والإحصاءات والترتيب
  const stats = E.getStats(C);
  assert.ok(stats.total.won >= 1 && stats.achievements.includes("first_win"));
  const top = E.getLeaderboard("xo", "week");
  assert.ok(top.some((row) => row.id === E.idOf(C)), "ترتيب أسبوعي");
  assert.ok(E.getLeaderboard(null, "month").length >= 1, "ترتيب شهري لكل الألعاب");
});

await check("challenge-accept-decline-expire", async () => {
  const chat = "120363000000000104@g.us";
  const r = E.createRoom({ gameId: "connect4", chat, isGroup: true, host: { jid: A, name: "A" }, invite: [{ jid: B, name: "B" }] });
  assert.equal(E.joinRoom(r.room.roomId, { jid: C, name: "C" }).code, "not-invited");
  assert.equal(E.declineChallenge(r.room.roomId, { jid: B }).ok, true);
  assert.equal(r.room.state, STATES.CANCELLED, "رفض المدعو الوحيد يلغي");
  const r2 = E.createRoom({ gameId: "connect4", chat, isGroup: true, host: { jid: A, name: "A" }, invite: [{ jid: B, name: "B" }] });
  E.sweep(Date.now() + 3 * 60 * 1000);
  assert.equal(r2.room.state, STATES.EXPIRED, "انتهاء مهلة التحدي");
  assert.equal(r2.room.result.reason, "challenge-expired");
  const r3 = E.createRoom({ gameId: "connect4", chat: B, isGroup: false, host: { jid: B, name: "B" } });
  assert.equal(r3.code, "needs-opponent", "الخاص بلا كمبيوتر ولا صديق");
});

await check("timeout-and-rematch", async () => {
  const chat = "120363000000000105@g.us";
  const r = E.createRoom({ gameId: "xo", chat, isGroup: true, host: { jid: A, name: "A" } });
  E.joinRoom(r.room.roomId, { jid: B, name: "B" });
  const room = r.room;
  E.sweep(Date.now() + 5 * 60 * 1000);
  assert.equal(room.state, STATES.FINISHED);
  assert.equal(room.result.reason, "timeout");
  assert.deepEqual(room.result.winners, [1], "من انتهى وقته يخسر");
  const first = E.rematch(room.roomId, { jid: A });
  assert.deepEqual(first.pending, ["B"], "الإعادة تنتظر الطرف الآخر");
  const second = E.rematch(room.roomId, { jid: B });
  assert.equal(second.room.state, STATES.PLAYING);
  assert.equal(second.room.players[0].id, E.idOf(B), "المقاعد تُدوَّر للعدل");
  assert.equal(E.rematch(room.roomId, { jid: A }).room.roomId, second.room.roomId, "نفس الإعادة لا تتكرر");
});

await check("persistence-db-repository", async () => {
  const db = getDatabase();
  const repo = dbRepository(db);
  E._reset();
  E.configure({ repository: repo, wallet });
  const r = E.createRoom({ gameId: "connect4", chat: A, isGroup: false, host: { jid: A, name: "A" }, vsAI: true, difficulty: "EASY" });
  await act(r.room, A, "drop", { col: 3 });
  repo.flush();
  const saved = db.setting("arcade:state");
  assert.ok(saved.rooms[r.room.roomId], "الغرفة محفوظة في القاعدة");
  assert.doesNotMatch(JSON.stringify(saved), /apikey|password|token"/i, "لا أسرار في الحالة المحفوظة");
  // «إعادة تشغيل»: محرك جديد من نفس القاعدة يستعيد الغرفة ويكمل
  E._reset();
  E.configure({ repository: dbRepository(db), wallet });
  const restored = E.getState(r.room.roomId);
  assert.ok(restored, "استُعيدت بعد إعادة التشغيل");
  assert.equal(restored.state, STATES.PLAYING);
  const next = await E.applyAction({ gameId: "connect4", sessionId: restored.sessionId, actionId: "drop", actor: E.idOf(A), nonce: restored.nonce, payload: { col: 3 }, source: "button" });
  assert.equal(next.ok, true, "إعادة الاتصال: الحركة تكمل على الحالة المستعادة");
});

console.log(`✅ terboo-arcade-engine: ${results.length} مجموعات (${results.join(" · ")})`);
process.exit(0);
