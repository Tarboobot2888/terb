// الألعاب: كل حركة تُحتسب في محرّك الأركيد على الخادم. العميل يعرض ويرسل نيّة فقط.
// اللوحة تُرسم رسماً (CSS) عبر components/GameBoard.tsx بعارض مسموح لكل لعبة.
import { useCallback, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useApp } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { Empty, ErrorBox, Loading, Unavailable } from "../components/ui";
import { GameBoardView } from "../components/GameBoard";
import type { GamePanel, GameRow, GameView } from "../lib/types";

/** رمز الفئة — من فئة العقد لا من بيانات اللعبة */
const CATEGORY_ICON: Record<string, string> = {
  board: "⬛", puzzle: "🧩", word: "🔤", quiz: "🧠", arcade: "🕹", party: "🎉", adventure: "🗺",
};

export function Games() {
  const { t, lang, errorText, notify } = useApp();
  const { data, loading, error, reload } = useFetch<{ games: GameRow[] }>("/games");
  const [view, setView] = useState<GameView | null>(null);
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState("");

  // الخصم الآلي يُطلب فقط لمن يدعمه: الألعاب الفردية ترفضه بـai-unsupported.
  // الواجهة تعرض التمييز أصلاً في نصّ الزر، فالطلب يتبعه بدل إرسال true دائماً.
  const start = useCallback(async (gameId: string, supportsAI: boolean) => {
    setStarting(gameId);
    try {
      const out = await api.post<{ session: GameView }>(`/games/${encodeURIComponent(gameId)}/session`, { vsAI: supportsAI });
      setView(out.session);
    } catch (cause) {
      notify(errorText(cause), "error");
    } finally {
      setStarting("");
    }
  }, [notify, errorText]);

  // الحركة ترسل النيّة فقط (type/value/nonce) — لا نتيجة ولا نقاط
  const act = useCallback(async (type: string, value: unknown) => {
    if (!view || busy) return;
    setBusy(true);
    try {
      const out = await api.post<{ session: GameView }>(
        `/games/sessions/${encodeURIComponent(view.roomId)}/action`,
        { type, value, nonce: view.nonce },
      );
      setView(out.session);
    } catch (cause) {
      // nonce قديم/ليس دورك ⇒ نُحدِّث اللوحة من الخادم بدل ترك شاشة خاطئة
      const reason = cause instanceof ApiError ? String(cause.details?.["reason"] || "") : "";
      if (reason === "stale-nonce" || reason === "not-your-turn") {
        notify(t("games.staleMove"), "error");
        try {
          const fresh = await api.get<{ session: GameView }>(`/games/sessions/${encodeURIComponent(view.roomId)}`);
          setView(fresh.session);
        } catch {
          // تعذّر التحديث: تبقى اللوحة كما هي والرسالة ظاهرة
        }
      } else {
        notify(errorText(cause), "error");
      }
    } finally {
      setBusy(false);
    }
  }, [view, busy, notify, errorText, t]);

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
    const hasTurn = view.turn !== null && view.turn !== undefined;
    const myTurn = !hasTurn || view.turn === view.viewerSeat;
    const playing = view.state === "PLAYING" || view.state === "playing";
    const aiTurn = hasTurn && !myTurn && Boolean(view.players.find((p) => p.seat === view.turn)?.isAI);
    const panels: GamePanel[] = Array.isArray(view.panels) ? view.panels : [];
    // أزرار الإجراءات التي ليست خلايا على اللوحة (رمي نرد · حرف · خيار)
    const buttons = playing && myTurn ? view.actions : [];

    return (
      <div className="stack stack--lg game">
        <div className="row row--between">
          <h1 className="game__title">
            <span aria-hidden="true">{view.icon}</span> {view.title}
          </h1>
          <button className="btn btn--ghost btn--sm" type="button" onClick={() => void leave()}>
            {t("games.leave")}
          </button>
        </div>

        <section className="card stack game__stage">
          <div className="row row--between game__seats">
            <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
              {view.players.map((player) => (
                <span
                  key={player.seat}
                  className={`chip${player.me ? " chip--violet" : player.isAI ? " chip--muted" : " chip--cyan"}${view.turn === player.seat ? " chip--turn" : ""}`}
                >
                  {player.isAI ? "AI" : player.label}
                  {player.isAI && player.difficulty ? ` · ${player.difficulty}` : ""}
                  {view.turn === player.seat ? " ●" : ""}
                </span>
              ))}
            </div>
            <span className="chip">{view.state}</span>
          </div>

          {panels.length ? (
            <div className="row game__panels" style={{ gap: 7, flexWrap: "wrap" }}>
              {panels.map((panel, index) => (
                <span key={index} className="chip chip--panel">
                  <span className="chip__label">{panel.label}</span>
                  <span className="num">{panel.value}</span>
                </span>
              ))}
            </div>
          ) : null}

          {/* اللوحة مرسومة: العارض مسموح لكل لعبة ولا يُنفَّذ HTML من بيانات اللعبة */}
          <GameBoardView view={view} onCell={(value) => void act("move", value)} disabled={busy || !playing || !myTurn} />

          {view.status ? <p className="game__status">{view.status}</p> : null}

          {playing ? (
            <>
              <p className="card__meta" aria-live="polite">
                {aiTurn ? t("games.aiThinking") : myTurn ? t("games.yourTurn") : t("games.waiting")}
              </p>
              {buttons.length ? (
                <div className="row game__actions" style={{ gap: 7, flexWrap: "wrap" }}>
                  {buttons.map((action, index) => (
                    <button
                      key={index}
                      className="btn btn--sm"
                      type="button"
                      disabled={busy}
                      onClick={() => void act(action.type, action.value)}
                    >
                      {action.label || String(action.value ?? action.type)}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="stack game__over" style={{ gap: 8 }}>
              <strong>{t("games.over")}</strong>
              <GameResult result={view.result} />
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn--primary btn--sm" type="button" onClick={() => void start(view.gameId, Boolean(view.players.some((p) => p.isAI)))}>
                  {t("games.again")}
                </button>
                <button className="btn btn--ghost btn--sm" type="button" onClick={() => void leave()}>
                  {t("games.leave")}
                </button>
              </div>
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
          <div className="grid grid--games">
            {data.games.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                lang={lang}
                busy={starting === game.id}
                onPlay={() => void start(game.id, game.supportsAI)}
              />
            ))}
          </div>
        )}
    </div>
  );
}

function GameCard({ game, busy, onPlay, lang }: { game: GameRow; busy: boolean; onPlay: () => void; lang: string }) {
  const { t } = useApp();
  // صورة مصغّرة من الهوية: حرف اللعبة فوق تدرّج مشتقّ من فئتها (بلا صور خارجية)
  const art = useMemo(() => CATEGORY_ICON[game.category] || "🎮", [game.category]);
  return (
    <article className={`card stack gamecard gamecard--${String(game.category || "arcade").replace(/[^a-z]/g, "")}`}>
      <div className="gamecard__art" aria-hidden="true">
        <span className="gamecard__icon">{game.icon || art}</span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div className="row row--between">
          <strong className="card__title">{game.title}</strong>
          <span className="chip chip--muted">{game.category}</span>
        </div>
        <p className="card__meta num">
          {game.players.min === game.players.max ? game.players.min : `${game.players.min}–${game.players.max}`}
          {" · "}
          <span className="ltr">{game.mode}</span>
        </p>
      </div>
      {game.webRunnable ? (
        <button className="btn btn--primary btn--sm" type="button" disabled={busy} onClick={onPlay}>
          {busy ? t("common.loading") : game.supportsAI ? `${t("games.play")} · ${t("games.vsAI")}` : t("games.play")}
        </button>
      ) : (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn--sm" type="button" disabled>{t("games.groupOnly")}</button>
          <Unavailable reason={game.unavailableReason} />
        </div>
      )}
      <span className="sr-only">{lang === "ar" ? "لعبة" : "Game"}</span>
    </article>
  );
}

/** نتيجة اللعبة: حقول معروفة فقط، بلا JSON خام */
function GameResult({ result }: { result: unknown }) {
  const { t } = useApp();
  if (!result || typeof result !== "object") return null;
  const row = result as Record<string, unknown>;
  const fields: Array<[string, string]> = [];
  if (typeof row["outcome"] === "string") fields.push([t("games.result"), String(row["outcome"])]);
  if (typeof row["reason"] === "string" && row["reason"]) fields.push([t("common.why"), String(row["reason"])]);
  if (Array.isArray(row["scores"])) fields.push([t("games.score"), (row["scores"] as unknown[]).map((v) => String(v)).join(" · ")]);
  if (!fields.length) return null;
  return (
    <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
      {fields.map(([label, value]) => (
        <span key={label} className="chip chip--panel">
          <span className="chip__label">{label}</span>
          <span className="num">{value}</span>
        </span>
      ))}
    </div>
  );
}
