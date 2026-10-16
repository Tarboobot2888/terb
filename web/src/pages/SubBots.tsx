// ═══════════════════════════════════════════════
// 🤖 البوتات الفرعية — تنصيب TARBOOV6 وحالة الجلسات
// ───────────────────────────────────────────────
// • التنصيب لرقم الحساب الموثَّق وحده، بتأكيد صريح من المستخدم.
// • كود الاقتران الحقيقي يأتي من الخادم للطالب وحده، بنافذة قصيرة، ويُستعلم
//   عنه في كل نبضة مع إعادة التحقق من ملكية الطلب على الخادم.
// • «TARBOOV6» وسم التدفق لا رمزاً: الرمز الفعلي من واتساب ويختلف كل محاولة.
// • الحالة المعروضة هي حالة الخادم الحقيقية؛ «جاهز» لا تظهر قبل اتصال فعلي.
// • لا رقم كامل ولا مسار جلسة ولا QR في أي مكان من هذه الصفحة.
// ═══════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useApp } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { Confirm, Empty, ErrorBox, Loading, formatWhen } from "../components/ui";
import type { PairingRequest, SubBotsResponse } from "../lib/types";

const TERMINAL = new Set(["ready", "failed", "expired", "cancelled"]);

export function SubBots() {
  const { t, lang, errorText, notify } = useApp();
  const [listTick, setListTick] = useState(0);
  const { data, loading, error, reload } = useFetch<SubBotsResponse>("/subbots", [listTick]);
  const [confirming, setConfirming] = useState(false);
  const [starting, setStarting] = useState(false);
  const [request, setRequest] = useState<PairingRequest | null>(null);
  const [failure, setFailure] = useState("");
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);
  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback((requestId: string) => {
    const tick = async () => {
      try {
        const out = await api.get<PairingRequest>(`/subbots/pair/${encodeURIComponent(requestId)}`);
        setRequest(out);
        if (TERMINAL.has(out.state)) {
          stopPolling();
          if (out.state === "ready") {
            notify(t("subbots.readyMsg"), "success");
            setListTick((value) => value + 1);
          }
          return;
        }
        pollRef.current = window.setTimeout(() => void tick(), 2000);
      } catch (cause) {
        stopPolling();
        setFailure(errorText(cause));
      }
    };
    void tick();
  }, [stopPolling, notify, t, errorText]);

  const install = useCallback(async () => {
    setConfirming(false);
    setStarting(true);
    setFailure("");
    try {
      const out = await api.post<PairingRequest>("/subbots/pair", { confirm: true });
      setRequest(out);
      if (!TERMINAL.has(out.state)) poll(out.requestId);
    } catch (cause) {
      const code = cause instanceof ApiError ? cause.code : "";
      setFailure(code === "NEEDS_CONFIRMATION" ? errorText(cause) : errorText(cause));
      notify(errorText(cause), "error");
    } finally {
      setStarting(false);
    }
  }, [poll, notify, errorText]);

  const cancel = useCallback(async () => {
    if (!request) return;
    stopPolling();
    try {
      const out = await api.post<PairingRequest>(`/subbots/pair/${encodeURIComponent(request.requestId)}/cancel`, {});
      setRequest(out);
      notify(t("subbots.cancelledMsg"));
    } catch (cause) {
      notify(errorText(cause), "error");
    }
  }, [request, stopPolling, notify, t, errorText]);

  const pairing = data?.pairing;

  return (
    <div className="stack stack--lg">
      <h1>{t("subbots.title")}</h1>

      {/* ── التنصيب ── */}
      {pairing?.availableInWeb ? (
        <section className="card stack sb__install">
          <div className="row row--between">
            <strong className="card__title">{t("subbots.install")}</strong>
            {pairing.label ? <span className="chip chip--violet ltr">{pairing.label}</span> : null}
          </div>
          <p className="card__meta">{t("subbots.explain")}</p>
          <p className="field__hint">{t("subbots.yourNumberOnly")}</p>

          {request && !TERMINAL.has(request.state) ? (
            <PairingPanel request={request} onCancel={() => void cancel()} />
          ) : (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn btn--primary"
                type="button"
                disabled={starting}
                onClick={() => setConfirming(true)}
              >
                {starting ? t("subbots.installing") : t("subbots.install")}
              </button>
              {request?.state === "ready" ? <span className="chip chip--ok">{t("subbots.readyMsg")}</span> : null}
              {request?.state === "expired" ? <span className="chip chip--bad">{t("subbots.expired")}</span> : null}
              {request?.state === "cancelled" ? <span className="chip chip--muted">{t("subbots.cancelledMsg")}</span> : null}
              {request?.state === "failed" ? <span className="chip chip--bad">{t("subbots.failedMsg")}</span> : null}
            </div>
          )}

          {failure ? <div className="errorbox" role="alert"><p className="card__meta">{failure}</p></div> : null}
        </section>
      ) : null}

      {/* ── الجلسات ── */}
      {loading ? <Loading />
        : error ? <ErrorBox error={error} onRetry={reload} />
        : !data?.subBots.length ? <Empty title={t("subbots.none")} />
        : (
          <ul className="list">
            {data.subBots.map((row) => (
              <li key={row.ref} className="list__row">
                <span className="row" style={{ gap: 8 }}>
                  <span className="num ltr">{row.ref}</span>
                  {row.mine ? <span className="chip chip--violet">{t("subbots.mine")}</span> : null}
                </span>
                <span className="row" style={{ gap: 7, flexWrap: "wrap" }}>
                  <span className={`chip chip--${row.active ? "ok" : "muted"}`}>
                    {row.active ? t("subbots.active") : t("subbots.stopped")}
                  </span>
                  {row.startedAt ? <span className="card__meta num">{formatWhen(row.startedAt, lang)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}

      <Confirm
        open={confirming}
        title={t("subbots.install")}
        body={t("subbots.explain")}
        confirmLabel={t("subbots.install")}
        onConfirm={() => void install()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

/** لوحة الاقتران: الرمز للطالب وحده، مع عدّاد انتهاء وزر نسخ حقيقي */
function PairingPanel({ request, onCancel }: { request: PairingRequest; onCancel: () => void }) {
  const { t, notify } = useApp();
  const [left, setLeft] = useState(request.expiresInSeconds);
  const codeRef = useRef<HTMLSpanElement | null>(null);

  // العدّاد محلي للعرض فقط؛ الانتهاء الحقيقي يقرّره الخادم في كل نبضة
  useEffect(() => { setLeft(request.expiresInSeconds); }, [request.expiresInSeconds, request.requestId]);
  useEffect(() => {
    if (left <= 0) return;
    const timer = window.setTimeout(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [left]);

  const copy = useCallback(async () => {
    const text = request.copyCode || request.code || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      notify(t("common.copied"), "success");
      return;
    } catch {
      // الحافظة محجوبة (سياق غير آمن/رفض الإذن): نحدّد الرمز ليُنسَخ يدوياً
    }
    try {
      const node = codeRef.current;
      if (node && window.getSelection) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    } catch {
      // لا شيء يتعطّل: الرمز معروض ويمكن نسخه يدوياً
    }
    notify(t("common.copyFailed"), "error");
  }, [request.copyCode, request.code, notify, t]);

  const stateText: Record<string, string> = {
    validating: t("subbots.installing"),
    creating: t("subbots.installing"),
    "waiting-for-pairing-code": t("subbots.installing"),
    "code-ready": t("subbots.waitingLink"),
    connecting: t("subbots.waitingLink"),
    connected: t("subbots.connectedMsg"),
    "following-channel": t("subbots.followingChannel"),
  };

  return (
    <div className="stack sb__pairing">
      <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
        <span className="chip chip--panel">
          <span className="chip__label">{t("subbots.state")}</span>
          <span className="ltr">{request.state}</span>
        </span>
        <span className="chip chip--panel">
          <span className="chip__label">{t("subbots.target")}</span>
          <span className="num ltr">{request.maskedTarget}</span>
        </span>
      </div>

      <p className="card__meta" aria-live="polite">{stateText[request.state] || request.state}</p>

      {request.code ? (
        <div className="stack sb__code">
          <span className="field__label">{t("subbots.code")}</span>
          <span className="sb__codevalue num ltr" ref={codeRef}>{request.code}</span>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className="btn btn--primary btn--sm" type="button" onClick={() => void copy()}>
              {t("subbots.copyCode")}
            </button>
            <span className="chip chip--live num">{t("subbots.expiresIn", left)}</span>
          </div>
          <p className="field__hint">{t("subbots.steps")}</p>
        </div>
      ) : null}

      <div className="row">
        <button className="btn btn--ghost btn--sm" type="button" onClick={onCancel}>
          {t("subbots.cancelRequest")}
        </button>
      </div>
    </div>
  );
}
