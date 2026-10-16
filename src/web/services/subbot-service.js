// ═══════════════════════════════════════════════
// 🤖 Terboo Web — البوتات الفرعية (عرض الحالة)
// ───────────────────────────────────────────────
// يستعمل terboo-jadibot-manager.js الحقيقي ولا ينشئ مديراً ثانياً.
// هذا الملف للعرض فقط؛ تنصيب بوت فرعي من الموقع في subbot-provision.js
// بتدفق محمي يسلّم الرمز للطالب الموثَّق وحده (لا QR ولا مسار اعتماد هنا).
// القائمة تعرض ما يملكه المستخدم فقط: الحالة ووقت التشغيل، بلا أي سرّ.
// ═══════════════════════════════════════════════

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
    // التنصيب متاح من الموقع عبر تدفق محمي (POST /subbots/pair)
    pairing: {
      availableInWeb: true,
      label: "TARBOOV6",
      targetsOwnNumberOnly: true,
    },
  };
}

export { mySubBots };
