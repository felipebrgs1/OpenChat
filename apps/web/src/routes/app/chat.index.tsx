import type { Conversation, MeResponse, Starter } from "@nexo/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@nexo/ui/components/card";
import { Textarea } from "@nexo/ui/components/textarea";
import { Button } from "@nexo/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { useModel } from "@/components/model-provider";
import { api, ApiRequestError } from "@/lib/api";

export const Route = createFileRoute("/app/chat/")({
  component: ChatIndexPage,
});

function ChatIndexPage() {
  const navigate = useNavigate();
  const { model } = useModel();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
  });
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);

  if (me.data && !me.data.user.onboardedAt) {
    return <Navigate to="/app" />;
  }

  const start = async (content: string, starterId?: string) => {
    const text = content.trim();
    if (!text || pending) {
      return;
    }
    setPending(true);
    try {
      const conversation = await api<Conversation>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ model: model || undefined }),
      });
      await navigate({
        to: "/app/chat/$conversationId",
        params: { conversationId: conversation.id },
        search: { prompt: text, starterId },
      });
    } catch (error) {
      toast.error(
        error instanceof ApiRequestError ? error.message : "Não foi possível criar a conversa.",
      );
      setPending(false);
    }
  };

  const starters = me.data?.role?.starters ?? [];

  return (
    <section className="mx-auto flex h-full max-w-3xl flex-col justify-between px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Nova conversa</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Escolha uma pergunta-guia ou escreva a sua.
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {starters.map((starter: Starter) => (
            <button
              key={starter.id}
              type="button"
              className="text-left"
              onClick={() => void start(starter.prompt, starter.id)}
            >
              <Card size="sm">
                <CardHeader>
                  <CardTitle>{starter.title}</CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground">{starter.prompt}</CardContent>
              </Card>
            </button>
          ))}
        </div>
      </div>
      <form
        className="flex gap-2 pt-6"
        onSubmit={(event) => {
          event.preventDefault();
          void start(draft);
        }}
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Pergunte ao Nexo"
        />
        <Button type="submit" disabled={pending}>
          Enviar
        </Button>
      </form>
    </section>
  );
}
