import { adjustCreditsBodySchema } from "@nexo/contracts";
import { creditLedger, db, users } from "@nexo/db";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { writeAudit } from "../lib/audit";
import { notFound, validation } from "../lib/errors";
import { getUserBalance, grantCredits } from "../lib/credits";
import { parseBody } from "../lib/parse";
import { requireAdmin, requireAuth, type AuthUser } from "../middleware/auth";

export const creditRoutes = new Hono<{ Variables: { user: AuthUser } }>();

creditRoutes.use("*", requireAuth);

// saldo do próprio usuário — abstração só em créditos (1000 créditos = US$1 interno)
creditRoutes.get("/balance", async (c) => {
  const user = c.get("user");
  const balance = await getUserBalance(user.id);
  return c.json({
    balance,
  });
});

// histórico do próprio usuário (últimos 50)
creditRoutes.get("/history", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, user.id))
    .orderBy(desc(creditLedger.createdAt))
    .limit(50);
  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      reason: r.reason,
      model: r.model,
      conversationId: r.conversationId,
      messageId: r.messageId,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      tps: r.tps ? Number(r.tps) : null,
      latencyMs: r.latencyMs,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

// admin: saldo/history de outro user + grant (admin vê só créditos também)
creditRoutes.get("/admin/:userId/balance", requireAdmin, async (c) => {
  const userId = c.req.param("userId");
  const target = (await db.select().from(users).where(eq(users.id, userId)))[0];
  if (!target) throw notFound("Usuário não encontrado.");
  const balance = await getUserBalance(userId);
  return c.json({ userId, balance });
});

creditRoutes.get("/admin/:userId/history", requireAdmin, async (c) => {
  const userId = c.req.param("userId");
  const target = (await db.select().from(users).where(eq(users.id, userId)))[0];
  if (!target) throw notFound("Usuário não encontrado.");
  const rows = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(100);
  return c.json({
    entries: rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      reason: r.reason,
      model: r.model,
      conversationId: r.conversationId,
      messageId: r.messageId,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      tps: r.tps ? Number(r.tps) : null,
      latencyMs: r.latencyMs,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

creditRoutes.post("/admin/:userId/adjust", requireAdmin, async (c) => {
  const userId = c.req.param("userId");
  const body = await parseBody(adjustCreditsBodySchema, await c.req.json());
  const target = (await db.select().from(users).where(eq(users.id, userId)))[0];
  if (!target) throw notFound("Usuário não encontrado.");
  if (!Number.isFinite(body.amount) || body.amount === 0) {
    throw validation("amount deve ser número não-zero (positivo=crédito, negativo=débito).");
  }
  if (Math.abs(body.amount) > 100000) {
    throw validation("amount muito grande.");
  }
  const actor = c.get("user");
  const { balanceAfter } = await grantCredits({
    userId,
    amount: body.amount,
    reason: body.reason ?? "admin_adjust",
    actorId: actor.id,
  });
  await writeAudit({
    actorId: actor.id,
    action: "credits.adjust",
    entityType: "user",
    entityId: userId,
    meta: { amount: body.amount, reason: body.reason, balanceAfter },
  });
  return c.json({ balanceAfter });
});
