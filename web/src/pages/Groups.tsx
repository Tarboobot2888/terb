// المجموعات: الأزرار تتبع الحقيقة الحيّة (دورك ودور البوت)، والجماعي يحتاج تأكيداً
import { useCallback, useState } from "react";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { Confirm, Empty, ErrorBox, Loading, Unavailable } from "../components/ui";
import type { GroupRow } from "../lib/types";

type GroupDetail = {
  group: GroupRow & { actionsAvailable: boolean; actionsBlockedReason: string };
};
type Members = {
  groupId: string; subject: string; size: number;
  members: Array<{ ref: string; label: string; admin: string | null }>;
};

export function Groups() {
  const { t, errorText, notify } = useApp();
  const list = useFetch<{ groups: GroupRow[] }>("/groups");
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useFetch<GroupDetail>(openId ? `/groups/${encodeURIComponent(openId)}` : null);
  const members = useFetch<Members>(openId ? `/groups/${encodeURIComponent(openId)}/members` : null);
  const [picked, setPicked] = useState<string[]>([]);
  const [pending, setPending] = useState<{ action: string; bulk: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (ref: string) =>
    setPicked((current) => current.includes(ref) ? current.filter((value) => value !== ref) : [...current, ref]);

  const apply = useCallback(async (action: string, confirm: boolean) => {
    if (!openId || !picked.length) return;
    setBusy(true);
    try {
      const out = await api.post<{ ok: boolean; applied: unknown[]; failed: unknown[]; verified: boolean; reason?: string }>(
        `/groups/${encodeURIComponent(openId)}/members/action`,
        { action, targets: picked, confirm },
      );
      // لا نقول «نُفِّذ» إلا بما أثبته المنفّذ
      if (out.ok && out.verified) notify(`${out.applied.length} ✓`, "success");
      else if (out.applied.length) notify(`${out.applied.length} ✓ / ${out.failed.length} ✕`, "info");
      else notify(out.reason || t("common.error"), "error");
      setPicked([]);
      setPending(null);
      members.reload();
    } catch (cause) {
      notify(errorText(cause), "error");
      setPending(null);
    } finally {
      setBusy(false);
    }
  }, [openId, picked, members, notify, errorText, t]);

  const request = (action: string) => {
    const bulk = picked.length > 1 || action.endsWith("Selected");
    if (bulk) setPending({ action, bulk });
    else void apply(action, false);
  };

  if (list.loading) return <Loading />;
  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;

  const group = detail.data?.group;
  const canAct = Boolean(group?.actionsAvailable);

  return (
    <div className="stack stack--lg">
      <h1>{t("groups.title")}</h1>

      {!list.data?.groups.length ? <Empty title={t("common.empty")} body={t("groups.offline")} /> : (
        <div className="grid">
          {list.data.groups.map((row) => (
            <button
              key={row.groupId}
              className={`card card--interactive stack${openId === row.groupId ? " card--selected" : ""}`}
              type="button"
              style={{ gap: 7, textAlign: "start" }}
              onClick={() => { setOpenId(row.groupId); setPicked([]); }}
            >
              <strong className="card__title">{row.subject || row.groupId}</strong>
              <span className="card__meta num">{row.size} {t("groups.members")}</span>
              <div className="row" style={{ gap: 6 }}>
                {row.isGroupAdmin ? <span className="chip chip--violet">{t("groups.admin")}</span> : null}
                <span className={`chip ${row.botIsAdmin ? "chip--success" : "chip--muted"}`}>
                  bot {row.botIsAdmin ? "admin" : "member"}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {openId ? (
        <section className="stack">
          {detail.loading || members.loading ? <Loading rows={2} />
            : detail.error ? <ErrorBox error={detail.error} onRetry={detail.reload} />
            : (
              <>
                <div className="row row--between">
                  <h2>{group?.subject || openId}</h2>
                  {!canAct ? <Unavailable reason={group?.actionsBlockedReason || "unknown"} /> : null}
                </div>

                <div className="row" style={{ gap: 7 }}>
                  <button className="btn btn--danger btn--sm" type="button" disabled={!canAct || !picked.length || busy}
                    onClick={() => request(picked.length > 1 ? "group.members.kickSelected" : "group.member.kick")}>
                    kick ({picked.length})
                  </button>
                  <button className="btn btn--sm" type="button" disabled={!canAct || !picked.length || busy}
                    onClick={() => request(picked.length > 1 ? "group.members.promoteSelected" : "group.member.promote")}>
                    promote
                  </button>
                  <button className="btn btn--sm" type="button" disabled={!canAct || !picked.length || busy}
                    onClick={() => request(picked.length > 1 ? "group.members.demoteSelected" : "group.member.demote")}>
                    demote
                  </button>
                </div>

                <ul className="memberlist">
                  {(members.data?.members || []).map((member) => (
                    <li key={member.ref}>
                      <label className="row" style={{ gap: 10, cursor: canAct ? "pointer" : "default" }}>
                        <input
                          type="checkbox"
                          disabled={!canAct}
                          checked={picked.includes(member.ref)}
                          onChange={() => toggle(member.ref)}
                        />
                        <span className="navitem__label">{member.label}</span>
                        {member.admin ? <span className="chip chip--violet">{member.admin}</span> : null}
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            )}
        </section>
      ) : null}

      <Confirm
        open={Boolean(pending)}
        title={t("groups.confirmBulk")}
        body={`${pending?.action || ""} · ${picked.length}`}
        onCancel={() => setPending(null)}
        onConfirm={() => { if (pending) void apply(pending.action, true); }}
      />
    </div>
  );
}
