import type { Conversation, KnowledgeCollectionSummary, MeResponse } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { useModel } from "@/components/model-provider";
import { api, ApiRequestError } from "@/lib/api";
import { MarkdownBody } from "@/lib/markdown";

export const Route = createFileRoute("/app/")({
  component: HomePage,
});

function HomePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { model } = useModel();
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
  });
  const recents = useQuery({
    queryKey: ["conversations"],
    queryFn: () => api<{ conversations: Conversation[] }>("/api/conversations"),
    retry: false,
  });
  const knowledge = useQuery({
    queryKey: ["knowledge"],
    queryFn: () =>
      api<{ collections: KnowledgeCollectionSummary[] }>("/api/knowledge"),
  });
  const onboard = useMutation({
    mutationFn: () =>
      api<MeResponse>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ onboardedAt: new Date().toISOString() }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], data);
    },
  });

  if (me.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Carregando cargo…
      </div>
    );
  }

  const role = me.data?.role;
  const user = me.data?.user;

  if (!role || !user?.roleId) {
    return (
      <section className="mx-auto flex h-full max-w-lg flex-col justify-center px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Aguarde o admin</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Peça ao admin um cargo. Sem cargo você não entra no assistente.
        </p>
      </section>
    );
  }

  const onboarded = Boolean(user.onboardedAt);

  const startStarter = async (prompt: string, starterId: string) => {
    if (!onboarded) {
      toast.error("Marque que entendeu o cargo antes do chat.");
      return;
    }
    try {
      const conversation = await api<Conversation>("/api/conversations", {
        method: "POST",
        body: JSON.stringify({ model: model || undefined }),
      });
      await navigate({
        to: "/app/chat/$conversationId",
        params: { conversationId: conversation.id },
        search: { prompt, starterId },
      });
    } catch (error) {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao abrir o chat.");
    }
  };

  return (
    <section className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            {role.name}
          </p>
          <div className="mt-3">
            <MarkdownBody content={role.welcomeMd} />
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">{role.description}</p>
        </div>

        {!onboarded ? (
          <div className="flex flex-col gap-3 rounded-2xl border bg-muted/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm leading-6">
              Li o texto do meu cargo e entendi o que o assistente prioriza.
            </p>
            <Button
              className="rounded-full"
              disabled={onboard.isPending}
              onClick={() => onboard.mutate()}
            >
              Entendi meu cargo
            </Button>
          </div>
        ) : null}

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Perguntas-guia</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {role.starters.map((starter) => (
              <button
                key={starter.id}
                type="button"
                className="rounded-2xl border border-border/80 px-4 py-3 text-left transition-colors hover:bg-muted/60"
                onClick={() => void startStarter(starter.prompt, starter.id)}
              >
                <span className="block text-sm font-medium">{starter.title}</span>
                <span className="mt-1 line-clamp-2 block text-[13px] leading-5 text-muted-foreground">
                  {starter.prompt}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">
            Bases que você pode consultar
          </h2>
          {(knowledge.data?.collections ?? []).length === 0 ? (
            <p className="text-[13px] leading-6 text-muted-foreground">
              Seu cargo ainda não tem base; as respostas serão genéricas.
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {(knowledge.data?.collections ?? []).map((collection) => (
                <li key={collection.id}>
                  <Link
                    to="/app/knowledge/$collectionId"
                    params={{ collectionId: collection.id }}
                    className="block rounded-2xl border border-border/80 px-4 py-3 text-sm transition-colors hover:bg-muted/60"
                  >
                    <span className="block font-medium">{collection.name}</span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">
                      {collection.documentCount} doc(s)
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Conversas recentes</h2>
          <ul className="divide-y rounded-2xl border">
            {(recents.data?.conversations ?? []).slice(0, 3).map((conversation) => (
              <li key={conversation.id}>
                <Link
                  to="/app/chat/$conversationId"
                  params={{ conversationId: conversation.id }}
                  className="block px-4 py-3 text-sm hover:bg-muted/50"
                >
                  {conversation.title || "Nova conversa"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
