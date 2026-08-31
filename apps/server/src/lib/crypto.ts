import { createHash, randomBytes } from "node:crypto";

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashPassword(password: string) {
  return Bun.password.hash(password, { algorithm: "argon2id" });
}

export function verifyPassword(password: string, hash: string) {
  return Bun.password.verify(password, hash);
}
