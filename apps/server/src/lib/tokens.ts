import { db, refreshTokens, users } from "@nexo/db";
import { eq } from "drizzle-orm";

import { sha256 } from "./crypto";
import { refreshTtlSeconds, signAccessToken, signRefreshToken, verifyRefreshToken } from "./jwt";
import { toPublicUser } from "./mappers";
import { unauthorized } from "./errors";

type UserRow = typeof users.$inferSelect;

export async function issueTokens(user: UserRow) {
  const [row] = await db
    .insert(refreshTokens)
    .values({
      userId: user.id,
      tokenHash: "pending",
      expiresAt: new Date(Date.now() + refreshTtlSeconds() * 1000),
    })
    .returning();

  if (!row) {
    throw new Error("failed to persist refresh token");
  }

  const { token: refreshToken } = await signRefreshToken(user.id, row.id);
  await db
    .update(refreshTokens)
    .set({ tokenHash: sha256(refreshToken) })
    .where(eq(refreshTokens.id, row.id));

  const access = await signAccessToken({
    id: user.id,
    email: user.email,
    isAdmin: user.isAdmin,
    roleId: user.roleId,
  });

  return {
    accessToken: access.token,
    refreshToken,
    expiresIn: access.expiresIn,
    user: toPublicUser(user),
  };
}

export async function rotateRefreshToken(refreshToken: string) {
  let claims;
  try {
    claims = await verifyRefreshToken(refreshToken);
  } catch {
    throw unauthorized("Refresh token inválido.");
  }

  const tokenRow = (
    await db.select().from(refreshTokens).where(eq(refreshTokens.id, claims.jti!))
  )[0];
  if (
    !tokenRow ||
    tokenRow.revokedAt ||
    tokenRow.tokenHash !== sha256(refreshToken) ||
    tokenRow.expiresAt.getTime() < Date.now()
  ) {
    throw unauthorized("Refresh token inválido.");
  }

  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(eq(refreshTokens.id, tokenRow.id));

  const user = (await db.select().from(users).where(eq(users.id, tokenRow.userId)))[0];
  if (!user || user.status === "disabled") {
    throw unauthorized("Conta desativada.");
  }

  return issueTokens(user);
}

export async function revokeRefreshToken(refreshToken: string) {
  try {
    const claims = await verifyRefreshToken(refreshToken);
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, claims.jti!));
  } catch {
    return;
  }
}
