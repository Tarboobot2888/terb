// ═══════════════════════════════════════════════
// 🎮 TERBOO ARCADE — نقطة الدخول الواحدة لكل ألعاب المحرك الموحّد
// ───────────────────────────────────────────────
// .اركيد                       قائمة الأقسام
// .اركيد cat <قسم>              ألعاب القسم
// .اركيد info <لعبة>            بطاقة تفاصيل اللعبة
// .اركيد play <لعبة> [ai] [EASY|NORMAL|HARD|EXPERT] [@صديق]
// .اركيد <لعبة> ...             اختصار لـ play
// .اركيد a <غرفة> <nonce> <n>   زر حركة (يولّده المحرك فقط)
// .اركيد join|start|leave|surrender|pause|resume|rematch|board|accept|decline <غرفة>
// .اركيد top [لعبة] [week|month] · .اركيد stats
// كل الحركات تمر من engine.applyAction (تحقق الدور · القانونية · nonce · المكافآت من الخادم).
// ═══════════════════════════════════════════════

import { loadArcade } from "../../src/lib/terboo-arcade/index.js";
import * as engine from "../../src/lib/terboo-arcade/engine.js";
import { arcadeCommand } from "../../src/lib/terboo-arcade/commands.js";
import { arcadeAnswer } from "../../src/lib/terboo-arcade/whatsapp.js";
import { getDatabase } from "../../src/lib/terboo-database.js";

await loadArcade();
engine.startSweeper();

const pluginConfig = {
  name: "اركيد",
  alias: ["arcade", "terbooarcade"],
  category: "game",
  description: "TERBOO ARCADE: كل الألعاب بلوحات مرئية وأزرار وخصم كمبيوتر وترتيب",
  usage: ".اركيد [لعبة] [ai|@صديق]",
  example: ".اركيد xo ai",
  isOwner: false,
  isPremium: false,
  isGroup: false,
  isPrivate: false,
  cooldown: 2,
  energi: 0,
  isEnabled: true,
};

async function handler(m, { sock }) {
  return arcadeCommand(m, sock);
}

/** الحركات المكتوبة (رد/نص) لكل ألعاب الأركيد */
async function answerHandler(m, sock) {
  // المجموعة عطّلت الألعاب (.العاب إيقاف) ⇒ لا حركات لغير المشرفين
  const group = m.isGroup ? getDatabase().getGroup?.(m.chat) : null;
  if (group && group.game === false && !m.isAdmin) return false;
  return arcadeAnswer(m, sock);
}

export { pluginConfig as config, handler, answerHandler };
