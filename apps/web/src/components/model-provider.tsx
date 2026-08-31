import type { ModelsResponse } from "@nexo/contracts";
import { useQuery } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { api } from "@/lib/api";

const STORAGE_KEY = "nexo.model";

type ModelContextValue = {
  model: string;
  setModel: (model: string) => void;
  allowedModels: string[];
  defaultModel: string;
};

const ModelContext = createContext<ModelContextValue | null>(null);

export function ModelProvider({ children }: { children: ReactNode }) {
  const models = useQuery({
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
    const allowedModels = models.data?.allowedModels ?? [];
    const defaultModel = models.data?.defaultModel ?? "";
    const model = allowedModels.includes(chosen) ? chosen : defaultModel;
    return { model, setModel, allowedModels, defaultModel };
  }, [chosen, models.data, setModel]);

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useModel() {
  const ctx = useContext(ModelContext);
  if (!ctx) {
    throw new Error("useModel fora do ModelProvider");
  }
  return ctx;
}
