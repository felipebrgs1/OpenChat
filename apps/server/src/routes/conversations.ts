import {
  createConversationBodySchema,
  patchConversationBodySchema,
  sendMessageBodySchema,
} from "@nexo/contracts";
import { conversations, db, messages, roleStarterPrompts, roles, usageEvents, users } from "@nexo/db";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";

import { notFound } from "../lib/errors";
import { publicLlmError, streamNexoTurn } from "../lib/pi-harness";
import { assertBudgets } from "../lib/budget";
import { creditsFromUsd, deductCredits } from "../lib/credits";
import { buildKnowledgeBlock } from "../lib/knowledge";
import { maybeLearnFromTurn } from "../lib/memory";
import { buildRagKnowledgeBlock, formatCitations, retrieveKnowledgeChunks } from "../lib/rag";
import { assertSelectableModel, effectiveDefaultModel, loadOrgSettings } from "../lib/org";
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
    credits: (row as unknown as { credits: string | null }).credits ?? null,
    tps: (row as unknown as { tps: string | null }).tps
      ? Number((row as unknown as { tps: string }).tps)
      : null,
    latencyMs: (row as unknown as { latencyMs: number | null }).latencyMs ?? null,
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
  const model = body.model ?? effectiveDefaultModel(settings);
  await assertSelectableModel(settings, model);

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

conversationRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const current = await loadOwned(user.id, c.req.param("id"));
  await db.delete(conversations).where(eq(conversations.id, current.id));
  return c.json({ ok: true });
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
  const model = body.model ?? convo.model ?? effectiveDefaultModel(settings);
  await assertSelectableModel(settings, model);
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

  // loop de aprendizado Hermes: prompt do cargo (role) + prompt do usuário + memória aprendida
  const freshUser = (await db.select().from(users).where(eq(users.id, user.id)))[0] as unknown as {
    personalPrompt: string | null;
    memorySummary: string | null;
    autoLearn: boolean | null;
  };
  // RAG: retrieval top-6 filtrado por cargo; fallback para bloco legado se RAG vazio
  let ragChunks: Awaited<ReturnType<typeof retrieveKnowledgeChunks>> = [];
  let knowledgeBlock = "";
  if (user.roleId) {
    try {
      ragChunks = await retrieveKnowledgeChunks(content, user.roleId, 6);
    } catch {
      ragChunks = [];
    }
    if (ragChunks.length > 0) {
      knowledgeBlock = buildRagKnowledgeBlock(ragChunks);
    } else {
      knowledgeBlock = await buildKnowledgeBlock(user.roleId);
    }
  }

  const assembled = assemblePrompt({
    globalSystemPrompt: settings.globalSystemPrompt,
    role,
    history: history.filter((row) => row.id !== assistantMessage.id),
    knowledgeBlock,
    user: {
      personalPrompt: freshUser?.personalPrompt ?? null,
      memorySummary: freshUser?.memorySummary ?? null,
    },
  });

  if (process.env.DEBUG_PROMPT?.trim() === "1") {
    console.log(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "debug",
        promptDebug: true,
        conversationId: convo.id,
        userId: user.id,
        system: assembled.system,
      }),
    );
  }

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "meta",
      data: JSON.stringify({
        messageId: assistantMessage.id,
        userMessageId: userMessage.id,
        model,
      }),
    });

    // controle fino de gastos: saldo + orçamento mensal user/cargo/org
    try {
      await assertBudgets({ userId: user.id, orgSettings: settings });
    } catch (budgetError) {
      const message =
        budgetError instanceof Error ? budgetError.message : "Orçamento atingido.";
      await db
        .update(messages)
        .set({ error: message })
        .where(eq(messages.id, assistantMessage.id));
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ code: "BUDGET_EXCEEDED", message }),
      });
      return;
    }

    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      const error = "OPENROUTER_API_KEY ausente.";
      await db.update(messages).set({ error }).where(eq(messages.id, assistantMessage.id));
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ code: "LLM_UPSTREAM", message: error }),
      });
      return;
    }

    let full = "";
    const startedAt = Date.now();
    try {
      const usage = await streamNexoTurn({
        userId: user.id,
        model,
        fallbackModel: settings.fallbackModel,
        baseUrl: settings.openrouterBaseUrl,
        systemPrompt: assembled.system,
        history: assembled.messages.slice(0, -1).map((row) => ({
          role: row.role,
          content: row.content,
        })),
        content,
        signal: c.req.raw.signal,
        onDelta: async (text) => {
          full += text;
          await stream.writeSSE({
            event: "delta",
            data: JSON.stringify({ text }),
          });
        },
      });

      // RAG citação: append fontes ao final se houve retrieval
      if (ragChunks.length > 0) {
        const citation = formatCitations(ragChunks);
        if (citation && !full.includes("**Fontes:")) {
          full += citation;
          await stream.writeSSE({ event: "delta", data: JSON.stringify({ text: citation }) });
        }
      }

      const latencyMs = Date.now() - startedAt;
      const completionTokens = usage.completionTokens ?? 0;
      const tps = latencyMs > 0 ? Number(((completionTokens / latencyMs) * 1000).toFixed(2)) : 0;
      const cost = usage.costUsd !== undefined ? String(usage.costUsd) : null;
      const credits = creditsFromUsd(usage.costUsd);
      const creditsStr = credits.toFixed(4);

      await db
        .update(messages)
        .set({
          content: full,
          model,
          promptTokens: usage.promptTokens ?? null,
          completionTokens: usage.completionTokens ?? null,
          costUsd: cost,
          credits: creditsStr,
          tps: String(tps),
          latencyMs,
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
        credits: creditsStr,
        tps: String(tps),
        latencyMs,
      });

      // debita créditos (1000 créditos = US$1) – fracionado
      let balanceAfter: string | null = null;
      try {
        const deducted = await deductCredits({
          userId: user.id,
          costUsd: usage.costUsd ?? 0,
          model,
          conversationId: convo.id,
          messageId: assistantMessage.id,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          tps,
          latencyMs,
        });
        balanceAfter = deducted.balanceAfter;
      } catch {
        // não falha o done se ledger falhar
      }

      await stream.writeSSE({
        event: "done",
        data: JSON.stringify({
          messageId: assistantMessage.id,
          promptTokens: usage.promptTokens ?? 0,
          completionTokens: usage.completionTokens ?? 0,
          credits: creditsStr,
          tps,
          latencyMs,
          balanceAfter,
        }),
      });

      // loop Hermes: aprende com o usuário (não bloqueia o stream)
      void maybeLearnFromTurn({
        userId: user.id,
        userContent: content,
        assistantContent: full,
        autoLearn: freshUser?.autoLearn ?? true,
      }).catch(() => {});
    } catch (error) {
      const message = publicLlmError(error);
      // se for BUDGET_EXCEEDED já tratado, mas em caso geral
      if (message.includes("BUDGET_EXCEEDED") || (error instanceof Error && (error as unknown as { code?: string }).code === "BUDGET_EXCEEDED")) {
        await db.update(messages).set({ content: full, error: message, model }).where(eq(messages.id, assistantMessage.id));
        await stream.writeSSE({ event: "error", data: JSON.stringify({ code: "BUDGET_EXCEEDED", message }) });
        return;
      }
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
