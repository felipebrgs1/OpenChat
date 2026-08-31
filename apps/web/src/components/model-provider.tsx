import type { ModelOption, ModelsResponse } from "@nexo/contracts";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { api } from "@/lib/api";

const STORAGE_KEY = "nexo.model";

type ModelContextValue = {
  model: string;
  setModel: (model: string) => void;
  models: ModelOption[];
  allowedModels: string[];
  defaultModel: string;
  loading: boolean;
};

const ModelContext = createContext<ModelContextValue | null>(null);

export function ModelProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ["models"],
    queryFn: () => api<ModelsResponse>("/api/models"),
    retry: false,
  });
  const [chosen, setChosen] = useState(() => localStorage.getItem(STORAGE_KEY) ?? "");
  const setModel = useCallback((next: string) => {
    setChosen(next);
    localStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<ModelContextValue>(() => {
    const models = query.data?.models ?? [];
    const allowedModels =
      models.length > 0 ? models.map((row) => row.id) : (query.data?.allowedModels ?? []);
    const defaultModel = query.data?.defaultModel ?? models[0]?.id ?? "";
    const model = allowedModels.includes(chosen) ? chosen : defaultModel;
    return { model, setModel, models, allowedModels, defaultModel, loading: query.isLoading };
  }, [chosen, query.data, query.isLoading, setModel]);

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModel() {
  const ctx = useContext(ModelContext);
  if (!ctx) {
    throw new Error("useModel fora do ModelProvider");
  }
  return ctx;
}
