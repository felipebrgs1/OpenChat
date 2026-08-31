import { db, organizationSettings } from "@nexo/db";

import { notFound, validation } from "./errors";

export async function loadOrgSettings() {
  const settings = (await db.select().from(organizationSettings).limit(1))[0];
  if (!settings) {
    throw notFound("Settings da org não encontradas. Rode o seed.");
  }
  return settings;
}

export function assertAllowedModel(allowed: string[], model: string) {
  if (!allowed.includes(model)) {
    throw validation("Modelo fora da allowlist.");
  }
}
