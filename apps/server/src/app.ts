import { healthResponseSchema } from "@nexo/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";

import { ApiError } from "./lib/errors";
import { adminSettingsRoutes } from "./routes/admin-settings";
import { adminUserRoutes } from "./routes/admin-users";
import { creditRoutes } from "./routes/credits";
import { authRoutes } from "./routes/auth";
import { conversationRoutes } from "./routes/conversations";
import { inviteAdminRoutes, invitePublicRoutes } from "./routes/invites";
import { meRoutes } from "./routes/me";
import { modelRoutes } from "./routes/models";
import { roleRoutes } from "./routes/roles";

const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

const app = new Hono();

app.use("*", async (c, next) => {
  const requestId = crypto.randomUUID();
  const start = Date.now();
  await next();
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      requestId,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - start,
    }),
  );
});

app.use(
  "*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/api/health", (c) => {
  return c.json(healthResponseSchema.parse({ status: "ok" }));
});

app.route("/api/auth", authRoutes);
app.route("/api/invites", invitePublicRoutes);
app.route("/api/invites", inviteAdminRoutes);
app.route("/api/me", meRoutes);
app.route("/api/roles", roleRoutes);
app.route("/api/models", modelRoutes);
app.route("/api/conversations", conversationRoutes);
app.route("/api/admin/users", adminUserRoutes);
app.route("/api/admin/settings", adminSettingsRoutes);
app.route("/api/credits", creditRoutes);

app.notFound((c) => {
  return c.json({ error: { code: "NOT_FOUND", message: "Não encontrado." } }, 404);
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json(
      { error: { code: error.code, message: error.message } },
      error.status as ContentfulStatusCode,
    );
  }
  if (error instanceof ZodError) {
    const first = error.issues[0];
    return c.json(
      { error: { code: "VALIDATION", message: first?.message ?? "Payload inválido." } },
      400,
    );
  }
  console.error(error);
  return c.json({ error: { code: "VALIDATION", message: "Erro interno." } }, 500);
});

export default app;
