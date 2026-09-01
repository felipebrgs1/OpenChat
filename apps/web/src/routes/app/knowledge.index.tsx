import type { KnowledgeCollectionSummary } from "@nexo/contracts";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";

import { api } from "@/lib/api";

export const Route = createFileRoute("/app/knowledge/")({
  component: KnowledgePage,
});

function KnowledgePage() {
  const collections = useQuery({
    queryKey: ["knowledge"],
    queryFn: () => api<{ collections: KnowledgeCollectionSummary[] }>("/api/knowledge"),
  });

  const list = collections.data?.collections ?? [];

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Bases do seu cargo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Documentos que o assistente consulta antes de responder.
        </p>
      </div>

      {collections.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : null}

      {!collections.isLoading && list.length === 0 ? (
        <div className="rounded-2xl border bg-muted/40 p-4 text-sm leading-6 text-muted-foreground">
          Seu cargo ainda não tem base; as respostas serão genéricas.
        </div>
      ) : null}

      <ul className="divide-y overflow-hidden rounded-2xl border">
        {list.map((collection) => (
          <li key={collection.id} className="px-4 py-3">
            <Link
              to="/app/knowledge/$collectionId"
              params={{ collectionId: collection.id }}
              className="block"
            >
              <span className="text-sm font-medium hover:underline">{collection.name}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">
                {collection.description || collection.slug} · {collection.documentCount}{" "}
                {collection.documentCount === 1 ? "documento" : "documentos"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
