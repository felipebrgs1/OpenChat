import { loginBodySchema, logoutBodySchema, refreshBodySchema } from "@nexo/contracts";
import { db, users } from "@nexo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { unauthorized } from "../lib/errors";
import { parseBody } from "../lib/parse";
import { issueTokens, revokeRefreshToken, rotateRefreshToken } from "../lib/tokens";
import { verifyPassword } from "../lib/crypto";
import type { AuthUser } from "../middleware/auth";
import { requireAuth } from "../middleware/auth";

export const authRoutes = new Hono<{ Variables: { user: AuthUser } }>();

authRoutes.post("/login", async (c) => {
  const body = await parseBody(loginBodySchema, await c.req.json());
  const email = body.email.trim().toLowerCase();
  const user = (await db.select().from(users).where(eq(users.email, email)))[0];

  if (!user?.passwordHash || user.status === "invited") {
    throw unauthorized("Email ou senha inválidos.");
  }
  if (user.status === "disabled") {
    throw unauthorized("Conta desativada.");
  }

  const ok = await verifyPassword(body.password, user.passwordHash);
  if (!ok) {
    throw unauthorized("Email ou senha inválidos.");
  }

  return c.json(await issueTokens(user));
});

authRoutes.post("/refresh", async (c) => {
  const body = await parseBody(refreshBodySchema, await c.req.json());
  return c.json(await rotateRefreshToken(body.refreshToken));
});

authRoutes.post("/logout", requireAuth, async (c) => {
  const body = await parseBody(logoutBodySchema, (await c.req.json().catch(() => ({}))) as unknown);
  if (body.refreshToken) {
    await revokeRefreshToken(body.refreshToken);
  }
  return c.json({ ok: true });
});
