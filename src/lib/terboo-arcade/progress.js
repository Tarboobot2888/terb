// ═══════════════════════════════════════════════
// 🏆 TERBOO ARCADE — المكافآت · الإحصاءات · الترتيب · الإنجازات
// ───────────────────────────────────────────────
// • تُصرف فقط من finish() داخل المحرك بعد status() من منطق الخادم (لا من العميل أبداً).
// • idempotent: مفتاح sessionId:playerId في سجل المكافآت — إعادة الإنهاء لا تصرف مرتين.
// • ضد الاستغلال: حد يومي لكل لاعب/لعبة، ومعامل أقل ضد الكمبيوتر السهل.
// • الإنجازات من بيانات (src/data/arcade/achievements.json) لا من كود.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { getDatabase } from "../terboo-database.js";
import { noteFailure } from "../terboo-failure-log.js";

const DAILY_CAP = 25;
const AI_FACTOR = Object.freeze({ EASY: 0.25, NORMAL: 0.5, HARD: 0.8, EXPERT: 1 });
const POINTS = Object.freeze({ win: 3, draw: 1, loss: 0, solo: 2 });

let achievementsCache = null;
function achievements() {
  if (achievementsCache) return achievementsCache;
  try {
    const file = path.join(process.cwd(), "src", "data", "arcade", "achievements.json");
    achievementsCache = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    noteFailure("arcade-progress", error, { where: "terboo-arcade/progress:achievements", stage: "read", fallback: "no-achievements" });
    achievementsCache = [];
  }
  return achievementsCache;
}

/** محفظة البوت الحقيقية (نفس دوال القاعدة) — قابلة للحقن في الاختبارات */
function dbWallet() {
  return {
    credit(jid, { koin = 0, exp = 0, energi = 0 }) {
      const db = getDatabase();
      if (koin > 0) db.updateKoin(jid, koin);
      if (energi > 0) db.updateEnergi(jid, energi);
      if (exp > 0) db.updateExp(jid, exp);
    },
  };
}

function outcomeOf(contract, outcome, index) {
  if (contract.mode === "solo" || contract.mode === "coop") return outcome.winners?.includes(index) ? "solo" : "loss";
  if (outcome.draw || !outcome.winners?.length) return "draw";
  return outcome.winners.includes(index) ? "win" : "loss";
}

function scaled(base, factor) {
  const out = {};
  for (const [k, v] of Object.entries(base || {})) out[k] = Math.max(0, Math.round((Number(v) || 0) * factor));
  return out;
}

function evaluateAchievements(stats) {
  const earned = [];
  const has = new Set(stats.achievements || []);
  for (const a of achievements()) {
    if (has.has(a.id)) continue;
    const r = a.rule || {};
    let value = 0;
    if (r.type === "played") value = stats.total.played;
    else if (r.type === "won") value = stats.total.won;
    else if (r.type === "streak") value = stats.total.best;
    else if (r.type === "distinctGames") value = Object.keys(stats.games).length;
    else if (r.type === "gameWins") value = stats.games[r.game]?.won || 0;
    else if (r.type === "aiWins") value = stats.aiWins?.[r.difficulty] || 0;
    else if (r.type === "categoryWins") value = stats.categories?.[r.category] || 0;
    if (value >= (r.gte || 1)) earned.push(a);
  }
  return earned;
}

/**
 * يسجّل نتيجة جلسة منتهية: مكافآت idempotent + إحصاءات + ترتيب + إنجازات.
 * @returns {Array<{playerId, result, reward, points, achievements, duplicate?}>}
 */
function settle({ contract, room, outcome, repo, wallet = dbWallet(), now = Date.now() }) {
  const aiPlayer = room.players.find((p) => p.isAI);
  const factor = aiPlayer ? AI_FACTOR[aiPlayer.difficulty] ?? AI_FACTOR.NORMAL : 1;
  const results = [];
  room.players.forEach((player, index) => {
    if (player.isAI) return;
    const key = `${room.sessionId}:${player.id}`;
    const result = outcomeOf(contract, outcome, index);
    if (!repo.ledgerAdd(key)) {
      results.push({ playerId: player.id, result, duplicate: true });
      return;
    }
    // مكافأة العملة (بحد يومي) — الإحصاءات تُسجّل دائماً
    let reward = {};
    const dailyKey = `${player.id}:${contract.id}`;
    const policy = contract.rewardPolicy?.[result];
    if (policy && repo.dailyCount(dailyKey, now) < DAILY_CAP) {
      reward = scaled(policy, factor);
      repo.bumpDaily(dailyKey, now);
      try {
        wallet.credit(player.jid, reward);
      } catch (error) {
        noteFailure("arcade-progress", error, { where: "terboo-arcade/progress:settle", stage: "wallet.credit", fallback: "reward-skipped" });
        reward = {};
      }
    }
    const won = result === "win" || result === "solo";
    const points = Math.round(POINTS[result] * (aiPlayer ? factor : 1));
    repo.addScore(contract.id, { id: player.id, name: player.name, won }, points, now);

    const stats = repo.getStats(player.id) || { total: { played: 0, won: 0, lost: 0, draw: 0, streak: 0, best: 0 }, games: {}, categories: {}, aiWins: {}, achievements: [] };
    const g = (stats.games[contract.id] ||= { played: 0, won: 0, lost: 0, draw: 0 });
    stats.total.played += 1;
    g.played += 1;
    if (won) {
      stats.total.won += 1;
      g.won += 1;
      stats.total.streak += 1;
      stats.total.best = Math.max(stats.total.best, stats.total.streak);
      stats.categories[contract.category] = (stats.categories[contract.category] || 0) + 1;
      if (aiPlayer) stats.aiWins[aiPlayer.difficulty] = (stats.aiWins[aiPlayer.difficulty] || 0) + 1;
    } else if (result === "draw") {
      stats.total.draw += 1;
      g.draw += 1;
    } else {
      stats.total.lost += 1;
      g.lost += 1;
      stats.total.streak = 0;
    }
    const earned = evaluateAchievements(stats);
    stats.achievements = [...(stats.achievements || []), ...earned.map((a) => a.id)];
    repo.setStats(player.id, stats);
    results.push({ playerId: player.id, jid: player.jid, result, reward, points, achievements: earned });
  });
  return results;
}

export { AI_FACTOR, DAILY_CAP, POINTS, achievements, dbWallet, evaluateAchievements, settle };
