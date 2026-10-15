// استوديو الوسائط: رفع ثم تشغيل أدوات الوسائط الحقيقية على الملف المملوك
import { useCallback, useRef, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { Confirm, Empty, ErrorBox, Loading, formatBytes, formatWhen } from "../components/ui";
import type { ArtifactRow, ToolResult, ToolRow } from "../lib/types";

/** أدوات الوسائط المحلية بحسب نوع الملف — كلها من سجل الأدوات الحقيقي */
const BY_KIND: Record<string, string[]> = {
  image: ["image.describe", "image.ocr", "image.upscale", "image.remove_background"],
  audio: ["audio.transcribe"],
  video: ["video.inspect", "video.transcribe", "video.keyframes"],
  document: ["document.extract", "document.summarize"],
  archive: ["file.inspect"],
};

export function Media() {
  const { t, lang, errorText, notify } = useApp();
  const files = useFetch<{ files: ArtifactRow[] }>("/me/files?limit=50");
  const tools = useFetch<{ tools: ToolRow[] }>("/catalog/tools");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<ArtifactRow | null>(null);
  const [result, setResult] = useState<ToolResult | null>(null);
  const [running, setRunning] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const upload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      await api.upload<{ file: ArtifactRow }>(file);
      files.reload();
      notify(t("common.saved"), "success");
    } catch (cause) {
      notify(errorText(cause), "error");
    } finally {
      setUploading(false);
    }
  }, [files, notify, errorText, t]);

  const runOn = useCallback(async (file: ArtifactRow, toolId: string) => {
    const field = file.kind === "image" ? "image" : file.kind === "audio" ? "audio" : file.kind === "video" ? "video" : "file";
    setRunning(toolId);
    setResult(null);
    try {
      const out = await api.post<{ result: ToolResult }>(`/tools/${encodeURIComponent(toolId)}/run`, {
        input: { [field]: file.id, fileName: file.name },
      });
      setResult(out.result);
    } catch (cause) {
      notify(errorText(cause), "error");
    } finally {
      setRunning("");
    }
  }, [notify, errorText]);

  const remove = useCallback(async (id: string) => {
    try {
      await api.del(`/artifacts/${id}`);
      setConfirmId(null);
      if (selected?.id === id) { setSelected(null); setResult(null); }
      files.reload();
    } catch (cause) {
      notify(errorText(cause), "error");
    }
  }, [files, selected, notify, errorText]);

  const available = (toolId: string) => {
    const tool = (tools.data?.tools || []).find((entry) => entry.id === toolId);
    return tool?.webRunnable ? tool : null;
  };

  return (
    <div className="stack stack--lg">
      <h1>{t("media.title")}</h1>

      <section
        className={`dropzone${dragging ? " dropzone--active" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
        <strong>{t("media.drop")}</strong>
        <button className="btn btn--primary" type="button" disabled={uploading} onClick={() => inputRef.current?.click()}>
          {uploading ? <><span className="spinner" aria-hidden="true" />{t("media.uploading")}</> : t("media.choose")}
        </button>
        <p className="card__meta">
          {t("media.limits")}: {lang === "ar"
            ? "صورة 16MB · صوت 25MB · فيديو 64MB · مستند 100MB"
            : "image 16MB · audio 25MB · video 64MB · document 100MB"}
        </p>
      </section>

      <section className="stack">
        <h2>{t("media.files")}</h2>
        {files.loading ? <Loading />
          : files.error ? <ErrorBox error={files.error} onRetry={files.reload} />
          : !files.data?.files.length ? <Empty title={t("dash.noFiles")} />
          : (
            <div className="grid grid--wide">
              {files.data.files.map((file) => (
                <article key={file.id} className={`card stack${selected?.id === file.id ? " card--selected" : ""}`} style={{ gap: 9 }}>
                  <div className="row row--between">
                    <strong style={{ overflowWrap: "anywhere" }}>{file.name}</strong>
                    <span className="chip chip--cyan">{file.kind}</span>
                  </div>
                  <p className="card__meta num">{formatBytes(file.bytes)} · {file.mime}</p>
                  <p className="card__meta">{t("media.expires")}: {formatWhen(file.expiresAt, lang)}</p>
                  <div className="row" style={{ gap: 7 }}>
                    <a className="btn btn--ghost btn--sm" href={file.downloadPath}>{t("media.download")}</a>
                    <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setSelected(file); setResult(null); }}>
                      {t("media.pickTool")}
                    </button>
                    <button className="btn btn--danger btn--sm" type="button" onClick={() => setConfirmId(file.id)}>
                      {t("media.delete")}
                    </button>
                  </div>

                  {selected?.id === file.id ? (
                    <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--hairline)", paddingTop: 10 }}>
                      <div className="row" style={{ gap: 6 }}>
                        {(BY_KIND[file.kind] || []).map((toolId) => {
                          const tool = available(toolId);
                          return (
                            <button
                              key={toolId}
                              className="btn btn--sm"
                              type="button"
                              disabled={!tool || Boolean(running)}
                              title={tool ? tool.purpose : t("tools.unavailable")}
                              onClick={() => void runOn(file, toolId)}
                            >
                              {running === toolId ? <span className="spinner" aria-hidden="true" /> : null}
                              <span className="mono">{toolId}</span>
                            </button>
                          );
                        })}
                      </div>
                      {result ? (
                        <div className="stack" style={{ gap: 7 }}>
                          <span className={`chip ${result.ok ? "chip--success" : "chip--danger"}`}>
                            {result.ok ? "ok" : result.error || "failed"}
                          </span>
                          {result.text ? <pre className="runner__text">{result.text}</pre> : null}
                          {result.items.map((item, index) => (
                            item.url ? (
                              <a key={index} className="btn btn--ghost btn--sm" href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                                {t("tools.externalLink")} ↗
                              </a>
                            ) : null
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
      </section>

      <Confirm
        open={Boolean(confirmId)}
        title={t("media.delete")}
        confirmLabel={t("media.delete")}
        onCancel={() => setConfirmId(null)}
        onConfirm={() => { if (confirmId) void remove(confirmId); }}
      />
    </div>
  );
}
