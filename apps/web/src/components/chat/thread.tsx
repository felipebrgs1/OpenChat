import type { ChatMessage, MeResponse } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { cn } from "@nexo/ui/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, RotateCcw } from "lucide-react";
import { useCallback, useLayoutEffect, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ChatComposer } from "@/components/chat/composer";
import { FeedbackBar, RagSources } from "@/components/chat/rag-sources";
import { useModel } from "@/components/model-provider";
import { UserAvatar } from "@/components/user-avatar";
import { api, ApiRequestError } from "@/lib/api";
import { MarkdownBody } from "@/lib/markdown";
import { modelLabel } from "@/lib/models";
import { streamChat } from "@/lib/sse";

export function ChatThread({
  conversationId,
  initialPrompt,
  initialStarterId,
}: {
  conversationId: string;
  initialPrompt?: string;
  initialStarterId?: string;
}) {
  const { model } = useModel();
  const queryClient = useQueryClient();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
    staleTime: 30_000,
  });
  const history = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () =>
      api<{ messages: ChatMessage[] }>(`/api/conversations/${conversationId}/messages`),
    staleTime: 10_000,
  });
  const [live, setLive] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [slow, setSlow] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [feedbackDone, setFeedbackDone] = useState<Record<string, string>>({});
  const abortRef = useRef<AbortController | null>(null);
  const sentInitial = useRef(false);
  const slowTimer = useRef<number | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const messages = live ?? history.data?.messages ?? [];
  const lastMessage = messages[messages.length - 1];

  // Nota: reset ao trocar conversationId já é feito via key={conversationId}
  // no parent (chat.$conversationId.tsx). Este estado live/draft é scoped
  // ao mount, não precisa de useEffect([conversationId]).

  // scroll imperativo — useLayoutEffect evita flash, roda após DOM mas antes do paint
  useLayoutEffect(() => {
    if (!stickToBottom.current) return;
    const node = scrollerRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [lastMessage?.id, lastMessage?.content, streaming]);

  const send = useCallback(
    async (content: string, starterId?: string | null) => {
      const text = content.trim();
      if (!text || streaming) return;
      setDraft("");
      setStreaming(true);
      setSlow(false);
      stickToBottom.current = true;
      if (slowTimer.current) window.clearTimeout(slowTimer.current);
      slowTimer.current = window.setTimeout(() => setSlow(true), 8000);

      const tempUser: ChatMessage = {
        id: `temp-user-${Date.now()}`,
        conversationId,
        role: "user",
        content: text,
        model: null,
        promptTokens: null,
        completionTokens: null,
        credits: null,
        tps: null,
        latencyMs: null,
        finishReason: null,
        error: null,
        createdAt: new Date().toISOString(),
      };
      const tempAssistant: ChatMessage = {
        ...tempUser,
        id: `temp-assistant-${Date.now()}`,
        role: "assistant",
        content: "",
      };
      setLive((current) => [...(current ?? history.data?.messages ?? []), tempUser, tempAssistant]);

      const controller = new AbortController();
      abortRef.current = controller;
      let assistantId = tempAssistant.id;

      try {
        await streamChat({
          conversationId,
          content: text,
          model,
          starterId,
          signal: controller.signal,
          onMeta: (meta) => {
            assistantId = meta.messageId;
            setLive((current) =>
              (current ?? []).map((row) =>
                row.id === tempAssistant.id
                  ? { ...row, id: meta.messageId, model: meta.model }
                  : row,
              ),
            );
          },
          onSources: (src) => {
            setLive((current) =>
              (current ?? []).map((row) =>
                row.id === (src.messageId === assistantId ? assistantId : row.id) ||
                row.id === assistantId
                  ? { ...row, sources: src.sources as never, hasSources: src.hasSources as never }
                  : row,
              ),
            );
          },
          onDelta: (delta) => {
            setLive((current) =>
              (current ?? []).map((row) =>
                row.id === assistantId ? { ...row, content: row.content + delta } : row,
              ),
            );
          },
          onDone: (done) => {
            setLive((current) =>
              (current ?? []).map((row) =>
                row.id === done.messageId
                  ? {
                      ...row,
                      promptTokens: done.promptTokens,
                      completionTokens: done.completionTokens,
                      credits: (done.credits as string | null) ?? null,
                      tps: (done.tps as number | null) ?? null,
                      latencyMs: (done.latencyMs as number | null) ?? null,
                    }
                  : row,
              ),
            );
            if (done.balanceAfter) {
              void queryClient.invalidateQueries({ queryKey: ["me"] });
              void queryClient.invalidateQueries({ queryKey: ["credits", "balance"] });
            }
          },
          onError: (_code, message) => {
            setLive((current) =>
              (current ?? []).map((row) =>
                row.id === assistantId ? { ...row, error: message } : row,
              ),
            );
            toast.error(message);
          },
        });
      } catch (error) {
        const message = error instanceof ApiRequestError ? error.message : "Erro de rede.";
        setLive((current) =>
          (current ?? []).map((row) => (row.id === assistantId ? { ...row, error: message } : row)),
        );
        toast.error(message);
      } finally {
        setStreaming(false);
        setSlow(false);
        abortRef.current = null;
        if (slowTimer.current) window.clearTimeout(slowTimer.current);
        await queryClient.invalidateQueries({ queryKey: ["conversations"] });
      }
    },
    [conversationId, history.data?.messages, model, queryClient, streaming],
  );

  // envia initialPrompt uma única vez após history carregar (deep-link ?prompt=)
  // TanStack Query já controla loading; este effect é o único legítimo aqui
  /* eslint-disable react/set-state-in-effect */
  useEffect(() => {
    if (!initialPrompt || sentInitial.current || !history.isSuccess) return;

    const alreadySent = history.data?.messages.some(
      (m) => m.role === "user" && m.content.trim() === initialPrompt.trim(),
    );
    if (alreadySent) {
      sentInitial.current = true;
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }
    sentInitial.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    void send(initialPrompt, initialStarterId);
  }, [history.isSuccess, history.data?.messages, initialPrompt, initialStarterId, send]);
  /* eslint-enable react/set-state-in-effect */

  const lastUser = [...messages].reverse().find((row) => row.role === "user");
  const copy = async (message: ChatMessage) => {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(
      () => setCopiedId((current) => (current === message.id ? null : current)),
      1500,
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={(event) => {
          const node = event.currentTarget;
          stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
        }}
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
          {messages.length === 0 && !streaming ? (
            <div className="m-auto max-w-md text-center">
              <h2 className="text-2xl font-semibold tracking-tight">Como posso ajudar?</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Escreva abaixo. O assistente usa o contexto do seu cargo.
              </p>
            </div>
          ) : null}
          {messages.map((message) => {
            const isUser = message.role === "user";
            const isLastAssistant =
              !isUser && messages[messages.length - 1]?.id === message.id && streaming;
            return (
              <article
                key={message.id}
                className={cn("group flex w-full gap-3", isUser ? "justify-end" : "justify-start")}
              >
                {isUser ? null : (
                  <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] font-semibold text-background">
                    N
                  </span>
                )}
                <div className={cn("min-w-0", isUser ? "max-w-[85%] sm:max-w-[72%]" : "flex-1")}>
                  {isUser ? (
                    <div className="rounded-3xl bg-muted px-4 py-2.5 text-[15px] leading-6">
                      {message.content}
                    </div>
                  ) : (
                    <div>
                      {message.content ? <MarkdownBody content={message.content} /> : null}
                      {isLastAssistant && !message.content ? (
                        <span className="inline-flex gap-1 py-2">
                          <span className="size-1.5 animate-bounce rounded-full bg-foreground/70 [animation-delay:-0.2s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-foreground/70 [animation-delay:-0.1s]" />
                          <span className="size-1.5 animate-bounce rounded-full bg-foreground/70" />
                        </span>
                      ) : null}
                      {isLastAssistant && message.content ? (
                        <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-foreground" />
                      ) : null}
                      {/* R5 — fontes estruturadas + estado sem fonte */}
                      {Array.isArray((message as unknown as { sources?: unknown }).sources) ? (
                        <RagSources
                          sources={
                            (
                              message as unknown as {
                                sources: import("@nexo/contracts").RagSource[];
                              }
                            ).sources
                          }
                          hasSources={
                            ((
                              message as unknown as {
                                sources: import("@nexo/contracts").RagSource[];
                              }
                            ).sources.length ?? 0) > 0
                          }
                        />
                      ) : (message as unknown as { hasSources?: boolean }).hasSources === false ? (
                        <RagSources sources={[]} hasSources={false} />
                      ) : null}
                      {!isUser && message.content && !isLastAssistant ? (
                        feedbackDone[message.id] ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Obrigado pelo feedback!
                          </p>
                        ) : (
                          <FeedbackBar
                            messageId={message.id}
                            onFeedback={(rating) =>
                              setFeedbackDone((prev) => ({ ...prev, [message.id]: rating }))
                            }
                          />
                        )
                      ) : null}
                    </div>
                  )}
                  {message.error ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-destructive">
                      <span>{message.error}</span>
                      {lastUser ? (
                        <Button
                          variant="ghost"
                          size="xs"
                          className="rounded-full"
                          onClick={() => void send(lastUser.content)}
                        >
                          <RotateCcw className="size-3" />
                          Tentar de novo
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                  {!isUser && (message.content || message.model) ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {message.content ? (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="rounded-full"
                          onClick={() => void copy(message)}
                          aria-label="Copiar"
                        >
                          {copiedId === message.id ? <Check /> : <Copy />}
                        </Button>
                      ) : null}
                      {message.model ? (
                        <span className="px-1 text-[11px] text-muted-foreground">
                          {modelLabel(message.model)}
                        </span>
                      ) : null}
                      {message.credits && me.data?.user.isAdmin ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
                          {Number(message.credits).toFixed(2)} créditos
                        </span>
                      ) : null}
                      {message.tps != null ? (
                        <span className="text-[11px] text-muted-foreground">
                          {message.tps.toFixed(1)} t/s
                        </span>
                      ) : null}
                      {message.latencyMs != null ? (
                        <span className="text-[11px] text-muted-foreground">
                          • {message.latencyMs}ms
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {isUser ? (
                  <UserAvatar
                    name={me.data?.user.name}
                    email={me.data?.user.email}
                    className="mt-0.5"
                  />
                ) : null}
              </article>
            );
          })}
          {slow && streaming ? (
            <p className="text-center text-xs text-muted-foreground">ainda gerando…</p>
          ) : null}
        </div>
      </div>
      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSubmit={() => void send(draft)}
        onStop={() => abortRef.current?.abort()}
        streaming={streaming}
      />
    </div>
  );
}
