import type { RoleSummary } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { Textarea } from "@nexo/ui/components/textarea";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api, ApiRequestError } from "@/lib/api";

export const Route = createFileRoute("/app/admin/roles/")({
  component: AdminRolesPage,
});

const fieldClass = "h-9 rounded-xl text-sm md:text-sm";
const areaClass = "min-h-28 rounded-xl text-sm md:text-sm leading-6";

function AdminRolesPage() {
  const queryClient = useQueryClient();
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: RoleSummary[] }>("/api/roles"),
  });
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [welcomeMd, setWelcomeMd] = useState("");

  const create = useMutation({
    mutationFn: () =>
      api("/api/roles", {
        method: "POST",
        body: JSON.stringify({ slug, name, description, systemPrompt, welcomeMd }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
      toast.success("Cargo criado.");
      setSlug("");
      setName("");
      setDescription("");
      setSystemPrompt("");
      setWelcomeMd("");
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao criar cargo.");
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/roles/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Não foi possível apagar.");
    },
  });

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cargos</h1>
        <p className="mt-1 text-sm text-muted-foreground">Cargo de sistema não pode ser apagado.</p>
      </div>

      <ul className="divide-y overflow-hidden rounded-2xl border">
        {roles.data?.roles.map((role) => (
          <li key={role.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <div className="min-w-0">
              <Link
                to="/app/admin/roles/$slug"
                params={{ slug: role.slug }}
                className="font-medium hover:underline"
              >
                {role.name}
              </Link>
              <p className="text-muted-foreground">
                {role.slug}
                {role.isSystem ? " · sistema" : ""}
              </p>
            </div>
            {role.isSystem ? null : (
              <Button variant="ghost" className="rounded-xl" onClick={() => remove.mutate(role.id)}>
                Apagar
              </Button>
            )}
          </li>
        ))}
      </ul>

      <form
        className="grid max-w-2xl gap-4 rounded-2xl border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <h2 className="text-base font-medium">Novo cargo</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="slug">Slug</Label>
            <Input
              id="slug"
              className={fieldClass}
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="name">Nome</Label>
            <Input
              id="name"
              className={fieldClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">Descrição</Label>
          <Input
            id="description"
            className={fieldClass}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="systemPrompt">System prompt</Label>
          <Textarea
            id="systemPrompt"
            className={areaClass}
            value={systemPrompt}
            onChange={(event) => setSystemPrompt(event.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="welcomeMd">Welcome markdown</Label>
          <Textarea
            id="welcomeMd"
            className={areaClass}
            value={welcomeMd}
            onChange={(event) => setWelcomeMd(event.target.value)}
            required
          />
        </div>
        <Button type="submit" className="w-fit rounded-xl" disabled={create.isPending}>
          Criar
        </Button>
      </form>
    </section>
  );
}
