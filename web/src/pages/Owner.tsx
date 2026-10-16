// لوحة المالك: تظهر فقط لمن أثبت الخادم أنه مالك، وكل فعل محدَّد ومُدقَّق
import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useDebounced, useFetch } from "../lib/hooks";
import { Confirm, Empty, ErrorBox, Loading, formatBytes, formatWhen } from "../components/ui";
import type { OwnerOverview } from "../lib/types";

type Tab = "site" | "users" | "jobs" | "providers" | "audit";

type UsersResponse = {
  total: number; matched: number;
  users: Array<{ ref: string; phoneMasked: string; name: string | null; level: number | null; energi: number | null; isPremium: boolean; isBanned: boolean; registered: boolean; lastSeen: string | null }>;
};
type WebsiteResponse = {
  site: { state: string; listening: boolean; url: string; secure: boolean; domain: string; domainVerified: boolean; tlsMode: string; port: number };
  domain: { configuredDomain: string; pendingDomain: string; verified: boolean; lastError: string; record: { type: string; name: string; value: string } | null };
  routing: { domain: string; checked: boolean; a?: string[]; aaaa?: string[]; matchesPublicIp?: boolean | null };
  tls: Record<string, unknown>;
};

export function Owner() {
  const { t, lang, profile } = useApp();
  const [tab, setTab] = useState<Tab>("site");

  // الواجهة تخفي اللوحة، والخادم يرفضها على كل حال (OWNER_ONLY)
  if (!profile?.isOwner) {
    return <Empty title={t("common.notAvailable")} body={lang === "ar" ? "هذه اللوحة للمالك فقط." : "This console is owner-only."} />;
  }

  return (
    <div className="stack stack--lg">
      <h1>{t("owner.title")}</h1>
      <div className="row" style={{ gap: 6 }}>
        {(["site", "users", "jobs", "providers", "audit"] as Tab[]).map((name) => (
          <button key={name} className={`chip${tab === name ? " chip--violet" : ""}`} type="button" onClick={() => setTab(name)}>
            {t(`owner.${name === "site" ? "site" : name}`)}
          </button>
        ))}
      </div>
      {tab === "site" ? <SiteTab /> : null}
      {tab === "users" ? <UsersTab /> : null}
      {tab === "jobs" ? <JobsTab /> : null}
      {tab === "providers" ? <ProvidersTab /> : null}
      {tab === "audit" ? <AuditTab /> : null}
    </div>
  );
}

function Overview() {
  const { t, lang } = useApp();
  const { data, loading, error, reload } = useFetch<OwnerOverview>("/owner/overview");
  if (loading) return <Loading rows={2} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="grid">
      <article className="card"><p className="card__meta">{t("owner.site")}</p><strong>{data.site.state}</strong></article>
      <article className="card"><p className="card__meta">WhatsApp</p>
        <div className="row"><span className={`dot ${data.whatsapp.connected ? "dot--on" : "dot--off"}`} />
          <strong>{data.whatsapp.connected ? t("common.online") : t("common.offline")}</strong></div>
      </article>
      <article className="card"><p className="card__meta">{t("owner.users")}</p><strong className="num">{data.users.total}</strong>
        <p className="card__meta num">{data.users.premium} premium · {data.users.banned} banned</p></article>
      <article className="card"><p className="card__meta">{lang === "ar" ? "السجل" : "Registry"}</p>
        <strong className="num">{data.registry.plugins}</strong>
        <p className="card__meta num">{data.registry.tools} tools · {data.registry.categories} cats</p></article>
      <article className="card"><p className="card__meta">{lang === "ar" ? "الذاكرة" : "Memory"}</p>
        <strong className="num">{formatBytes(data.process.rssBytes)}</strong>
        <p className="card__meta num">node {data.process.nodeVersion}</p></article>
      <article className="card"><p className="card__meta">{lang === "ar" ? "تحديات الدخول" : "Live challenges"}</p>
        <strong className="num">{data.auth.liveChallenges}</strong></article>
    </div>
  );
}

function SiteTab() {
  const { t, lang, notify, errorText } = useApp();
  const website = useFetch<WebsiteResponse>("/owner/website");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);

  const setIt = useCallback(async () => {
    setBusy(true);
    try {
      await api.post("/owner/domain", { domain, confirm: true, explicit: true });
      website.reload();
      notify(t("common.saved"), "success");
    } catch (cause) {
      notify(errorText(cause), "error");
    } finally { setBusy(false); }
  }, [domain, website, notify, errorText, t]);

  const verify = useCallback(async () => {
    setBusy(true);
    try {
      const out = await api.post<{ verified: boolean; reason: string }>("/owner/domain/verify", {});
      notify(out.verified ? t("common.saved") : out.reason, out.verified ? "success" : "error");
      website.reload();
    } catch (cause) {
      notify(errorText(cause), "error");
    } finally { setBusy(false); }
  }, [website, notify, errorText, t]);

  return (
    <div className="stack stack--lg">
      <Overview />
      {website.loading ? <Loading rows={2} />
        : website.error ? <ErrorBox error={website.error} onRetry={website.reload} />
        : website.data ? (
          <>
            <section className="card stack">
              <div className="row row--between">
                <strong>{t("owner.site")}</strong>
                <span className={`chip ${website.data.site.secure ? "chip--success" : "chip--danger"}`}>
                  {website.data.site.secure ? "HTTPS" : "HTTP"}
                </span>
              </div>
              <p className="card__meta ltr">{website.data.site.url || "—"}</p>
              {!website.data.site.secure && website.data.site.url ? (
                <p className="field__error">
                  {lang === "ar"
                    ? "هذا العنوان غير مشفَّر. ضع reverse proxy بشهادة أمامه قبل النشر."
                    : "This address is not encrypted. Put a reverse proxy with a certificate in front of it before publishing."}
                </p>
              ) : null}
              <p className="card__meta num">port {website.data.site.port} · tls {website.data.site.tlsMode} · listening {String(website.data.site.listening)}</p>
            </section>

            <section className="card stack">
              <strong>{t("owner.domain")}</strong>
              <div className="row">
                <input className="input ltr" style={{ maxWidth: 300 }} placeholder="bot.example.com" value={domain}
                  onChange={(event) => setDomain(event.target.value)} aria-label={t("owner.domain")} />
                <button className="btn btn--primary btn--sm" type="button" disabled={busy || !domain.trim()} onClick={() => void setIt()}>{t("common.save")}</button>
                <button className="btn btn--ghost btn--sm" type="button" disabled={busy} onClick={() => void verify()}>{t("owner.verify")}</button>
              </div>
              <p className="card__meta">
                {website.data.domain.pendingDomain || "—"} · {website.data.domain.verified
                  ? (lang === "ar" ? "متحقَّق" : "verified")
                  : (lang === "ar" ? "غير متحقَّق" : "not verified")}
                {website.data.domain.lastError ? ` · ${website.data.domain.lastError}` : ""}
              </p>
              {website.data.domain.record ? (
                <pre className="runner__text ltr">{`${website.data.domain.record.type}  ${website.data.domain.record.name}  ${website.data.domain.record.value}`}</pre>
              ) : null}
              {website.data.routing.checked ? (
                <p className="card__meta num ltr">A: {(website.data.routing.a || []).join(", ") || "—"}</p>
              ) : null}
            </section>

            <section className="card stack">
              <strong>{t("owner.tls")}</strong>
              <pre className="runner__text ltr">{JSON.stringify(website.data.tls, null, 1)}</pre>
              <p className="card__meta">
                {lang === "ar"
                  ? "الإصدار والتجديد خارج عملية البوت — راجع docs/web-platform/DOMAIN_AND_TLS.md."
                  : "Issuance and renewal happen outside the bot process — see docs/web-platform/DOMAIN_AND_TLS.md."}
              </p>
            </section>
          </>
        ) : null}
    </div>
  );
}

function UsersTab() {
  const { t, lang, notify, errorText } = useApp();
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 320);
  const { data, loading, error, reload } = useFetch<UsersResponse>(`/owner/users?${new URLSearchParams({ limit: "50", ...(debounced ? { q: debounced } : {}) })}`);
  const [pending, setPending] = useState<{ ref: string; ban: boolean } | null>(null);

  const apply = useCallback(async (ref: string, ban: boolean) => {
    try {
      await api.post(`/owner/users/${encodeURIComponent(ref)}/${ban ? "ban" : "unban"}`, { confirm: true, explicit: true });
      setPending(null);
      reload();
      notify(t("common.saved"), "success");
    } catch (cause) {
      notify(errorText(cause), "error");
      setPending(null);
    }
  }, [reload, notify, errorText, t]);

  return (
    <div className="stack">
      <input className="input" style={{ maxWidth: 320 }} placeholder={t("owner.search")} value={query}
        onChange={(event) => setQuery(event.target.value)} aria-label={t("owner.search")} />
      {loading ? <Loading />
        : error ? <ErrorBox error={error} onRetry={reload} />
        : !data?.users.length ? <Empty title={t("common.empty")} />
        : (
          <>
            <p className="card__meta num">{data.matched} / {data.total}</p>
            <div className="stack">
              {data.users.map((user) => (
                <article key={user.ref} className="card row row--between">
                  <div className="stack" style={{ gap: 4 }}>
                    <strong>{user.name || user.phoneMasked}</strong>
                    <span className="card__meta num">{user.phoneMasked} · lvl {user.level ?? "—"} · ⚡{user.energi ?? "—"}</span>
                  </div>
                  <div className="row" style={{ gap: 7 }}>
                    {user.isPremium ? <span className="chip chip--gold">premium</span> : null}
                    {user.isBanned ? <span className="chip chip--danger">banned</span> : null}
                    <button
                      className={`btn btn--sm${user.isBanned ? "" : " btn--danger"}`}
                      type="button"
                      onClick={() => setPending({ ref: user.ref, ban: !user.isBanned })}
                    >
                      {user.isBanned ? t("owner.unban") : t("owner.ban")}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
      <Confirm
        open={Boolean(pending)}
        title={pending?.ban ? t("owner.ban") : t("owner.unban")}
        body={lang === "ar" ? "سيُلغى كل جلسات هذا الحساب على الموقع." : "All of this account's web sessions will be revoked."}
        onCancel={() => setPending(null)}
        onConfirm={() => { if (pending) void apply(pending.ref, pending.ban); }}
      />
    </div>
  );
}

function JobsTab() {
  const { t, lang } = useApp();
  const { data, loading, error, reload } = useFetch<{ summary: Record<string, number>; tasks: Array<{ id: string; type: string; status: string; owner: string; createdAt: number }> }>("/owner/jobs?limit=50");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <div className="stack">
      <div className="grid">
        {Object.entries(data?.summary || {}).map(([key, value]) => (
          <article key={key} className="card"><p className="card__meta">{key}</p><strong className="num">{String(value)}</strong></article>
        ))}
      </div>
      {!data?.tasks.length ? <Empty title={t("dash.noTasks")} /> : (
        <div className="stack">
          {data.tasks.map((task) => (
            <article key={task.id} className="card row row--between">
              <div className="stack" style={{ gap: 4 }}>
                <strong className="mono">{task.type}</strong>
                <span className="card__meta">{formatWhen(task.createdAt, lang)}</span>
              </div>
              <span className="chip">{task.status}</span>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ProvidersTab() {
  const { loading, error, data, reload } = useFetch<Record<string, unknown>>("/owner/providers");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return <pre className="runner__text ltr">{JSON.stringify(data, null, 1)}</pre>;
}

function AuditTab() {
  const { t, lang } = useApp();
  const { data, loading, error, reload } = useFetch<{ entries: Array<{ at: number; actor: string; action: string; target: string; outcome: string }> }>("/owner/audit?limit=100");
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.entries.length) return <Empty title={t("common.empty")} />;
  return (
    <div className="stack">
      {data.entries.map((entry, index) => (
        <article key={index} className="card row row--between">
          <div className="stack" style={{ gap: 4 }}>
            <strong className="mono">{entry.action}</strong>
            <span className="card__meta num">{entry.actor} → {entry.target || "—"}</span>
          </div>
          <div className="stack" style={{ gap: 4, textAlign: "end" }}>
            <span className={`chip ${entry.outcome.startsWith("ok") ? "chip--success" : "chip--muted"}`}>{entry.outcome}</span>
            <span className="card__meta">{formatWhen(entry.at, lang)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}
