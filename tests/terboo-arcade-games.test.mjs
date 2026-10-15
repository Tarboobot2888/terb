// ═══════════════════════════════════════════════
// 🧪 TERBOO ARCADE — قواعد الألعاب + لعب آلي حتى النهاية لكل لعبة
// ───────────────────────────────────────────────
// • كل لعبة في السجل تُلعب حتى FINISHED عبر engine.applyAction (حركات قانونية/حرة) بلا استثناء
// • قواعد محددة: الجاذبية · الأكل الإجباري · القلب · الكشف الأول الآمن · الدمج · تعارض السودوكو
//   · وردل مع الحروف المكررة · الثيران والأبقار · لا تسريب (سفن/وجوه بطاقات/إجابة السؤال/السر)
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const { loadArcade, arcadeContracts } = await import("../src/lib/terboo-arcade/index.js");
const ids = await loadArcade();
const { games } = await import("../src/lib/terboo-games.js");
const E = await import("../src/lib/terboo-arcade/engine.js");
const R = await import("../src/lib/terboo-arcade/render.js");
const { memoryRepository } = await import("../src/lib/terboo-arcade/repository.js");
const { seeded, serverRng } = await import("../src/lib/terboo-arcade/rng.js");
E.configure({ repository: memoryRepository(), wallet: { credit() {} } });

const A = "201000000401@s.whatsapp.net";
const C = (id) => games.contractOf(id);
const init = (id, players = 2, options = {}) => C(id).controller.init({ players, rng: seeded(`t:${id}`), options: { lang: "ar", ...options }, seats: [] });
const apply = (id, state, action, actor = 0, rng = serverRng) => {
  const next = structuredClone(state);
  const res = C(id).controller.apply(next, action, { actor, rng });
  return { res, state: res?.state || next };
};

// 1) كل لعبة حتى النهاية
const FREE = {
  sudoku: (st) => { const i = st.grid.findIndex((v) => !v); return { id: "set", payload: { cell: i, v: st.solution[i] } }; },
  wordle_ar: (st, k) => ({ id: "guess", payload: { word: k % 3 === 2 ? st.answer : "مدرسه" } }),
  bulls_cows: (st, k) => ({ id: "guess", payload: { code: ["1234", "5678", "9012", st.secret][k % 4] } }),
  hangman: (st) => ({ id: "word", payload: { w: st.word } }),
};
let finished = 0;
for (const c of arcadeContracts()) {
  const rng = seeded(c.id);
  const vsAI = c.supportsAI && c.mode === "pvp";
  const r = E.createRoom({ gameId: c.id, chat: `g-${c.id}@s.whatsapp.net`, isGroup: false, host: { jid: A, name: "A" }, vsAI, difficulty: "EASY", options: { lang: "ar" } });
  assert.equal(r.ok, true, `${c.id}: ${r.code}`);
  const room = r.room;
  for (let step = 0; step < 500 && room.state === "PLAYING"; step += 1) {
    const view = E.getView(room.roomId, { lang: "es" });
    assert.ok(R.textView(view).length > 0, `${c.id}: نص`);
    const legal = c.controller.legalActions(room.game, view.turn ?? 0);
    let act = legal.length ? rng.pick(legal) : null;
    if (FREE[c.id] && (!legal.length || step % 2)) act = FREE[c.id](room.game, step);
    if (!act) {
      E.sweep(Date.now() + 10 * 60 * 1000);
      continue;
    }
    const res = await E.applyAction({ gameId: c.id, sessionId: room.sessionId, actionId: act.id, actor: E.idOf(A), nonce: room.nonce, payload: act.payload ?? null, source: "button" });
    assert.ok(res.ok || ["illegal", "not-your-turn"].includes(res.code), `${c.id}: ${res.code}`);
  }
  assert.equal(room.state, "FINISHED", `${c.id} انتهت`);
  finished += 1;
}
assert.equal(finished, ids.length, "كل الألعاب لُعبت حتى النهاية");

// 2) قواعد محددة
// أربعة في صف: الجاذبية
let s = init("connect4");
s = apply("connect4", s, { id: "drop", payload: { col: 2 } }).state;
assert.equal(s.board[5 * 7 + 2], 0, "القطعة تسقط للصف الأسفل");
// الداما: الأكل إجباري
s = init("checkers");
s.board = Array(64).fill(null);
s.board[5 * 8 + 2] = { s: 0, k: false };
s.board[4 * 8 + 3] = { s: 1, k: false };
s.board[5 * 8 + 6] = { s: 0, k: false };
s.board[0 * 8 + 1] = { s: 1, k: false };
const moves = C("checkers").controller.legalActions(s, 0);
assert.ok(moves.length >= 1 && moves.every((mv) => mv.label.includes("×")), "لا حركات عادية حين يوجد أكل");
// أوثيلو: القلب
s = init("reversi");
const r0 = C("reversi").controller.legalActions(s, 0)[0];
s = apply("reversi", s, r0).state;
assert.equal(s.board.filter((v) => v === 0).length, 4, "الحركة الأولى تقلب قطعة");
// كاشف الألغام: الكشف الأول آمن دائماً
for (let k = 0; k < 20; k += 1) {
  let ms = init("minesweeper", 1);
  ms = apply("minesweeper", ms, { id: "reveal", payload: { cell: 27 } }, 0, seeded(`m${k}`)).state;
  assert.ok(!ms.mines.includes(27) && ms.boom === null, "الكشف الأول آمن");
}
// 2048: الدمج
s = { grid: [2, 2, 4, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], score: 0 };
s = apply("g2048", s, { id: "slide", payload: { dir: "left" } }, 0, seeded("x")).state;
assert.deepEqual(s.grid.slice(0, 4), [4, 8, 0, 0].map((v, i) => (i < 2 ? v : s.grid[i])), "2+2 و4+4");
assert.equal(s.score, 12);
// سودوكو: التعارض مرفوض والخلية المعطاة مقفلة
s = init("sudoku", 1);
const empty = s.grid.findIndex((v) => !v);
const row = Math.floor(empty / 9);
const clash = s.grid.slice(row * 9, row * 9 + 9).find(Boolean);
assert.equal(C("sudoku").controller.validateFree(s, { id: "set", payload: { cell: empty, v: clash } }).ok, false, "تعارض الصف");
const given = s.grid.findIndex(Boolean);
assert.equal(C("sudoku").controller.validateFree(s, { id: "set", payload: { cell: given, v: 1 } }).ok, false, "خلية معطاة");
// وردل: إدخال غير صالح مرفوض
s = init("wordle_ar", 1);
assert.equal(C("wordle_ar").controller.validateFree(s, { id: "guess", payload: { word: "abcde" } }).ok, false);
assert.equal(C("wordle_ar").controller.validateFree(s, { id: "guess", payload: { word: "مدرس" } }).ok, false, "4 حروف");
// الثيران والأبقار: رقم بأرقام مكررة مرفوض
s = init("bulls_cows");
assert.equal(C("bulls_cows").controller.validateFree(s, { id: "guess", payload: { code: "1123" } }).ok, false);
// سباق الحروف: كلمة خارج القاموس أو بحرف خطأ مرفوضة
s = init("letter_rush", 2, { lang: "en" });
assert.equal(C("letter_rush").controller.validateFree(s, { id: "word", payload: { w: "zzzzzz" } }).ok, false);

// 3) لا تسريب في العرض
const bsRoom = E.createRoom({ gameId: "battleship", chat: "leak@s.whatsapp.net", isGroup: false, host: { jid: A, name: "A" }, vsAI: true }).room;
const bsView = E.getView(bsRoom.roomId);
assert.ok(!bsView.board.cells.some((c) => c.k === "ship"), "لا سفن ظاهرة قبل النهاية");
assert.doesNotMatch(JSON.stringify(bsView), /"ships"|"cells":\[\d/, "View لا يحمل مواقع السفن");
const memRoom = E.createRoom({ gameId: "memory", chat: "leak2@s.whatsapp.net", isGroup: false, host: { jid: A, name: "A" }, vsAI: true }).room;
const memView = E.getView(memRoom.roomId);
assert.ok(memView.board.cells.every((c) => c.k === "hidden"), "الوجوه مخفية");
const quizRoom = E.createRoom({ gameId: "trivia_arena", chat: "leak3@s.whatsapp.net", isGroup: false, host: { jid: A, name: "A" } }).room;
const quizView = E.getView(quizRoom.roomId);
assert.doesNotMatch(JSON.stringify(quizView), /"answer":\s*\d|"qs"/, "الإجابة الصحيحة لا تظهر في العرض");
assert.ok(quizView.actions.filter((a) => a.id === "answer").length === 4, "الخيارات الأربعة كلها أزرار (لا تمييز للصحيح)");
const bcRoom = E.createRoom({ gameId: "bulls_cows", chat: "leak4@s.whatsapp.net", isGroup: false, host: { jid: A, name: "A" }, vsAI: true }).room;
assert.ok(!JSON.stringify(E.getView(bcRoom.roomId)).includes(bcRoom.game.secret), "الرقم السري لا يظهر");
const simonRoom = E.createRoom({ gameId: "simon", chat: "leak5@s.whatsapp.net", isGroup: false, host: { jid: A, name: "A" } }).room;
await E.applyAction({ gameId: "simon", sessionId: simonRoom.sessionId, actionId: "press", actor: E.idOf(A), nonce: simonRoom.nonce, payload: { c: simonRoom.game.seq[0] }, source: "button" });
assert.ok(E.getView(simonRoom.roomId).board.cells.slice(1).every((c) => c.k === "hidden"), "سايمون يخفي التتابع أثناء الإدخال");

console.log(`✅ terboo-arcade-games: ${finished}/${ids.length} لعبة لُعبت حتى النهاية · قواعد (جاذبية · أكل إجباري · قلب · كشف آمن · دمج · سودوكو · وردل · ثيران · حروف) · لا تسريب (سفن · بطاقات · إجابة · سر · تتابع)`);
process.exit(0);
