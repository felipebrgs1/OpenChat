import { CREDITS_PER_USD } from "@nexo/contracts";
import { creditLedger, db, users } from "@nexo/db";
import { eq } from "drizzle-orm";

export const CREDITS_PER_DOLLAR = CREDITS_PER_USD; // 1000
export const INITIAL_CREDITS = "1000.0000";

export function creditsFromUsd(costUsd: number | null | undefined): number {
  if (costUsd === null || costUsd === undefined || Number.isNaN(costUsd)) return 0;
  return costUsd * CREDITS_PER_DOLLAR;
}

export function creditsToUsd(credits: number | string): string {
  const n = typeof credits === "string" ? parseFloat(credits) : credits;
  return (n / CREDITS_PER_DOLLAR).toFixed(6);
}

export function formatCredits(value: string | number): string {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return n.toFixed(2);
}

export async function getUserBalance(userId: string): Promise<string> {
  const row = (await db.select().from(users).where(eq(users.id, userId)))[0];
  return (row as unknown as { creditBalance: string })?.creditBalance ?? INITIAL_CREDITS;
}

export async function assertHasCredits(userId: string, minRequired = 0.01) {
  const balance = await getUserBalance(userId);
  if (parseFloat(balance) < minRequired) {
    const { budgetExceeded } = await import("./errors");
    throw budgetExceeded(`Saldo insuficiente. Você tem ${formatCredits(balance)} créditos.`);
  }
}

export async function deductCredits(input: {
  userId: string;
  costUsd: number | null | undefined;
  model: string;
  conversationId: string;
  messageId: string;
  promptTokens?: number | null;
  completionTokens?: number | null;
  tps?: number | null;
  latencyMs?: number | null;
}) {
  const credits = creditsFromUsd(input.costUsd);
  // allow fractional, keep 4 decimals
  const creditsStr = credits.toFixed(4);
  const user = (await db.select().from(users).where(eq(users.id, input.userId)))[0];
  if (!user) throw new Error("user not found");
  const current = parseFloat(
    (user as unknown as { creditBalance: string }).creditBalance ?? INITIAL_CREDITS,
  );
  const after = current - credits;
  const afterStr = after.toFixed(4);

  await db
    .update(users)
    .set({ creditBalance: afterStr, updatedAt: new Date() })
    .where(eq(users.id, input.userId));

  const [entry] = await db
    .insert(creditLedger)
    .values({
      userId: input.userId,
      amount: (-credits).toFixed(4),
      balanceAfter: afterStr,
      reason: "chat_usage",
      model: input.model,
      conversationId: input.conversationId,
      messageId: input.messageId,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      costUsd: input.costUsd != null ? String(input.costUsd) : null,
      tps: input.tps != null ? String(input.tps) : null,
      latencyMs: input.latencyMs ?? null,
      meta: { credits: creditsStr },
    })
    .returning();

  return { credits, creditsStr, balanceAfter: afterStr, entry };
}

export async function grantCredits(input: {
  userId: string;
  amount: number; // positive to add, negative to remove
  reason?: string;
  actorId?: string;
}) {
  const user = (await db.select().from(users).where(eq(users.id, input.userId)))[0];
  if (!user) throw new Error("user not found");
  const current = parseFloat(
    (user as unknown as { creditBalance: string }).creditBalance ?? INITIAL_CREDITS,
  );
  const after = current + input.amount;
  if (after < 0) throw new Error("saldo não pode ficar negativo");
  const afterStr = after.toFixed(4);
  await db
    .update(users)
    .set({ creditBalance: afterStr, updatedAt: new Date() })
    .where(eq(users.id, input.userId));
  const [entry] = await db
    .insert(creditLedger)
    .values({
      userId: input.userId,
      amount: input.amount.toFixed(4),
      balanceAfter: afterStr,
      reason: input.reason ?? "admin_grant",
      meta: input.actorId ? { actorId: input.actorId } : undefined,
    })
    .returning();
  return { balanceAfter: afterStr, entry };
}
