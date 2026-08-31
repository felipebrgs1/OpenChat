import { Hono } from "hono";

import { loadOrgSettings } from "../lib/org";
import { requireAuth, requireRole, type AuthUser } from "../middleware/auth";

export const modelRoutes = new Hono<{ Variables: { user: AuthUser } }>();

modelRoutes.use("*", requireAuth, requireRole);

modelRoutes.get("/", async (c) => {
  const settings = await loadOrgSettings();
  return c.json({
    defaultModel: settings.defaultModel,
    fallbackModel: settings.fallbackModel,
    allowedModels: settings.allowedModels,
  });
});
