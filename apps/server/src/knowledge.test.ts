import { beforeAll, afterAll, describe, expect, it } from "bun:test";
import { eq, like } from "drizzle-orm";

import { db, knowledgeCollections, knowledgeRoles, roles } from "@nexo/db";
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
  const data = (await response.json()) as Record<string, unknown>;
  return { status: response.status, data };
}

async function login(email: string, password: string) {
  const result = await request("/api/auth/login", { method: "POST", body: { email, password } });
  expect(result.status).toBe(200);
  return result.data.accessToken as string;
}

async function createUserWithRole(roleSlug: string) {
  const adminToken = await login(adminEmail, adminPassword);
  const role = (await db.select().from(roles).where(eq(roles.slug, roleSlug)))[0];
  if (!role) {
    throw new Error(`cargo ${roleSlug} não encontrado`);
  }
  const email = `kb-${roleSlug}+${Date.now()}@empresa.com`;
  const invite = await request("/api/invites", {
    method: "POST",
    token: adminToken,
    body: { email, roleId: role.id },
  });
  const accept = await request(`/api/invites/${invite.data.token as string}/accept`, {
    method: "POST",
    body: { name: `User ${roleSlug}`, password: "senha-segura" },
  });
  return accept.data.accessToken as string;
}

describe("lote 4 — knowledge por cargo", () => {
  beforeAll(async () => {
    await seed();
  });

  afterAll(async () => {
    await deleteTestUsers();
    // collections criadas pelo teste de CRUD admin
    await db.delete(knowledgeCollections).where(like(knowledgeCollections.slug, "teste-%"));
  });

  it("doc vinculado só a cobranca não aparece para comercial", async () => {
    const cobrancaToken = await createUserWithRole("cobranca");
    const comercialToken = await createUserWithRole("comercial");

    const cobrancaList = await request("/api/knowledge", { token: cobrancaToken });
    expect(cobrancaList.status).toBe(200);
    const cobrancaSlugs = (cobrancaList.data.collections as { slug: string }[]).map((c) => c.slug);
    expect(cobrancaSlugs).toContain("como-cobramos");

    const comercialList = await request("/api/knowledge", { token: comercialToken });
    const comercialSlugs = (comercialList.data.collections as { slug: string }[]).map(
      (c) => c.slug,
    );
    expect(comercialSlugs).not.toContain("como-cobramos");

    // acesso direto ao detalhe também é bloqueado
    const collection = (
      await db
        .select()
        .from(knowledgeCollections)
        .where(eq(knowledgeCollections.slug, "como-cobramos"))
    )[0];
    if (!collection) {
      throw new Error("collection seed não encontrada");
    }
    const peek = await request(`/api/knowledge/${collection.id}`, { token: comercialToken });
    expect(peek.status).toBe(404);
  });

  it("base com visibility all aparece para qualquer cargo", async () => {
    const token = await createUserWithRole("comercial");
    const list = await request("/api/knowledge", { token });
    const slugs = (list.data.collections as { slug: string }[]).map((c) => c.slug);
    expect(slugs).toContain("organograma");
  });

  it("admin cria collection + doc e vincula cargo; doc fica visível só para o cargo", async () => {
    const adminToken = await login(adminEmail, adminPassword);
    const suporte = (await db.select().from(roles).where(eq(roles.slug, "suporte")))[0];
    if (!suporte) {
      throw new Error("cargo suporte não encontrado");
    }

    const created = await request("/api/knowledge", {
      method: "POST",
      token: adminToken,
      body: {
        slug: `teste-${Date.now()}`,
        name: "Base de teste",
        description: "criada no teste",
        visibility: "by_role",
        roleIds: [suporte.id],
      },
    });
    expect(created.status).toBe(200);
    const collectionId = created.data.id as string;

    const doc = await request(`/api/knowledge/${collectionId}/documents`, {
      method: "POST",
      token: adminToken,
      body: { title: "Doc de teste", bodyMd: "# Conteúdo\n\nlinha de teste" },
    });
    expect(doc.status).toBe(200);

    const suporteToken = await createUserWithRole("suporte");
    const detail = await request(`/api/knowledge/${collectionId}`, { token: suporteToken });
    expect(detail.status).toBe(200);
    expect((detail.data.documents as { title: string }[]).map((d) => d.title)).toContain(
      "Doc de teste",
    );

    // soft delete esconde o doc
    const docId = (detail.data.documents as { id: string }[])[0]!.id;
    const removed = await request(`/api/knowledge/documents/${docId}`, {
      method: "DELETE",
      token: adminToken,
    });
    expect(removed.status).toBe(200);
    const after = await request(`/api/knowledge/${collectionId}`, { token: suporteToken });
    expect((after.data.documents as unknown[]).length).toBe(0);
  });

  it("assemblePrompt injeta [CONHECIMENTO] com cap de tokens", async () => {
    const { assemblePrompt } = await import("./lib/prompt");
    const { buildKnowledgeBlock } = await import("./lib/knowledge");
    const cobranca = (await db.select().from(roles).where(eq(roles.slug, "cobranca")))[0];
    if (!cobranca) {
      throw new Error("cargo cobranca não encontrado");
    }
    const block = await buildKnowledgeBlock(cobranca.id);
    expect(block).toContain("[CONHECIMENTO]");
    expect(block).toContain("Como a Voz Educa cobra");

    const assembled = assemblePrompt({
      globalSystemPrompt: "global",
      role: cobranca,
      history: [],
      knowledgeBlock: block,
    });
    expect(assembled.system).toContain("[CONHECIMENTO]");
    // cap: bloco de conhecimento não passa de ~4k tokens + cabeçalho
    const knowledgePart = assembled.system.split("[CONHECIMENTO]")[1] ?? "";
    expect(knowledgePart.length).toBeLessThanOrEqual(4000 * 4 + 200);
  });

  it("knowledge_role referencia cargo existente (integridade do seed)", async () => {
    const links = await db.select().from(knowledgeRoles);
    const roleRows = await db.select().from(roles);
    const roleIds = new Set(roleRows.map((r) => r.id));
    for (const link of links) {
      expect(roleIds.has(link.roleId)).toBe(true);
    }
  });
});
