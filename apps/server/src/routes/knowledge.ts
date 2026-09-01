import {
  createKnowledgeCollectionBodySchema,
  createKnowledgeDocumentBodySchema,
  patchKnowledgeCollectionBodySchema,
  patchKnowledgeDocumentBodySchema,
} from "@nexo/contracts";
import { db, knowledgeChunks, knowledgeCollections, knowledgeDocuments, knowledgeRoles } from "@nexo/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import { writeAudit } from "../lib/audit";
import { forbidden, notFound } from "../lib/errors";
import { chunkMarkdown } from "../lib/chunk";
import { embedTexts } from "../lib/embeddings";
import {
  loadAllCollections,
  loadCollectionsForRole,
  loadDocuments,
  loadRoleLinks,
} from "../lib/knowledge";
import { parseBody } from "../lib/parse";
import { requireAdmin, requireAuth, type AuthUser } from "../middleware/auth";

export const knowledgeRoutes = new Hono<{ Variables: { user: AuthUser } }>();

type CollectionRow = typeof knowledgeCollections.$inferSelect;
type DocumentRow = typeof knowledgeDocuments.$inferSelect;

function toDocument(row: DocumentRow) {
  return {
    id: row.id,
    collectionId: row.collectionId,
    title: row.title,
    sourceType: row.sourceType,
    filename: row.filename,
    mime: row.mime,
    bodyMd: row.bodyMd,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function toSummary(
  row: CollectionRow,
  docs: DocumentRow[],
  links: { collectionId: string; roleId: string }[],
) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    documentCount: docs.filter((doc) => doc.collectionId === row.id).length,
    roleIds: links.filter((link) => link.collectionId === row.id).map((link) => link.roleId),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function checksum(body: string) {
  return Bun.SHA256.hash(body, "hex");
}

async function guardCollectionRead(user: AuthUser, collectionId: string) {
  const row = (
    await db.select().from(knowledgeCollections).where(eq(knowledgeCollections.id, collectionId))
  )[0];
  if (!row || row.deletedAt) {
    throw notFound("Base não encontrada.");
  }
  if (!user.isAdmin) {
    if (!user.roleId) {
      throw forbidden("Usuário sem cargo.");
    }
    if (row.visibility === "all") {
      return row;
    }
    const linked = (
      await db.select().from(knowledgeRoles).where(eq(knowledgeRoles.collectionId, collectionId))
    ).some((link) => link.roleId === user.roleId);
    if (!linked) {
      throw notFound("Base não encontrada.");
    }
  }
  return row;
}

async function reindexDocument(documentId: string, collectionId: string, bodyMd: string) {
  // remove antigos
  await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, documentId));
  const chunks = chunkMarkdown(bodyMd);
  if (chunks.length === 0) return;
  try {
    const { embeddings } = await embedTexts(chunks);
    const rows = chunks.map((content, i) => ({
      documentId,
      collectionId,
      chunkIndex: i,
      content,
      embedding: embeddings[i] ?? null,
    }));
    // insere em batches para não estourar param limit
    for (let i = 0; i < rows.length; i += 64) {
      const batch = rows.slice(i, i + 64);
      await db.insert(knowledgeChunks).values(batch);
    }
  } catch (e) {
    console.warn(`reindex falhou para doc ${documentId}:`, e instanceof Error ? e.message : String(e));
    // fallback: salva chunks sem embedding para não bloquear criação
    try {
      const fallbackRows = chunks.map((content, i) => ({
        documentId,
        collectionId,
        chunkIndex: i,
        content,
      }));
      for (let i = 0; i < fallbackRows.length; i += 64) {
        await db.insert(knowledgeChunks).values(fallbackRows.slice(i, i + 64) as never);
      }
    } catch {}
  }
}

async function extractTextFromFile(file: File): Promise<{ text: string; filename: string; mime: string }> {
  const filename = file.name;
  const mime = file.type || "application/octet-stream";
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      // lazy import para não quebrar se pdf-parse não estiver instalado
      // @ts-ignore
      const mod: unknown = await import("pdf-parse").catch(() => null);
      const pdfParse = (mod as { default?: (b: Buffer) => Promise<{ text: string }> })?.default;
      if (pdfParse) {
        const parsed = await pdfParse(buf);
        return { text: parsed.text, filename, mime: mime || "application/pdf" };
      }
      // fallback: tenta extrair como texto simples
      return { text: buf.toString("utf-8").slice(0, 200000), filename, mime };
    } catch {
      const buf = Buffer.from(await file.arrayBuffer());
      return { text: buf.toString("utf-8").slice(0, 200000), filename, mime };
    }
  }
  // txt/md
  const text = await file.text();
  return { text, filename, mime: mime || "text/markdown" };
}

// ---------- logado ----------

knowledgeRoutes.use("*", requireAuth);

knowledgeRoutes.get("/", async (c) => {
  const user = c.get("user");
  const rows = user.isAdmin
    ? await loadAllCollections()
    : user.roleId
      ? await loadCollectionsForRole(user.roleId)
      : [];
  const ids = rows.map((row) => row.id);
  const [docs, links] = await Promise.all([loadDocuments(ids), loadRoleLinks(ids)]);
  return c.json({
    collections: await Promise.all(rows.map((row) => toSummary(row, docs, links))),
  });
});

knowledgeRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const row = await guardCollectionRead(user, c.req.param("id"));
  const [docs, links] = await Promise.all([loadDocuments([row.id]), loadRoleLinks([row.id])]);
  return c.json({
    ...(await toSummary(row, docs, links)),
    documents: docs.map(toDocument),
  });
});

// ---------- admin ----------

knowledgeRoutes.use("*", requireAdmin);

knowledgeRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await parseBody(createKnowledgeCollectionBodySchema, await c.req.json());

  const existing = (
    await db.select().from(knowledgeCollections).where(eq(knowledgeCollections.slug, body.slug))
  )[0];
  if (existing && !existing.deletedAt) {
    throw forbidden("Já existe uma base com esse slug.");
  }

  const [row] = await db
    .insert(knowledgeCollections)
    .values({
      slug: body.slug,
      name: body.name,
      description: body.description ?? "",
      visibility: body.visibility ?? "by_role",
      createdBy: user.id,
    })
    .returning();
  if (!row) {
    throw new Error("failed to create collection");
  }

  if (body.roleIds?.length) {
    await db
      .insert(knowledgeRoles)
      .values(body.roleIds.map((roleId) => ({ collectionId: row.id, roleId })));
  }

  await writeAudit({
    actorId: user.id,
    action: "knowledge.create",
    entityType: "knowledge_collection",
    entityId: row.id,
    meta: { slug: row.slug },
  });

  return c.json({ id: row.id, slug: row.slug });
});

knowledgeRoutes.post("/:id/documents", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const collection = await guardCollectionRead(user, id);
  const body = await parseBody(createKnowledgeDocumentBodySchema, await c.req.json());

  const [row] = await db
    .insert(knowledgeDocuments)
    .values({
      collectionId: collection.id,
      title: body.title,
      bodyMd: body.bodyMd,
      sourceType: "markdown",
      checksum: checksum(body.bodyMd),
      createdBy: user.id,
    })
    .returning();
  if (!row) {
    throw new Error("failed to create document");
  }

  await db
    .update(knowledgeCollections)
    .set({ updatedAt: new Date() })
    .where(eq(knowledgeCollections.id, id));

  // RAG: indexa chunks em background (await para garantir consistência)
  await reindexDocument(row.id, collection.id, body.bodyMd);

  await writeAudit({
    actorId: user.id,
    action: "knowledge.publish",
    entityType: "knowledge_document",
    entityId: row.id,
    meta: { collectionId: id, title: body.title },
  });

  return c.json(toDocument(row));
});

// upload txt/md/pdf -> extrai texto e cria document
knowledgeRoutes.post("/:id/upload", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const collection = await guardCollectionRead(user, id);
  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  if (!file || typeof file === "string") {
    throw forbidden("Envie um arquivo em 'file'.");
  }
  // valida extensão
  const lower = file.name.toLowerCase();
  const allowed = lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".pdf");
  if (!allowed) {
    throw forbidden("Formato não suportado. Use md, txt ou pdf.");
  }
  const titleForm = form.get("title");
  const { text, filename, mime } = await extractTextFromFile(file);
  if (!text.trim()) throw forbidden("Arquivo vazio ou ilegível.");
  const title = (typeof titleForm === "string" && titleForm.trim()) || filename.replace(/\.[^.]+$/, "") || "Documento";

  const [row] = await db
    .insert(knowledgeDocuments)
    .values({
      collectionId: collection.id,
      title,
      bodyMd: text.slice(0, 500000),
      sourceType: lower.endsWith(".pdf") ? "upload" : "markdown",
      filename,
      mime,
      checksum: checksum(text),
      createdBy: user.id,
    })
    .returning();
  if (!row) throw new Error("failed to create document from upload");

  await db.update(knowledgeCollections).set({ updatedAt: new Date() }).where(eq(knowledgeCollections.id, id));
  await reindexDocument(row.id, collection.id, row.bodyMd);

  await writeAudit({
    actorId: user.id,
    action: "knowledge.publish",
    entityType: "knowledge_document",
    entityId: row.id,
    meta: { collectionId: id, title, filename, upload: true },
  });

  return c.json(toDocument(row));
});

knowledgeRoutes.patch("/documents/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await parseBody(patchKnowledgeDocumentBodySchema, await c.req.json());
  const current = (
    await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
  )[0];
  if (!current || current.deletedAt) {
    throw notFound("Documento não encontrado.");
  }

  const [row] = await db
    .update(knowledgeDocuments)
    .set({
      title: body.title ?? current.title,
      bodyMd: body.bodyMd ?? current.bodyMd,
      checksum: checksum(body.bodyMd ?? current.bodyMd),
      updatedAt: new Date(),
    })
    .where(eq(knowledgeDocuments.id, id))
    .returning();
  if (!row) {
    throw notFound("Documento não encontrado.");
  }

  await db
    .update(knowledgeCollections)
    .set({ updatedAt: new Date() })
    .where(eq(knowledgeCollections.id, row.collectionId));

  if (body.bodyMd !== undefined) {
    await reindexDocument(row.id, row.collectionId, row.bodyMd);
  }

  await writeAudit({
    actorId: user.id,
    action: "knowledge.document_update",
    entityType: "knowledge_document",
    entityId: id,
    meta: { collectionId: row.collectionId },
  });

  return c.json(toDocument(row));
});

knowledgeRoutes.delete("/documents/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const current = (
    await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
  )[0];
  if (!current || current.deletedAt) {
    throw notFound("Documento não encontrado.");
  }

  await db
    .update(knowledgeDocuments)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(knowledgeDocuments.id, id));

  await db.delete(knowledgeChunks).where(eq(knowledgeChunks.documentId, id));

  await db
    .update(knowledgeCollections)
    .set({ updatedAt: new Date() })
    .where(eq(knowledgeCollections.id, current.collectionId));

  await writeAudit({
    actorId: user.id,
    action: "knowledge.document_delete",
    entityType: "knowledge_document",
    entityId: id,
    meta: { collectionId: current.collectionId },
  });

  return c.json({ ok: true });
});

knowledgeRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await parseBody(patchKnowledgeCollectionBodySchema, await c.req.json());
  const current = (
    await db.select().from(knowledgeCollections).where(eq(knowledgeCollections.id, id))
  )[0];
  if (!current || current.deletedAt) {
    throw notFound("Base não encontrada.");
  }

  const [row] = await db
    .update(knowledgeCollections)
    .set({
      name: body.name ?? current.name,
      description: body.description ?? current.description,
      visibility: body.visibility ?? current.visibility,
      updatedAt: new Date(),
    })
    .where(eq(knowledgeCollections.id, id))
    .returning();
  if (!row) {
    throw notFound("Base não encontrada.");
  }

  if (body.roleIds) {
    await db.delete(knowledgeRoles).where(eq(knowledgeRoles.collectionId, id));
    if (body.roleIds.length) {
      await db
        .insert(knowledgeRoles)
        .values(body.roleIds.map((roleId) => ({ collectionId: id, roleId })));
    }
  }

  await writeAudit({
    actorId: user.id,
    action: "knowledge.update",
    entityType: "knowledge_collection",
    entityId: id,
    meta: body,
  });

  return c.json({ id: row.id, slug: row.slug });
});
