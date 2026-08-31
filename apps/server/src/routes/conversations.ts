import {
  createConversationBodySchema,
  patchConversationBodySchema,
  sendMessageBodySchema,
} from "@nexo/contracts";
import { conversations, db, messages, roleStarterPrompts, roles, usageEvents } from "@nexo/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { notFound } from "../lib/errors";
import { streamOpenRouter } from "../lib/openrouter";
import { assertAllowedModel, loadOrgSettings } from "../lib/org";
import { parseBody } from "../lib/parse";
import { assemblePrompt } from "../lib/prompt";
import { assertMessageRateLimit } from "../lib/rate-limit";
import { requireAuth, requireRole, type AuthUser } from "../middleware/auth";

export const conversationRoutes = new Hono<{ Variables: { user: AuthUser } }>();

conversationRoutes.use("*", requireAuth, requireRole);

function toConversation(row: typeof conversations.$inferSelect) {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    roleIdSnapshot: row.roleIdSnapshot,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toMessage(row: typeof messages.$inferSelect) {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    model: row.model,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    costUsd: row.costUsd,
    finishReason: row.finishReason,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

async function loadOwned(userId: string, id: string) {
  const row = (
    await db
      .select()
      .from(conversations)
      .where(and(eq(conversations.id, id), eq(conversations.userId, userId)))
  )[0];
  if (!row) {
    throw notFound("Conversa não encontrada.");
  }
  return row;
}

conversationRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.userId, user.id), isNull(conversations.archivedAt)))
    .orderBy(desc(conversations.updatedAt));
  return c.json({ conversations: rows.map(toConversation) });
});

conversationRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(createConversationBodySchema, await c.req.json().catch(() => ({})));
  const settings = await loadOrgSettings();
  const model = body.model ?? settings.defaultModel;
  assertAllowedModel(settings.allowedModels, model);

  const [row] = await db
    .insert(conversations)
    .values({
      userId: user.id,
      roleIdSnapshot: user.roleId,
      model,
    })
    .returning();
  if (!row) {
    throw new Error("failed to create conversation");
  }
  return c.json(toConversation(row));
});

conversationRoutes.get("/:id", async (c) => {
  const row = await loadOwned(c.get("user").id, c.req.param("id"));
  return c.json(toConversation(row));
});

conversationRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const current = await loadOwned(user.id, c.req.param("id"));
  const body = await parseBody(patchConversationBodySchema, await c.req.json());
  const [row] = await db
    .update(conversations)
    .set({
      title: body.title ?? current.title,
      archivedAt:
        body.archived === undefined ? current.archivedAt : body.archived ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, current.id))
    .returning();
  if (!row) {
    throw notFound("Conversa não encontrada.");
  }
  return c.json(toConversation(row));
});

conversationRoutes.get("/:id/messages", async (c) => {
  const convo = await loadOwned(c.get("user").id, c.req.param("id"));
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convo.id))
    .orderBy(asc(messages.createdAt));
  return c.json({ messages: rows.map(toMessage) });
});

conversationRoutes.post("/:id/messages", async (c) => {
  const user = c.get("user");
  const convo = await loadOwned(user.id, c.req.param("id"));
  const body = await parseBody(sendMessageBodySchema, await c.req.json());
  const settings = await loadOrgSettings();
  const model = body.model ?? convo.model ?? settings.defaultModel;
  assertAllowedModel(settings.allowedModels, model);
  assertMessageRateLimit(user.id);

  let content = body.content;
  if (body.starterId) {
    const starter = (
      await db.select().from(roleStarterPrompts).where(eq(roleStarterPrompts.id, body.starterId))
    )[0];
    if (starter) {
      content = starter.prompt;
    }
  }

  const existing = await db.select().from(messages).where(eq(messages.conversationId, convo.id));
  const isFirst = existing.filter((row) => row.role === "user").length === 0;
  const title = isFirst ? content.slice(0, 60) : convo.title;

  const [userMessage] = await db
    .insert(messages)
    .values({
      conversationId: convo.id,
      role: "user",
      content,
    })
    .returning();
  if (!userMessage) {
    throw new Error("failed to persist user message");
  }

  const [assistantMessage] = await db
    .insert(messages)
    .values({
      conversationId: convo.id,
      role: "assistant",
      content: "",
      model,
    })
    .returning();
  if (!assistantMessage) {
    throw new Error("failed to persist assistant message");
  }

  await db
    .update(conversations)
    .set({ title, model, updatedAt: new Date() })
    .where(eq(conversations.id, convo.id));

  const role = user.roleId
    ? (await db.select().from(roles).where(eq(roles.id, user.roleId)))[0]
    : undefined;
  if (!role) {
    throw notFound("Cargo não encontrado.");
  }

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, convo.id))
    .orderBy(asc(messages.createdAt));

  const assembled = assemblePrompt({
    globalSystemPrompt: settings.globalSystemPrompt,
    role,
    history: history.filter((row) => row.id !== assistantMessage.id),
  });

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "meta",
      data: JSON.stringify({
        messageId: assistantMessage.id,
        userMessageId: userMessage.id,
        model,
      }),
    });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      const error = "OPENROUTER_API_KEY ausente.";
      await db.update(messages).set({ error }).where(eq(messages.id, assistantMessage.id));
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ code: "LLM_UPSTREAM", message: error }),
      });
      return;
    }

    let full = "";
    try {
      const usage = await streamOpenRouter({
        baseUrl: settings.openrouterBaseUrl,
        apiKey,
        referer: process.env.OPENROUTER_HTTP_REFERER,
        title: process.env.OPENROUTER_APP_TITLE ?? "Nexo",
        userId: user.id,
        model,
        fallbackModel: settings.fallbackModel,
        messages: [{ role: "system", content: assembled.system }, ...assembled.messages],
        signal: c.req.raw.signal,
        onDelta: async (text) => {
          full += text;
          await stream.writeSSE({
            event: "delta",
            data: JSON.stringify({ text }),
          });
        },
      });

      const cost = usage.costUsd !== undefined ? String(usage.costUsd) : null;
      await db
        .update(messages)
        .set({
          content: full,
          model,
          promptTokens: usage.promptTokens ?? null,
          completionTokens: usage.completionTokens ?? null,
          costUsd: cost,
          finishReason: usage.finishReason ?? "stop",
        })
        .where(eq(messages.id, assistantMessage.id));

      await db.insert(usageEvents).values({
        userId: user.id,
        conversationId: convo.id,
        model,
        promptTokens: usage.promptTokens ?? 0,
        completionTokens: usage.completionTokens ?? 0,
        costUsd: cost,
      });

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({
          messageId: assistantMessage.id,
          promptTokens: usage.promptTokens ?? 0,
          completionTokens: usage.completionTokens ?? 0,
          costUsd: usage.costUsd ?? null,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha no OpenRouter.";
      await db
        .update(messages)
        .set({ content: full, error: message, model })
        .where(eq(messages.id, assistantMessage.id));
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ code: "LLM_UPSTREAM", message }),
      });
    }
  });
});
