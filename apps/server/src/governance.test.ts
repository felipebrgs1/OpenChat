import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import { db, roles, usageEvents } from "@nexo/db";
import { seed } from "@nexo/db/seed";

import app from "./app";
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
  const token = accept.data!.accessToken as string;
  const list = await request("/api/admin/users", { token: adminToken });
  const target = (list.data!.users as { id: string; email: string }[]).find(
    (u) => u.email === email,
  )!;
  return { token, adminToken, userId: target.id, roleId: role.id };
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

/** e2e: cria conversa e envia mensagem; devolve o corpo SSE. */
async function sendFirstMessage(token: string) {
  const created = await request("/api/conversations", { method: "POST", token, body: {} });
  expect(created.status).toBe(200);
  return sendMessage(token, created.data!.id as string);
}

describe("lote 5 — governança e uso (e2e, sem dados sintéticos)", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    // usuários de teste em cascade apagam conversas/mensagens/usage/ledger
    await deleteTestUsers();
  });

  it("usuário desativado não autentica (401)", async () => {
    const { token, adminToken, userId } = await createUserWithRole("suporte");

    const meBefore = await request("/api/me", { token });
    expect(meBefore.status).toBe(200);

    const patched = await request(`/api/admin/users/${userId}`, {
      method: "PATCH",
      token: adminToken,
      body: { status: "disabled" },
    });
    expect(patched.status).toBe(200);

    const meAfter = await request("/api/me", { token });
    expect(meAfter.status).toBe(401);
  });

  it("orçamento do cargo zerado → BUDGET_EXCEEDED no SSE, sem usage_event", async () => {
    const { token, adminToken, roleId, userId } = await createUserWithRole("cobranca");
    const before = await db.select().from(usageEvents).where(eq(usageEvents.userId, userId));

    // admin zera o orçamento do cargo via API real
    const patched = await request(`/api/roles/${roleId}`, {
      method: "PATCH",
      token: adminToken,
      body: { monthlyBudgetUsd: 0 },
    });
    expect(patched.status).toBe(200);

    try {
      const body = await sendFirstMessage(token);
      expect(body).toContain("event: error");
      expect(body).toContain("BUDGET_EXCEEDED");
      expect(body).toContain("cargo");

      // turno bloqueado não grava usage
      const after = await db.select().from(usageEvents).where(eq(usageEvents.userId, userId));
      expect(after.length).toBe(before.length);
    } finally {
      await request(`/api/roles/${roleId}`, {
        method: "PATCH",
        token: adminToken,
        body: { monthlyBudgetUsd: null },
      });
    }
  });

  it("orçamento do usuário zerado → BUDGET_EXCEEDED; null remove o limite", async () => {
    const { token, adminToken, userId } = await createUserWithRole("suporte");

    const patched = await request(`/api/admin/users/${userId}`, {
      method: "PATCH",
      token: adminToken,
      body: { monthlyBudgetUsd: 0 },
    });
    expect(patched.status).toBe(200);
    expect((patched.data! as { monthlyBudgetUsd: string }).monthlyBudgetUsd).toBe("0.0000");

    const body = await sendFirstMessage(token);
    expect(body).toContain("event: error");
    expect(body).toContain("BUDGET_EXCEEDED");
    expect(body).toContain("usuário");

    const cleared = await request(`/api/admin/users/${userId}`, {
      method: "PATCH",
      token: adminToken,
      body: { monthlyBudgetUsd: null },
    });
    expect(cleared.status).toBe(200);
    expect((cleared.data! as { monthlyBudgetUsd: string }).monthlyBudgetUsd).toBeNull();

    // sem limite (e saldo 1000), o erro deixa de ser BUDGET_EXCEEDED
    // (chamada LLM real; timeout maior que o default de 5s)
    const afterClear = await sendFirstMessage(token);
    expect(afterClear).not.toContain("BUDGET_EXCEEDED");
  }, 60000);

  it("GET /api/admin/usage: agregados consistentes com os eventos reais", async () => {
    const adminToken = await login(adminEmail, adminPassword);
    const result = await request("/api/admin/usage?days=30", { token: adminToken });
    expect(result.status).toBe(200);

    const data = result.data! as {
      total: { messages: number; costUsd: string; credits: string };
      byUser: { messages: number; costUsd: string }[];
      byRole: { messages: number; budgetUsd: string | null }[];
      byModel: { key: string; costUsd: string; messages: number }[];
      byDay: { messages: number; costUsd: string }[];
    };

    // consistência: total é a soma dos buckets por usuário
    const sumUserMessages = data.byUser.reduce((acc, row) => acc + row.messages, 0);
    const sumUserCost = data.byUser.reduce((acc, row) => acc + Number(row.costUsd), 0);
    expect(sumUserMessages).toBe(data.total.messages);
    expect(Math.abs(sumUserCost - Number(data.total.costUsd))).toBeLessThan(1e-6);

    // por modelo também soma o total
    const sumModelCost = data.byModel.reduce((acc, row) => acc + Number(row.costUsd), 0);
    expect(Math.abs(sumModelCost - Number(data.total.costUsd))).toBeLessThan(1e-6);

    // por dia também
    const sumDayMessages = data.byDay.reduce((acc, row) => acc + row.messages, 0);
    expect(sumDayMessages).toBe(data.total.messages);

    // cargos trazem orçamento (null = sem limite)
    for (const row of data.byRole) {
      expect(row.budgetUsd === null || typeof row.budgetUsd === "string").toBe(true);
    }
  });

  it("não-admin não acessa /api/admin/usage", async () => {
    const { token } = await createUserWithRole("suporte");
    const result = await request("/api/admin/usage", { token });
    expect(result.status).toBe(403);
  });
});
