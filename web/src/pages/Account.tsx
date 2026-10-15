// الحساب: اللغة · الجلسات · ذاكرة الذكاء (عرض ومسح)
import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { Confirm, Empty, ErrorBox, Loading, formatWhen } from "../components/ui";
import type { Lang, SessionRow } from "../lib/types";

type Memory = { facts: Array<{ text: string; type: string; confidence: number; at: number }>; count: number; unavailable?: boolean };

export function Account() {
  const { t, lang, setLang, profile, signOut, notify, errorText, reloadProfile } = useApp();
  const sessions = useFetch<{ sessions: SessionRow[] }>("/auth/sessions");
  const memory = useFetch<Memory>("/me/memory");
  const [confirmForget, setConfirmForget] = useState(false);
  const [saving, setSaving] = useState(false);

  const changeLang = useCallback(async (next: Lang) => {
    setLang(next);
    setSaving(true);
    try {
      await api.patch("/me/preferences", { language: next });
      await reloadProfile();
      notify(t("common.saved"), "success");
    } catch (cause) {
      notify(errorText(cause), "error");
    } finally {
      setSaving(false);
    }
  }, [setLang, reloadProfile, notify, errorText, t]);

  const revoke = useCallback(async (ref: string) => {
    try {
      await api.del(`/auth/sessions/${encodeURIComponent(ref)}`);
      sessions.reload();
    } catch (cause) {
      notify(errorText(cause), "error");
    }
  }, [sessions, notify, errorText]);

  const revokeAll = useCallback(async () => {
    try {
      const out = await api.post<{ revoked: number }>("/auth/sessions/revoke-all", {});
      notify(`${out.revoked}`, "success");
      sessions.reload();
    } catch (cause) {
      notify(errorText(cause), "error");
    }
  }, [sessions, notify, errorText]);

  const forget = useCallback(async () => {
    try {
      await api.post("/me/memory/forget", { confirm: true });
      setConfirmForget(false);
      memory.reload();
      notify(t("common.saved"), "success");
    } catch (cause) {
      notify(errorText(cause), "error");
      setConfirmForget(false);
    }
  }, [memory, notify, errorText, t]);

  if (!profile) return <Loading />;

  return (
    <div className="stack stack--lg">
      <h1>{t("account.title")}</h1>

      <section className="card stack">
        <div className="row row--between">
          <div className="stack" style={{ gap: 4 }}>
            <strong>{profile.name || profile.phoneMasked}</strong>
            <span className="card__meta num">{profile.phoneMasked}</span>
          </div>
          <div className="row" style={{ gap: 7 }}>
            {profile.isOwner ? <span className="chip chip--gold">owner</span> : null}
            {profile.isPremium ? <span className="chip chip--gold">{t("account.premium")}</span> : null}
            {profile.isPartner ? <span className="chip chip--gold">partner</span> : null}
          </div>
        </div>
        <p className="card__meta">
          {t("dash.role")}: {profile.role} · {profile.registered
            ? (lang === "ar" ? "مسجَّل في البوت" : "registered with the bot")
            : (lang === "ar" ? "غير مسجَّل في البوت" : "not registered with the bot")}
        </p>
      </section>

      <section className="card stack">
        <strong>{t("account.language")}</strong>
        <div className="row" style={{ gap: 7 }}>
          <button className={`btn btn--sm${lang === "ar" ? " btn--primary" : ""}`} type="button" disabled={saving} onClick={() => void changeLang("ar")}>العربية</button>
          <button className={`btn btn--sm${lang === "en" ? " btn--primary" : ""}`} type="button" disabled={saving} onClick={() => void changeLang("en")}>English</button>
        </div>
        <p className="card__meta">
          {lang === "ar"
            ? "محرّك لغات البوت يدعم العربية والإنجليزية فقط، فالموقع يتبعه."
            : "The bot's locale engine supports Arabic and English only, so the site follows it."}
        </p>
      </section>

      <section className="stack">
        <div className="row row--between">
          <h2>{t("account.sessions")}</h2>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => void revokeAll()}>{t("account.revokeAll")}</button>
        </div>
        {sessions.loading ? <Loading rows={2} />
          : sessions.error ? <ErrorBox error={sessions.error} onRetry={sessions.reload} />
          : (
            <div className="stack">
              {(sessions.data?.sessions || []).map((session) => (
                <article key={session.id} className="card row row--between">
                  <div className="stack" style={{ gap: 4 }}>
                    <strong>{session.current ? t("account.current") : session.agent || "—"}</strong>
                    <span className="card__meta">{formatWhen(session.lastSeenAt, lang)}</span>
                  </div>
                  {session.current
                    ? <span className="chip chip--success">●</span>
                    : <button className="btn btn--danger btn--sm" type="button" onClick={() => void revoke(session.id)}>{t("account.revoke")}</button>}
                </article>
              ))}
            </div>
          )}
      </section>

      <section className="stack">
        <h2>{t("account.memory")}</h2>
        <p className="card__meta">{t("account.memoryBody")}</p>
        {memory.loading ? <Loading rows={1} />
          : memory.error ? <ErrorBox error={memory.error} onRetry={memory.reload} />
          : memory.data?.unavailable || !memory.data?.facts.length ? <Empty title={t("account.noMemory")} />
          : (
            <>
              <ul className="memberlist">
                {memory.data.facts.map((fact, index) => (
                  <li key={index} className="row row--between">
                    <span className="navitem__label">{fact.text}</span>
                    <span className="chip chip--muted">{fact.type}</span>
                  </li>
                ))}
              </ul>
              <button className="btn btn--danger btn--sm" type="button" onClick={() => setConfirmForget(true)}>{t("account.forget")}</button>
            </>
          )}
      </section>

      <section className="card row row--between">
        <strong>{t("account.logout")}</strong>
        <button className="btn btn--ghost" type="button" onClick={() => void signOut()}>{t("account.logout")}</button>
      </section>

      <Confirm
        open={confirmForget}
        title={t("account.forget")}
        body={t("account.memoryBody")}
        confirmLabel={t("account.forget")}
        onCancel={() => setConfirmForget(false)}
        onConfirm={() => void forget()}
      />
    </div>
  );
}
