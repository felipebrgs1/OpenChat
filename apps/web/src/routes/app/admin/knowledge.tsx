import type {
  KnowledgeCollectionDetail,
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

  const [expandedDocs, setExpandedDocs] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editVisibility, setEditVisibility] = useState<"by_role" | "all">("by_role");
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [historyId, setHistoryId] = useState<string | null>(null);

  const historyQ = useQuery({
    queryKey: ["knowledge-history", historyId],
    queryFn: () =>
      api<{
        history: Array<{
          id: string;
          action: string;
          createdAt: string;
          actorId: string | null;
          meta: unknown;
        }>;
      }>(`/api/knowledge/${historyId}/history`),
    enabled: !!historyId,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    if (expandedDocs)
      queryClient.invalidateQueries({ queryKey: ["knowledge-detail", expandedDocs] });
  };

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

  const patchCollection = useMutation({
    mutationFn: (payload: {
      id: string;
      name?: string;
      description?: string;
      visibility?: string;
      roleIds?: string[];
    }) =>
      api(`/api/knowledge/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Base atualizada.");
      setEditingId(null);
    },
    onError: (error) => {
      toast.error(error instanceof ApiRequestError ? error.message : "Falha ao atualizar base.");
    },
  });

  return (
    <section className="mx-auto w-full max-w-5xl space-y-8 px-6 py-8 sm:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bases de conhecimento</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bases vinculadas ao cargo entram no RAG (híbrido + rerank). Edite com histórico de
          alteração.
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
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() =>
                    setExpandedDocs(expandedDocs === collection.id ? null : collection.id)
                  }
                >
                  {expandedDocs === collection.id
                    ? "Fechar docs"
                    : `Ver docs (${collection.documentCount})`}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => {
                    setEditingId(collection.id);
                    setEditName(collection.name);
                    setEditDescription(collection.description);
                    setEditVisibility(collection.visibility as "by_role" | "all");
                    setEditRoleIds(collection.roleIds);
                    setHistoryId(null);
                  }}
                >
                  Editar
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setHistoryId(historyId === collection.id ? null : collection.id)}
                >
                  {historyId === collection.id ? "Fechar histórico" : "Histórico"}
                </Button>
              </div>
            </div>
            {expandedDocs === collection.id ? (
              <CollectionDocs collectionId={collection.id} />
            ) : null}
            {editingId === collection.id ? (
              <form
                className="mt-3 grid gap-3 rounded-xl border bg-card p-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  patchCollection.mutate({
                    id: collection.id,
                    name: editName,
                    description: editDescription,
                    visibility: editVisibility,
                    roleIds: editRoleIds,
                  });
                }}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Nome</Label>
                    <Input
                      className={fieldClass}
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Descrição</Label>
                    <Input
                      className={fieldClass}
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={editVisibility === "by_role"}
                      onChange={() => setEditVisibility("by_role")}
                    />{" "}
                    Restrita por cargo
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      checked={editVisibility === "all"}
                      onChange={() => setEditVisibility("all")}
                    />{" "}
                    Visível para todos
                  </label>
                </div>
                {editVisibility === "by_role" ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(roles.data?.roles ?? []).map((role) => (
                      <label key={role.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={editRoleIds.includes(role.id)}
                          onCheckedChange={(checked) =>
                            setEditRoleIds((cur) =>
                              checked ? [...cur, role.id] : cur.filter((id) => id !== role.id),
                            )
                          }
                        />
                        {role.name}
                      </label>
                    ))}
                  </div>
                ) : null}
                <div className="flex gap-2">
                  <Button type="submit" size="xs" disabled={patchCollection.isPending}>
                    Salvar
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditingId(null)}
                  >
                    Cancelar
                  </Button>
                </div>
              </form>
            ) : null}
            {historyId === collection.id ? (
              <div className="mt-3 rounded-xl border bg-muted/20 p-3">
                <div className="text-xs font-medium">Histórico de alterações</div>
                {historyQ.isLoading ? (
                  <div className="mt-2 text-xs text-muted-foreground">Carregando…</div>
                ) : (historyQ.data?.history ?? []).length === 0 ? (
                  <div className="mt-2 text-xs text-muted-foreground">Sem histórico</div>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {(historyQ.data?.history ?? []).map((h) => (
                      <li key={h.id} className="flex justify-between gap-2 text-xs">
                        <span className="font-mono">{h.action}</span>
                        <span className="text-muted-foreground">
                          {new Date(h.createdAt).toLocaleString("pt-BR")}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            <p className="mt-3 text-xs text-muted-foreground">
              Documentos desta base são gerenciados em{" "}
              <a href="/app/documents" className="underline">
                Meus documentos
              </a>{" "}
              /{" "}
              <a href="/app/admin/documents" className="underline">
                Painel docs (admin)
              </a>{" "}
              — aqui só base.
            </p>
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

function CollectionDocs({ collectionId }: { collectionId: string }) {
  const detail = useQuery({
    queryKey: ["knowledge-detail", collectionId],
    queryFn: () => api<KnowledgeCollectionDetail>(`/api/knowledge/${collectionId}`),
  });
  const qc = useQueryClient();
  const [editingDocId, setEditingDocId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");

  const patchDoc = useMutation({
    mutationFn: (p: { id: string; title: string; bodyMd: string }) =>
      api(`/api/knowledge/documents/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ title: p.title, bodyMd: p.bodyMd }),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["knowledge-detail", collectionId] });
      await qc.invalidateQueries({ queryKey: ["knowledge"] });
      setEditingDocId(null);
      toast.success("Documento atualizado");
    },
    onError: (e) => toast.error(e instanceof ApiRequestError ? e.message : "Falha ao atualizar"),
  });

  if (detail.isLoading)
    return <div className="mt-3 text-xs text-muted-foreground">Carregando documentos…</div>;
  const docs = detail.data?.documents ?? [];
  if (docs.length === 0)
    return <div className="mt-3 text-xs text-muted-foreground">Nenhum documento nesta base.</div>;

  return (
    <div className="mt-3 space-y-3 rounded-xl border bg-card p-3">
      <div className="text-xs font-medium">
        Documentos atuais — clique em Editar para ver o texto
      </div>
      {docs.map((d) => (
        <div key={d.id} className="rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{d.title}</span>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                if (editingDocId === d.id) setEditingDocId(null);
                else {
                  setEditingDocId(d.id);
                  setEditTitle(d.title);
                  setEditBody(d.bodyMd);
                }
              }}
            >
              {editingDocId === d.id ? "Fechar" : "Editar texto atual"}
            </Button>
          </div>
          {editingDocId === d.id ? (
            <form
              className="mt-3 grid gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                patchDoc.mutate({ id: d.id, title: editTitle, bodyMd: editBody });
              }}
            >
              <Input
                className={fieldClass}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Título"
              />
              <Textarea
                className={areaClass}
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                placeholder="Conteúdo markdown atual"
              />
              <div className="flex gap-2">
                <Button type="submit" size="xs" disabled={patchDoc.isPending}>
                  Salvar texto
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditingDocId(null)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          ) : (
            <div className="mt-2 max-h-40 overflow-y-auto rounded bg-muted/30 p-2 text-xs leading-5 whitespace-pre-wrap">
              {d.bodyMd.slice(0, 800)}
              {d.bodyMd.length > 800 ? "…" : ""}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
