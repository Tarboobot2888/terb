// الأدوات والتحميل: نموذج مبنيّ من مخطّط المدخلات الحقيقي لكل أداة
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useDebounced, useFetch } from "../lib/hooks";
import { Empty, ErrorBox, Loading, Unavailable, formatBytes } from "../components/ui";
import type { ToolResult, ToolRow } from "../lib/types";

export function Tools() {
  const { t, errorText, notify } = useApp();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const debounced = useDebounced(query, 320);
  const path = `/catalog/tools?${new URLSearchParams({ ...(debounced ? { q: debounced } : {}), ...(category ? { category } : {}) })}`;
  const { data, loading, error, reload } = useFetch<{ tools: ToolRow[] }>(path);
  const [open, setOpen] = useState<ToolRow | null>(null);

  const categories = useMemo(() => {
    const set = new Set((data?.tools || []).map((tool) => tool.category));
    return [...set].sort();
  }, [data]);

  return (
    <div className="stack stack--lg">
      <section className="stack">
        <h1>{t("tools.title")}</h1>
        <div className="row">
          <input
            className="input"
            style={{ maxWidth: 340 }}
            placeholder={t("tools.search")}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label={t("tools.search")}
          />
          <div className="row" style={{ gap: 6 }}>
            <button className={`chip${category === "" ? " chip--violet" : ""}`} type="button" onClick={() => setCategory("")}>{t("tools.all")}</button>
            {categories.map((name) => (
              <button key={name} className={`chip${category === name ? " chip--violet" : ""}`} type="button" onClick={() => setCategory(name)}>{name}</button>
            ))}
          </div>
        </div>
      </section>

      {loading ? <Loading />
        : error ? <ErrorBox error={error} onRetry={reload} />
        : !data?.tools.length ? <Empty title={t("tools.empty")} />
        : (
          <div className="grid grid--wide">
            {data.tools.map((tool) => (
              <article key={tool.id} className="card stack" style={{ gap: 9 }}>
                <div className="row row--between">
                  <strong className="card__title mono">{tool.id}</strong>
                  <span className="chip chip--cyan">{tool.category}</span>
                </div>
                <p className="card__meta">{tool.purpose || "—"}</p>
                <div className="row" style={{ gap: 6 }}>
                  {tool.permission !== "user" ? <span className="chip chip--gold">{tool.permission}</span> : null}
                  {tool.output ? <span className="chip">{tool.output}</span> : null}
                  {tool.maxBytes ? <span className="chip num">{formatBytes(tool.maxBytes)}</span> : null}
                </div>
                {tool.webRunnable ? (
                  <button className="btn btn--primary btn--sm" type="button" onClick={() => setOpen(tool)}>{t("tools.run")}</button>
                ) : (
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn--sm" type="button" disabled>{t("tools.unavailable")}</button>
                    <Unavailable reason={tool.unavailableReason} />
                  </div>
                )}
              </article>
            ))}
          </div>
        )}

      {open ? (
        <ToolRunner
          tool={open}
          onClose={() => setOpen(null)}
          onError={(cause) => notify(errorText(cause), "error")}
        />
      ) : null}
    </div>
  );
}

/** نموذج التشغيل: الحقول تُبنى من tool.input الحقيقي لا من تخمين */
function ToolRunner({ tool, onClose, onError }: { tool: ToolRow; onClose: () => void; onError: (cause: unknown) => void }) {
  const { t, lang } = useApp();
  const [values, setValues] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Record<string, { id: string; name: string }>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [jobId, setJobId] = useState("");

  const properties = tool.input?.properties || {};
  const required = tool.input?.required || [];
  const binaryFields = ["image", "audio", "video", "file"];
  const fields = Object.entries(properties);
  const ready = required.every((name) => (binaryFields.includes(name) ? uploads[name] : values[name]?.trim()));

  const payload = () => {
    const input: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      if (!value.trim()) continue;
      const spec = properties[name];
      input[name] = spec?.type === "number" ? Number(value) : value;
    }
    for (const [name, upload] of Object.entries(uploads)) input[name] = upload.id;
    return input;
  };

  const run = async (background: boolean) => {
    setBusy(true);
    setResult(null);
    setJobId("");
    try {
      if (background) {
        const out = await api.post<{ taskId: string }>(`/tools/${encodeURIComponent(tool.id)}/jobs`, { input: payload() });
        setJobId(out.taskId);
      } else {
        const out = await api.post<{ result: ToolResult }>(`/tools/${encodeURIComponent(tool.id)}/run`, { input: payload() });
        setResult(out.result);
      }
    } catch (cause) {
      onError(cause);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (field: string, file: File) => {
    try {
      const out = await api.upload<{ file: { id: string; name: string } }>(file);
      setUploads((current) => ({ ...current, [field]: { id: out.file.id, name: out.file.name } }));
    } catch (cause) {
      onError(cause);
    }
  };

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <section className="runner card card--raised" role="dialog" aria-modal="true" aria-label={tool.id}>
        <div className="row row--between">
          <strong className="mono">{tool.id}</strong>
          <button className="btn btn--ghost btn--sm" type="button" onClick={onClose}>{t("common.close")}</button>
        </div>
        <p className="card__meta">{tool.purpose}</p>

        <form className="stack" onSubmit={(event) => { event.preventDefault(); if (ready) void run(false); }}>
          {fields.length === 0 ? <p className="card__meta">{lang === "ar" ? "هذه الأداة لا تحتاج مدخلات." : "This tool needs no input."}</p> : null}
          {fields.map(([name, spec]) => {
            const isBinary = binaryFields.includes(name);
            const isRequired = required.includes(name);
            return (
              <div className="field" key={name}>
                <label className="field__label" htmlFor={`f-${name}`}>
                  {name}{isRequired ? " *" : ""}
                </label>
                {isBinary ? (
                  <div className="row">
                    <input
                      id={`f-${name}`}
                      className="input"
                      type="file"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void upload(name, file);
                      }}
                    />
                    {uploads[name] ? <span className="chip chip--success">{uploads[name]!.name}</span> : null}
                  </div>
                ) : (
                  <input
                    id={`f-${name}`}
                    className="input"
                    type={spec?.type === "number" ? "number" : "text"}
                    inputMode={name === "url" ? "url" : undefined}
                    placeholder={spec?.description || name}
                    value={values[name] || ""}
                    onChange={(event) => setValues((current) => ({ ...current, [name]: event.target.value }))}
                  />
                )}
                {spec?.description ? <p className="field__hint">{spec.description}</p> : null}
              </div>
            );
          })}

          <div className="row">
            <button className="btn btn--primary" type="submit" disabled={busy || !ready}>
              {busy ? <><span className="spinner" aria-hidden="true" />{t("tools.running")}</> : t("tools.run")}
            </button>
            <button className="btn btn--ghost" type="button" disabled={busy || !ready} onClick={() => void run(true)}>
              {t("tools.background")}
            </button>
          </div>
          {!ready ? <p className="field__hint">{t("tools.inputRequired")}</p> : null}
        </form>

        {jobId ? (
          <div className="card" role="status">
            <p className="card__meta">{t("tools.background")}</p>
            <strong className="mono">{jobId}</strong>
            <p className="card__meta">{t("dash.tasks")} → {t("nav.dashboard")}</p>
          </div>
        ) : null}

        {result ? (
          <div className="stack">
            <div className="row row--between">
              <strong>{t("tools.result")}</strong>
              <span className={`chip ${result.ok ? "chip--success" : "chip--danger"}`}>
                {result.ok ? "ok" : result.error || "failed"}
              </span>
            </div>
            {result.text ? <pre className="runner__text">{result.text}</pre> : null}
            {result.items.length ? (
              <ul className="runner__items">
                {result.items.map((item, index) => (
                  <li key={index} className="row row--between">
                    <span className="card__meta">{item.title || item.type || "item"}</span>
                    {item.url ? (
                      <a className="btn btn--ghost btn--sm" href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                        {t("tools.externalLink")} ↗
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="card__meta num">{result.latencyMs} ms</p>
          </div>
        ) : null}
      </section>
    </>
  );
}
