// ═══════════════════════════════════════════════
// 🧪 TERBOO ARCADE — الأداء والذاكرة والتنظيف (100 / 500 / 1000 غرفة)
// ───────────────────────────────────────────────
// لكل حجم: إنشاء غرف (نصفها جماعي بلاعبين ونصفها ضد الكمبيوتر) · حركات حقيقية عبر applyAction
// · View لكل غرفة · ثم انتهاء المهل والتنظيف ⇒ كل الغرف تُزال والفهارس تفرغ (لا تسرّب).
// الأرقام المطبوعة مقاسة في هذا التشغيل (لا أرقام مكتوبة مسبقاً).
// ═══════════════════════════════════════════════

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.on("uncaughtException", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error("❌ فشل الاختبار:", e?.stack || e); process.exit(1); });

const { loadArcade } = await import("../src/lib/terboo-arcade/index.js");
await loadArcade();
const E = await import("../src/lib/terboo-arcade/engine.js");
const { memoryRepository } = await import("../src/lib/terboo-arcade/repository.js");

const results = [];
const mb = () => Math.round(process.memoryUsage().heapUsed / 1048576);

for (const size of [100, 500, 1000]) {
  E._reset();
  E.configure({ repository: memoryRepository(), wallet: { credit() {} } });
  global.gc?.();
  const heap0 = mb();
  const t0 = performance.now();
  const rooms = [];
  for (let i = 0; i < size; i += 1) {
    const a = `2019${String(size).padStart(4, "0")}${String(i).padStart(5, "0")}@s.whatsapp.net`;
    if (i % 2) {
      rooms.push(E.createRoom({ gameId: "xo", chat: a, isGroup: false, host: { jid: a, name: "P" }, vsAI: true, difficulty: "NORMAL" }).room);
    } else {
      const b = `2018${String(size).padStart(4, "0")}${String(i).padStart(5, "0")}@s.whatsapp.net`;
      const r = E.createRoom({ gameId: "connect4", chat: `1203630${size}${i}@g.us`, isGroup: true, host: { jid: a, name: "A" } });
      E.joinRoom(r.room.roomId, { jid: b, name: "B" });
      rooms.push(r.room);
    }
  }
  const tCreate = performance.now() - t0;
  // حركة حقيقية في كل غرفة + View
  const t1 = performance.now();
  for (const room of rooms) {
    const seat = room.game.turn;
    const actor = room.players[seat];
    const legal = E.getView(room.roomId).actions;
    const pick = legal[0];
    const res = await E.applyAction({ gameId: room.gameId, sessionId: room.sessionId, actionId: pick.id, actor: actor.id, nonce: room.nonce, payload: pick.payload ?? null, source: "button" });
    assert.equal(res.ok, true, `${room.gameId}: ${res.code}`);
  }
  const tActions = performance.now() - t1;
  const live = E.stats();
  assert.equal(live.rooms, size, "كل الغرف حية");
  const heapPeak = mb();
  // انتهاء المهل ⇒ إنهاء · ثم بعد مهلة العرض ⇒ إزالة كاملة
  const t2 = performance.now();
  E.sweep(Date.now() + 40 * 60 * 1000);
  E.sweep(Date.now() + 120 * 60 * 1000);
  const tSweep = performance.now() - t2;
  const after = E.stats();
  assert.equal(after.rooms, 0, "التنظيف أزال كل الغرف");
  assert.equal(after.chats, 0, "فهرس الدردشات فارغ");
  assert.equal(after.players, 0, "فهرس اللاعبين فارغ");
  assert.equal(after.locks, 0, "لا أقفال عالقة");
  const perAction = tActions / size;
  assert.ok(perAction < 50, `متوسط الحركة (مع رد الكمبيوتر) ${perAction.toFixed(2)}ms`);
  results.push({ size, createMs: Math.round(tCreate), actionsMs: Math.round(tActions), perActionMs: Number(perAction.toFixed(2)), sweepMs: Math.round(tSweep), heapStartMb: heap0, heapPeakMb: heapPeak });
}

const out = path.join(process.cwd(), "docs", "arcade", "performance.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), node: process.version, results }, null, 2));
console.log(`✅ terboo-arcade-performance: ${results.map((r) => `${r.size} غرفة: إنشاء ${r.createMs}ms · حركات ${r.actionsMs}ms (${r.perActionMs}ms/حركة) · تنظيف ${r.sweepMs}ms · heap ${r.heapPeakMb}MB`).join(" | ")} · كل الفهارس فارغة بعد التنظيف`);
process.exit(0);
