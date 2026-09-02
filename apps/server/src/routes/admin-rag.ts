import { asc, eq } from "drizzle-orm";
import { db, ragEvaluationCases, ragEvaluationResults, ragEvaluationRuns } from "@nexo/db";
import { Hono } from "hono";

import { requireAdmin, requireAuth, type AuthUser } from "../middleware/auth";
import { compareRuns, listRuns, runRagEvaluation } from "../lib/rag-eval";

export const adminRagRoutes = new Hono<{ Variables: { user: AuthUser } }>();

adminRagRoutes.use("*", requireAuth, requireAdmin);

// lista casos
adminRagRoutes.get("/cases", async (c) => {
  const rows = await db
    .select()
    .from(ragEvaluationCases)
    .orderBy(asc(ragEvaluationCases.createdAt));
  return c.json({ cases: rows });
});

// lista runs
adminRagRoutes.get("/runs", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 50);
  const runs = await listRuns(limit);
  return c.json({ runs });
});

// detalhe do run + resultados
adminRagRoutes.get("/runs/:id", async (c) => {
  const id = c.req.param("id");
  const run = (await db.select().from(ragEvaluationRuns).where(eq(ragEvaluationRuns.id, id)))[0];
  if (!run) return c.json({ error: { code: "NOT_FOUND", message: "Run não encontrado." } }, 404);
  const results = await db
    .select()
    .from(ragEvaluationResults)
    .where(eq(ragEvaluationResults.runId, id))
    .orderBy(asc(ragEvaluationResults.createdAt));
  return c.json({ run, results });
});

// compara dois runs
adminRagRoutes.get("/compare", async (c) => {
  const a = c.req.query("a");
  const b = c.req.query("b");
  if (!a || !b)
    return c.json({ error: { code: "VALIDATION", message: "Informe ?a=runId&a&b=runId" } }, 400);
  const res = await compareRuns(a, b);
  return c.json(res);
});

// dispara avaliação
adminRagRoutes.post("/runs", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const pipelineVersion =
    typeof body.pipelineVersion === "string" ? body.pipelineVersion : undefined;
  const topK = typeof body.topK === "number" ? body.topK : undefined;
  const limit = typeof body.limit === "number" ? body.limit : undefined;
  const result = await runRagEvaluation({ pipelineVersion, topK, limit });
  return c.json(result);
});
