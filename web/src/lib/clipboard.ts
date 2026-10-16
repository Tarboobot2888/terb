// ═══════════════════════════════════════════════
// نسخ نصّ يعمل على HTTP أيضاً
// ───────────────────────────────────────────────
// navigator.clipboard غير موجود إطلاقاً خارج «السياق الآمن» (HTTPS أو
// localhost). الموقع يُفتح على http://<ip>:3000 فكان زر النسخ يفشل دائماً
// ويظهر «تعذّر النسخ». لذلك:
//   ① نجرّب Clipboard API حين تكون متاحة فعلاً (HTTPS لاحقاً).
//   ② وإلا نرجع إلى execCommand("copy") على عنصر مؤقّت — مدعوم على HTTP.
//   ③ وإن فشل الاثنان نحدّد النصّ في الصفحة ليقدر المستخدم على نسخه يدوياً.
// ═══════════════════════════════════════════════

export type CopyOutcome = "clipboard" | "fallback" | "selected" | "failed";

/** يحدّد محتوى عنصر ليستطيع المستخدم نسخه يدوياً */
function selectNode(node: HTMLElement | null): boolean {
  if (!node || typeof window.getSelection !== "function") return false;
  try {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    if (!selection) return false;
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  } catch {
    return false;
  }
}

/** نسخ عبر عنصر مؤقّت خارج الشاشة (يعمل في السياق غير الآمن) */
function copyByExecCommand(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  // خارج الشاشة وغير قابل للتحرير بصرياً، لكنه قابل للتحديد
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(area);
  }
}

/**
 * ينسخ نصّاً ويعيد الطريقة التي نجحت.
 * @param fallbackNode عنصر يُحدَّد نصّه حين يتعذّر النسخ البرمجي
 */
export async function copyText(text: string, fallbackNode?: HTMLElement | null): Promise<CopyOutcome> {
  const value = String(text || "");
  if (!value) return "failed";

  // ① السياق الآمن فقط: الوجود نفسه هو الفحص الصحيح
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return "clipboard";
    } catch {
      // مرفوضة من المستخدم أو السياسة ⇒ نكمل إلى البديل
    }
  }

  // ② البديل المدعوم على HTTP
  if (copyByExecCommand(value)) return "fallback";

  // ③ آخر ما يمكن: تحديد النصّ ليُنسخ يدوياً
  return selectNode(fallbackNode ?? null) ? "selected" : "failed";
}
