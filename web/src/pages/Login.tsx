// ═══════════════════════════════════════════════
// تسجيل الدخول: رقم ⇒ رمز من محادثة واتساب ⇒ جلسة
// ───────────────────────────────────────────────
// • لا يُقال «أُرسل الرمز» إلا إذا رد الخادم بنجاح فعلي.
// • الأخطاء لا تكشف وجود الحساب: نُظهر نص الخادم كما هو.
// • حقل الرمز صديق للصق، يعمل بالكيبورد، وله عدّاد انتهاء وتهدئة إعادة إرسال.
// ═══════════════════════════════════════════════
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useCountdown } from "../lib/hooks";
import { COUNTRIES } from "../lib/countries";

type Challenge = { challengeId: string; expiresInSeconds: number; resendAfterSeconds: number };

export function Login() {
  const { t, lang, errorText, signedIn, notify } = useApp();
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [dial, setDial] = useState("+20");
  const [local, setLocal] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  const expiresIn = useCountdown(challenge?.expiresInSeconds ?? 0);
  const resendIn = useCountdown(challenge?.resendAfterSeconds ?? 0);
  const expired = Boolean(challenge) && expiresIn <= 0;

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  const phone = `${dial}${local.replace(/[^\d]/g, "")}`;
  const phoneLooksUsable = local.replace(/[^\d]/g, "").length >= 6;

  const request = useCallback(async (resend = false) => {
    setBusy(true);
    setError("");
    try {
      const out = await api.post<Challenge>("/auth/otp/request", { phone, lang });
      setChallenge(out);
      setStep("code");
      if (resend) {
        setCode("");
        notify(t("login.send"), "success");
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }, [phone, lang, errorText, notify, t]);

  const verify = useCallback(async () => {
    if (!challenge) return;
    setBusy(true);
    setError("");
    try {
      const out = await api.post<{ csrfToken: string; newAccount: boolean }>("/auth/otp/verify", {
        challengeId: challenge.challengeId,
        code: code.replace(/[^\d]/g, ""),
      });
      await signedIn(out.csrfToken);
    } catch (cause) {
      setError(errorText(cause));
      setCode("");
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  }, [challenge, code, errorText, signedIn]);

  const onCodeChange = (value: string) => {
    // صديق للصق: يقبل «123 456» و«123-456»
    setCode(value.replace(/[^\d]/g, "").slice(0, 6));
  };

  return (
    <main className="auth" id="main">
      <div className="auth__panel card card--raised">
        <div className="auth__head">
          <img className="logo__mark" src="/brand/terboo.png" alt="" width={34} height={34} />
          <div>
            <h1 className="auth__title">{t("login.title")}</h1>
            <p className="card__meta">{t("login.subtitle")}</p>
          </div>
        </div>

        {step === "phone" ? (
          <form
            className="stack"
            onSubmit={(event) => { event.preventDefault(); if (phoneLooksUsable && !busy) void request(); }}
          >
            <div className="field">
              <label className="field__label" htmlFor="dial">{t("login.phone")}</label>
              <div className="auth__phone">
                <select
                  id="dial"
                  className="select auth__dial"
                  value={dial}
                  onChange={(event) => setDial(event.target.value)}
                  aria-label={t("login.phone")}
                >
                  {COUNTRIES.map((country) => (
                    <option key={country.code} value={country.dial}>
                      {country.flag} {country.dial} {lang === "ar" ? country.ar : country.en}
                    </option>
                  ))}
                </select>
                <input
                  className="input num"
                  inputMode="tel"
                  autoComplete="tel-national"
                  placeholder="1012345678"
                  value={local}
                  onChange={(event) => setLocal(event.target.value)}
                  aria-invalid={Boolean(error) || undefined}
                  aria-describedby="phone-hint"
                />
              </div>
              <p className="field__hint" id="phone-hint">{t("login.phoneHint")}</p>
              {error ? <p className="field__error" role="alert">{error}</p> : null}
            </div>

            <button className="btn btn--primary btn--block" type="submit" disabled={busy || !phoneLooksUsable}>
              {busy ? <><span className="spinner" aria-hidden="true" />{t("login.sending")}</> : t("login.send")}
            </button>
          </form>
        ) : (
          <form
            className="stack"
            onSubmit={(event) => { event.preventDefault(); if (code.length === 6 && !busy && !expired) void verify(); }}
          >
            <div className="field">
              <label className="field__label" htmlFor="otp">{t("login.code")}</label>
              <p className="card__meta">{t("login.codeSubtitle")}</p>
              <input
                id="otp"
                ref={codeRef}
                className="input num auth__code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="——————"
                value={code}
                onChange={(event) => onCodeChange(event.target.value)}
                aria-invalid={Boolean(error) || undefined}
                aria-describedby="otp-state"
              />
              <p className="field__hint" id="otp-state">
                {expired ? t("login.expired") : t("login.expiresIn", `${Math.floor(expiresIn / 60)}:${String(expiresIn % 60).padStart(2, "0")}`)}
              </p>
              {error ? <p className="field__error" role="alert">{error}</p> : null}
            </div>

            <button className="btn btn--primary btn--block" type="submit" disabled={busy || code.length !== 6 || expired}>
              {busy ? <><span className="spinner" aria-hidden="true" />{t("login.verifying")}</> : t("login.verify")}
            </button>

            <div className="row row--between">
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => { setStep("phone"); setChallenge(null); setCode(""); setError(""); }}
              >
                {t("login.changeNumber")}
              </button>
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                disabled={busy || resendIn > 0}
                onClick={() => void request(true)}
              >
                {resendIn > 0 ? t("login.resendIn", resendIn) : t("login.resend")}
              </button>
            </div>
          </form>
        )}

        <p className="auth__foot card__meta">{t("landing.footerNote")}</p>
      </div>
    </main>
  );
}
