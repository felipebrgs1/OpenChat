import type { RagSource } from "@nexo/contracts";
import { Button } from "@nexo/ui/components/button";
import { ExternalLink, FileText, Flag } from "lucide-react";

import { api } from "@/lib/api";

export function RagSources({
  sources,
  hasSources,
}: {
  sources: RagSource[];
  hasSources: boolean;
}) {
  if (!hasSources || sources.length === 0) {
    return (
      <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <Flag className="size-3.5" />
          Não encontrei fonte interna confiável
        </span>
        <p className="mt-1 text-xs leading-5 opacity-80">
          A resposta acima não usou a base interna. Verifique com o cargo dono do assunto antes de agir.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border bg-card">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <FileText className="size-4 text-muted-foreground" />
        <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Fontes verificáveis — {sources.length}
        </span>
      </div>
      <ul className="divide-y">
        {sources.map((s) => (
          <li key={s.chunkId} className="group px-3 py-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{s.title}</div>
                <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs text-muted-foreground">
                  {s.heading ? (
                    <span className="rounded-full bg-muted px-2 py-0.5">{s.heading}</span>
                  ) : null}
                  {s.page ? <span>p. {s.page}</span> : null}
                </div>
                <p className="mt-1.5 line-clamp-3 text-xs leading-5 text-muted-foreground">
                  “{s.excerpt}”
                </p>
              </div>
              {s.revisionId ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="shrink-0 rounded-full"
                  onClick={() => {
                    const base = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";
                    const url = `${base}/api/knowledge/revisions/${s.revisionId}/download`;
                    // abre com auth via window.open; backend valida cargo antes de redirigir/pre-assinar
                    window.open(url, "_blank");
                  }}
                >
                  Abrir <ExternalLink className="size-3" />
                </Button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function FeedbackBar({
  messageId,
  onFeedback,
}: {
  messageId: string;
  onFeedback: (rating: string) => void;
}) {
  const send = async (rating: string) => {
    try {
      await api("/api/feedback", {
        method: "POST",
        body: JSON.stringify({ messageId, rating }),
      });
      onFeedback(rating);
    } catch {}
  };

  return (
    <div className="mt-2 flex flex-wrap gap-1">
      {[
        ["util", "Útil"],
        ["incorreta", "Incorreta"],
        ["desatualizada", "Desatualizada"],
        ["sem_fonte", "Sem fonte"],
      ].map(([value, label]) => (
        <Button key={value} variant="ghost" size="xs" className="rounded-full border text-xs" onClick={() => void send(value)}>
          {label}
        </Button>
      ))}
    </div>
  );
}
