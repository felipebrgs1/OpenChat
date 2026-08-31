import { db, users } from "@nexo/db";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";

import { forbidden, roleRequired, unauthorized } from "../lib/errors";
import { authDisabled } from "../lib/flags";
import { verifyAccessToken } from "../lib/jwt";

export type AuthUser = typeof users.$inferSelect;

async function loadDevUser() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (email) {
    const byEmail = (await db.select().from(users).where(eq(users.email, email)))[0];
    if (byEmail && byEmail.status !== "disabled") {
      return byEmail;
    }
  }
  return (
    await db
      .select()
      .from(users)
      .where(and(eq(users.isAdmin, true), eq(users.status, "active")))
      .limit(1)
  )[0];
}

export const requireAuth: MiddlewareHandler<{ Variables: { user: AuthUser } }> = async (
  c,
  next,
) => {
  const header = c.req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    if (authDisabled()) {
      const devUser = await loadDevUser();
      if (!devUser) {
        throw unauthorized("AUTH_DISABLED ativo, mas não há admin bootstrap.");
      }
      c.set("user", devUser);
      await next();
      return;
    }
    throw unauthorized();
  }

  let sub: string;
  try {
    const claims = await verifyAccessToken(token);
    sub = claims.sub!;
  } catch {
    throw unauthorized();
  }

  const user = (await db.select().from(users).where(eq(users.id, sub)))[0];
  if (!user) {
    throw unauthorized();
  }
  if (user.status === "disabled") {
    throw unauthorized("Conta desativada.");
  }

  c.set("user", user);
  await next();
};

export const requireAdmin: MiddlewareHandler<{ Variables: { user: AuthUser } }> = async (
  c,
  next,
) => {
  const user = c.get("user");
  if (!user.isAdmin) {
    throw forbidden();
  }
  await next();
};

export const requireRole: MiddlewareHandler<{ Variables: { user: AuthUser } }> = async (
  c,
  next,
) => {
  const user = c.get("user");
  if (!user.roleId) {
    throw roleRequired();
  }
  await next();
};
