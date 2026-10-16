// أوامر واتساب: مرجع صريح. كل صف يقول إنه غير قابل للتشغيل من الموقع ولماذا.
import { useMemo, useState } from "react";
import { useApp } from "../lib/store";
import { useDebounced, useFetch } from "../lib/hooks";
import { Empty, ErrorBox, Loading } from "../components/ui";
import type { CategoryRow, CommandRow } from "../lib/types";

export function Commands() {
  const { t, lang } = useApp();
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 280);
  const categories = useFetch<{ categories: CategoryRow[] }>("/catalog/categories");
  const { data, loading, error, reload } = useFetch<{ total: number; commands: CommandRow[] }>(
    `/catalog/commands?${new URLSearchParams({ limit: "400", ...(category ? { category } : {}) })}`,
  );

  const rows = useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    const all = data?.commands || [];
    if (!needle) return all;
    return all.filter((row) =>
      row.command.toLowerCase().includes(needle) ||
      row.alias.some((alias) => alias.toLowerCase().includes(needle)) ||
      row.description.toLowerCase().includes(needle));
  }, [data, debounced]);

  return (
    <div className="stack stack--lg">
      <div className="stack">
        <h1>{t("nav.commands")}</h1>
        <div className="errorbox" role="note">
          <p className="card__meta">
            {lang === "ar"
              ? "هذه مرجع للأوامر كما هي في البوت. تنفيذها يحتاج رسالة واتساب حقيقية ومقبساً حياً، فلا تُشغَّل من الموقع — أرسلها إلى Bot Terboo على واتساب."
              : "This is a reference to the bot's commands. Running one needs a real WhatsApp message and a live socket, so it cannot run from the web — send it to Bot Terboo on WhatsApp."}
          </p>
        </div>
        <div className="row">
          <input
            className="input" style={{ maxWidth: 320 }}
            placeholder={t("tools.search")} value={query}
            onChange={(event) => setQuery(event.target.value)} aria-label={t("tools.search")}
          />
          <div className="row" style={{ gap: 6 }}>
            <button className={`chip${category === "" ? " chip--violet" : ""}`} type="button" onClick={() => setCategory("")}>
              {t("tools.all")} {data?.total ? <span className="num">({data.total})</span> : null}
            </button>
            {(categories.data?.categories || []).slice(0, 14).map((row) => (
              <button key={row.category} className={`chip${category === row.category ? " chip--violet" : ""}`} type="button" onClick={() => setCategory(row.category)}>
                {row.category} <span className="num">({row.commandCount})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? <Loading />
        : error ? <ErrorBox error={error} onRetry={reload} />
        : !rows.length ? <Empty title={t("tools.empty")} />
        : (
          <div className="grid grid--wide">
            {rows.map((row) => (
              <article key={`${row.category}-${row.command}`} className="card stack" style={{ gap: 7 }}>
                <div className="row row--between">
                  <strong className="card__title mono">{row.command}</strong>
                  <span className="chip">{row.category}</span>
                </div>
                <p className="card__meta">{row.description || "—"}</p>
                {row.usage ? <code className="cmd__usage ltr">{row.usage}</code> : null}
                <div className="row" style={{ gap: 6 }}>
                  {row.requires.owner ? <span className="chip chip--gold">owner</span> : null}
                  {row.requires.premium ? <span className="chip chip--gold">premium</span> : null}
                  {row.requires.group ? <span className="chip">group</span> : null}
                  {row.requires.groupAdmin ? <span className="chip">admin</span> : null}
                  {row.cost.energi ? <span className="chip num">⚡{row.cost.energi}</span> : null}
                  <span className="chip chip--muted">{t("ai.whatsappOnly")}</span>
                </div>
              </article>
            ))}
          </div>
        )}
    </div>
  );
}
