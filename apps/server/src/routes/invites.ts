import { acceptInviteBodySchema, createInviteBodySchema } from "@nexo/contracts";
import { db, invites, roles, users } from "@nexo/db";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import { writeAudit } from "../lib/audit";
import { hashPassword, randomToken, sha256 } from "../lib/crypto";
import { conflict, notFound } from "../lib/errors";
import { parseBody } from "../lib/parse";
import { issueTokens } from "../lib/tokens";
import { requireAdmin, requireAuth, type AuthUser } from "../middleware/auth";

export const invitePublicRoutes = new Hono();
export const inviteAdminRoutes = new Hono<{ Variables: { user: AuthUser } }>();

invitePublicRoutes.post("/:token/accept", async (c) => {
  const token = c.req.param("token");
  const body = await parseBody(acceptInviteBodySchema, await c.req.json());
  const invite = (
    await db
      .select()
      .from(invites)
      .where(eq(invites.tokenHash, sha256(token)))
  )[0];

  if (!invite || invite.acceptedAt || invite.expiresAt.getTime() < Date.now()) {
    throw notFound("Convite inválido ou expirado.");
  }

  const email = invite.email.toLowerCase();
  let user = (await db.select().from(users).where(eq(users.email, email)))[0];
  const passwordHash = await hashPassword(body.password);

  if (user?.status === "active") {
    throw conflict("Usuário já cadastrado.");
  }

  if (user) {
    const [updated] = await db
      .update(users)
      .set({
        name: body.name,
        passwordHash,
        roleId: invite.roleId,
        status: "active",
        emailVerified: true,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    user = updated ?? user;
  } else {
    const [created] = await db
      .insert(users)
      .values({
        name: body.name,
        email,
        passwordHash,
        roleId: invite.roleId,
        status: "active",
        emailVerified: true,
        creditBalance: "1000.0000",
      })
      .returning();
    if (!created) {
      throw new Error("failed to create user");
    }
    user = created;
  }

  await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, invite.id));

  return c.json(await issueTokens(user));
});

inviteAdminRoutes.use("*", requireAuth, requireAdmin);

inviteAdminRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      invite: invites,
      roleName: roles.name,
    })
    .from(invites)
    .innerJoin(roles, eq(invites.roleId, roles.id))
    .orderBy(desc(invites.createdAt));

  return c.json({
    invites: rows.map((row) => ({
      id: row.invite.id,
      email: row.invite.email,
      roleId: row.invite.roleId,
      roleName: row.roleName,
      expiresAt: row.invite.expiresAt.toISOString(),
      acceptedAt: row.invite.acceptedAt ? row.invite.acceptedAt.toISOString() : null,
      createdAt: row.invite.createdAt.toISOString(),
    })),
  });
});

inviteAdminRoutes.post("/", async (c) => {
  const body = await parseBody(createInviteBodySchema, await c.req.json());
  const email = body.email.trim().toLowerCase();
  const actor = c.get("user");

  let roleId = body.roleId;
  if (!roleId) {
    const novato = (await db.select().from(roles).where(eq(roles.slug, "novato")))[0];
    if (!novato) {
      throw notFound("Cargo novato não encontrado. Rode o seed.");
    }
    roleId = novato.id;
  } else {
    const role = (await db.select().from(roles).where(eq(roles.id, roleId)))[0];
    if (!role) {
      throw notFound("Cargo não encontrado.");
    }
  }

  const existingUser = (await db.select().from(users).where(eq(users.email, email)))[0];
  if (existingUser?.status === "active") {
    throw conflict("Usuário já cadastrado.");
  }

  const pending = (
    await db
      .select()
      .from(invites)
      .where(and(eq(invites.email, email), isNull(invites.acceptedAt)))
  )[0];
  if (pending && pending.expiresAt.getTime() > Date.now()) {
    await db.update(invites).set({ expiresAt: new Date() }).where(eq(invites.id, pending.id));
  }

  if (!existingUser) {
    await db.insert(users).values({
      name: email.split("@")[0] ?? email,
      email,
      roleId,
      status: "invited",
    });
  } else {
    await db
      .update(users)
      .set({ roleId, status: "invited", updatedAt: new Date() })
      .where(eq(users.id, existingUser.id));
  }

  const token = randomToken();
  const [invite] = await db
    .insert(invites)
    .values({
      email,
      roleId,
      invitedBy: actor.id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 72 * 60 * 60 * 1000),
    })
    .returning();

  if (!invite) {
    throw new Error("failed to create invite");
  }

  const role = (await db.select().from(roles).where(eq(roles.id, roleId)))[0];
  await writeAudit({
    actorId: actor.id,
    action: "user.invite",
    entityType: "invite",
    entityId: invite.id,
    meta: { email, roleId },
  });

  return c.json({
    id: invite.id,
    email: invite.email,
    roleId: invite.roleId,
    roleName: role?.name ?? "",
    expiresAt: invite.expiresAt.toISOString(),
    acceptedAt: null,
    createdAt: invite.createdAt.toISOString(),
    token,
    acceptPath: `/invite/${token}`,
  });
});

inviteAdminRoutes.post("/:id/revoke", async (c) => {
  const id = c.req.param("id");
  const invite = (await db.select().from(invites).where(eq(invites.id, id)))[0];
  if (!invite) {
    throw notFound("Convite não encontrado.");
  }
  if (invite.acceptedAt) {
    throw conflict("Convite já aceito.");
  }

  await db.update(invites).set({ expiresAt: new Date() }).where(eq(invites.id, id));
  await writeAudit({
    actorId: c.get("user").id,
    action: "invite.revoke",
    entityType: "invite",
    entityId: id,
  });

  return c.json({ ok: true });
});
