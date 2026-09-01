import { db, knowledgeFeedback, messages, conversations } from "@nexo/db";
import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { forbidden, notFound } from "../lib/errors";
import { parseBody } from "../lib/parse";
import { requireAuth, type AuthUser } from "../middleware/auth";

export const feedbackRoutes = new Hono<{ Variables: { user: AuthUser } }>();

feedbackRoutes.use("*", requireAuth);

const createFeedbackSchema = z.object({
  messageId: z.string().uuid(),
  rating: z.enum(["util", "incorreta", "desatualizada", "sem_fonte"]),
  comment: z.string().max(2000).optional(),
});

feedbackRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(createFeedbackSchema, await c.req.json());

  const msg = (await db.select().from(messages).where(eq(messages.id, body.messageId)))[0];
  if (!msg) throw notFound("Mensagem não encontrada.");
  if (msg.role !== "assistant") throw forbidden("Só mensagens do assistente podem ser avaliadas.");
  // verifica que mensagem pertence a uma conversa do usuário (ou admin pode avaliar qualquer)
  const convo = (
    await db.select().from(conversations).where(eq(conversations.id, msg.conversationId))
  )[0];
  if (!convo) throw notFound("Conversa não encontrada.");
  if (!user.isAdmin && convo.userId !== user.id) throw forbidden("Sem acesso a esta mensagem.");

  const [row] = await db
    .insert(knowledgeFeedback)
    .values({
      messageId: body.messageId,
      userId: user.id,
      rating: body.rating,
      comment: body.comment?.trim() ? body.comment.trim() : null,
    })
    .returning();

  return c.json({ feedback: row });
});

feedbackRoutes.get("/", async (c) => {
  const user = c.get("user");
  // lista feedbacks do usuário (ou admin vê todos)
  const where = user.isAdmin ? undefined : eq(knowledgeFeedback.userId, user.id);
  const rows = where
    ? await db.select().from(knowledgeFeedback).where(where).orderBy(desc(knowledgeFeedback.createdAt)).limit(100)
    : await db.select().from(knowledgeFeedback).orderBy(desc(knowledgeFeedback.createdAt)).limit(100);
  return c.json({ feedback: rows });
});

// admin: painel de perguntas sem resposta e feedback negativo
feedbackRoutes.get("/admin/summary", async (c) => {
  const user = c.get("user");
  if (!user.isAdmin) throw forbidden();
  const all = await db.select().from(knowledgeFeedback);
  const byRating = all.reduce<Record<string, number>>((acc, r) => {
    acc[r.rating] = (acc[r.rating] ?? 0) + 1;
    return acc;
  }, {});
  const semFonte = all.filter((r) => r.rating === "sem_fonte").length;
  const incorreta = all.filter((r) => r.rating === "incorreta").length;
  const desatualizada = all.filter((r) => r.rating === "desatualizada").length;
  // mensagens com sem_fonte indicam perguntas sem resposta satisfatória
  return c.json({
    total: all.length,
    byRating,
    semFonte,
    incorreta,
    desatualizada,
    recent: all.slice(0, 20),
  });
});
