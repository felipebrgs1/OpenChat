import { db, organizationSettings } from "@nexo/db";

import { notFound, validation } from "./errors";
import { listOpenRouterModels, type OpenRouterModelOption } from "./openrouter-models";

export const DEFAULT_MODEL_ID = "z-ai/glm-5.3-flash";

export async function loadOrgSettings() {
  const settings = (await db.select().from(organizationSettings).limit(1))[0];
  if (!settings) {
    throw notFound("Settings da org não encontradas. Rode o seed.");
  }
  return settings;
}

export function effectiveAllowedModels(
  allowed: string[] | null | undefined,
  defaultModel?: string | null,
) {
  const ids = (allowed ?? []).map((id) => id.trim()).filter(Boolean);
  if (ids.length > 0) {
    return [...new Set(ids)];
  }
  return [defaultModel?.trim() || DEFAULT_MODEL_ID];
}

export function effectiveDefaultModel(
  settings: Pick<Awaited<ReturnType<typeof loadOrgSettings>>, "allowedModels" | "defaultModel">,
) {
  const allowed = effectiveAllowedModels(settings.allowedModels, settings.defaultModel);
  if (settings.defaultModel && allowed.includes(settings.defaultModel)) {
    return settings.defaultModel;
  }
  return allowed[0] ?? DEFAULT_MODEL_ID;
}

export function assertAllowedModel(allowed: string[], model: string) {
  if (!allowed.includes(model)) {
    throw validation("Modelo fora da allowlist.");
  }
}

function namedModels(catalog: OpenRouterModelOption[], ids: string[]) {
  const byId = new Map(catalog.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id) ?? { id, name: id });
}

export async function loadSelectableModels(settings: Awaited<ReturnType<typeof loadOrgSettings>>) {
  const catalog = await listOpenRouterModels(settings.openrouterBaseUrl);
  const allowed = effectiveAllowedModels(settings.allowedModels, settings.defaultModel);
  const defaultModel = effectiveDefaultModel(settings);
  const ids = allowed.includes(defaultModel) ? allowed : [defaultModel, ...allowed];
  return namedModels(catalog, ids);
}

export function assertSelectableModel(
  settings: Awaited<ReturnType<typeof loadOrgSettings>>,
  model: string,
) {
  const allowed = effectiveAllowedModels(settings.allowedModels, settings.defaultModel);
  assertAllowedModel(allowed, model);
}
