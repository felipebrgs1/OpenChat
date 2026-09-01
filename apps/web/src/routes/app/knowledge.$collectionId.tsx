import type { KnowledgeCollectionDetail, MeResponse } from "@nexo/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { api } from "@/lib/api";
import { MarkdownBody } from "@/lib/markdown";

export const Route = createFileRoute("/app/knowledge/$collectionId")({
  component: CollectionPage,
});

function CollectionPage() {
  const { collectionId } = Route.useParams();
  const collection = useQuery({
    queryKey: ["knowledge", collectionId],
    queryFn: () => api<KnowledgeCollectionDetail>(`/api/knowledge/${collectionId}`),
  });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<MeResponse>("/api/me") });

  if (collection.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  if (!collection.data) {
    return (
      <section className="mx-auto w-full max-w-3xl px-6 py-10">
        <p className="text-sm text-muted-foreground">Base não encontrada.</p>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10">
      <div>
        <Link to="/app/knowledge" className="text-xs text-muted-foreground hover:underline">
          ← Bases
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{collection.data.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{collection.data.description}</p>
      </div>
      {me.data?.user.isAdmin ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/30 dark:bg-amber-950/20">
          Você é admin — editar esta base (com histórico) em{" "}
          <Link to="/app/admin/knowledge" className="font-medium underline">
            /app/admin/knowledge
          </Link>
        </div>
      ) : null}

      <div className="space-y-8">
        {collection.data.documents.map((doc) => (
          <article key={doc.id} className="rounded-2xl border p-5">
            <h2 className="text-base font-medium">{doc.title}</h2>
            <div className="mt-3">
              <MarkdownBody content={doc.bodyMd} />
            </div>
          </article>
        ))}
        {collection.data.documents.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum documento nesta base ainda.</p>
        ) : null}
      </div>
    </section>
  );
}
