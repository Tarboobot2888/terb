// الرئيسية: بيانات حقيقية فقط. ما لا مصدر له يظهر كحالة فراغ لا كرقم مخترع.
import { useFetch } from "../lib/hooks";
import { useApp } from "../lib/store";
import { Empty, ErrorBox, Loading, formatBytes, formatWhen } from "../components/ui";
import type { Route } from "../components/Shell";
import type { ArtifactRow, TaskRow } from "../lib/types";

type Usage = {
  ai: { remaining: number; resetSeconds: number; limit: number; window: string };
  tools: { remaining: number; resetSeconds: number; limit: number; window: string };
  uploads: { remaining: number; resetSeconds: number; limit: number; window: string };
  tasks: { running: number; limit: number };
  history: null;
};

export function Dashboard({ onRoute }: { onRoute: (route: Route) => void }) {
  const { t, lang, profile } = useApp();
  const tasks = useFetch<{ tasks: TaskRow[] }>("/me/tasks?limit=5");
  const files = useFetch<{ files: ArtifactRow[] }>("/me/files?limit=5");
  const usage = useFetch<Usage>("/me/usage");

  if (!profile) return <Loading />;

  const economy = profile.economy;

  return (
    <div className="stack stack--lg">
      <section className="card card--raised dash__hero">
        <div className="stack" style={{ gap: 8 }}>
          <p className="card__meta">{t("dash.greeting")}</p>
          <h1 style={{ fontSize: "1.6rem" }}>{profile.name || profile.phoneMasked}</h1>
          <div className="row">
            <span className={`chip ${profile.isOwner ? "chip--gold" : profile.isPremium ? "chip--gold" : "chip--violet"}`}>
              {t("dash.role")}: {profile.role}
            </span>
            {profile.registered ? null : <span className="chip chip--muted">{lang === "ar" ? "غير مسجَّل في البوت" : "not registered with the bot"}</span>}
          </div>
        </div>
        <img className="dash__art" src="/brand/terboo-landscape.jpg" alt="" width={1280} height={720} loading="lazy" />
      </section>

      {!profile.existsInBotDatabase ? (
        <div className="errorbox" role="note">
          <strong>{lang === "ar" ? "حساب جديد" : "New account"}</strong>
          <p className="card__meta">{t("dash.notInDb")}</p>
        </div>
      ) : null}

      {economy ? (
        <section className="grid">
          <Stat label={t("dash.level")} value={economy.level} />
          <Stat label={t("dash.xp")} value={economy.exp} />
          <Stat label={t("dash.energy")} value={economy.unlimited ? t("dash.unlimited") : economy.energi} />
          <Stat label={t("dash.coins")} value={economy.koin} />
        </section>
      ) : null}

      <section className="stack">
        <h2>{t("dash.quick")}</h2>
        <div className="grid">
          <Shortcut icon="✶" label={t("nav.ai")} onClick={() => onRoute("ai")} />
          <Shortcut icon="⚙" label={t("nav.tools")} onClick={() => onRoute("tools")} />
          <Shortcut icon="▣" label={t("nav.media")} onClick={() => onRoute("media")} />
          <Shortcut icon="◇" label={t("nav.games")} onClick={() => onRoute("games")} />
          <Shortcut icon="☺" label={t("nav.account")} onClick={() => onRoute("account")} />
        </div>
      </section>

      <section className="stack">
        <h2>{t("dash.tasks")}</h2>
        {tasks.loading ? <Loading rows={2} />
          : tasks.error ? <ErrorBox error={tasks.error} onRetry={tasks.reload} />
          : !tasks.data?.tasks.length ? <Empty title={t("dash.noTasks")} />
          : (
            <div className="stack">
              {tasks.data.tasks.map((task) => (
                <article key={task.id} className="card row row--between">
                  <div className="stack" style={{ gap: 4 }}>
                    <strong>{task.title || task.type}</strong>
                    <span className="card__meta">{formatWhen(task.createdAt, lang)}</span>
                  </div>
                  <div className="stack" style={{ gap: 6, minWidth: 140 }}>
                    <span className={`chip ${task.status === "completed" ? "chip--success" : task.status === "failed" ? "chip--danger" : "chip--cyan"}`}>
                      {task.status}
                    </span>
                    {/* تقدّم حقيقي فقط: بلا نسبة مخترعة حين لا يرسل الـrunner مراحل */}
                    {task.progress !== null ? (
                      <div className="bar"><div className="bar__fill" style={{ width: `${Math.round(task.progress * 100)}%` }} /></div>
                    ) : ["queued", "running", "waiting"].includes(task.status) ? (
                      <div className="bar bar--indeterminate"><div className="bar__fill" /></div>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
      </section>

      <section className="stack">
        <h2>{t("dash.files")}</h2>
        {files.loading ? <Loading rows={2} />
          : files.error ? <ErrorBox error={files.error} onRetry={files.reload} />
          : !files.data?.files.length ? <Empty title={t("dash.noFiles")} />
          : (
            <div className="grid">
              {files.data.files.map((file) => (
                <article key={file.id} className="card stack" style={{ gap: 6 }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{file.name}</strong>
                  <span className="card__meta num">{file.kind} · {formatBytes(file.bytes)}</span>
                  <span className="card__meta">{t("media.expires")}: {formatWhen(file.expiresAt, lang)}</span>
                  <a className="btn btn--ghost btn--sm" href={file.downloadPath}>{t("media.download")}</a>
                </article>
              ))}
            </div>
          )}
      </section>

      <section className="stack">
        <h2>{t("dash.usage")}</h2>
        {usage.loading ? <Loading rows={1} />
          : usage.error ? <ErrorBox error={usage.error} onRetry={usage.reload} />
          : usage.data ? (
            <div className="grid">
              <Quota label={t("nav.ai")} remaining={usage.data.ai.remaining} limit={usage.data.ai.limit} />
              <Quota label={t("nav.tools")} remaining={usage.data.tools.remaining} limit={usage.data.tools.limit} />
              <Quota label={t("media.files")} remaining={usage.data.uploads.remaining} limit={usage.data.uploads.limit} />
              <Quota label={t("dash.tasks")} remaining={usage.data.tasks.limit - usage.data.tasks.running} limit={usage.data.tasks.limit} />
            </div>
          ) : null}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string | null }) {
  const { t } = useApp();
  return (
    <article className="card">
      <p className="card__meta">{label}</p>
      <strong className="num" style={{ fontSize: "1.4rem" }}>
        {value === null || value === undefined ? t("common.unknown") : value}
      </strong>
    </article>
  );
}

function Quota({ label, remaining, limit }: { label: string; remaining: number; limit: number }) {
  const { t } = useApp();
  const used = Math.max(0, limit - remaining);
  const ratio = limit > 0 ? used / limit : 0;
  return (
    <article className="card stack" style={{ gap: 8 }}>
      <div className="row row--between">
        <p className="card__meta">{label}</p>
        <span className="card__meta num">{remaining} {t("common.remaining")} {t("common.of")} {limit}</span>
      </div>
      <div className="bar"><div className="bar__fill" style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} /></div>
    </article>
  );
}

function Shortcut({ icon, label, onClick }: { icon: string; label: string; onClick: () => void }) {
  return (
    <button className="card card--interactive row" type="button" onClick={onClick} style={{ gap: 12 }}>
      <span aria-hidden="true" style={{ fontSize: "1.3rem", color: "var(--violet-bright)" }}>{icon}</span>
      <strong>{label}</strong>
    </button>
  );
}
