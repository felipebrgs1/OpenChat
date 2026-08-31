import { healthResponseSchema } from "@nexo/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const port = Number(process.env.PORT ?? 3001);
const corsOrigin = process.env.CORS_ORIGIN ?? "http://localhost:5173";

const app = new Hono();

app.use(logger());
app.use(
  "/*",
  cors({
    origin: corsOrigin,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/api/health", (c) => {
  return c.json(healthResponseSchema.parse({ status: "ok" }));
});

export default {
  port,
  fetch: app.fetch,
};
