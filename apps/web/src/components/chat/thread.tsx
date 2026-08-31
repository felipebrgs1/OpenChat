import type { ChatMessage, MeResponse } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Textarea } from "@nexo/ui/components/textarea";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useModel } from "@/components/model-provider";
import { api, ApiRequestError } from "@/lib/api";
import { MarkdownBody } from "@/lib/markdown";
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
  });
  const history = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () =>
      api<{ messages: ChatMessage[] }>(`/api/conversations/${conversationId}/messages`),
  });
  const [live, setLive] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [slow, setSlow] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const sentInitial = useRef(false);
  const slowTimer = useRef<number | null>(null);
  const messages = live ?? history.data?.messages ?? [];

  const send = async (content: string, starterId?: string | null) => {
    const text = content.trim();
    if (!text || streaming) {
      return;
    }
    setDraft("");
    setStreaming(true);
    setSlow(false);
    if (slowTimer.current) {
      window.clearTimeout(slowTimer.current);
    }
    slowTimer.current = window.setTimeout(() => setSlow(true), 8000);

    const tempUser: ChatMessage = {
      id: `temp-user-${Date.now()}`,
      conversationId,
      role: "user",
      content: text,
      model: null,
      promptTokens: null,
      completionTokens: null,
      costUsd: null,
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
              row.id === tempAssistant.id ? { ...row, id: meta.messageId, model: meta.model } : row,
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
                    costUsd: done.costUsd !== null ? String(done.costUsd) : null,
                  }
                : row,
            ),
          );
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
      if (slowTimer.current) {
        window.clearTimeout(slowTimer.current);
      }
      await queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  };

  useEffect(() => {
    if (!initialPrompt || sentInitial.current || !history.isSuccess) {
      return;
    }
    sentInitial.current = true;
    void send(initialPrompt, initialStarterId);
    // initial send once after history loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.isSuccess, initialPrompt, initialStarterId]);

  const lastUser = [...messages].reverse().find((row) => row.role === "user");

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-6">
        {messages.length === 0 && !streaming ? (
          <p className="text-sm text-muted-foreground">Escreva no campo abaixo para começar.</p>
        ) : null}
        {messages.map((message) => (
          <article key={message.id} className="max-w-3xl">
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {message.role === "user" ? "Você" : "Nexo"}
            </p>
            {message.role === "assistant" ? (
              <MarkdownBody content={message.content || (streaming ? "▍" : "")} />
            ) : (
              <p className="text-sm">{message.content}</p>
            )}
            {message.error ? (
              <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
                <span>{message.error}</span>
                {lastUser ? (
                  <Button variant="ghost" onClick={() => void send(lastUser.content)}>
                    Tentar de novo
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
              {message.model ? <span>{message.model}</span> : null}
              {me.data?.user.isAdmin && message.costUsd ? <span>US$ {message.costUsd}</span> : null}
              {message.content ? (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void navigator.clipboard.writeText(message.content)}
                >
                  Copiar
                </Button>
              ) : null}
            </div>
          </article>
        ))}
        {slow && streaming ? <p className="text-xs text-muted-foreground">ainda gerando…</p> : null}
      </div>
      <form
        className="border-t p-4"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <div className="mx-auto flex max-w-3xl gap-2">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Pergunte ao Nexo"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void send(draft);
              }
            }}
          />
          {streaming ? (
            <Button type="button" variant="outline" onClick={() => abortRef.current?.abort()}>
              Parar
            </Button>
          ) : (
            <Button type="submit">Enviar</Button>
          )}
        </div>
      </form>
    </div>
  );
}
