import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { conversations, db, roles } from "@nexo/db";
import { seed } from "@nexo/db/seed";

import app from "./app";
import { deleteTestUsers } from "./testing";

const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? "admin@nexo.local";
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "troque-esta-senha";

// conversas criadas com o token do admin durante os testes
const adminConversationIds: string[] = [];

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

async function login(email: string, password: string) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: { email, password },
  });
  expect(result.status).toBe(200);
  return result.data.accessToken as string;
}

describe("lote 2 — chat", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    if (adminConversationIds.length > 0) {
      await db.delete(conversations).where(inArray(conversations.id, adminConversationIds));
    }
    await deleteTestUsers();
  });

  it("rejeita modelo fora da allowlist", async () => {
    const token = await login(adminEmail, adminPassword);
    const created = await request("/api/conversations", {
      method: "POST",
      token,
      body: { model: "openai/gpt-not-allowed" },
    });
    expect(created.status).toBe(400);
    expect((created.data.error as { code: string }).code).toBe("VALIDATION");
  });

  it("isola conversa por usuário", async () => {
    const adminToken = await login(adminEmail, adminPassword);
    const created = await request("/api/conversations", {
      method: "POST",
      token: adminToken,
      body: {},
    });
    expect(created.status).toBe(200);
    const conversationId = created.data.id as string;
    adminConversationIds.push(conversationId);

    const suporte = (await db.select().from(roles).where(eq(roles.slug, "suporte")))[0];
    const email = `chatb+${Date.now()}@empresa.com`;
    const invite = await request("/api/invites", {
      method: "POST",
      token: adminToken,
      body: { email, roleId: suporte!.id },
    });
    const accept = await request(`/api/invites/${invite.data.token as string}/accept`, {
      method: "POST",
      body: { name: "User B", password: "senha-segura" },
    });
    const otherToken = accept.data.accessToken as string;

    const peek = await request(`/api/conversations/${conversationId}`, { token: otherToken });
    expect(peek.status).toBe(404);
    expect((peek.data.error as { code: string }).code).toBe("NOT_FOUND");
  });

  it("sem OPENROUTER_API_KEY devolve error SSE sem vazar harness", async () => {
    const token = await login(adminEmail, adminPassword);
    const created = await request("/api/conversations", {
      method: "POST",
      token,
      body: {},
    });
    expect(created.status).toBe(200);
    adminConversationIds.push(created.data.id as string);
    const previous = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "";
    try {
      const headers = new Headers({ "Content-Type": "application/json" });
      headers.set("Authorization", `Bearer ${token}`);
      const response = await app.request(
        `/api/conversations/${created.data.id as string}/messages`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ content: "oi" }),
        },
      );
      expect(response.headers.get("content-type") ?? "").toContain("text/event-stream");
      const body = await response.text();
      expect(body).toContain("event: error");
      expect(body).toContain("LLM_UPSTREAM");
      expect(body).toContain("OPENROUTER_API_KEY ausente");
      expect(body).not.toContain("pi-coding-agent");
      expect(body).not.toContain("sessionFile");
      expect(body).not.toContain("toolCallId");
    } finally {
      process.env.OPENROUTER_API_KEY = previous;
    }
  });
});
