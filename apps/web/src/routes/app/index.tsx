import type { Conversation, MeResponse } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@nexo/ui/components/card";
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
    return <div className="p-8 text-sm text-muted-foreground">Carregando cargo…</div>;
  }

  const role = me.data?.role;
  const user = me.data?.user;

  if (!role || !user?.roleId) {
    return (
      <section className="mx-auto max-w-xl px-8 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Aguarde o admin</h1>
        <p className="mt-2 text-sm text-muted-foreground">
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
    <section className="mx-auto max-w-3xl space-y-8 overflow-y-auto px-8 py-10">
      <MarkdownBody content={role.welcomeMd} />
      <p className="text-sm text-muted-foreground">{role.description}</p>

      {!onboarded ? (
        <div className="flex items-center justify-between gap-4 border p-4">
          <p className="text-sm">Li o texto do meu cargo e entendi o que o assistente prioriza.</p>
          <Button disabled={onboard.isPending} onClick={() => onboard.mutate()}>
            Entendi meu cargo
          </Button>
        </div>
      ) : null}

      <div>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Perguntas-guia
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {role.starters.map((starter) => (
            <button
              key={starter.id}
              type="button"
              className="text-left"
              onClick={() => void startStarter(starter.prompt, starter.id)}
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

      <div>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Conversas recentes
        </h2>
        <ul className="space-y-1 text-sm">
          {(recents.data?.conversations ?? []).slice(0, 3).map((conversation) => (
            <li key={conversation.id}>
              <Link
                to="/app/chat/$conversationId"
                params={{ conversationId: conversation.id }}
                className="hover:underline"
              >
                {conversation.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
