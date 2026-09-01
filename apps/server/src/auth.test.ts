import { beforeAll, afterAll, describe, expect, it } from "bun:test";

import app from "./app";
import { seed } from "@nexo/db/seed";
import { db, roles, users } from "@nexo/db";
import { eq } from "drizzle-orm";

import { deleteTestUsers } from "./testing";

const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@nexo.local";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "troque-esta-senha";

async function request(
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  const response = await app.request(path, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

describe("lote 1 — identidade", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    await deleteTestUsers();
  });

  it("convite + login + me.role", async () => {
    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email: adminEmail, password: adminPassword },
    });
    expect(login.status).toBe(200);
    const adminToken = (login.data.accessToken as string) ?? "";
    expect(adminToken.length).toBeGreaterThan(10);

    const roleList = await request("/api/roles", { token: adminToken });
    expect(roleList.status).toBe(200);
    const suporte = ((roleList.data.roles as { slug: string; id: string }[]) ?? []).find(
      (role) => role.slug === "suporte",
    );
    expect(suporte).toBeTruthy();

    const email = `dev+${Date.now()}@empresa.com`;
    const invite = await request("/api/invites", {
      method: "POST",
      token: adminToken,
      body: { email, roleId: suporte!.id },
    });
    expect(invite.status).toBe(200);
    const token = invite.data.token as string;

    const accept = await request(`/api/invites/${token}/accept`, {
      method: "POST",
      body: { name: "Dev Suporte", password: "senha-segura" },
    });
    expect(accept.status).toBe(200);

    const me = await request("/api/me", { token: accept.data.accessToken as string });
    expect(me.status).toBe(200);
    expect((me.data.role as { slug: string } | null)?.slug).toBe("suporte");
  });

  it("cargo system não pode ser deletado", async () => {
    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email: adminEmail, password: adminPassword },
    });
    const adminToken = login.data.accessToken as string;
    const adminRole = (await db.select().from(roles).where(eq(roles.slug, "admin")))[0];
    expect(adminRole).toBeTruthy();

    const del = await request(`/api/roles/${adminRole!.id}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(del.status).toBe(409);
    expect((del.data.error as { code: string }).code).toBe("CONFLICT");
  });

  it("usuário sem cargo recebe ROLE_REQUIRED", async () => {
    const login = await request("/api/auth/login", {
      method: "POST",
      body: { email: adminEmail, password: adminPassword },
    });
    const adminToken = login.data.accessToken as string;
    const email = `semcargo+${Date.now()}@empresa.com`;

    const invite = await request("/api/invites", {
      method: "POST",
      token: adminToken,
      body: { email },
    });
    const accept = await request(`/api/invites/${invite.data.token as string}/accept`, {
      method: "POST",
      body: { name: "Sem Cargo", password: "senha-segura" },
    });
    const userId = (accept.data.user as { id: string }).id;

    await db.update(users).set({ roleId: null, updatedAt: new Date() }).where(eq(users.id, userId));

    const relogin = await request("/api/auth/login", {
      method: "POST",
      body: { email, password: "senha-segura" },
    });
    const rolesCall = await request("/api/roles", {
      token: relogin.data.accessToken as string,
    });
    expect(rolesCall.status).toBe(403);
    expect((rolesCall.data.error as { code: string }).code).toBe("ROLE_REQUIRED");
  });
});
