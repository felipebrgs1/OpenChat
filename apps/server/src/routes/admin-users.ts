import { patchAdminUserBodySchema } from "@nexo/contracts";
import { db, roles, users } from "@nexo/db";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { writeAudit } from "../lib/audit";
import { forbidden, notFound } from "../lib/errors";
import { toPublicUser, toRoleSummary } from "../lib/mappers";
import { parseBody } from "../lib/parse";
import { requireAdmin, requireAuth, type AuthUser } from "../middleware/auth";

export const adminUserRoutes = new Hono<{ Variables: { user: AuthUser } }>();

adminUserRoutes.use("*", requireAuth, requireAdmin);

adminUserRoutes.get("/", async (c) => {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));
  const roleRows = await db.select().from(roles);
  const roleById = new Map(roleRows.map((role) => [role.id, role]));

  return c.json({
    users: rows.map((row) => ({
      ...toPublicUser(row),
      role: row.roleId ? toRoleSummary(roleById.get(row.roleId) ?? fallbackRole(row.roleId)) : null,
    })),
  });
});

adminUserRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(patchAdminUserBodySchema, await c.req.json());
  const actor = c.get("user");
  const current = (await db.select().from(users).where(eq(users.id, id)))[0];
  if (!current) {
    throw notFound("Usuário não encontrado.");
  }

  if (actor.id === id && body.isAdmin === false) {
    throw forbidden("Você não pode remover o próprio acesso de admin.");
  }
  if (actor.id === id && body.status === "disabled") {
    throw forbidden("Você não pode desativar a própria conta.");
  }

  if (body.roleId) {
    const role = (await db.select().from(roles).where(eq(roles.id, body.roleId)))[0];
    if (!role) {
      throw notFound("Cargo não encontrado.");
    }
  }

  const [updated] = await db
    .update(users)
    .set({
      roleId: body.roleId === undefined ? current.roleId : body.roleId,
      status: body.status ?? current.status,
      isAdmin: body.isAdmin ?? current.isAdmin,
      monthlyBudgetUsd:
        body.monthlyBudgetUsd === undefined
          ? (current as unknown as { monthlyBudgetUsd: string | null }).monthlyBudgetUsd
          : body.monthlyBudgetUsd === null
            ? null
            : body.monthlyBudgetUsd.toFixed(4),
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning();

  if (!updated) {
    throw notFound("Usuário não encontrado.");
  }

  await writeAudit({
    actorId: actor.id,
    action: "user.update",
    entityType: "user",
    entityId: id,
    meta: body,
  });

  const role = updated.roleId
    ? (await db.select().from(roles).where(eq(roles.id, updated.roleId)))[0]
    : undefined;

  return c.json({
    ...toPublicUser(updated),
    role: role ? toRoleSummary(role) : null,
  });
});

function fallbackRole(id: string) {
  return {
    id,
    slug: "desconhecido",
    name: "Desconhecido",
    description: "",
    systemPrompt: "",
    welcomeMd: "",
    monthlyBudgetUsd: null,
    isSystem: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
