import { patchMeBodySchema } from "@nexo/contracts";
import { db, roleStarterPrompts, roles, users } from "@nexo/db";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { parseBody } from "../lib/parse";
import { toPublicUser, toRoleDetail } from "../lib/mappers";
import { requireAuth, type AuthUser } from "../middleware/auth";

export const meRoutes = new Hono<{ Variables: { user: AuthUser } }>();

meRoutes.use("*", requireAuth);

async function loadMe(userId: string) {
  const user = (await db.select().from(users).where(eq(users.id, userId)))[0];
  if (!user) {
    return null;
  }

  if (!user.roleId) {
    return { user: toPublicUser(user), role: null };
  }

  const role = (await db.select().from(roles).where(eq(roles.id, user.roleId)))[0];
  if (!role) {
    return { user: toPublicUser(user), role: null };
  }

  const starters = await db
    .select()
    .from(roleStarterPrompts)
    .where(eq(roleStarterPrompts.roleId, role.id))
    .orderBy(asc(roleStarterPrompts.sortOrder));

  return { user: toPublicUser(user), role: toRoleDetail(role, starters) };
}

meRoutes.get("/", async (c) => {
  const me = await loadMe(c.get("user").id);
  return c.json(me);
});

meRoutes.patch("/", async (c) => {
  const body = await parseBody(patchMeBodySchema, await c.req.json());
  const current = c.get("user");
  const [updated] = await db
    .update(users)
    .set({
      name: body.name ?? current.name,
      onboardedAt:
        body.onboardedAt === undefined
          ? current.onboardedAt
          : body.onboardedAt
            ? new Date(body.onboardedAt)
            : null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, current.id))
    .returning();

  if (!updated) {
    return c.json(await loadMe(current.id));
  }

  return c.json(await loadMe(updated.id));
});
