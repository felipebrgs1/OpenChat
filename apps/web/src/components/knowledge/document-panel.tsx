import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@nexo/ui/components/button";
import { api } from "@/lib/api";
import { getSession } from "@/lib/session";

type DocRow = {
  id: string;
  collectionId: string;
  title: string;
  filename: string | null;
  mime: string | null;
  ownerId: string | null;
  ownerName?: string | null;
  ownerEmail?: string | null;
  collectionName?: string | null;
  visibility?: string;
  roleIds?: string[];
  status: string;
  reviewAt: string | null;
  publishedAt: string | null;
  overdue?: boolean;
  updatedAt: string;
  checksum?: string | null;
};

type UserRow = { id: string; name: string; email: string; role?: { name: string } | null };
type RoleRow = { id: string; slug: string; name: string };

export function DocumentPanel({ mode }: { mode: "my" | "all" }) {
  const qc = useQueryClient();
  const endpoint = mode === "all" ? "/api/knowledge/panel/all" : "/api/knowledge/panel/my";
  const opsEndpoint = "/api/knowledge/ops/panel";

  const docsQ = useQuery({
    queryKey: ["docs-panel", mode],
    queryFn: () => api<{ documents: DocRow[] }>(endpoint),
  });

  const opsQ = useQuery({
    queryKey: ["ops-panel"],
    queryFn: () =>
      api<{
        totalDocs: number;
        byStatus: Record<string, number>;
        overdue: Array<{ id: string; title: string; reviewAt: string }>;
        feedback: { semFonte: number; total: number };
      }>(opsEndpoint),
    enabled: mode === "all",
  });

  const usersQ = useQuery({
    queryKey: ["admin-users-list"],
    queryFn: () => api<{ users: UserRow[] }>("/api/admin/users"),
    enabled: mode === "all",
  });

  const rolesQ = useQuery({
    queryKey: ["roles-list"],
    queryFn: () =>
      api<{ roles: RoleRow[] } | RoleRow[]>("/api/roles").then((r) => {
        // /api/roles returns { roles: [...] } ou array direto dependendo da versão
        if (Array.isArray(r)) return r as RoleRow[];
        if ((r as { roles?: RoleRow[] }).roles) return (r as { roles: RoleRow[] }).roles;
        return [] as RoleRow[];
      }),
    enabled: true,
  });

  const [editing, setEditing] = useState<DocRow | null>(null);
  const [editOwner, setEditOwner] = useState("");
  const [editStatus, setEditStatus] = useState("published");
  const [editVisibility, setEditVisibility] = useState("by_role");
  const [editRoleIds, setEditRoleIds] = useState<string[]>([]);
  const [editReviewAt, setEditReviewAt] = useState("");
  const [historyDocId, setHistoryDocId] = useState<string | null>(null);

  // reseta o formulário no evento que seleciona o documento (sem setState em effect)
  const startEditing = (doc: DocRow) => {
    setEditing(doc);
    setEditOwner(doc.ownerId ?? "");
    setEditStatus(doc.status);
    setEditVisibility((doc.visibility as string) ?? "by_role");
    setEditRoleIds(doc.roleIds ?? []);
    setEditReviewAt(doc.reviewAt ? doc.reviewAt.slice(0, 10) : "");
  };

  const docHistoryQ = useQuery({
    queryKey: ["doc-history", historyDocId],
    queryFn: () =>
      api<{
        revisions: Array<{
          id: string;
          revisionNumber: number;
          filename: string;
          mime: string;
          sizeBytes: number;
          checksum: string;
          createdAt: string;
          supersededAt: string | null;
          ingestion: { status: string; stage: string; errorMessage?: string | null } | null;
        }>;
      }>(`/api/knowledge/documents/${historyDocId}/revisions`),
    enabled: !!historyDocId,
  });

  // reseta o formulário quando o documento em edição muda (padrão derivado de prop)
  // oxlint-disable-next-line set-state-in-effect

  const patchMut = useMutation({
    mutationFn: (payload: {
      id: string;
      ownerId?: string;
      status?: string;
      visibility?: string;
      roleIds?: string[];
      reviewAt?: string | null;
    }) =>
      api(`/api/knowledge/documents/${payload.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      toast.success("Documento atualizado");
      qc.invalidateQueries({ queryKey: ["docs-panel"] });
      setEditing(null);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro"),
  });

  const rollbackMut = useMutation({
    mutationFn: ({ docId, revisionId }: { docId: string; revisionId: string }) =>
      api(`/api/knowledge/documents/${docId}/rollback`, {
        method: "POST",
        body: JSON.stringify({ revisionId }),
      }),
    onSuccess: () => {
      toast.success("Rollback criado");
      qc.invalidateQueries({ queryKey: ["docs-panel"] });
    },
  });

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!uploadCollection || !uploadFile) throw new Error("Selecione coleção e arquivo");
      const fd = new FormData();
      fd.append("file", uploadFile);
      if (uploadTitle.trim()) fd.append("title", uploadTitle.trim());
      fd.append("visibility", uploadVisibility);
      if (uploadVisibility === "by_role" && uploadRoleIds.length)
        fd.append("roleIds", JSON.stringify(uploadRoleIds));
      const base = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
      const res = await fetch(`${base}/api/knowledge/${uploadCollection}/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getSession()?.accessToken ?? ""}` },
        body: fd,
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt.slice(0, 500));
      }
      return res.json();
    },
    onSuccess: () => {
      toast.success("Documento enviado — ingestão em andamento");
      qc.invalidateQueries({ queryKey: ["docs-panel"] });
      setShowUpload(false);
      setUploadFile(null);
      setUploadTitle("");
      setUploadRoleIds([]);
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro no upload"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api(`/api/knowledge/documents/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Documento removido — pgvector limpo");
      qc.invalidateQueries({ queryKey: ["docs-panel"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Erro ao excluir"),
  });

  const docs = docsQ.data?.documents ?? [];
  const users = usersQ.data?.users ?? [];
  const roles = rolesQ.data ?? [];

  const collectionsQ = useQuery({
    queryKey: ["knowledge-collections"],
    queryFn: () =>
      api<{ collections: Array<{ id: string; name: string; slug: string }> }>("/api/knowledge"),
  });
  const collections = collectionsQ.data?.collections ?? [];

  const [showUpload, setShowUpload] = useState(false);
  const [uploadCollection, setUploadCollection] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadVisibility, setUploadVisibility] = useState("by_role");
  const [uploadRoleIds, setUploadRoleIds] = useState<string[]>([]);

  if (docsQ.isLoading) return <div className="p-6 text-sm text-muted-foreground">Carregando…</div>;
  if (docsQ.isError)
    return <div className="p-6 text-sm text-destructive">Erro ao carregar documentos</div>;

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">
          {mode === "all" ? "Painel de documentos — Admin" : "Meus documentos"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "all"
            ? "Por padrão apenas admin e dono têm acesso. Aqui você vê todos, pode trocar dono, domínio e revisão."
            : "Apenas documentos onde você é dono (por padrão só dono+admin têm acesso)."}
        </p>
      </div>

      {mode === "all" && opsQ.data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="text-lg font-semibold">{opsQ.data.totalDocs}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Vencidos</div>
            <div className="text-lg font-semibold text-amber-600">{opsQ.data.overdue.length}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Sem fonte</div>
            <div className="text-lg font-semibold">{opsQ.data.feedback.semFonte}</div>
          </div>
          <div className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">Publicados</div>
            <div className="text-lg font-semibold">{opsQ.data.byStatus.published ?? 0}</div>
          </div>
        </div>
      ) : null}

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setShowUpload((v) => !v)}>
          {showUpload ? "Cancelar" : "Novo documento"}
        </Button>
      </div>
      {showUpload ? (
        <div className="rounded-xl border p-4 bg-card space-y-3">
          <h3 className="font-medium text-sm">Novo documento</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs sm:col-span-2">
              Coleção *
              <select
                value={uploadCollection}
                onChange={(e) => setUploadCollection(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
              >
                <option value="">— selecione —</option>
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.slug}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              Título (opcional)
              <input
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
                placeholder="ex: Política 2024"
                className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              Arquivo * (pdf, docx, txt, md)
              <input
                type="file"
                accept=".pdf,.docx,.txt,.md,.markdown,.csv,.pptx,.xlsx,.html"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            <label className="text-xs">
              Domínio
              <select
                value={uploadVisibility}
                onChange={(e) => setUploadVisibility(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
              >
                <option value="by_role">por cargo — só cargos selecionados</option>
                <option value="all">público — todos os cargos</option>
              </select>
            </label>
            {uploadVisibility === "by_role" ? (
              <div className="text-xs sm:col-span-2">
                Cargos com acesso
                <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border p-2 max-h-32 overflow-y-auto">
                  {roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={uploadRoleIds.includes(r.id)}
                        onChange={(e) => {
                          if (e.target.checked) setUploadRoleIds((prev) => [...prev, r.id]);
                          else setUploadRoleIds((prev) => prev.filter((id) => id !== r.id));
                        }}
                      />
                      <span className="truncate">{r.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => uploadMut.mutate()}
              disabled={uploadMut.isPending || !uploadCollection || !uploadFile}
            >
              {uploadMut.isPending ? "Enviando…" : "Enviar"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowUpload(false)}>
              Fechar
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Por padrão o dono será você; visibilidade e cargos definem quem recupera no RAG. Status
            inicial: published.
          </p>
        </div>
      ) : null}

      {docs.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum documento.{" "}
          {mode === "my" ? "Crie um via upload na base." : "Nenhum documento cadastrado."}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Título</th>
                <th className="px-3 py-2 text-left">Coleção</th>
                <th className="px-3 py-2 text-left">Dono</th>
                <th className="px-3 py-2 text-left">Domínio</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Revisão</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {docs.map((d) => (
                <tr key={d.id} className={d.overdue ? "bg-amber-50/50 dark:bg-amber-950/20" : ""}>
                  <td className="px-3 py-2">
                    <div className="font-medium">{d.title}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[260px]">
                      {d.filename ?? d.id.slice(0, 8)}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {d.collectionName ?? d.collectionId.slice(0, 8)}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {d.ownerEmail ?? d.ownerName ?? d.ownerId?.slice(0, 8) ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${d.visibility === "all" ? "bg-sky-100 text-sky-700" : "bg-violet-100 text-violet-700"}`}
                    >
                      {d.visibility === "all" ? "público" : "por cargo"}
                    </span>
                    {d.visibility === "by_role" && d.roleIds?.length ? (
                      <span className="ml-1 text-[11px] text-muted-foreground">
                        ({d.roleIds.length} cargos)
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${d.status === "published" ? "bg-emerald-100 text-emerald-700" : d.status === "draft" ? "bg-amber-100 text-amber-700" : "bg-zinc-200 text-zinc-600"}`}
                    >
                      {d.status}
                    </span>
                    {d.overdue ? (
                      <span className="ml-1 text-xs text-amber-600">vencido</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {d.reviewAt ? new Date(d.reviewAt).toLocaleDateString("pt-BR") : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="xs" onClick={() => startEditing(d)}>
                        Editar
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => setHistoryDocId(d.id)}>
                        Histórico
                      </Button>
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => {
                          if (
                            !confirm(
                              `Remover "${d.title}"? Apaga do pgvector e marca como deletado. Arquivo original fica até retenção.`,
                            )
                          )
                            return;
                          deleteMut.mutate(d.id);
                        }}
                        disabled={deleteMut.isPending}
                      >
                        Excluir
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historyDocId ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setHistoryDocId(null)}
        >
          <div
            className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-card p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-medium">
                Histórico —{" "}
                {docs.find((x) => x.id === historyDocId)?.title ?? historyDocId?.slice(0, 8)}
              </h3>
              <Button variant="ghost" size="xs" onClick={() => setHistoryDocId(null)}>
                Fechar
              </Button>
            </div>
            {docHistoryQ.isLoading ? (
              <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>
            ) : (docHistoryQ.data?.revisions ?? []).length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Sem revisões</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {(docHistoryQ.data?.revisions ?? []).map((r) => (
                  <li key={r.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">
                        v{r.revisionNumber} — {r.filename}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${r.ingestion?.status === "ready" ? "bg-emerald-100 text-emerald-700" : r.ingestion?.status === "failed" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}
                      >
                        {r.ingestion?.status ?? "—"} · {r.ingestion?.stage ?? ""}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString("pt-BR")} ·{" "}
                      {(r.sizeBytes / 1024).toFixed(1)} KB · {r.checksum.slice(0, 8)}…{" "}
                      {r.supersededAt
                        ? `· superseded ${new Date(r.supersededAt).toLocaleDateString("pt-BR")}`
                        : "· atual"}
                    </div>
                    {r.ingestion?.errorMessage ? (
                      <p className="mt-1 text-xs text-destructive">{r.ingestion.errorMessage}</p>
                    ) : null}
                    <div className="mt-2 flex gap-1">
                      <Button
                        variant="outline"
                        size="xs"
                        onClick={() => {
                          const base = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
                          window.open(`${base}/api/knowledge/revisions/${r.id}/download`, "_blank");
                        }}
                      >
                        Baixar original
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      {editing ? (
        <div className="rounded-xl border p-4 bg-card space-y-4">
          <h3 className="font-medium">Editar — {editing.title}</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {mode === "all" ? (
              <label className="text-xs sm:col-span-2">
                Dono
                <select
                  value={editOwner}
                  onChange={(e) => setEditOwner(e.target.value)}
                  className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">— manter —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} — {u.email}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">
                  Apenas admin pode transferir dono.
                </span>
              </label>
            ) : null}
            <label className="text-xs">
              Status
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
              >
                <option value="draft">draft — rascunho (não entra no RAG)</option>
                <option value="published">published — ativo</option>
                <option value="obsolete">obsolete — obsoleto</option>
              </select>
            </label>
            <label className="text-xs">
              Domínio
              <select
                value={editVisibility}
                onChange={(e) => setEditVisibility(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
              >
                <option value="all">público — todos os cargos</option>
                <option value="by_role">por cargo — só cargos selecionados</option>
              </select>
            </label>
            <label className="text-xs">
              Revisão em
              <input
                type="date"
                value={editReviewAt}
                onChange={(e) => setEditReviewAt(e.target.value)}
                className="mt-1 w-full rounded-lg border bg-background px-2 py-1.5 text-sm"
              />
            </label>
            {editVisibility === "by_role" ? (
              <div className="text-xs sm:col-span-2">
                Cargos com acesso
                <div className="mt-1 grid grid-cols-2 gap-1 rounded-lg border p-2 max-h-32 overflow-y-auto">
                  {roles.map((r) => (
                    <label key={r.id} className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={editRoleIds.includes(r.id)}
                        onChange={(e) => {
                          if (e.target.checked) setEditRoleIds((prev) => [...prev, r.id]);
                          else setEditRoleIds((prev) => prev.filter((id) => id !== r.id));
                        }}
                      />
                      <span className="truncate">{r.name}</span>
                    </label>
                  ))}
                </div>
                {editRoleIds.length === 0 ? (
                  <span className="text-[11px] text-amber-600">
                    Nenhum cargo selecionado = só dono+admin
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() =>
                patchMut.mutate({
                  id: editing.id,
                  ownerId: editOwner || undefined,
                  status: editStatus,
                  visibility: editVisibility,
                  roleIds: editVisibility === "by_role" ? editRoleIds : undefined,
                  reviewAt: editReviewAt ? new Date(editReviewAt).toISOString() : null,
                } as never)
              }
              disabled={patchMut.isPending}
            >
              Salvar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
              Cancelar
            </Button>
            {mode === "all" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  const revs = await api<{
                    revisions: Array<{ id: string; revisionNumber: number }>;
                  }>(`/api/knowledge/documents/${editing.id}/revisions`).catch(() => null);
                  const first = revs?.revisions?.[0];
                  if (!first) return toast.error("Sem histórico");
                  const target = revs.revisions[revs.revisions.length - 1];
                  if (!target || target.id === first.id) return toast.error("Nada para reverter");
                  rollbackMut.mutate({ docId: editing.id, revisionId: target.id });
                }}
              >
                Rollback p/ v1
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
