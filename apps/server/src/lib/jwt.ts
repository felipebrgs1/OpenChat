import { SignJWT, jwtVerify, type JWTPayload } from "jose";

function secret() {
  const value = process.env.JWT_SECRET;
  if (!value) {
    throw new Error("JWT_SECRET is required");
  }
  return new TextEncoder().encode(value);
}

export function parseTtl(value: string | undefined, fallbackSeconds: number) {
  if (!value) {
    return fallbackSeconds;
  }
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match?.[1] || !match[2]) {
    return fallbackSeconds;
  }
  const amount = Number(match[1]);
  const unit = match[2] as "s" | "m" | "h" | "d";
  const factor = { s: 1, m: 60, h: 3600, d: 86400 }[unit];
  return amount * factor;
}

export function accessTtlSeconds() {
  return parseTtl(process.env.JWT_ACCESS_TTL, 900);
}

export function refreshTtlSeconds() {
  return parseTtl(process.env.JWT_REFRESH_TTL, 60 * 60 * 24 * 7);
}

export type AccessClaims = JWTPayload & {
  typ: "access";
  email: string;
  is_admin: boolean;
  role_id: string | null;
};

export type RefreshClaims = JWTPayload & {
  typ: "refresh";
};

export async function signAccessToken(input: {
  id: string;
  email: string;
  isAdmin: boolean;
  roleId: string | null;
}) {
  const expiresIn = accessTtlSeconds();
  const token = await new SignJWT({
    typ: "access",
    email: input.email,
    is_admin: input.isAdmin,
    role_id: input.roleId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.id)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret());
  return { token, expiresIn };
}

export async function signRefreshToken(userId: string, jti: string) {
  const expiresIn = refreshTtlSeconds();
  const token = await new SignJWT({ typ: "refresh" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret());
  return { token, expiresIn };
}

export async function verifyAccessToken(token: string) {
  const { payload } = await jwtVerify(token, secret());
  if (payload.typ !== "access" || !payload.sub) {
    throw new Error("invalid access token");
  }
  return payload as AccessClaims;
}

export async function verifyRefreshToken(token: string) {
  const { payload } = await jwtVerify(token, secret());
  if (payload.typ !== "refresh" || !payload.sub || !payload.jti) {
    throw new Error("invalid refresh token");
  }
  return payload as RefreshClaims;
}
