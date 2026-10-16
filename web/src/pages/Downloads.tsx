// ═══════════════════════════════════════════════
// ⬇️ مركز التنزيلات — منصات حقيقية من سجل الـscrapers
// ───────────────────────────────────────────────
// • المنصات والأدوات تأتي من /downloads/platforms (السجل المركزي) لا من قائمة ثابتة.
// • فحص الرابط عبر /downloads/resolve: بلا طلب شبكي، ويكشف المنصة والتوفّر.
// • الجلب مهمة حقيقية على الطابور: taskId يُتابع من /me/tasks/:id ويُلغى منه.
// • لا نجاح معروض قبل ناتج حقيقي؛ الفشل يُعرض بسببه ومحاولاته.
// • الروابط الخارجية تُعلَن خارجية؛ البايتات تُنزَّل من مسار أثر محمي.
// ═══════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { copyText } from "../lib/clipboard";
import { useFetch } from "../lib/hooks";
import { Empty, ErrorBox, Loading, formatBytes, formatWhen } from "../components/ui";
import type { DownloadJob, DownloadOutcome, DownloadPlatform, DownloadTarget, ResultItem, TaskRow } from "../lib/types";

type Phase = "idle" | "resolving" | "queued" | "running" | "done" | "failed";

export function Downloads({ initialUrl = "" }: { initialUrl?: string }) {
  const { t, lang, errorText, notify } = useApp();
  const platforms = useFetch<{ platforms: DownloadPlatform[] }>("/downloads/platforms");
  const [url, setUrl] = useState(initialUrl);
  const [target, setTarget] = useState<DownloadTarget | null>(null);
  const [scraperId, setScraperId] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [task, setTask] = useState<TaskRow | null>(null);
  const [outcome, setOutcome] = useState<DownloadOutcome | null>(null);
  const [failure, setFailure] = useState("");
  const [historyTick, setHistoryTick] = useState(0);
  const history = useFetch<{ downloads: TaskRow[] }>("/downloads/history", [historyTick]);
  const pollRef = useRef<number | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  // رابط وارد من البحث بنقرة صريحة من المستخدم
  useEffect(() => {
    if (initialUrl) setUrl(initialUrl);
  }, [initialUrl]);

  // فحص الرابط بعد توقّف الكتابة — بلا طلب شبكي خارجي
  useEffect(() => {
    const trimmed = url.trim();
    if (!trimmed) { setTarget(null); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPhase((current) => (current === "idle" ? "resolving" : current));
      api.post<{ target: DownloadTarget }>("/downloads/resolve", { url: trimmed })
        .then((out) => {
          if (cancelled) return;
          setTarget(out.target);
          setScraperId("");
          setPhase((current) => (current === "resolving" ? "idle" : current));
        })
        .catch((cause) => {
          if (cancelled) return;
          setTarget(null);
          setPhase("idle");
          setFailure(errorText(cause));
        });
    }, 420);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [url, errorText]);

  const poll = useCallback((taskId: string) => {
    const tick = async () => {
      try {
        // الطابور يحفظ ملخّصاً نصّياً فقط، فالنتيجة الكاملة تأتي من مسار التنزيلات
        const out = await api.get<{ task: TaskRow; outcome: DownloadOutcome | null }>(
          `/downloads/jobs/${encodeURIComponent(taskId)}`,
        );
        setTask(out.task);
        const status = out.task.status;
        if (["completed", "failed", "cancelled", "expired"].includes(status)) {
          stopPolling();
          const result = out.outcome;
          if (status === "completed" && result?.ok) {
            setOutcome(result);
            setPhase("done");
          } else {
            setOutcome(result || null);
            setFailure(out.task.error || (result ? "" : status));
            setPhase("failed");
          }
          setHistoryTick((value) => value + 1);
          return;
        }
        setPhase(status === "running" ? "running" : "queued");
        pollRef.current = window.setTimeout(() => void tick(), 1400);
      } catch (cause) {
        stopPolling();
        setFailure(errorText(cause));
        setPhase("failed");
      }
    };
    void tick();
  }, [stopPolling, errorText]);

  const fetchNow = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed || !target?.supported) return;
    stopPolling();
    setOutcome(null);
    setFailure("");
    setTask(null);
    setPhase("queued");
    try {
      const job = await api.post<DownloadJob>("/downloads/jobs", {
        url: trimmed,
        ...(scraperId ? { scraperId } : {}),
      });
      poll(job.taskId);
    } catch (cause) {
      setPhase("failed");
      setFailure(errorText(cause));
      notify(errorText(cause), "error");
    }
  }, [url, target, scraperId, stopPolling, poll, errorText, notify]);

  const cancel = useCallback(async () => {
    if (!task?.id) return;
    try {
      await api.post(`/me/tasks/${encodeURIComponent(task.id)}/cancel`, {});
    } catch (cause) {
      notify(errorText(cause), "error");
    }
  }, [task, notify, errorText]);

  const paste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setUrl(text.trim());
    } catch {
      // الحافظة محجوبة: المستخدم يلصق يدوياً ولا شيء يتعطّل
      notify(t("downloads.urlHint"));
    }
  }, [notify, t]);

  const working = phase === "queued" || phase === "running";

  return (
    <div className="stack stack--lg">
      <h1>{t("downloads.title")}</h1>

      <section className="card stack dl__composer">
        <label className="field">
          <span className="field__label">{t("downloads.urlLabel")}</span>
          <div className="row dl__inputrow">
            <input
              className="input ltr"
              type="url"
              inputMode="url"
              dir="ltr"
              spellCheck={false}
              value={url}
              placeholder="https://…"
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter" && target?.supported && !working) void fetchNow(); }}
            />
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => void paste()}>{t("downloads.paste")}</button>
            {url ? <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setUrl(""); setTarget(null); setOutcome(null); setFailure(""); setPhase("idle"); }}>{t("downloads.clear")}</button> : null}
          </div>
          <span className="field__hint">{t("downloads.urlHint")}</span>
        </label>

        {target ? (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
              <span className="chip chip--panel">
                <span className="chip__label">{t("downloads.detected")}</span>
                <span className="ltr">{target.platform || target.host}</span>
              </span>
              {target.outputs.map((output) => <span key={output} className="chip chip--muted ltr">{output}</span>)}
            </div>

            {!target.supported ? (
              <p className="field__hint field__hint--warn">{t("downloads.unsupported")}</p>
            ) : !target.available ? (
              <p className="field__hint field__hint--warn">{t("downloads.unavailable")}</p>
            ) : null}

            {target.supported && target.scrapers.length > 1 ? (
              <label className="field">
                <span className="field__label">{t("downloads.tool")}</span>
                <select className="select" value={scraperId} onChange={(event) => setScraperId(event.target.value)}>
                  <option value="">{t("downloads.auto")}</option>
                  {target.scrapers.map((id) => <option key={id} value={id}>{id}</option>)}
                </select>
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn btn--primary"
            type="button"
            disabled={!target?.supported || working || phase === "resolving"}
            onClick={() => void fetchNow()}
          >
            {working ? t("downloads.fetching") : t("downloads.fetch")}
          </button>
          {working ? (
            <>
              <span className="chip chip--live" aria-live="polite">
                {phase === "running" ? t("downloads.running") : t("downloads.queued")}
                {task?.progress !== null && task?.progress !== undefined ? ` · ${Math.round(task.progress)}%` : ""}
              </span>
              {task?.controls.cancel ? (
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => void cancel()}>{t("common.cancel")}</button>
              ) : null}
            </>
          ) : null}
        </div>

        {phase === "failed" ? (
          <div className="errorbox" role="alert">
            <strong>{t("downloads.failed")}</strong>
            {failure ? <p className="card__meta ltr">{failure}</p> : null}
            {outcome?.tried?.length ? <Attempts tried={outcome.tried} label={t("downloads.tried")} /> : null}
          </div>
        ) : null}
      </section>

      {phase === "done" && outcome ? <ResultCard outcome={outcome} /> : null}

      <section className="stack">
        <h2 className="h2">{t("downloads.history")}</h2>
        {history.loading ? <Loading rows={2} />
          : history.error ? <ErrorBox error={history.error} onRetry={history.reload} />
          : !history.data?.downloads.length ? <Empty title={t("downloads.noHistory")} />
          : (
            <ul className="list">
              {history.data.downloads.map((row) => (
                <li key={row.id} className="list__row">
                  <span className="ltr">{row.title || row.type.replace("web.download:", "")}</span>
                  <span className="row" style={{ gap: 7 }}>
                    <span className={`chip chip--${row.status === "completed" ? "ok" : row.status === "failed" ? "bad" : "muted"}`}>{row.status}</span>
                    <span className="card__meta num">{formatWhen(row.createdAt, lang)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="stack">
        <h2 className="h2">{t("downloads.platforms")}</h2>
        {platforms.loading ? <Loading rows={2} />
          : platforms.error ? <ErrorBox error={platforms.error} onRetry={platforms.reload} />
          : (
            <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
              {(platforms.data?.platforms || []).map((row) => (
                <span key={row.platform} className={`chip ${row.available ? "chip--cyan" : "chip--muted"} ltr`} title={row.scrapers.join(", ")}>
                  {row.platform}
                </span>
              ))}
            </div>
          )}
      </section>
    </div>
  );
}

function Attempts({ tried, label }: { tried: DownloadOutcome["tried"]; label: string }) {
  return (
    <div className="stack" style={{ gap: 5 }}>
      <span className="card__meta">{label}</span>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {tried.map((row, index) => (
          <span key={index} className={`chip chip--${row.ok ? "ok" : "bad"} ltr`} title={row.error}>
            {row.id} · {row.latencyMs}ms
          </span>
        ))}
      </div>
    </div>
  );
}

function ResultCard({ outcome }: { outcome: DownloadOutcome }) {
  const { t, notify } = useApp();
  const result = outcome.result;
  const items: ResultItem[] = result?.items || [];
  // ما يمكن تنزيله فعلاً: رابط خارجي أو أثر محفوظ
  const usable = items.filter((item) => item.url || item.downloadPath);

  const copy = useCallback(async (text: string) => {
    const outcome = await copyText(text);
    if (outcome === "failed") notify(t("common.copyFailed"), "error");
    else notify(t("common.copied"), "success");
  }, [notify, t]);

  return (
    <section className="card stack">
      <div className="row row--between">
        <strong className="card__title">{result?.title || t("downloads.result")}</strong>
        <span className="chip chip--ok ltr">{outcome.platform || outcome.host}</span>
      </div>

      {result?.text ? <p className="card__meta dl__text">{result.text}</p> : null}

      {!usable.length ? (
        <Empty title={t("downloads.noMedia")} />
      ) : (
        <ul className="dl__items">
          {usable.map((item, index) => (
            <li key={index} className="dl__item">
              <div className="dl__itemhead">
                <span className={`chip chip--muted ltr`}>{item.type || "file"}</span>
                {item.title ? <strong className="dl__itemtitle">{item.title}</strong> : null}
              </div>
              <div className="row dl__meta" style={{ gap: 7, flexWrap: "wrap" }}>
                {item.mimetype ? <span className="card__meta ltr">{item.mimetype}</span> : null}
                {item.sizeBytes ? <span className="card__meta num">{formatBytes(item.sizeBytes)}</span> : null}
                {item.durationSeconds ? <span className="card__meta num">{Math.round(item.durationSeconds)}s</span> : null}
                {item.note ? <span className="card__meta">{item.note}</span> : null}
              </div>
              <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
                {item.downloadPath ? (
                  <a className="btn btn--primary btn--sm" href={item.downloadPath} download>
                    {t("downloads.save")}
                  </a>
                ) : null}
                {item.url ? (
                  <>
                    <a className="btn btn--sm" href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                      {t("downloads.open")}
                    </a>
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => void copy(item.url)}>
                      {t("downloads.copyLink")}
                    </button>
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="field__hint">{t("downloads.externalNote")}</p>
      {outcome.tried?.length > 1 ? <Attempts tried={outcome.tried} label={t("downloads.tried")} /> : null}
    </section>
  );
}
