// الألعاب: كل حركة تُحتسب في محرّك الأركيد على الخادم. العميل يعرض فقط.
import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { Empty, ErrorBox, Loading, Unavailable } from "../components/ui";
import type { GameRow, GameView } from "../lib/types";

export function Games() {
  const { t, errorText, notify } = useApp();
  const { data, loading, error, reload } = useFetch<{ games: GameRow[] }>("/games");
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);

  const start = useCallback(async (gameId: string) => {
    setBusy(true);
    try {
      const out = await api.post<{ session: GameView }>(`/games/${encodeURIComponent(gameId)}/session`, { vsAI: true });
      setView(out.session);
    } catch (cause) {
      notify(errorText(cause), "error");
    } finally {
      setBusy(false);
    }
  }, [notify, errorText]);

  // الحركة ترسل النيّة فقط (type/value/nonce) — لا نتيجة ولا نقاط
  const act = useCallback(async (type: string, value: unknown) => {
    if (!view) return;
    setBusy(true);
    try {
      const out = await api.post<{ session: GameView }>(
        `/games/sessions/${encodeURIComponent(view.roomId)}/action`,
        { type, value, nonce: view.nonce },
      );
      setView(out.session);
    } catch (cause) {
      notify(errorText(cause), "error");
    } finally {
      setBusy(false);
    }
  }, [view, notify, errorText]);

  const leave = useCallback(async () => {
    if (!view) return;
    try {
      await api.post(`/games/sessions/${encodeURIComponent(view.roomId)}/leave`, {});
    } catch {
      // المغادرة محلية أيضاً: نخرج من الشاشة في كل الأحوال
    }
    setView(null);
  }, [view]);

  if (view) {
    const myTurn = view.turn === null || view.turn === undefined ? true : view.turn === view.viewerSeat;
    return (
      <div className="stack stack--lg">
        <div className="row row--between">
          <h1>{view.icon} {view.title}</h1>
          <button className="btn btn--ghost" type="button" onClick={() => void leave()}>{t("games.leave")}</button>
        </div>

        <section className="card stack">
          <div className="row row--between">
            <div className="row" style={{ gap: 7 }}>
              {view.players.map((player) => (
                <span key={player.seat} className={`chip${player.me ? " chip--violet" : player.isAI ? "" : " chip--cyan"}`}>
                  {player.isAI ? "AI" : player.label}{view.turn === player.seat ? " ●" : ""}
                </span>
              ))}
            </div>
            <span className="chip">{view.state}</span>
          </div>

          {/* العرض يأتي من المحرّك: نعرضه كبيانات لا كـHTML */}
          <pre className="runner__text" aria-label={t("games.title")}>
            {typeof view.board === "string" ? view.board : JSON.stringify(view.board ?? {}, null, 1)}
          </pre>

          {view.state === "playing" ? (
            <>
              <p className="card__meta">{myTurn ? t("games.yourTurn") : t("games.waiting")}</p>
              <div className="row" style={{ gap: 7 }}>
                {view.actions.length === 0 ? <span className="card__meta">{t("games.waiting")}</span> : null}
                {view.actions.map((action, index) => (
                  <button
                    key={index}
                    className="btn btn--sm"
                    type="button"
                    disabled={busy || !myTurn}
                    onClick={() => void act(action.type, action.value)}
                  >
                    {action.label || String(action.value ?? action.type)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <strong>{t("games.over")}</strong>
              {view.result ? <pre className="runner__text">{JSON.stringify(view.result, null, 1)}</pre> : null}
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="stack stack--lg">
      <h1>{t("games.title")}</h1>
      {loading ? <Loading />
        : error ? <ErrorBox error={error} onRetry={reload} />
        : !data?.games.length ? <Empty title={t("common.empty")} />
        : (
          <div className="grid">
            {data.games.map((game) => (
              <article key={game.id} className="card stack" style={{ gap: 9 }}>
                <div className="row row--between">
                  <strong className="card__title">{game.icon} {game.title}</strong>
                  <span className="chip">{game.category}</span>
                </div>
                <p className="card__meta num">
                  {game.players.min}–{game.players.max} · {game.mode}
                </p>
                {game.webRunnable ? (
                  <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={() => void start(game.id)}>
                    {game.supportsAI ? `${t("games.play")} · ${t("games.vsAI")}` : t("games.play")}
                  </button>
                ) : (
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn btn--sm" type="button" disabled>{t("games.groupOnly")}</button>
                    <Unavailable reason={game.unavailableReason} />
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
    </div>
  );
}
