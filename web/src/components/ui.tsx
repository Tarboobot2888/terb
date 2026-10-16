// عناصر مشتركة: حالات التحميل والفراغ والخطأ والتنبيهات والحوار
import type { ReactNode } from "react";
import { useApp } from "../lib/store";
import { useFocusTrap } from "../lib/hooks";

export function Loading({ rows = 3 }: { rows?: number }) {
  const { t } = useApp();
  return (
    <div className="stack" role="status" aria-live="polite">
      <span className="sr-only">{t("common.loading")}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span key={index} className="skeleton" style={{ height: 76, display: "block" }} />
      ))}
    </div>
  );
}

export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {body ? <p className="card__meta">{body}</p> : null}
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t, errorText } = useApp();
  const text = errorText(error);
  if (!text) return null;
  return (
    <div className="errorbox" role="alert">
      <strong>{t("common.error")}</strong>
      <p className="card__meta">{text}</p>
      {onRetry ? <button className="btn btn--ghost btn--sm" type="button" onClick={onRetry}>{t("common.retry")}</button> : null}
    </div>
  );
}

/** سبب التعطيل يُعرض دائماً: لا زر صامت */
export function Unavailable({ reason }: { reason: string }) {
  const { t, lang } = useApp();
  const known: Record<string, { ar: string; en: string }> = {
    "needs-whatsapp-group-context": { ar: "تحتاج سياق مجموعة على واتساب", en: "Needs a WhatsApp group context" },
    "handler-requires-serialized-whatsapp-message": { ar: "ينفَّذ من واتساب فقط: يحتاج رسالة حقيقية ومقبساً حياً", en: "WhatsApp only: needs a real message and a live socket" },
    "circuit-open": { ar: "المزوّد متعطّل مؤقتاً", en: "Provider temporarily unavailable" },
    "game-is-group-only": { ar: "هذه اللعبة للمجموعات فقط", en: "This game is group-only" },
    "engine-has-no-channel-neutral-action-protocol": { ar: "محرّك هذه اللعبة لا يملك بروتوكول إجراء محايد للقناة", en: "This game's engine has no channel-neutral action protocol" },
    "pairing-codes-and-qr-grant-full-account-control-and-stay-on-whatsapp": { ar: "رموز الاقتران تمنح تحكّماً كاملاً وتبقى على واتساب", en: "Pairing codes grant full control and stay on WhatsApp" },
    "you-are-not-a-group-admin": { ar: "لست مشرفاً في هذه المجموعة", en: "You are not an admin here" },
    "bot-is-not-a-group-admin": { ar: "البوت ليس مشرفاً في هذه المجموعة", en: "The bot is not an admin here" },
  };
  const hit = known[reason];
  return (
    <span className="chip chip--muted" title={reason}>
      {t("common.why")}: {hit ? (lang === "ar" ? hit.ar : hit.en) : reason}
    </span>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast${toast.kind === "error" ? " toast--error" : toast.kind === "success" ? " toast--success" : ""}`}>
          {toast.text}
        </div>
      ))}
    </div>
  );
}

/** حوار تأكيد — للأفعال المدمّرة التي يطلب الخادم تأكيدها */
export function Confirm({ open, title, body, confirmLabel, onConfirm, onCancel }: {
  open: boolean; title: string; body?: string; confirmLabel?: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  const { t } = useApp();
  const ref = useFocusTrap<HTMLDivElement>(open);
  if (!open) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={onCancel} />
      <div className="confirm card card--raised" ref={ref} role="dialog" aria-modal="true" aria-label={title}>
        <strong>{title}</strong>
        {body ? <p className="card__meta">{body}</p> : null}
        <div className="row row--between">
          <button className="btn btn--ghost" type="button" onClick={onCancel}>{t("common.cancel")}</button>
          <button className="btn btn--danger" type="button" onClick={onConfirm}>{confirmLabel || t("common.confirm")}</button>
        </div>
      </div>
    </>
  );
}

export function formatBytes(bytes: number | null | undefined): string {
  const value = Number(bytes || 0);
  if (!value) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let size = value;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size < 10 && index > 0 ? size.toFixed(1) : Math.round(size)} ${units[index]}`;
}

export function formatWhen(at: number | null | undefined, lang: string): string {
  if (!at) return "—";
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
      dateStyle: "short", timeStyle: "short", numberingSystem: "latn",
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace("T", " ");
  }
}
