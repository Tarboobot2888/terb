// ═══════════════════════════════════════════════
// 🛡️ OpenClaw — سياسة أدوات Terboo المعروضة للمحرّك
// ───────────────────────────────────────────────
// OpenClaw محرّك قادر على تنفيذ أوامر وأدوات. حدود هذا الجسر صريحة:
//   • منع افتراضي: لا أداة واحدة من Terboo متاحة لـOpenClaw إلا بإدراجها
//     صراحةً في config.openclaw.exposeTerbooTools.
//   • الأداة المُدرَجة يجب أن تكون موجودة فعلاً في السجل المركزي، وغير
//     مخصّصة للمالك، ولا تحتاج سياق واتساب — وإلا تُرفَض بسبب.
//   • صلاحية المستخدم تُفحَص عند كل نداء بمحرّك الصلاحيات نفسه، لا مرة واحدة
//     عند الإدراج: إدراج الأداة لا يمنح أحداً حقاً لا يملكه.
//   • لا تُمرَّر أدوات تنفيذ/ملفات/شِل إلى المحرّك من هنا إطلاقاً.
// ═══════════════════════════════════════════════

import { getTool } from "../../lib/terboo-tool-registry.js";
import { openclawConfig } from "./config.js";

/** أنواع لا تُعرَض أبداً حتى لو أُدرجت بالخطأ */
const NEVER_EXPOSE = Object.freeze(new Set(["group.members"]));

/** تصنيفات تنفيذية لا تُعرَض عبر الجسر */
const BLOCKED_KINDS = Object.freeze(new Set(["exec", "shell", "file", "ssh"]));

/**
 * يقيّم الأدوات المُدرَجة ويعيد المسموح منها مع سبب الرفض للباقي.
 * @returns {{allowed:Array<{id:string,kind:string,purpose:string}>, rejected:Array<{id:string,reason:string}>}}
 */
function toolPolicy() {
  const settings = openclawConfig();
  const allowed = [];
  const rejected = [];

  for (const raw of settings.exposeTerbooTools) {
    const id = String(raw || "").trim();
    if (!id) continue;
    if (NEVER_EXPOSE.has(id)) {
      rejected.push({ id, reason: "needs-whatsapp-context" });
      continue;
    }
    const tool = getTool(id);
    if (!tool) {
      rejected.push({ id, reason: "unknown-tool" });
      continue;
    }
    if (tool.permission === "owner") {
      rejected.push({ id, reason: "owner-only-tool-not-bridgeable" });
      continue;
    }
    if (BLOCKED_KINDS.has(String(tool.kind || ""))) {
      rejected.push({ id, reason: `blocked-kind:${tool.kind}` });
      continue;
    }
    allowed.push({ id: tool.id, kind: String(tool.kind || ""), purpose: String(tool.purpose || "").slice(0, 120) });
  }

  return { allowed, rejected };
}

/**
 * هل يجوز لـOpenClaw نداء هذه الأداة لهذا المستخدم الآن؟
 * الإدراج شرط لازم غير كاف: الصلاحية تُفحَص بالمحرّك نفسه عند كل نداء.
 */
function mayCallTool(principal, toolId) {
  const { allowed } = toolPolicy();
  if (!allowed.some((row) => row.id === toolId)) {
    return { allowed: false, reason: "not-exposed" };
  }
  const tool = getTool(toolId);
  if (!tool) return { allowed: false, reason: "unknown-tool" };
  if (tool.permission === "premium" && !(principal?.isPremium || principal?.isOwner)) {
    return { allowed: false, reason: "premium-only" };
  }
  if (principal?.isBanned) return { allowed: false, reason: "banned" };
  return { allowed: true, reason: "" };
}

export { BLOCKED_KINDS, NEVER_EXPOSE, mayCallTool, toolPolicy };
