import { db, roles, usageEvents, users } from "@nexo/db";
import { desc, eq, gte, sql } from "drizzle-orm";
import { Hono } from "hono";

import { requireAdmin, requireAuth, type AuthUser } from "../middleware/auth";
import { currentMonthStart } from "../lib/budget";

export const adminUsageRoutes = new Hono<{ Variables: { user: AuthUser } }>();

adminUsageRoutes.use("*", requireAuth, requireAdmin);

type Bucket = {
  key: string;
  label: string;
  messages: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: string;
  credits: string;
};

const agg = {
  messages: sql<string>`count(*)`,
  promptTokens: sql<string>`coalesce(sum(${usageEvents.promptTokens}), 0)`,
  completionTokens: sql<string>`coalesce(sum(${usageEvents.completionTokens}), 0)`,
  costUsd: sql<string>`coalesce(sum(${usageEvents.costUsd}), 0)`,
  credits: sql<string>`coalesce(sum(${usageEvents.credits}), 0)`,
};

function toBucket(row: {
  key: string | null;
  label: string | null;
  messages: string;
  promptTokens: string;
  completionTokens: string;
  costUsd: string;
  credits: string;
}): Bucket {
  return {
    key: row.key ?? "—",
    label: row.label ?? "—",
    messages: Number(row.messages),
    promptTokens: Number(row.promptTokens),
    completionTokens: Number(row.completionTokens),
    costUsd: Number(row.costUsd).toFixed(6),
    credits: Number(row.credits).toFixed(2),
  };
}

adminUsageRoutes.get("/", async (c) => {
  const daysParam = Number(c.req.query("days") ?? "7");
  const days =
    Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.trunc(daysParam), 90) : 7;

  // janela em ms preserva lógica simples; dia agrupa no fuso da org
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const window = gte(usageEvents.createdAt, since);
  const monthStart = currentMonthStart();
  const monthWindow = gte(usageEvents.createdAt, monthStart);

  const baseSelect = () =>
    db
      .select({
        ...agg,
      })
      .from(usageEvents);

  // total no período
  const [totalRow] = await baseSelect().where(window);

  // por usuário (período)
  const userRows = await db
    .select({
      ...agg,
      key: users.id,
      label: users.name,
      email: users.email,
    })
    .from(usageEvents)
    .innerJoin(users, eq(users.id, usageEvents.userId))
    .where(window)
    .groupBy(users.id, users.name, users.email)
    .orderBy(desc(sql`coalesce(sum(${usageEvents.costUsd}), 0)`));

  // por cargo (mês corrente — orçamento é mensal)
  const roleRows = await db
    .select({
      ...agg,
      key: roles.id,
      label: roles.name,
      slug: roles.slug,
      budget: roles.monthlyBudgetUsd,
    })
    .from(usageEvents)
    .innerJoin(users, eq(users.id, usageEvents.userId))
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(monthWindow)
    .groupBy(roles.id, roles.name, roles.slug, roles.monthlyBudgetUsd)
    .orderBy(desc(sql`coalesce(sum(${usageEvents.costUsd}), 0)`));

  // por modelo (período)
  const modelRows = await db
    .select({
      ...agg,
      key: usageEvents.model,
    })
    .from(usageEvents)
    .where(window)
    .groupBy(usageEvents.model)
    .orderBy(desc(sql`coalesce(sum(${usageEvents.costUsd}), 0)`));

  // por dia (período, fuso America/Sao_Paulo)
  const dayRows = await db
    .select({
      ...agg,
      day: sql<string>`to_char((${usageEvents.createdAt} at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD')`,
    })
    .from(usageEvents)
    .where(window)
    .groupBy(sql`(${usageEvents.createdAt} at time zone 'America/Sao_Paulo')::date`)
    .orderBy(sql`(${usageEvents.createdAt} at time zone 'America/Sao_Paulo')::date`);

  // gasto mensal de cada cargo vs orçamento
  const roleBudget = roleRows.map((row) => ({
    ...toBucket(row),
    budgetUsd: row.budget ?? null,
  }));

  const total = totalRow as unknown as { messages: string; promptTokens: string; completionTokens: string; costUsd: string; credits: string };
  return c.json({
    since: since.toISOString(),
    until: new Date().toISOString(),
    total: toBucket({ key: null, label: null, ...total }),
    byUser: userRows.map((row) => toBucket({ ...row, label: row.label ?? row.email ?? row.key })),
    byRole: roleBudget.map((row) => ({ ...row, label: row.label ?? "sem cargo" })),
    byModel: modelRows.map((row) => toBucket({ ...row, label: row.key ?? "—" })),
    byDay: dayRows.map((row) => toBucket({ ...row, key: row.day, label: row.day })),
  });
});
