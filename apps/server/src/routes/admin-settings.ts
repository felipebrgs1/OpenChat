import { patchAdminSettingsBodySchema } from "@nexo/contracts";
import { db, organizationSettings } from "@nexo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { writeAudit } from "../lib/audit";
import { validation } from "../lib/errors";
import {
  DEFAULT_MODEL_ID,
  effectiveAllowedModels,
  effectiveDefaultModel,
  loadOrgSettings,
} from "../lib/org";
import { listOpenRouterModels } from "../lib/openrouter-models";
import { parseBody } from "../lib/parse";
import { requireAdmin, requireAuth, type AuthUser } from "../middleware/auth";

export const adminSettingsRoutes = new Hono<{ Variables: { user: AuthUser } }>();

adminSettingsRoutes.use("*", requireAuth, requireAdmin);

async function settingsResponse(row: typeof organizationSettings.$inferSelect) {
  const catalog = await listOpenRouterModels(row.openrouterBaseUrl);
  return {
    name: row.name,
    defaultModel: effectiveDefaultModel(row),
    fallbackModel: row.fallbackModel || DEFAULT_MODEL_ID,
    allowedModels: effectiveAllowedModels(row.allowedModels, row.defaultModel),
    globalSystemPrompt: row.globalSystemPrompt,
    monthlyBudgetUsd: row.monthlyBudgetUsd,
    catalog,
  };
}

adminSettingsRoutes.get("/", async (c) => {
  const settings = await loadOrgSettings();
  return c.json(await settingsResponse(settings));
});

adminSettingsRoutes.patch("/", async (c) => {
  const settings = await loadOrgSettings();
  const body = await parseBody(patchAdminSettingsBodySchema, await c.req.json());
  const allowedModels = effectiveAllowedModels(
    body.allowedModels ?? settings.allowedModels,
    body.defaultModel ?? settings.defaultModel,
  );
  if (allowedModels.length === 0) {
    throw validation("Selecione ao menos um modelo.");
  }
  const defaultModel = body.defaultModel ?? effectiveDefaultModel(settings);
  if (!allowedModels.includes(defaultModel)) {
    throw validation("O modelo padrão precisa estar na lista disponível.");
  }
  const fallbackModel = body.fallbackModel ?? settings.fallbackModel ?? defaultModel;
  const [row] = await db
    .update(organizationSettings)
    .set({
      allowedModels,
      defaultModel,
      fallbackModel: allowedModels.includes(fallbackModel) ? fallbackModel : defaultModel,
      globalSystemPrompt: body.globalSystemPrompt ?? settings.globalSystemPrompt,
      monthlyBudgetUsd:
        body.monthlyBudgetUsd === undefined
          ? settings.monthlyBudgetUsd
          : body.monthlyBudgetUsd === null
            ? null
            : body.monthlyBudgetUsd.toFixed(4),
      updatedAt: new Date(),
    })
    .where(eq(organizationSettings.id, settings.id))
    .returning();
  if (!row) {
    throw validation("Não foi possível salvar as configurações.");
  }
  await writeAudit({
    actorId: c.get("user").id,
    action: "settings.update",
    entityType: "organization_settings",
    entityId: row.id,
    meta: body,
  });
  return c.json(await settingsResponse(row));
});
