import type { AdminSettings } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { Select } from "@nexo/ui/components/select";
import { cn } from "@nexo/ui/lib/utils";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { api, ApiRequestError } from "@/lib/api";

export const Route = createFileRoute("/app/admin/models")({
  component: AdminModelsPage,
});

function AdminModelsPage() {
  const settings = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () => api<AdminSettings>("/api/admin/settings"),
  });

  if (settings.isLoading || !settings.data) {
    return (
      <section className="px-8 py-10 text-sm text-muted-foreground">Carregando catálogo…</section>
    );
  }

  return (
    <AdminModelsForm
      key={`${settings.data.defaultModel}:${settings.data.allowedModels.join(",")}`}
      data={settings.data}
    />
  );
}

function AdminModelsForm({ data }: { data: AdminSettings }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(data.allowedModels);
  const [defaultModel, setDefaultModel] = useState(data.defaultModel);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return data.catalog;
    }
    return data.catalog.filter(
      (row) => row.id.toLowerCase().includes(term) || row.name.toLowerCase().includes(term),
    );
  }, [data.catalog, query]);

  const save = useMutation({
    mutationFn: () =>
      api<AdminSettings>("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ allowedModels: selected, defaultModel }),
      }),
    onSuccess: async (next) => {
      queryClient.setQueryData(["admin-settings"], next);
      await queryClient.invalidateQueries({ queryKey: ["models"] });
      toast.success("Modelos atualizados.");
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao salvar.");
    },
  });

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = current.includes(id) ? current.filter((row) => row !== id) : [...current, id];
      if (next.length === 0) {
        return current;
      }
      if (!next.includes(defaultModel)) {
        setDefaultModel(next[0] ?? id);
      }
      return next;
    });
  };

  return (
    <section className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-end justify-between gap-4 px-8 py-8">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Modelos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha quais modelos OpenRouter o time pode usar no chat.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="default-model">Padrão</Label>
            <Select
              id="default-model"
              className="min-w-56"
              value={defaultModel}
              onChange={(event) => setDefaultModel(event.target.value)}
            >
              {selected.map((id) => {
                const name = data.catalog.find((row) => row.id === id)?.name ?? id;
                return (
                  <option key={id} value={id}>
                    {name}
                  </option>
                );
              })}
            </Select>
          </div>
          <Button
            className="rounded-xl"
            disabled={save.isPending || selected.length === 0}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </div>
      <div className="px-8 pb-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar no catálogo OpenRouter"
          className="h-9 max-w-md rounded-xl"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          {selected.length} selecionado{selected.length === 1 ? "" : "s"}
          {data.catalog.length
            ? ` · ${data.catalog.length} no catálogo`
            : " · catálogo vazio (confira OPENROUTER_API_KEY)"}
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10">
        {data.catalog.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar o catálogo. Confira OPENROUTER_API_KEY no .env da raiz.
          </p>
        ) : null}
        <div className="divide-y rounded-2xl border">
          {filtered.map((row) => {
            const checked = selected.includes(row.id);
            return (
              <button
                key={row.id}
                type="button"
                onClick={() => toggle(row.id)}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/50",
                  checked && "bg-muted/40",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-md border",
                    checked && "border-foreground bg-foreground text-background",
                  )}
                >
                  {checked ? <Check className="size-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{row.name}</span>
                  <span className="block truncate text-[12px] text-muted-foreground">{row.id}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
