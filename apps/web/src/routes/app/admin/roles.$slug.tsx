import type { RoleDetail } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { Textarea } from "@nexo/ui/components/textarea";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api, ApiRequestError } from "@/lib/api";

export const Route = createFileRoute("/app/admin/roles/$slug")({
  component: RoleEditPage,
});

function RoleEditPage() {
  const { slug } = Route.useParams();
  const role = useQuery({
    queryKey: ["role", slug],
    queryFn: () => api<RoleDetail>(`/api/roles/${slug}`),
  });

  if (!role.data) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;
  }

  return <RoleForm key={role.data.id} role={role.data} />;
}

function RoleForm({ role }: { role: RoleDetail }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(role.name);
  const [description, setDescription] = useState(role.description);
  const [systemPrompt, setSystemPrompt] = useState(role.systemPrompt);
  const [welcomeMd, setWelcomeMd] = useState(role.welcomeMd);
  const [startersText, setStartersText] = useState(
    role.starters.map((starter) => starter.prompt).join("\n"),
  );

  const save = useMutation({
    mutationFn: async () => {
      await api(`/api/roles/${role.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, description, systemPrompt, welcomeMd }),
      });
      const starters = startersText
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((prompt) => ({
          title: prompt.length > 72 ? `${prompt.slice(0, 69)}…` : prompt,
          prompt,
        }));
      await api(`/api/roles/${role.id}/starters`, {
        method: "PUT",
        body: JSON.stringify({ starters }),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["role", role.slug] });
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast.success("Cargo atualizado.");
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao salvar.");
    },
  });

  return (
    <section className="mx-auto max-w-2xl space-y-6 px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">{role.name}</h1>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Descrição</Label>
          <Input
            id="description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="systemPrompt">System prompt</Label>
          <Textarea
            id="systemPrompt"
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="welcomeMd">Welcome markdown</Label>
          <Textarea
            id="welcomeMd"
            value={welcomeMd}
            onChange={(event) => setWelcomeMd(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="starters">Perguntas-guia (uma por linha)</Label>
          <Textarea
            id="starters"
            value={startersText}
            onChange={(event) => setStartersText(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={save.isPending}>
          Salvar
        </Button>
      </form>
    </section>
  );
}
