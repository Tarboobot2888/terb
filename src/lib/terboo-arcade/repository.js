// ═══════════════════════════════════════════════
// 🗄️ TERBOO ARCADE — Repository Adapter
// ───────────────────────────────────────────────
// المحرك لا يلمس التخزين مباشرة: كل حفظ (غرف · سجل المكافآت · الترتيب · الإحصاءات
// · الإنجازات · التحليلات) يمر من واجهة واحدة لها تنفيذان:
//   memoryRepository()  — للاختبارات/التشغيل بلا قاعدة
//   dbRepository(db)    — نفس قاعدة البوت (settings: arcade:*) بحفظ ذرّي من القاعدة
// التحليلات بلا معرّفات مستخدمين (عدّادات لكل لعبة فقط).
// ═══════════════════════════════════════════════

import { getDatabase } from "../terboo-database.js";
import { noteFailure } from "../terboo-failure-log.js";

const LEDGER_LIMIT = 20000;

/** مفتاح الأسبوع ISO (YYYY-Www) والشهر (YYYY-MM) */
function periodKeys(at = Date.now()) {
  const d = new Date(at);
  const month = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return { week: `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`, month, day: d.toISOString().slice(0, 10) };
}

function emptyState() {
  return { rooms: {}, ledger: [], boards: {}, stats: {}, analytics: {}, daily: {} };
}

/** منطق مشترك فوق كائن حالة واحد (state) و persist() */
function baseRepository(state, persist) {
  const ledgerSet = new Set(state.ledger);
  let timer = null;
  const schedule = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      persist();
    }, 400);
    timer.unref?.();
  };
  return {
    kind: "base",
    loadRooms: () => Object.values(state.rooms || {}),
    saveRoom(room) {
      state.rooms[room.roomId] = room;
      schedule();
    },
    deleteRoom(roomId) {
      if (state.rooms[roomId]) {
        delete state.rooms[roomId];
        schedule();
      }
    },
    ledgerHas: (key) => ledgerSet.has(key),
    ledgerAdd(key) {
      if (ledgerSet.has(key)) return false;
      ledgerSet.add(key);
      state.ledger.push(key);
      if (state.ledger.length > LEDGER_LIMIT) {
        const drop = state.ledger.splice(0, state.ledger.length - LEDGER_LIMIT);
        for (const old of drop) ledgerSet.delete(old);
      }
      schedule();
      return true;
    },
    /** عدّاد يومي (حد مكافآت مكافحة الاستغلال) */
    bumpDaily(key, at = Date.now()) {
      const day = periodKeys(at).day;
      if (!state.daily[day]) state.daily = { [day]: {} };
      state.daily[day][key] = (state.daily[day][key] || 0) + 1;
      schedule();
      return state.daily[day][key];
    },
    dailyCount(key, at = Date.now()) {
      return state.daily[periodKeys(at).day]?.[key] || 0;
    },
    addScore(gameId, player, points, at = Date.now()) {
      const keys = periodKeys(at);
      const board = (state.boards[gameId] ||= { all: {}, week: {}, month: {} });
      const bump = (bucket) => {
        const row = (bucket[player.id] ||= { name: player.name || "", points: 0, wins: 0, games: 0 });
        row.name = player.name || row.name;
        row.points += points;
        row.games += 1;
        if (player.won) row.wins += 1;
      };
      bump(board.all);
      if (board.week.key !== keys.week) board.week = { key: keys.week, rows: {} };
      if (board.month.key !== keys.month) board.month = { key: keys.month, rows: {} };
      bump(board.week.rows);
      bump(board.month.rows);
      schedule();
    },
    top(gameId, period = "all", limit = 10, at = Date.now()) {
      const keys = periodKeys(at);
      const collect = (id) => {
        const board = state.boards[id];
        if (!board) return {};
        if (period === "week") return board.week?.key === keys.week ? board.week.rows : {};
        if (period === "month") return board.month?.key === keys.month ? board.month.rows : {};
        return board.all || {};
      };
      const merged = {};
      for (const id of gameId ? [gameId] : Object.keys(state.boards)) {
        for (const [pid, row] of Object.entries(collect(id))) {
          const m = (merged[pid] ||= { id: pid, name: row.name, points: 0, wins: 0, games: 0 });
          m.points += row.points;
          m.wins += row.wins;
          m.games += row.games;
          m.name = row.name || m.name;
        }
      }
      return Object.values(merged).sort((a, b) => b.points - a.points || b.wins - a.wins || a.games - b.games).slice(0, limit);
    },
    getStats: (playerId) => state.stats[playerId] || null,
    setStats(playerId, stats) {
      state.stats[playerId] = stats;
      schedule();
    },
    bumpAnalytics(gameId, field, amount = 1) {
      const row = (state.analytics[gameId] ||= {});
      row[field] = (row[field] || 0) + amount;
      schedule();
    },
    analytics: () => JSON.parse(JSON.stringify(state.analytics)),
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      persist();
    },
  };
}

function memoryRepository() {
  const repo = baseRepository(emptyState(), () => {});
  repo.kind = "memory";
  return repo;
}

/** نفس قاعدة البوت: مفتاح إعدادات واحد arcade:state (حفظ القاعدة ذرّي) */
function dbRepository(db = getDatabase()) {
  const stored = db.setting("arcade:state");
  const state = { ...emptyState(), ...(stored && typeof stored === "object" ? stored : {}) };
  const repo = baseRepository(state, () => {
    try {
      db.setting("arcade:state", state);
    } catch (error) {
      noteFailure("arcade-repo", error, { where: "terboo-arcade/repository:persist", stage: "db.setting", fallback: "memory-only-until-next-save" });
    }
  });
  repo.kind = "db";
  return repo;
}

/** القاعدة إن كانت مهيّأة، وإلا الذاكرة */
function defaultRepository() {
  try {
    return dbRepository(getDatabase());
  } catch (error) {
    noteFailure("arcade-repo", error, { where: "terboo-arcade/repository:default", stage: "getDatabase", fallback: "memory" });
    return memoryRepository();
  }
}

export { dbRepository, defaultRepository, memoryRepository, periodKeys };
