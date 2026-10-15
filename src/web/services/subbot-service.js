// ═══════════════════════════════════════════════
// 🤖 Terboo Web — البوتات الفرعية (قراءة فقط من الموقع)
// ───────────────────────────────────────────────
// يستعمل terboo-jadibot-manager.js الحقيقي ولا ينشئ مديراً ثانياً.
//
// قرار أمني صريح: الموقع **لا** يبدأ اقتراناً ولا ينشئ جلسة فرعية.
//   الاقتران يُنتج رمز QR أو رمز اقتران يمنح تحكّماً كاملاً بحساب واتساب،
//   وبثّه عبر HTTP يجعل سرقة الجلسة ممكنة بجلسة موقع مخترقة وحدها.
//   startJadibot(sock, m, …) يحتاج أصلاً رسالة ومقبساً حيَّين ليسلّم الرمز
//   في محادثة المالك — وهذا هو المسار الآمن ويبقى على واتساب.
// فالموقع يعرض ما يملكه المستخدم فقط: الحالة ووقت التشغيل، بلا QR ولا
// رمز اقتران ولا مسار ملف اعتماد ولا أي جزء منه.
// ═══════════════════════════════════════════════

import { apiError } from "../errors.js";
import { maskPhone } from "./identity-service.js";

/** جلسات هذا المستخدم فقط، بحسب ownerJid الموثوق في المدير */
async function mySubBots(principal) {
  const manager = await import("../../lib/terboo-jadibot-manager.js");
  const { identityOf } = await import("../../lib/terboo-identity.js");

  const rows = [];
  for (const session of manager.getAllJadibotSessions()) {
    const live = manager.getJadibotStatus(session.jid);
    // الملكية: ownerJid من المدير وحده. غير معروف ⇒ لا يُعرض لأحد.
    const ownerId = live?.ownerJid ? identityOf(live.ownerJid) : null;
    const owned = Boolean(ownerId?.canonical && ownerId.canonical === principal.canonical);
    if (!owned && !principal.isOwner) continue;
    rows.push({
      // مرجع مُقنَّع: يكفي للعرض ولا يكشف الرقم الكامل
      ref: maskPhone(String(session.id || "").replace(/\D/g, "")),
      active: Boolean(session.isActive),
      status: live?.status || (session.isActive ? "active" : "stopped"),
      startedAt: live?.startedAt || null,
      uptimeMs: live?.uptime || null,
      mine: owned,
      // ما لا يغادر الخادم أبداً
      credentialsExposed: false,
    });
  }
  return {
    subBots: rows,
    // الحقيقة المعروضة في الواجهة بدل زر لا يعمل
    pairing: {
      availableInWeb: false,
      reason: "pairing-codes-and-qr-grant-full-account-control-and-stay-on-whatsapp",
    },
  };
}

/** أي محاولة اقتران من الموقع تُرفض صريحاً */
function pairingNotAvailable() {
  throw apiError("NOT_AVAILABLE_IN_WEB", {
    message: "Pairing a sub-bot is done in your WhatsApp chat with Bot Terboo, where the code is delivered privately.",
    details: { reason: "pairing-stays-on-whatsapp" },
  });
}

export { mySubBots, pairingNotAvailable };
