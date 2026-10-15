// ═══════════════════════════════════════════════
// 🎮 TERBOO ARCADE — تحميل ألعاب المحرك في السجل الوحيد (games)
// ───────────────────────────────────────────────
// كل ملف في terboo-arcade/games/*.js يصدّر تعريف لعبة (default) ⇒ defineGame ⇒ games.registerGame.
// لا سجل موازٍ: games.contracts() يعرض ألعاب الأركيد + ألعاب الأسئلة القديمة معاً.
// ═══════════════════════════════════════════════

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { games } from "../terboo-games.js";
import { noteFailure } from "../terboo-failure-log.js";
import { migrateLegacyQuizzes } from "./legacy-quiz.js";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "games");
let loading = null;

let legacyReport = { migrated: [], skipped: [] };
/** حجم سجل الأسئلة القديم عند آخر ترحيل — الحارس الرخيص لمنع إعادة العمل */
let legacySeen = -1;

async function loadArcade() {
  if (loading) return loading;
  loading = (async () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".js") && !f.startsWith("_")).sort();
    const loaded = [];
    for (const file of files) {
      try {
        const mod = await import(pathToFileURL(path.join(DIR, file)).href);
        if (mod.default) loaded.push(games.registerGame(mod.default).id);
      } catch (error) {
        noteFailure("arcade", error, { where: "terboo-arcade/index:loadArcade", stage: file, fallback: "game-skipped" });
      }
    }
    // ألعاب الأسئلة القديمة: تُرحَّل إلى نفس العقد ونفس محرك الأسئلة (لا سجل موازٍ).
    // تسجيلها يحدث وقت تحميل بلوقناتها، فقد يكون السجل فارغاً هنا ⇒ الترحيل كسول
    // عبر ensureLegacyQuizzes() ويُعاد فقط إن كبر السجل.
    loaded.push(...ensureLegacyQuizzes().migrated);
    return loaded;
  })();
  return loading;
}

/**
 * يرحّل أي لعبة أسئلة قديمة سُجّلت ولم تُرحَّل بعد. غير مكلف عند عدم التغيّر:
 * مقارنة حجم السجل فقط. يُستدعى من كل مدخل يعدّ العقود أو يحلّ أمر لعبة.
 */
function ensureLegacyQuizzes() {
  if (games.registry.size === legacySeen) return legacyReport;
  legacySeen = games.registry.size;
  try {
    const run = migrateLegacyQuizzes(games);
    legacyReport = {
      migrated: [...new Set([...legacyReport.migrated, ...run.migrated])],
      skipped: run.skipped,
    };
  } catch (error) {
    noteFailure("arcade", error, { where: "terboo-arcade/index:ensureLegacyQuizzes", stage: "migrate", fallback: "legacy-text-path" });
  }
  return legacyReport;
}

/** تقرير ترحيل ألعاب الأسئلة القديمة (يُستخدم في التدقيق والتقارير المولّدة) */
function legacyQuizReport() {
  ensureLegacyQuizzes();
  return { migrated: [...legacyReport.migrated], skipped: legacyReport.skipped.map((x) => ({ ...x })) };
}

/** عقود الأركيد فقط — تشمل ألعاب الأسئلة المُرحَّلة (كلها عقود أركيد الآن) */
function arcadeContracts() {
  ensureLegacyQuizzes();
  return [...games.arcade.values()];
}

export { arcadeContracts, ensureLegacyQuizzes, games, legacyQuizReport, loadArcade };
