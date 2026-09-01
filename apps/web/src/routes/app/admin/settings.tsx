import type { AdminSettings } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { Textarea } from "@nexo/ui/components/textarea";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api, ApiRequestError } from "@/lib/api";

export const Route = createFileRoute("/app/admin/settings")({
  component: AdminSettingsPage,
});

const areaClass = "min-h-40 rounded-xl text-sm md:text-sm leading-6";

function AdminSettingsPage() {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api<AdminSettings>("/api/admin/settings"),
  });

  const [globalPrompt, setGlobalPrompt] = useState<string | null>(null);
  const [budget, setBudget] = useState<string>("");

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api<AdminSettings>("/api/admin/settings", { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: async (next) => {
      queryClient.setQueryData(["admin-settings"], next);
      toast.success("Configurações salvas.");
      setGlobalPrompt(null);
      setBudget("");
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao salvar.");
    },
  });

  if (settings.isLoading || !settings.data) {
    return <section className="px-8 py-10 text-sm text-muted-foreground">Carregando…</section>;
  }

  const promptValue = globalPrompt ?? settings.data.globalSystemPrompt;

  return (
    <section className="mx-auto w-full max-w-2xl space-y-8 px-6 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Prompt global entra em todos os cargos (lote 5). Modelos ficam em{" "}
          <a href="/app/admin/models" className="underline">
            Modelos
          </a>
          .
        </p>
      </div>

      <form
        className="grid gap-4 rounded-2xl border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({ globalSystemPrompt: promptValue });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="global-prompt">Prompt global</Label>
          <Textarea
            id="global-prompt"
            className={areaClass}
            value={promptValue}
            onChange={(event) => setGlobalPrompt(event.target.value)}
          />
        </div>
        <Button
          type="submit"
          className="w-fit rounded-xl"
          disabled={save.isPending || globalPrompt === null}
        >
          Salvar prompt
        </Button>
      </form>

      <form
        className="grid gap-4 rounded-2xl border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate({
            monthlyBudgetUsd: budget.trim() === "" ? null : Number(budget),
          });
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="org-budget">Orçamento mensal da organização (USD)</Label>
          <Input
            id="org-budget"
            type="number"
            step="0.01"
            min="0"
            className="h-9 rounded-xl text-sm md:text-sm"
            placeholder={settings.data.monthlyBudgetUsd ?? "sem limite"}
            value={budget}
            onChange={(event) => setBudget(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Atual:{" "}
            {settings.data.monthlyBudgetUsd
              ? `${Number(settings.data.monthlyBudgetUsd).toFixed(2)} USD/mês`
              : "sem limite"}
            . Deixe vazio e salve para remover o limite.
          </p>
        </div>
        <Button
          type="submit"
          className="w-fit rounded-xl"
          disabled={save.isPending || budget === ""}
        >
          Salvar orçamento
        </Button>
      </form>
    </section>
  );
}
