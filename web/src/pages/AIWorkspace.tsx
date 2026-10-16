// مساحة الذكاء: محادثات قناة الويب · إلغاء حقيقي · صدق عن الصور والنوايا التنفيذية
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { useApp } from "../lib/store";
import { useFetch } from "../lib/hooks";
import { Confirm, Empty, ErrorBox, Loading } from "../components/ui";
import type { AnswerResult, ChatMessage, Conversation } from "../lib/types";

type Providers = { available: boolean; count: number; vision: boolean };

export function AIWorkspace() {
  const { t, errorText, notify } = useApp();
  const providers = useFetch<Providers>("/ai/providers");
  const list = useFetch<{ conversations: Conversation[] }>("/ai/conversations");
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [attachment, setAttachment] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // أول محادثة تُفتح تلقائياً
  useEffect(() => {
    if (!active && list.data?.conversations.length) setActive(list.data.conversations[0]!.id);
  }, [active, list.data]);

  const loadThread = useCallback(async (id: string) => {
    setError(null);
    try {
      const out = await api.get<{ conversation: { messages: ChatMessage[] } }>(`/ai/conversations/${id}`);
      setMessages(out.conversation.messages);
    } catch (cause) {
      setError(cause);
      setMessages([]);
    }
  }, []);

  useEffect(() => { if (active) void loadThread(active); }, [active, loadThread]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages, sending]);

  const create = useCallback(async () => {
    try {
      const out = await api.post<{ id: string }>("/ai/conversations", {});
      list.reload();
      setActive(out.id);
      setMessages([]);
    } catch (cause) {
      notify(errorText(cause), "error");
    }
  }, [list, notify, errorText]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if ((!text && !attachment) || sending) return;
    let conversationId = active;
    if (!conversationId) {
      try {
        const created = await api.post<{ id: string }>("/ai/conversations", {});
        conversationId = created.id;
        setActive(created.id);
        list.reload();
      } catch (cause) {
        notify(errorText(cause), "error");
        return;
      }
    }

    setSending(true);
    setError(null);
    const optimistic: ChatMessage = { id: `local-${Date.now()}`, role: "user", text: text || `[${attachment?.name}]`, at: Date.now() };
    setMessages((current) => [...current, optimistic]);
    setDraft("");

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const answer = await api.post<AnswerResult>(
        `/ai/conversations/${conversationId}/messages`,
        { text, ...(attachment ? { attachmentId: attachment.id } : {}) },
        controller.signal,
      );
      setAttachment(null);
      setMessages((current) => [...current, {
        id: `a-${Date.now()}`, role: "assistant", text: answer.text, at: Date.now(),
        ...(answer.provider ? { provider: answer.provider } : {}),
      }]);
      if (!answer.executed && answer.reason === "not-available-in-web") notify(t("ai.whatsappOnly"), "info");
      list.reload();
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError") {
        setMessages((current) => current.filter((message) => message.id !== optimistic.id));
      } else {
        setError(cause);
        if (cause instanceof ApiError && cause.details?.["capability"] === "vision") notify(t("ai.noVision"), "error");
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  }, [draft, attachment, sending, active, list, notify, errorText, t]);

  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const attach = useCallback(async (file: File) => {
    try {
      const out = await api.upload<{ file: { id: string; name: string; kind: string } }>(file);
      if (out.file.kind !== "image") {
        notify(t("ai.attach"), "error");
        return;
      }
      setAttachment({ id: out.file.id, name: out.file.name });
    } catch (cause) {
      notify(errorText(cause), "error");
    }
  }, [notify, errorText, t]);

  const remove = useCallback(async (id: string) => {
    try {
      await api.del(`/ai/conversations/${id}`);
      setConfirmDelete(null);
      if (active === id) { setActive(null); setMessages([]); }
      list.reload();
    } catch (cause) {
      notify(errorText(cause), "error");
    }
  }, [active, list, notify, errorText]);

  if (providers.loading) return <Loading />;
  if (providers.data && !providers.data.available) {
    return <Empty title={t("ai.noProviders")} />;
  }

  return (
    <div className="chat">
      <aside className="chat__list card">
        <div className="row row--between" style={{ marginBottom: 10 }}>
          <strong>{t("ai.conversations")}</strong>
          <button className="btn btn--primary btn--sm" type="button" onClick={() => void create()}>{t("ai.new")}</button>
        </div>
        {list.loading ? <Loading rows={2} />
          : list.error ? <ErrorBox error={list.error} onRetry={list.reload} />
          : !list.data?.conversations.length ? <Empty title={t("ai.empty")} />
          : (
            <ul className="chat__threads">
              {list.data.conversations.map((conversation) => (
                <li key={conversation.id}>
                  <button
                    className="navitem"
                    type="button"
                    aria-current={active === conversation.id ? "page" : undefined}
                    onClick={() => setActive(conversation.id)}
                  >
                    <span className="navitem__label">{conversation.title || t("ai.new")}</span>
                    <span className="card__meta num">{conversation.messageCount}</span>
                  </button>
                  <button
                    className="btn btn--ghost btn--sm chat__del"
                    type="button"
                    aria-label={t("ai.delete")}
                    onClick={() => setConfirmDelete(conversation.id)}
                  >✕</button>
                </li>
              ))}
            </ul>
          )}
      </aside>

      <section className="chat__main card">
        <div className="chat__scroll">
          {!active ? <Empty title={t("ai.empty")} />
            : !messages.length ? <Empty title={t("ai.emptyThread")} />
            : messages.map((message) => (
              <article key={message.id} className={`bubble bubble--${message.role}`}>
                <p className="bubble__text">{message.text}</p>
                {message.provider ? <span className="bubble__meta">{message.provider}</span> : null}
              </article>
            ))}
          {sending ? (
            <article className="bubble bubble--assistant bubble--thinking" aria-live="polite">
              <span className="spinner" aria-hidden="true" /> {t("ai.thinking")}
            </article>
          ) : null}
          {error ? <ErrorBox error={error} /> : null}
          <div ref={endRef} />
        </div>

        <form
          className="chat__composer"
          onSubmit={(event) => { event.preventDefault(); void send(); }}
        >
          {attachment ? (
            <div className="row chat__attachment">
              <span className="chip chip--cyan">▣ {attachment.name}</span>
              <button className="btn btn--ghost btn--sm" type="button" onClick={() => setAttachment(null)}>{t("common.close")}</button>
            </div>
          ) : null}
          <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void attach(file);
                event.target.value = "";
              }}
            />
            <button
              className="btn btn--ghost btn--icon"
              type="button"
              onClick={() => fileRef.current?.click()}
              aria-label={t("ai.attach")}
              disabled={!providers.data?.vision}
              title={providers.data?.vision ? t("ai.attach") : t("ai.noVision")}
            >▣</button>
            <textarea
              className="textarea"
              rows={1}
              placeholder={t("ai.placeholder")}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
              }}
              aria-label={t("ai.placeholder")}
            />
            {sending ? (
              <button className="btn btn--danger" type="button" onClick={stop}>{t("ai.stop")}</button>
            ) : (
              <button className="btn btn--primary" type="submit" disabled={!draft.trim() && !attachment}>{t("ai.send")}</button>
            )}
          </div>
        </form>
      </section>

      <Confirm
        open={Boolean(confirmDelete)}
        title={t("ai.delete")}
        confirmLabel={t("ai.delete")}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => { if (confirmDelete) void remove(confirmDelete); }}
      />
    </div>
  );
}
