export type OpenRouterModelOption = {
  id: string;
  name: string;
};

type Cache = {
  at: number;
  models: OpenRouterModelOption[];
};

const CACHE_MS = 10 * 60 * 1000;
let cache: Cache | null = null;

type OpenRouterModelsPayload = {
  data?: Array<{
    id?: string;
    name?: string;
    architecture?: { output_modalities?: string[] };
  }>;
};

export async function listOpenRouterModels(baseUrl: string): Promise<OpenRouterModelOption[]> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    return [];
  }
  if (cache && Date.now() - cache.at < CACHE_MS) {
    return cache.models;
  }

  const endpoint = `${baseUrl.replace(/\/$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? "http://localhost:5173",
        "X-Title": process.env.OPENROUTER_APP_TITLE ?? "Oráculo",
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`OpenRouter models HTTP ${response.status}`);
    }
    const payload = (await response.json()) as OpenRouterModelsPayload;
    const models = (payload.data ?? [])
      .filter((row) => {
        if (!row.id) {
          return false;
        }
        const outputs = row.architecture?.output_modalities;
        return !outputs || outputs.includes("text");
      })
      .map((row) => ({
        id: row.id!,
        name: row.name?.trim() || row.id!,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, "en"));
    cache = { at: Date.now(), models };
    return models;
  } catch {
    return cache?.models ?? [];
  } finally {
    clearTimeout(timer);
  }
}

export function mergeModelOptions(
  catalog: OpenRouterModelOption[],
  allowedIds: string[],
  defaultId?: string,
) {
  const byId = new Map(catalog.map((row) => [row.id, row]));
  for (const id of allowedIds) {
    if (!byId.has(id)) {
      byId.set(id, { id, name: id });
    }
  }
  const featured = allowedIds
    .map((id) => byId.get(id))
    .filter((row): row is OpenRouterModelOption => Boolean(row));
  const featuredIds = new Set(featured.map((row) => row.id));
  const rest = [...byId.values()].filter((row) => !featuredIds.has(row.id));
  const models = catalog.length > 0 ? [...featured, ...rest] : featured;
  if (defaultId && !models.some((row) => row.id === defaultId)) {
    models.unshift(byId.get(defaultId) ?? { id: defaultId, name: defaultId });
  }
  return models;
}
