// ═══════════════════════════════════════════════
// 🔎 مركز البحث — مصادر حقيقية من سجل الأدوات
// ───────────────────────────────────────────────
// • المصادر من /search/sources (أدوات kind=search) بحالتها الحقيقية.
// • النتائج بطاقات: عنوان · نطاق · مقتطف — نصّ فقط، بلا HTML من المصدر.
// • الروابط خارجية وتُفتح بـnoopener/noreferrer/nofollow.
// • منفصل عن التنزيلات: الإرسال إلى التنزيلات بنقرة صريحة من المستخدم.
// • لا نتائج ⇒ حالة فراغ صريحة؛ الفشل ⇒ سببه. لا نتائج مُختلقة.
// ═══════════════════════════════════════════════

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { copyText } from "../lib/clipboard";
import { useFetch } from "../lib/hooks";
import { Empty, ErrorBox, Loading } from "../components/ui";
import type { SearchResponse, SearchSource } from "../lib/types";

export function Search({ onSendToDownloads }: { onSendToDownloads?: (url: string) => void }) {
  const { t, errorText, notify } = useApp();
  const sources = useFetch<{ sources: SearchSource[] }>("/search/sources");
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const chosen = (sources.data?.sources || []).find((row) => row.id === (source || sources.data?.sources?.[0]?.id));

  const run = useCallback(async () => {
    const text = query.trim();
    if (!text || busy) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setResponse(null);
    try {
      const out = await api.post<SearchResponse>(
        "/search",
        { query: text, ...(source ? { source } : {}) },
        controller.signal,
      );
      if (!controller.signal.aborted) setResponse(out);
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError") return;
      setError(cause);
      notify(errorText(cause), "error");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }, [query, source, busy, notify, errorText]);

  const copy = useCallback(async (text: string) => {
    const outcome = await copyText(text);
    if (outcome === "failed") notify(t("common.copyFailed"), "error");
    else notify(t("common.copied"), "success");
  }, [notify, t]);

  return (
    <div className="stack stack--lg">
      <h1>{t("search.title")}</h1>

      <section className="card stack">
        <div className="row sr__bar">
          <input
            className="input"
            type="search"
            value={query}
            placeholder={t("search.placeholder")}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void run(); }}
            aria-label={t("search.title")}
          />
          <button className="btn btn--primary" type="button" disabled={!query.trim() || busy} onClick={() => void run()}>
            {busy ? t("search.searching") : t("search.go")}
          </button>
        </div>

        {sources.loading ? <Loading rows={1} />
          : sources.error ? <ErrorBox error={sources.error} onRetry={sources.reload} />
          : (
            <label className="field">
              <span className="field__label">{t("search.source")}</span>
              <select className="select" value={source} onChange={(event) => setSource(event.target.value)}>
                {(sources.data?.sources || []).map((row) => (
                  <option key={row.id} value={row.id} disabled={!row.available}>
                    {row.id}{row.available ? "" : " — ⛔"}
                  </option>
                ))}
              </select>
              {chosen?.purpose ? <span className="field__hint">{chosen.purpose}</span> : null}
              {chosen && !chosen.available ? <span className="field__hint field__hint--warn">{t("search.unavailableSource")}</span> : null}
            </label>
          )}

        <p className="field__hint">{t("search.hint")}</p>
      </section>

      {busy ? <Loading rows={3} /> : null}
      {error ? <ErrorBox error={error} onRetry={() => void run()} /> : null}

      {response && !busy ? (
        response.ok && response.results.length ? (
          <section className="stack">
            <div className="row row--between">
              <h2 className="h2">{t("search.results")}</h2>
              <span className="chip chip--muted num">{response.results.length} · {response.latencyMs}ms</span>
            </div>
            <ul className="sr__list">
              {response.results.map((hit, index) => (
                <li key={`${hit.url}-${index}`} className="sr__hit card">
                  <a
                    className="sr__title"
                    href={hit.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                  >
                    {hit.title}
                  </a>
                  <span className="sr__domain ltr">{hit.domain}</span>
                  {hit.snippet ? <p className="sr__snippet">{hit.snippet}</p> : null}
                  <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
                    <a className="btn btn--sm" href={hit.url} target="_blank" rel="noopener noreferrer nofollow">
                      {t("search.open")}
                    </a>
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => void copy(hit.url)}>
                      {t("downloads.copyLink")}
                    </button>
                    {onSendToDownloads ? (
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => onSendToDownloads(hit.url)}>
                        {t("search.toDownloads")}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <Empty
            title={response.reason === "no-results" ? t("search.noResults") : t("search.failed")}
            {...(response.reason && response.reason !== "no-results" ? { body: response.reason } : {})}
          />
        )
      ) : null}

      {response?.text && response.ok && !response.results.length ? (
        <section className="card"><p className="card__meta">{response.text}</p></section>
      ) : null}
    </div>
  );
}
