// ═══════════════════════════════════════════════
// 🧪 TERBOO ARCADE — خصم الكمبيوتر + فهم الكلام الطبيعي
// ───────────────────────────────────────────────
// • حتمية: نفس الحالة + نفس البذرة ⇒ نفس الحركة · كل حركة قانونية لكل لعبة ولكل مستوى
// • XO خبير لا يخسر · يكمل الفوز ويسد التهديد · أربعة في صف يسد ويكمل
// • الكمبيوتر لا يرى أسرار الخصم (السفن · الرقم السري) · ذاكرة البطاقات حسب المستوى
// • لا نموذج لغوي في اختيار الحركة (فحص ثابت)
// • Intent Resolver: «عايز ألعب XO» · «ضد الكمبيوتر» · «مع أحمد» · «ابدأ» · «دوري؟» · «كمل» · «وقف» · «رجع» · «rematch» · «الترتيب»
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const { loadArcade, arcadeContracts } = await import("../src/lib/terboo-arcade/index.js");
await loadArcade();
const { games } = await import("../src/lib/terboo-games.js");
const { chooseMove, sameAction } = await import("../src/lib/terboo-arcade/ai.js");
const { seeded, serverRng } = await import("../src/lib/terboo-arcade/rng.js");
const { resolveGameIntent } = await import("../src/lib/terboo-arcade/intent.js");
await import("../plugins/game/خمن_العلم.js");

const C = (id) => games.contractOf(id);
const LEVELS = ["EASY", "NORMAL", "HARD", "EXPERT"];
const play = (c, state, action, actor) => {
  const next = structuredClone(state);
  const res = c.controller.apply(next, action, { actor, rng: serverRng });
  assert.notEqual(res?.ok, false, `${c.id}: حركة مرفوضة ${JSON.stringify(action)}`);
  return res?.state || next;
};
const init = (c, players = 2) => c.controller.init({ players, rng: seeded(`init:${c.id}`), options: { lang: "ar", difficulty: "NORMAL" }, seats: [] });

// 1) كل لعبة بخصم: حركة قانونية لكل مستوى + حتمية
let aiGames = 0;
for (const c of arcadeContracts().filter((x) => x.supportsAI)) {
  aiGames += 1;
  const state = init(c, c.players.min);
  const actor = c.controller.currentActor(state) ?? 0;
  for (const level of LEVELS) {
    const a = chooseMove(c, state, { actor, difficulty: level, seed: "s1" });
    const b = chooseMove(c, state, { actor, difficulty: level, seed: "s1" });
    assert.ok(a, `${c.id}/${level}: حركة`);
    assert.ok(sameAction(a, b), `${c.id}/${level}: حتمي`);
    const legal = c.controller.legalActions(state, actor);
    const isLegal = legal.some((x) => sameAction(x, a)) || (c.freeActions.includes(a.id) && c.controller.validateFree(state, a, actor)?.ok);
    assert.ok(isLegal, `${c.id}/${level}: قانونية`);
  }
}
assert.ok(aiGames >= 11, `ألعاب بخصم كمبيوتر: ${aiGames}`);

// 2) XO خبير: لا يخسر أمام لاعب عشوائي (المقعدان)
const xo = C("xo");
let losses = 0;
for (let g = 0; g < 30; g += 1) {
  const aiSeat = g % 2;
  const rnd = seeded(`rand${g}`);
  let s = init(xo);
  while (!xo.controller.status(s).over) {
    const turn = xo.controller.currentActor(s);
    const move = turn === aiSeat ? chooseMove(xo, s, { actor: turn, difficulty: "EXPERT", seed: `g${g}:${s.board.join()}` }) : rnd.pick(xo.controller.legalActions(s));
    s = play(xo, s, move, turn);
  }
  const st = xo.controller.status(s);
  if (st.winners.length && !st.winners.includes(aiSeat)) losses += 1;
}
assert.equal(losses, 0, "XO خبير لا يخسر");
// يكمل الفوز ويسد
let s = { board: [0, 0, null, 1, 1, null, null, null, null], turn: 0, last: null };
assert.equal(chooseMove(xo, s, { actor: 0, difficulty: "EXPERT" }).payload.cell, 2, "يكمل الفوز");
s = { board: [1, 1, null, 0, null, null, null, null, 0], turn: 0, last: null };
assert.equal(chooseMove(xo, s, { actor: 0, difficulty: "EXPERT" }).payload.cell, 2, "يسد التهديد");

// 3) أربعة في صف: يكمل ويسد
const c4 = C("connect4");
const empty = () => ({ board: Array(42).fill(null), turn: 0, last: null });
let b = empty();
for (const col of [0, 1, 2]) b.board[35 + col] = 0;
for (const col of [0, 1, 2]) b.board[28 + col] = 1;
assert.equal(chooseMove(c4, b, { actor: 0, difficulty: "HARD" }).payload.col, 3, "يكمل الأربعة");
b = empty();
for (const col of [0, 1, 2]) b.board[35 + col] = 1;
b.board[28 + 6] = 0;
b.board[35 + 6] = 0;
assert.equal(chooseMove(c4, b, { actor: 0, difficulty: "HARD" }).payload.col, 3, "يسد الأربعة");

// 4) أسرار: الكمبيوتر لا يقرأ السفن أو السر
const bs = C("battleship");
let st = init(bs);
const shots = new Set();
for (let k = 0; k < 40 && !bs.controller.status(st).over; k += 1) {
  const turn = st.turn;
  const mv = chooseMove(bs, st, { actor: turn, difficulty: "EXPERT", seed: `bs${k}` });
  if (turn === 1) {
    assert.ok(!shots.has(mv.payload.cell), "لا يكرر الطلقة");
    shots.add(mv.payload.cell);
  }
  st = play(bs, st, mv, turn);
}
const aiSrc = fs.readFileSync("src/lib/terboo-arcade/games/battleship.js", "utf8");
const chooseBody = aiSrc.slice(aiSrc.indexOf("choose(state, me"));
assert.doesNotMatch(chooseBody.split("},\n};")[0], /\.ships\b|\.cells\b/, "اختيار الطلقة لا يقرأ مواقع السفن");
const bc = C("bulls_cows");
const bcSrc = fs.readFileSync("src/lib/terboo-arcade/games/bulls_cows.js", "utf8");
assert.doesNotMatch(bcSrc.slice(bcSrc.indexOf("choose(state, me")), /state\.secret/, "الكمبيوتر لا يقرأ الرقم السري");
let bstate = init(bc);
let guesses = 0;
while (!bc.controller.status(bstate).over && guesses < 24) {
  const turn = bstate.turn;
  const mv = chooseMove(bc, bstate, { actor: turn, difficulty: "EXPERT", seed: `bc${guesses}` });
  bstate = play(bc, bstate, mv, turn);
  guesses += 1;
}
assert.ok(bstate.winner !== null && guesses <= 12, `بالاستنتاج فقط يكشف السر (${guesses} تخمين)`);

// 5) ذاكرة البطاقات: الخبير يكمل زوجاً رآه
const mem = C("memory");
const ms = init(mem);
const face = ms.cards[0];
const twin = ms.cards.findIndex((f, i) => i !== 0 && f === face);
ms.seen = { 0: face, [twin]: face };
assert.equal(chooseMove(mem, ms, { actor: 0, difficulty: "EXPERT" }).payload.i, Math.min(0, twin) === 0 ? 0 : twin, "يقلب الزوج المعروف");

// 6) المستويات تختلف فعلاً: الخبير ضد السهل في XO
let expertLosses = 0;
for (let g = 0; g < 20; g += 1) {
  let x = init(xo);
  while (!xo.controller.status(x).over) {
    const turn = x.turn;
    const level = turn === g % 2 ? "EXPERT" : "EASY";
    x = play(xo, x, chooseMove(xo, x, { actor: turn, difficulty: level, seed: `lv${g}:${x.board.join()}` }), turn);
  }
  const res = xo.controller.status(x);
  if (res.winners.length && !res.winners.includes(g % 2)) expertLosses += 1;
}
assert.equal(expertLosses, 0, "الخبير لا يخسر أمام السهل");

// 7) لا نموذج لغوي في اختيار الحركة
const aiCore = fs.readFileSync("src/lib/terboo-arcade/ai.js", "utf8");
assert.doesNotMatch(aiCore, /terboo-ai-|provider|fetch\(|axios/, "اختيار الحركة خوارزمي فقط");

// 8) Intent Resolver
const cases = [
  ["عايز ألعب XO", { intent: "play", gameId: "xo" }],
  ["عايز ألعب اكس او ضد الكمبيوتر", { intent: "play", gameId: "xo", vsAI: true }],
  ["يلا نلعب أربعة في صف صعب", { intent: "play", gameId: "connect4", difficulty: "HARD" }],
  ["العب داما مع أحمد", { intent: "play", gameId: "checkers", friend: "احمد" }],
  ["let's play reversi vs ai", { intent: "play", gameId: "reversi", vsAI: true }],
  ["quiero jugar ahorcado", { intent: "play", gameId: "hangman" }],
  ["العب ثعبان وسلم", { intent: "play", gameId: "snakes" }],
  // بعد الترحيل: ألعاب الأسئلة القديمة عقود أركيد (q_*). المعرّف القديم كان
  // يفشل في createRoom («unknown-game») لأنه عقد legacy؛ الآن يحل إلى لعبة قابلة للعب.
  ["العب خمن العلم", { intent: "play", gameId: "q_tebakbendera" }],
  ["هات الترتيب", { intent: "leaderboard" }],
  ["الالعاب", { intent: "menu" }],
];
for (const [text, want] of cases) {
  const got = resolveGameIntent(text);
  assert.ok(got, `نية: ${text}`);
  for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, `${text} ⇒ ${k}`);
}
// كلمات التحكم القصيرة تحتاج غرفة نشطة (لا تخطف «كمل» من المهام)
assert.equal(resolveGameIntent("كمل"), null, "«كمل» بلا غرفة ليست لعبة");
assert.equal(resolveGameIntent("كمل", { hasRoom: true, roomState: "PLAYING" }), null, "«كمل» فقط لغرفة متوقفة");
assert.equal(resolveGameIntent("كمل", { hasRoom: true, roomState: "PAUSED" }).intent, "resume");
assert.equal(resolveGameIntent("وقف", { hasRoom: true, roomState: "PLAYING" }).intent, "pause");
assert.equal(resolveGameIntent("ابدأ", { hasRoom: true, roomState: "READY" }).intent, "start");
assert.equal(resolveGameIntent("دوري؟", { hasRoom: true, roomState: "PLAYING" }).intent, "turn");
assert.equal(resolveGameIntent("رجع", { hasRoom: true, roomState: "PLAYING" }).intent, "board");
assert.equal(resolveGameIntent("اعمل rematch", { hasRoom: true, roomState: "FINISHED" }).intent, "rematch");
assert.equal(resolveGameIntent("العب كرة القدم الحقيقية"), null, "لعبة غير موجودة ⇒ لا تخمين");

console.log(`✅ terboo-arcade-ai: ${aiGames} ألعاب بخصم (4 مستويات قانونية وحتمية) · XO خبير بلا خسارة · سد/إكمال · لا قراءة أسرار · مستويات مختلفة · لا LLM · ${cases.length + 9} حالة نية`);
process.exit(0);
