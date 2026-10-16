// شاشة الافتتاح: قصيرة ومقصودة، لا تمنع الدخول، وتُحترم فيها تقليل الحركة
import { useEffect, useState } from "react";
import { useApp } from "../lib/store";
import { useReducedMotion } from "../lib/hooks";

export function Splash({ onDone }: { onDone: () => void }) {
  const { t } = useApp();
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    // بلا حركة ⇒ لا انتظار إطلاقاً
    if (reduced) { onDone(); return; }
    const out = setTimeout(() => setLeaving(true), 1150);
    const done = setTimeout(onDone, 1550);
    return () => { clearTimeout(out); clearTimeout(done); };
  }, [reduced, onDone]);

  // الضغط أو أي مفتاح يتخطّى الشاشة فوراً
  useEffect(() => {
    const skip = () => onDone();
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("pointerdown", skip, { once: true });
    return () => {
      window.removeEventListener("keydown", skip);
      window.removeEventListener("pointerdown", skip);
    };
  }, [onDone]);

  return (
    <div className={`splash${leaving ? " splash--out" : ""}`} role="status" aria-live="polite">
      <div className="splash__halo" aria-hidden="true" />
      <div className="splash__body">
        <img className="splash__mark" src="/brand/terboo.png" alt="" width={96} height={72} />
        <div className="splash__slash" aria-hidden="true" />
        <div className="splash__name">BOT TERBOO</div>
        <div className="splash__tag">{t("splash.tagline")}</div>
      </div>
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
