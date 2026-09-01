import type { MeResponse, UserMemory } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Checkbox } from "@nexo/ui/components/checkbox";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { Textarea } from "@nexo/ui/components/textarea";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Brain, Check, Info, Loader2, Plus, Save, Sparkles, Trash2, User, Zap } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { api, ApiRequestError } from "@/lib/api";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const me = useQuery({
    queryKey: ["me"],
    queryFn: () => api<MeResponse>("/api/me"),
    staleTime: 30_000,
  });

  if (!me.data) {
    return (
      <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Carregando configurações…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-10 px-4 py-8 sm:px-8 sm:py-10">
      <SettingsForm
        key={me.data.user.id}
        initialName={me.data.user.name}
        email={me.data.user.email}
      />
      <HermesLoop me={me.data} />
    </div>
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
      toast.success("Perfil atualizado com sucesso.");
    },
    onError: (e) =>
      toast.error(e instanceof ApiRequestError ? e.message : "Falha ao salvar perfil"),
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <User className="size-4" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Perfil</h1>
          <p className="text-xs text-muted-foreground">
            Gerencie suas informações básicas de identificação
          </p>
        </div>
      </div>

      <form
        className="space-y-4 rounded-2xl border bg-card/50 p-5 shadow-xs backdrop-blur-xs"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="name" className="text-xs font-medium">
            Nome completo
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Seu nome"
          />
        </div>
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-muted-foreground">{email}</span>
          <Button type="submit" disabled={save.isPending} size="sm">
            {save.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Save className="size-3.5" />
            )}
            Salvar
          </Button>
        </div>
      </form>
    </section>
  );
}

function HermesLoop({ me }: { me: MeResponse }) {
  const queryClient = useQueryClient();
  const memories = useQuery({
    queryKey: ["me", "memory"],
    queryFn: () =>
      api<{
        memories: UserMemory[];
        memorySummary: string | null;
        personalPrompt: string | null;
        autoLearn: boolean;
      }>("/api/me/memory"),
    staleTime: 30_000,
  });

  // TanStack Query como fonte da verdade — sem useEffect de sincronização.
  // prompt é estado local apenas para edição; valor inicial vem do cache.
  // Usamos `undefined` como sentinel: enquanto usuário não editou, exibe
  // o valor do servidor. Isso evita o anti-pattern `useEffect(() => setPrompt(data))`
  // que sobrescreve digitação em refetch e causa renders extras.
  const [promptDraft, setPromptDraft] = useState<string | undefined>(undefined);
  const [newMem, setNewMem] = useState("");

  const serverPrompt = memories.data?.personalPrompt ?? "";
  const prompt = promptDraft !== undefined ? promptDraft : serverPrompt;
  // detecta dirty sem effect
  const isPromptDirty = promptDraft !== undefined && promptDraft !== serverPrompt;

  const savePrompt = useMutation({
    mutationFn: () =>
      api<MeResponse>("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ personalPrompt: prompt || null }),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["me"], data);
      queryClient.invalidateQueries({ queryKey: ["me", "memory"] });
      setPromptDraft(undefined); // volta a espelhar servidor — sem effect
      toast.success("Prompt pessoal salvo com sucesso!");
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Falha ao salvar"),
  });

  const toggleAuto = useMutation({
    mutationFn: (next: boolean) =>
      api<MeResponse>("/api/me", { method: "PATCH", body: JSON.stringify({ autoLearn: next }) }),
    onSuccess: (data, next) => {
      queryClient.setQueryData(["me"], data);
      queryClient.invalidateQueries({ queryKey: ["me", "memory"] });
      toast.success(next ? "Auto-learn ativado" : "Auto-learn desativado");
    },
  });

  const addMem = useMutation({
    mutationFn: () =>
      api("/api/me/memory", { method: "POST", body: JSON.stringify({ content: newMem }) }),
    onSuccess: async () => {
      setNewMem("");
      await queryClient.invalidateQueries({ queryKey: ["me", "memory"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Ensinado! O agente vai lembrar nas próximas respostas.");
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Falha ao ensinar"),
  });

  const delMem = useMutation({
    mutationFn: (id: string) => api(`/api/me/memory/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me", "memory"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("Memória removida.");
    },
  });

  const autoLearn = memories.data?.autoLearn ?? me.user.autoLearn ?? true;

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <Zap className="size-4" />
        </div>
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Loop de aprendizado — Hermes</h2>
          <p className="text-xs text-muted-foreground">
            Personalize como o assistente entende seu perfil e retém contexto contínuo
          </p>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-2xl border bg-muted/30 p-4 text-xs leading-5 shadow-xs">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Info className="size-4 text-muted-foreground" />
          Como funciona o sistema de contexto
        </div>
        <ol className="mt-2.5 list-decimal space-y-1.5 pl-5 text-muted-foreground">
          <li>
            <b className="text-foreground">Prompt do cargo:</b>{" "}
            <span className="font-medium text-foreground">{me.role?.name ?? "—"}</span> — definido
            pelo admin com as diretrizes operacionais.
          </li>
          <li>
            <b className="text-foreground">Seu prompt:</b> diretrizes pessoais suas (ex: “sempre
            responda em tópicos curtos, prefiro PT-BR informal”).
          </li>
          <li>
            <b className="text-foreground">Memória aprendida:</b> ao dizer “aprenda que…”, “lembre
            que…” ou dar feedbacks, o sistema aprende automaticamente.
          </li>
        </ol>
      </div>

      <div className="space-y-4 rounded-2xl border bg-card/50 p-5 shadow-xs backdrop-blur-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <Label htmlFor="personalPrompt" className="text-xs font-semibold">
              Seu prompt (user prompt)
            </Label>
          </div>
          <span className="rounded-full bg-muted/80 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
            {prompt.length}/2000
          </span>
        </div>

        <Textarea
          id="personalPrompt"
          placeholder="Ex: Sou do comercial, prefiro respostas em tópicos, sempre cite a fonte, meu time é X..."
          value={prompt}
          onChange={(e) => setPromptDraft(e.target.value)}
          rows={4}
          maxLength={2000}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <Button
            onClick={() => savePrompt.mutate()}
            disabled={savePrompt.isPending || !isPromptDirty}
            size="sm"
          >
            {savePrompt.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            Salvar meu prompt
          </Button>

          {me.role ? (
            <p
              className="max-w-sm truncate text-[11px] text-muted-foreground"
              title={me.role.systemPrompt}
            >
              Cargo: <span className="font-medium text-foreground">{me.role.name}</span> — “
              {me.role.systemPrompt.slice(0, 70)}…”
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-4 rounded-2xl border bg-card/50 p-5 shadow-xs backdrop-blur-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="size-4 text-primary" />
            <Label className="text-xs font-semibold">Memória aprendida</Label>
          </div>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors select-none">
            <Checkbox
              checked={autoLearn}
              onCheckedChange={(checked) => toggleAuto.mutate(Boolean(checked))}
            />
            Auto-learn
          </label>
        </div>

        {memories.data?.memorySummary ? (
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3.5 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
            <div className="font-medium mb-1">Resumo consolidado:</div>
            {memories.data.memorySummary}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Nenhuma memória ainda. Diga{" "}
            <span className="font-medium text-foreground">“aprenda que eu prefiro…”</span> durante
            uma conversa.
          </p>
        )}

        <div className="flex gap-2">
          <Input
            placeholder="Ensinar manualmente: ex: aprenda que prefiro respostas curtas"
            value={newMem}
            onChange={(e) => setNewMem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && newMem.trim() && !addMem.isPending) {
                e.preventDefault();
                addMem.mutate();
              }
            }}
          />
          <Button
            onClick={() => addMem.mutate()}
            disabled={!newMem.trim() || addMem.isPending}
            size="default"
          >
            {addMem.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Plus className="size-3.5" />
            )}
            Ensinar
          </Button>
        </div>

        {memories.data?.memories && memories.data.memories.length > 0 ? (
          <div className="space-y-2 pt-2">
            <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Memórias ativas ({memories.data.memories.length})
            </div>
            {memories.data.memories.map((m) => (
              <div
                key={m.id}
                className="group flex items-start justify-between gap-3 rounded-xl border bg-background/50 px-3.5 py-2.5 text-xs transition-colors hover:bg-muted/40"
              >
                <span className="flex-1 leading-relaxed text-foreground">
                  {m.content}
                  <span className="ml-2 inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {m.source}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground hover:text-destructive opacity-70 group-hover:opacity-100"
                  onClick={() => delMem.mutate(m.id)}
                  title="Remover memória"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
