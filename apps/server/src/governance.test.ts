import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import { db, roles, usageEvents, users } from "@nexo/db";
import { seed } from "@nexo/db/seed";

import app from "./app";

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
  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: response.status, data };
}

async function login(email: string, password: string) {
  const result = await request("/api/auth/login", { method: "POST", body: { email, password } });
  expect(result.status).toBe(200);
  return result.data!.accessToken as string;
}

async function createUserWithRole(roleSlug: string) {
  const adminToken = await login(adminEmail, adminPassword);
  const role = (await db.select().from(roles).where(eq(roles.slug, roleSlug)))[0]!;
  const email = `gov-${roleSlug}+${Date.now()}@empresa.com`;
  const invite = await request("/api/invites", {
    method: "POST",
    token: adminToken,
    body: { email, roleId: role.id },
  });
  const accept = await request(`/api/invites/${invite.data!.token as string}/accept`, {
    method: "POST",
    body: { name: `Gov ${roleSlug}`, password: "senha-segura" },
  });
  return { token: accept.data!.accessToken as string, email, roleId: role.id };
}

async function sendMessage(token: string, conversationId: string) {
  const response = await app.request(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ content: "quanto custa?" }),
  });
  expect(response.headers.get("content-type") ?? "").toContain("text/event-stream");
  return await response.text();
}

describe("lote 5 — governança e uso", () => {
  beforeAll(async () => {
    await seed();
  });

  it("usuário desativado não autentica (401)", async () => {
    const adminToken = await login(adminEmail, adminPassword);
    const { token, email } = await createUserWithRole("suporte");
    // sanity: autentica antes
    const meBefore = await request("/api/me", { token });
    expect(meBefore.status).toBe(200);

    const list = await request("/api/admin/users", { token: adminToken });
    const target = (list.data!.users as { id: string; email: string }[]).find(
      (u) => u.email === email,
    )!;
    const patched = await request(`/api/admin/users/${target.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "disabled" },
    });
    expect(patched.status).toBe(200);

    const meAfter = await request("/api/me", { token });
    expect(meAfter.status).toBe(401);
  });

  it("orçamento mensal do cargo estourado → BUDGET_EXCEEDED no SSE", async () => {
    const { token } = await createUserWithRole("cobranca");
    const role = (await db.select().from(roles).where(eq(roles.slug, "cobranca")))[0]!;
    const previousBudget = role.monthlyBudgetUsd;

    // grava usage simulado deste mês acima do orçamento que vamos setar
    const target = (await db.select().from(users).where(eq(users.roleId, role.id)))[0]!;
    await db.insert(usageEvents).values({
      userId: target.id,
      model: "test/model",
      costUsd: "5.000000",
      promptTokens: 10,
      completionTokens: 10,
    });

    await db.update(roles).set({ monthlyBudgetUsd: "1.0000" }).where(eq(roles.id, role.id));

    try {
      const created = await request("/api/conversations", { method: "POST", token, body: {} });
      expect(created.status).toBe(200);
      const body = await sendMessage(token, created.data!.id as string);
      expect(body).toContain("event: error");
      expect(body).toContain("BUDGET_EXCEEDED");
      expect(body).toContain("cargo");
    } finally {
      await db.update(roles).set({ monthlyBudgetUsd: previousBudget }).where(eq(roles.id, role.id));
    }
  });

  it("orçamento mensal do usuário estourado → BUDGET_EXCEEDED", async () => {
    const adminToken = await login(adminEmail, adminPassword);
    const { token, email } = await createUserWithRole("suporte");
    const list = await request("/api/admin/users", { token: adminToken });
    const target = (list.data!.users as { id: string; email: string }[]).find(
      (u) => u.email === email,
    )!;

    await db.insert(usageEvents).values({
      userId: target.id,
      model: "test/model",
      costUsd: "2.000000",
      promptTokens: 5,
      completionTokens: 5,
    });

    const patched = await request(`/api/admin/users/${target.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { monthlyBudgetUsd: 1 },
    });
    expect(patched.status).toBe(200);
    expect((patched.data! as { monthlyBudgetUsd: string }).monthlyBudgetUsd).toBe("1.0000");

    const created = await request("/api/conversations", { method: "POST", token, body: {} });
    expect(created.status).toBe(200);
    const body = await sendMessage(token, created.data!.id as string);
    expect(body).toContain("event: error");
    expect(body).toContain("BUDGET_EXCEEDED");
    expect(body).toContain("usuário");

    // limpa orçamento
    const cleared = await request(`/api/admin/users/${target.id}`, {
      method: "PATCH",
      token: adminToken,
      body: { monthlyBudgetUsd: null },
    });
    expect((cleared.data! as { monthlyBudgetUsd: string }).monthlyBudgetUsd).toBeNull();
  });

  it("GET /api/admin/usage agrega por user/cargo/modelo/dia", async () => {
    const adminToken = await login(adminEmail, adminPassword);
    const result = await request("/api/admin/usage?days=30", { token: adminToken });
    expect(result.status).toBe(200);
    const data = result.data! as Record<string, unknown>;
    expect(Array.isArray(data.byUser)).toBe(true);
    expect(Array.isArray(data.byRole)).toBe(true);
    expect(Array.isArray(data.byModel)).toBe(true);
    expect(Array.isArray(data.byDay)).toBe(true);
    const total = data.total as { costUsd: string; messages: number };
    expect(Number(total.costUsd)).toBeGreaterThanOrEqual(0);
    // deve conter ao menos o usage_event inserido nos testes anteriores
    const byModel = data.byModel as { key: string; costUsd: string }[];
    expect(byModel.some((row) => row.key === "test/model")).toBe(true);
  });

  it("não-admin não acessa /api/admin/usage", async () => {
    const { token } = await createUserWithRole("suporte");
    const result = await request("/api/admin/usage", { token });
    expect(result.status).toBe(403);
  });
});
