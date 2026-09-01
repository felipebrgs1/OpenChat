import type {
  KnowledgeCollectionSummary,
  RoleSummary,
} from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { Checkbox } from "@nexo/ui/components/checkbox";
import { Input } from "@nexo/ui/components/input";
import { Label } from "@nexo/ui/components/label";
import { Textarea } from "@nexo/ui/components/textarea";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api, ApiRequestError } from "@/lib/api";

export const Route = createFileRoute("/app/admin/knowledge")({
  component: AdminKnowledgePage,
});

const fieldClass = "h-9 rounded-xl text-sm md:text-sm";
const areaClass = "min-h-28 rounded-xl text-sm md:text-sm leading-6";

function AdminKnowledgePage() {
  const queryClient = useQueryClient();
  const collections = useQuery({
    queryKey: ["knowledge"],
    queryFn: () => api<{ collections: KnowledgeCollectionSummary[] }>("/api/knowledge"),
  });
  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: () => api<{ roles: RoleSummary[] }>("/api/roles"),
  });

  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"by_role" | "all">("by_role");
  const [roleIds, setRoleIds] = useState<string[]>([]);

  const [docTitle, setDocTitle] = useState("");
  const [docBody, setDocBody] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["knowledge"] });

  const createCollection = useMutation({
    mutationFn: () =>
      api("/api/knowledge", {
        method: "POST",
        body: JSON.stringify({ slug, name, description, visibility, roleIds }),
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Base criada.");
      setSlug("");
      setName("");
      setDescription("");
      setRoleIds([]);
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao criar base.");
    },
  });

  const createDocument = useMutation({
    mutationFn: (input: { collectionId: string; title: string; bodyMd: string }) =>
      api(`/api/knowledge/${input.collectionId}/documents`, {
        method: "POST",
        body: JSON.stringify({ title: input.title, bodyMd: input.bodyMd }),
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Documento publicado.");
      setDocTitle("");
      setDocBody("");
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao publicar doc.");
    },
  });

  const removeDocument = useMutation({
    mutationFn: (id: string) => api(`/api/knowledge/documents/${id}`, { method: "DELETE" }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Documento removido.");
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao remover.");
    },
  });

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bases de conhecimento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bases vinculadas ao cargo entram no system prompt (cap de ~4k tokens, docs inteiros por
          atualização).
        </p>
      </div>

      <ul className="divide-y overflow-hidden rounded-2xl border">
        {(collections.data?.collections ?? []).map((collection) => (
          <li key={collection.id} className="px-4 py-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <Link
                  to="/app/knowledge/$collectionId"
                  params={{ collectionId: collection.id }}
                  className="font-medium hover:underline"
                >
                  {collection.name}
                </Link>
                <p className="text-muted-foreground">
                  {collection.slug} · {collection.visibility === "all" ? "todos" : "por cargo"} ·{" "}
                  {collection.documentCount} doc(s)
                </p>
              </div>
            </div>
            <form
              className="mt-3 grid gap-2 rounded-xl bg-muted/40 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                createDocument.mutate({
                  collectionId: collection.id,
                  title: docTitle,
                  bodyMd: docBody,
                });
              }}
            >
              <Input
                className={fieldClass}
                placeholder="Título do documento"
                value={docTitle}
                onChange={(event) => setDocTitle(event.target.value)}
                required
              />
              <Textarea
                className={areaClass}
                placeholder="Conteúdo markdown"
                value={docBody}
                onChange={(event) => setDocBody(event.target.value)}
                required
              />
              <Button type="submit" className="w-fit rounded-xl" disabled={createDocument.isPending}>
                Publicar neste base
              </Button>
            </form>
          </li>
        ))}
      </ul>

      <form
        className="grid max-w-2xl gap-4 rounded-2xl border p-5"
        onSubmit={(event) => {
          event.preventDefault();
          createCollection.mutate();
        }}
      >
        <h2 className="text-base font-medium">Nova base</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="kb-slug">Slug</Label>
            <Input
              id="kb-slug"
              className={fieldClass}
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="kb-name">Nome</Label>
            <Input
              id="kb-name"
              className={fieldClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="kb-description">Descrição</Label>
          <Input
            id="kb-description"
            className={fieldClass}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="kb-visibility"
              checked={visibility === "by_role"}
              onChange={() => setVisibility("by_role")}
            />
            Restrita por cargo
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="kb-visibility"
              checked={visibility === "all"}
              onChange={() => setVisibility("all")}
            />
            Visível para todos
          </label>
        </div>
        {visibility === "by_role" ? (
          <div className="space-y-2">
            <Label>Cargos com acesso</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {(roles.data?.roles ?? []).map((role) => (
                <label key={role.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={roleIds.includes(role.id)}
                    onCheckedChange={(checked) => {
                      setRoleIds((current) =>
                        checked ? [...current, role.id] : current.filter((id) => id !== role.id),
                      );
                    }}
                  />
                  {role.name}
                </label>
              ))}
            </div>
          </div>
        ) : null}
        <Button type="submit" className="w-fit rounded-xl" disabled={createCollection.isPending}>
          Criar base
        </Button>
      </form>
    </section>
  );
}
