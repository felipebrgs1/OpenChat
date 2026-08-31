import type { MeResponse } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
  });

  if (!me.data) {
    return <div className="p-8 text-sm text-muted-foreground">Carregando…</div>;
  }

  return (
    <SettingsForm
      key={me.data.user.id}
      initialName={me.data.user.name}
      email={me.data.user.email}
    />
  );
}

function SettingsForm({ initialName, email }: { initialName: string; email: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(initialName);

  const save = useMutation({
    mutationFn: () =>
      api<MeResponse>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ name }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], data);
      toast.success("Perfil atualizado.");
    },
  });

  return (
    <section className="mx-auto max-w-lg space-y-6 px-8 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Perfil</h1>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="name">Nome</Label>
          <Input id="name" value={name} onChange={(event) => setName(event.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">{email}</p>
        <Button type="submit" disabled={save.isPending}>
          Salvar
        </Button>
      </form>
    </section>
  );
}
