// البوتات الفرعية: عرض فقط، والسبب معلَن بوضوح بدل زر لا يعمل
import { useApp } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { Empty, ErrorBox, Loading, formatWhen } from "../components/ui";
import type { SubBotsResponse } from "../lib/types";

export function SubBots() {
  const { t, lang } = useApp();
  const { data, loading, error, reload } = useFetch<SubBotsResponse>("/subbots");

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <div className="stack stack--lg">
      <h1>{t("subbots.title")}</h1>

      <div className="errorbox" role="note">
        <strong>{lang === "ar" ? "الاقتران على واتساب" : "Pairing stays on WhatsApp"}</strong>
        <p className="card__meta">{t("subbots.pairingWeb")}</p>
      </div>

      {!data?.subBots.length ? <Empty title={t("subbots.none")} /> : (
        <div className="grid">
          {data.subBots.map((bot) => (
            <article key={bot.ref} className="card stack" style={{ gap: 7 }}>
              <div className="row row--between">
                <strong className="num">{bot.ref}</strong>
                <span className={`chip ${bot.active ? "chip--success" : "chip--muted"}`}>
                  <span className={`dot ${bot.active ? "dot--on" : "dot--off"}`} />
                  {bot.active ? t("subbots.active") : t("subbots.stopped")}
                </span>
              </div>
              <p className="card__meta">{bot.status}</p>
              {bot.startedAt ? <p className="card__meta">{formatWhen(bot.startedAt, lang)}</p> : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
