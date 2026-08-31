import type { Conversation, MeResponse, Starter } from "@nexo/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ChatComposer } from "@/components/chat/composer";
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
  const firstName = me.data?.user.name?.split(" ")[0];

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-center px-6 py-10">
          <h1 className="text-center text-3xl font-semibold tracking-tight">
            {firstName ? `Olá, ${firstName}` : "Como posso ajudar?"}
          </h1>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            {me.data?.role?.name
              ? `Contexto do cargo ${me.data.role.name}. Escolha um atalho ou escreva.`
              : "Escolha um atalho ou escreva sua pergunta."}
          </p>
          <div className="mt-8 grid gap-2 sm:grid-cols-2">
            {starters.slice(0, 6).map((starter: Starter) => (
              <button
                key={starter.id}
                type="button"
                disabled={pending}
                onClick={() => void start(starter.prompt, starter.id)}
                className="group rounded-2xl border border-border/80 bg-background px-4 py-3 text-left transition-colors hover:bg-muted/60 disabled:opacity-60"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="text-sm font-medium">{starter.title}</span>
                  <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                </span>
                <span className="mt-1 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
                  {starter.prompt}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <ChatComposer
        value={draft}
        onChange={setDraft}
        onSubmit={() => void start(draft)}
        disabled={pending}
      />
    </section>
  );
}
