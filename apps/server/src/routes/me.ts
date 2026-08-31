import { createMemoryBodySchema, patchMeBodySchema } from "@nexo/contracts";
import { db, roleStarterPrompts, roles, userMemories, users } from "@nexo/db";
import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import { addMemory, rebuildMemorySummary } from "../lib/memory";
import { notFound } from "../lib/errors";
import { parseBody } from "../lib/parse";
import { toPublicUser, toRoleDetail } from "../lib/mappers";
import { requireAuth, type AuthUser } from "../middleware/auth";

export const meRoutes = new Hono<{ Variables: { user: AuthUser } }>();

meRoutes.use("*", requireAuth);

async function loadMe(userId: string) {
  const user = (await db.select().from(users).where(eq(users.id, userId)))[0];
  if (!user) {
    return null;
  }

  if (!user.roleId) {
    return { user: toPublicUser(user), role: null };
  }

  const role = (await db.select().from(roles).where(eq(roles.id, user.roleId)))[0];
  if (!role) {
    return { user: toPublicUser(user), role: null };
  }

  const starters = await db
    .select()
    .from(roleStarterPrompts)
    .where(eq(roleStarterPrompts.roleId, role.id))
    .orderBy(asc(roleStarterPrompts.sortOrder));

  return { user: toPublicUser(user), role: toRoleDetail(role, starters) };
}

meRoutes.get("/", async (c) => {
  const me = await loadMe(c.get("user").id);
  return c.json(me);
});

meRoutes.patch("/", async (c) => {
  const body = await parseBody(patchMeBodySchema, await c.req.json());
  const current = c.get("user");
  const [updated] = await db
    .update(users)
    .set({
      name: body.name ?? current.name,
      onboardedAt:
        body.onboardedAt === undefined
          ? current.onboardedAt
          : body.onboardedAt
            ? new Date(body.onboardedAt)
            : null,
      personalPrompt: body.personalPrompt === undefined ? current.personalPrompt : body.personalPrompt,
      autoLearn: body.autoLearn === undefined ? current.autoLearn : body.autoLearn,
      updatedAt: new Date(),
    })
    .where(eq(users.id, current.id))
    .returning();

  if (!updated) {
    return c.json(await loadMe(current.id));
  }

  return c.json(await loadMe(updated.id));
});

// --- loop Hermes: memória do usuário ---
meRoutes.get("/memory", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(userMemories)
    .where(eq(userMemories.userId, user.id))
    .orderBy(desc(userMemories.createdAt))
    .limit(50);
  return c.json({
    memories: rows.map((r) => ({
      id: r.id,
      content: r.content,
      source: r.source,
      createdAt: r.createdAt.toISOString(),
    })),
    memorySummary: user.memorySummary ?? null,
    personalPrompt: user.personalPrompt ?? null,
    autoLearn: user.autoLearn ?? true,
  });
});

meRoutes.post("/memory", async (c) => {
  const user = c.get("user");
  const body = await parseBody(createMemoryBodySchema, await c.req.json());
  const row = await addMemory({ userId: user.id, content: body.content, source: body.source ?? "manual" });
  if (!row) throw notFound("Falha ao salvar memória");
  return c.json({
    id: row.id,
    content: row.content,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  });
});

meRoutes.delete("/memory/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const row = (await db.select().from(userMemories).where(eq(userMemories.id, id)))[0];
  if (!row || row.userId !== user.id) throw notFound("Memória não encontrada.");
  await db.delete(userMemories).where(eq(userMemories.id, id));
  await rebuildMemorySummary(user.id);
  return c.json({ ok: true });
});

meRoutes.post("/memory/rebuild", async (c) => {
  const user = c.get("user");
  const summary = await rebuildMemorySummary(user.id);
  return c.json({ memorySummary: summary });
});
