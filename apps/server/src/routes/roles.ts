import { createRoleBodySchema, patchRoleBodySchema, putStartersBodySchema } from "@nexo/contracts";
import { db, roleStarterPrompts, roles } from "@nexo/db";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { writeAudit } from "../lib/audit";
import { conflict, forbidden, notFound } from "../lib/errors";
import { toRoleDetail, toRoleSummary } from "../lib/mappers";
import { parseBody } from "../lib/parse";
import { requireAdmin, requireAuth, requireRole, type AuthUser } from "../middleware/auth";

export const roleRoutes = new Hono<{ Variables: { user: AuthUser } }>();

roleRoutes.use("*", requireAuth);

roleRoutes.get("/", requireRole, async (c) => {
  const rows = await db.select().from(roles).orderBy(asc(roles.name));
  const user = c.get("user");
  if (user.isAdmin) {
    return c.json({ roles: rows.map(toRoleSummary) });
  }
  return c.json({
    roles: rows.filter((row) => row.id === user.roleId).map(toRoleSummary),
  });
});

roleRoutes.get("/:slug", requireRole, async (c) => {
  const slug = c.req.param("slug");
  const role = (await db.select().from(roles).where(eq(roles.slug, slug)))[0];
  if (!role) {
    throw notFound("Cargo não encontrado.");
  }

  const user = c.get("user");
  if (!user.isAdmin && user.roleId !== role.id) {
    throw forbidden();
  }

  const starters = await db
    .select()
    .from(roleStarterPrompts)
    .where(eq(roleStarterPrompts.roleId, role.id))
    .orderBy(asc(roleStarterPrompts.sortOrder));

  return c.json(toRoleDetail(role, starters));
});

roleRoutes.post("/", requireAdmin, async (c) => {
  const body = await parseBody(createRoleBodySchema, await c.req.json());
  const existing = (await db.select().from(roles).where(eq(roles.slug, body.slug)))[0];
  if (existing) {
    throw conflict("Slug já existe.");
  }

  const [role] = await db
    .insert(roles)
    .values({
      slug: body.slug,
      name: body.name,
      description: body.description,
      systemPrompt: body.systemPrompt,
      welcomeMd: body.welcomeMd,
      isSystem: false,
    })
    .returning();

  if (!role) {
    throw new Error("failed to create role");
  }

  await writeAudit({
    actorId: c.get("user").id,
    action: "role.create",
    entityType: "role",
    entityId: role.id,
    meta: { slug: role.slug },
  });

  return c.json(toRoleDetail(role, []));
});

roleRoutes.patch("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(patchRoleBodySchema, await c.req.json());
  const current = (await db.select().from(roles).where(eq(roles.id, id)))[0];
  if (!current) {
    throw notFound("Cargo não encontrado.");
  }

  const [role] = await db
    .update(roles)
    .set({
      name: body.name ?? current.name,
      description: body.description ?? current.description,
      systemPrompt: body.systemPrompt ?? current.systemPrompt,
      welcomeMd: body.welcomeMd ?? current.welcomeMd,
      updatedAt: new Date(),
    })
    .where(eq(roles.id, id))
    .returning();

  if (!role) {
    throw notFound("Cargo não encontrado.");
  }

  await writeAudit({
    actorId: c.get("user").id,
    action: "role.update",
    entityType: "role",
    entityId: role.id,
  });

  const starters = await db
    .select()
    .from(roleStarterPrompts)
    .where(eq(roleStarterPrompts.roleId, role.id))
    .orderBy(asc(roleStarterPrompts.sortOrder));

  return c.json(toRoleDetail(role, starters));
});

roleRoutes.put("/:id/starters", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const body = await parseBody(putStartersBodySchema, await c.req.json());
  const role = (await db.select().from(roles).where(eq(roles.id, id)))[0];
  if (!role) {
    throw notFound("Cargo não encontrado.");
  }

  await db.delete(roleStarterPrompts).where(eq(roleStarterPrompts.roleId, id));
  if (body.starters.length > 0) {
    await db.insert(roleStarterPrompts).values(
      body.starters.map((starter, index) => ({
        roleId: id,
        title: starter.title,
        prompt: starter.prompt,
        sortOrder: starter.sortOrder ?? index,
      })),
    );
  }

  await writeAudit({
    actorId: c.get("user").id,
    action: "role.starters",
    entityType: "role",
    entityId: id,
  });

  const starters = await db
    .select()
    .from(roleStarterPrompts)
    .where(eq(roleStarterPrompts.roleId, id))
    .orderBy(asc(roleStarterPrompts.sortOrder));

  return c.json(toRoleDetail(role, starters));
});

roleRoutes.delete("/:id", requireAdmin, async (c) => {
  const id = c.req.param("id");
  const role = (await db.select().from(roles).where(eq(roles.id, id)))[0];
  if (!role) {
    throw notFound("Cargo não encontrado.");
  }
  if (role.isSystem) {
    throw conflict("Cargo de sistema não pode ser deletado.");
  }

  await db.delete(roles).where(eq(roles.id, id));
  await writeAudit({
    actorId: c.get("user").id,
    action: "role.delete",
    entityType: "role",
    entityId: id,
    meta: { slug: role.slug },
  });

  return c.json({ ok: true });
});
