import { Button } from "@nexo/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nexo/ui/components/dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { useModel } from "@/components/model-provider";

export function ModelSelect() {
  const { model, setModel, models, loading } = useModel();
  const [query, setQuery] = useState("");
  const selected = models.find((row) => row.id === model);
  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return models;
    }
    return models.filter(
      (row) => row.id.toLowerCase().includes(term) || row.name.toLowerCase().includes(term),
    );
  }, [models, query]);

  if (models.length === 0) {
    return (
      <span className="px-3 text-sm text-muted-foreground">
        {loading ? "Carregando modelos…" : "Sem modelos OpenRouter"}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            className="h-9 max-w-[min(100%,28rem)] gap-1 rounded-full px-3 text-sm font-medium"
          />
        }
      >
        <span className="truncate">{selected?.name ?? model}</span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(28rem,calc(100vw-2rem))] rounded-xl p-1">
        <div className="p-1">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Buscar modelo OpenRouter"
            className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">Nenhum modelo encontrado.</p>
          ) : (
            filtered.map((row) => (
              <DropdownMenuItem
                key={row.id}
                className="items-start rounded-lg py-2"
                onClick={() => setModel(row.id)}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{row.name}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{row.id}</span>
                </span>
                {row.id === model ? <Check className="mt-0.5 size-3.5 shrink-0" /> : null}
              </DropdownMenuItem>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
