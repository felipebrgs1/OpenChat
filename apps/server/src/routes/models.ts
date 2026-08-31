import { Hono } from "hono";

import {
  effectiveAllowedModels,
  effectiveDefaultModel,
  loadOrgSettings,
  loadSelectableModels,
} from "../lib/org";
import { requireAuth, requireRole, type AuthUser } from "../middleware/auth";

export const modelRoutes = new Hono<{ Variables: { user: AuthUser } }>();

modelRoutes.use("*", requireAuth, requireRole);

modelRoutes.get("/", async (c) => {
  const settings = await loadOrgSettings();
  const models = await loadSelectableModels(settings);
  return c.json({
    defaultModel: effectiveDefaultModel(settings),
    fallbackModel: settings.fallbackModel,
    allowedModels: effectiveAllowedModels(settings.allowedModels, settings.defaultModel),
    models,
  });
});
