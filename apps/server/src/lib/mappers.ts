import type { PublicUser, RoleDetail, RoleSummary, Starter } from "@nexo/contracts";
import type { roleStarterPrompts, roles, users } from "@nexo/db";

type UserRow = typeof users.$inferSelect;
type RoleRow = typeof roles.$inferSelect;
type StarterRow = typeof roleStarterPrompts.$inferSelect;

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isAdmin: row.isAdmin,
    roleId: row.roleId,
    status: row.status,
    onboardedAt: row.onboardedAt ? row.onboardedAt.toISOString() : null,
    image: row.image,
    creditBalance: (row as unknown as { creditBalance: string | null }).creditBalance ?? "1000.0000",
    personalPrompt: (row as unknown as { personalPrompt: string | null }).personalPrompt ?? null,
    memorySummary: (row as unknown as { memorySummary: string | null }).memorySummary ?? null,
    autoLearn: (row as unknown as { autoLearn: boolean | null }).autoLearn ?? true,
  };
}

export function toRoleSummary(row: RoleRow): RoleSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isSystem: row.isSystem,
  };
}

export function toStarter(row: StarterRow): Starter {
  return {
    id: row.id,
    title: row.title,
    prompt: row.prompt,
    sortOrder: row.sortOrder,
  };
}

export function toRoleDetail(row: RoleRow, starterRows: StarterRow[]): RoleDetail {
  return {
    ...toRoleSummary(row),
    systemPrompt: row.systemPrompt,
    welcomeMd: row.welcomeMd,
    monthlyBudgetUsd: row.monthlyBudgetUsd,
    starters: starterRows.map(toStarter),
  };
}
