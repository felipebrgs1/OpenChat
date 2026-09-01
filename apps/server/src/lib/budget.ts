import { and, eq, gte, sql } from "drizzle-orm";
import { db, roles, usageEvents, users } from "@nexo/db";

import { budgetExceeded } from "./errors";
import type { organizationSettings } from "@nexo/db";

type OrgSettings = typeof organizationSettings.$inferSelect;

/** Início do mês corrente (timezone do servidor; spec: America/Sao_Paulo). */
export function currentMonthStart(now = new Date()): Date {
  const saoPaulo = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return new Date(Date.UTC(saoPaulo.getFullYear(), saoPaulo.getMonth(), 1));
}

export async function sumUsageCost(since: Date, userId?: string, roleId?: string) {
  const conditions = [gte(usageEvents.createdAt, since)];
  if (userId) {
    conditions.push(eq(usageEvents.userId, userId));
  }
  if (roleId) {
    conditions.push(eq(users.roleId, roleId));
  }
  const query = db
    .select({ total: sql<string | null>`coalesce(sum(${usageEvents.costUsd}), 0)` })
    .from(usageEvents)
    .innerJoin(users, eq(users.id, usageEvents.userId))
    .where(and(...conditions));
  const [row] = await query;
  return Number(row?.total ?? 0);
}

export async function getUserMonthlySpendUsd(userId: string) {
  return sumUsageCost(currentMonthStart(), userId);
}

export async function getRoleMonthlySpendUsd(roleId: string) {
  return sumUsageCost(currentMonthStart(), undefined, roleId);
}

/**
 * Controle fino de gastos: saldo em créditos + orçamento mensal
 * do usuário, do cargo e da org. Lança BUDGET_EXCEEDED quando estoura.
 */
export async function assertBudgets(input: { userId: string; orgSettings: OrgSettings }) {
  const user = (await db.select().from(users).where(eq(users.id, input.userId)))[0];
  if (!user) {
    throw budgetExceeded("Usuário não encontrado.");
  }

  // saldo em créditos (1000 créditos = US$1)
  const balance = Number((user as unknown as { creditBalance: string }).creditBalance ?? "0");
  if (balance <= 0) {
    throw budgetExceeded(
      `Saldo insuficiente: ${balance.toFixed(2)} créditos. Peça recarga ao admin.`,
    );
  }

  const monthStart = currentMonthStart();

  // orçamento mensal do usuário
  const userBudget = (user as unknown as { monthlyBudgetUsd: string | null }).monthlyBudgetUsd;
  if (userBudget !== null && userBudget !== undefined) {
    const spend = await getUserMonthlySpendUsd(user.id);
    if (spend >= Number(userBudget)) {
      throw budgetExceeded(
        `Orçamento mensal do usuário atingido (${spend.toFixed(4)} USD de ${Number(userBudget).toFixed(2)} USD).`,
      );
    }
  }

  // orçamento mensal do cargo
  if (user.roleId) {
    const role = (await db.select().from(roles).where(eq(roles.id, user.roleId)))[0];
    if (role?.monthlyBudgetUsd) {
      const spend = await getRoleMonthlySpendUsd(role.id);
      if (spend >= Number(role.monthlyBudgetUsd)) {
        throw budgetExceeded(
          `Orçamento mensal do cargo "${role.name}" atingido (${spend.toFixed(4)} USD de ${Number(role.monthlyBudgetUsd).toFixed(2)} USD).`,
        );
      }
    }
  }

  // orçamento mensal da org
  if (input.orgSettings.monthlyBudgetUsd) {
    const spend = await sumUsageCost(monthStart);
    if (spend >= Number(input.orgSettings.monthlyBudgetUsd)) {
      throw budgetExceeded(
        `Orçamento mensal da organização atingido (${spend.toFixed(4)} USD de ${Number(input.orgSettings.monthlyBudgetUsd).toFixed(2)} USD).`,
      );
    }
  }
}
