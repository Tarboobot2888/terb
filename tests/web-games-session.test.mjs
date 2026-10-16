// جلسات الألعاب من الويب: بدء لعبة جديدة يحلّ محلّ السابقة (لا already-in-room
// بلا مخرج)، والخصم الآلي يُطلب فقط لمن يدعمه، وكل لعبة قابلة للويب تبدأ فعلاً،
// وأسباب الرفض تُعاد برسالة مفهومة لا بـ«مدخل غير صالح».

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "terboo-games-"));
const { initWebStore } = await import("../src/web/store/web-store.js");
initWebStore(path.join(tmp, "web"));

const { createSession, leave, listGames, sessionState } = await import("../src/web/services/game-service.js");

const principal = {
  canonical: "pn:201000000077", sender: "201000000077@s.whatsapp.net",
  number: "201000000077", digits: "201000000077",
  isOwner: false, isPremium: false, isBanned: false,
};

const games = await listGames("ar");
const runnable = games.filter((game) => game.webRunnable);
assert.ok(runnable.length >= 20, `عدد الألعاب القابلة للويب غير منطقي: ${runnable.length}`);

// ── 1. كل لعبة قابلة للويب تبدأ فعلاً بالخصم الذي تدعمه ──
const failures = [];
for (const game of runnable) {
  try {
    const view = await createSession({ principal, gameId: game.id, vsAI: game.supportsAI, lang: "ar" });
    assert.equal(view.gameId, game.id);
    assert.ok(view.roomId, `${game.id}: بلا معرّف غرفة`);
    // الخصم الآلي يظهر فقط حين تدعمه اللعبة
    const hasAI = view.players.some((player) => player.isAI);
    if (!game.supportsAI) assert.equal(hasAI, false, `${game.id}: خصم آلي في لعبة لا تدعمه`);
  } catch (error) {
    failures.push(`${game.id}: ${error.details?.reason || error.code}`);
  }
}
assert.deepEqual(failures, [], `ألعاب تعذّر بدؤها:\n${failures.join("\n")}`);

// ── 2. البدء المتتالي بلا «مغادرة» لا يُرفض (الغرفة السابقة تُستبدَل) ──
const first = await createSession({ principal, gameId: "xo", vsAI: true, lang: "ar" });
const second = await createSession({ principal, gameId: "connect4", vsAI: true, lang: "ar" });
assert.notEqual(second.roomId, first.roomId, "لعبة جديدة ⇒ غرفة جديدة");
// الغرفة الأولى انتهت (تبقى مقروءة كسجلّ، لكنها لم تعد تمنع البدء)
const previous = await sessionState({ principal, roomId: first.roomId, lang: "ar" });
assert.ok(["FINISHED", "CANCELLED", "EXPIRED"].includes(previous.state),
  `الغرفة السابقة ما زالت قائمة: ${previous.state}`);

// ── 3. طلب خصم آلي للعبة لا تدعمه ⇒ سبب ورسالة مفهومة ──
const soloOnly = runnable.find((game) => !game.supportsAI);
if (soloOnly) {
  await assert.rejects(
    () => createSession({ principal, gameId: soloOnly.id, vsAI: true, lang: "ar" }),
    (error) => {
      assert.equal(error.code, "INVALID_INPUT");
      assert.equal(error.details?.reason, "ai-unsupported");
      assert.notEqual(error.message, "The request body or query is not valid.", "الرسالة العامة لا تفيد المستخدم");
      return true;
    },
  );
}

// ── 4. لعبة مجهولة ⇒ 404 ──
await assert.rejects(
  () => createSession({ principal, gameId: "no-such-game", vsAI: false, lang: "ar" }),
  (error) => error.code === "NOT_FOUND",
);

// ── 5. المغادرة تنهي الغرفة ──
const open = await createSession({ principal, gameId: "xo", vsAI: true, lang: "ar" });
const left = await leave({ principal, roomId: open.roomId });
assert.equal(left.left, true, "المغادرة تُنفَّذ فعلاً");
const closed = await sessionState({ principal, roomId: open.roomId, lang: "ar" });
assert.ok(["FINISHED", "CANCELLED", "EXPIRED"].includes(closed.state), `الغرفة لم تُغلَق: ${closed.state}`);

// ── 6. غرفة شخص آخر لا تُقرأ ──
const other = { ...principal, canonical: "pn:201000000078", sender: "201000000078@s.whatsapp.net", number: "201000000078", digits: "201000000078" };
const mine = await createSession({ principal, gameId: "xo", vsAI: true, lang: "ar" });
await assert.rejects(
  () => sessionState({ principal: other, roomId: mine.roomId, lang: "ar" }),
  (error) => error.code === "NOT_FOUND",
  "غرفة شخص لا تُقرأ بهوية غيره",
);

console.log(`✅ web-games-session: ${runnable.length} لعبة قابلة للويب بدأت كلها · استبدال الغرفة السابقة · الخصم الآلي بحسب الدعم · أسباب رفض مفهومة · ملكية الغرفة`);
process.exit(0);
