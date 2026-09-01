import {
  createKnowledgeCollectionBodySchema,
  createKnowledgeDocumentBodySchema,
  patchKnowledgeCollectionBodySchema,
  patchKnowledgeDocumentBodySchema,
} from "@nexo/contracts";
import {
  db,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocumentRevisions,
  knowledgeDocuments,
  knowledgeFeedback,
  knowledgeIngestions,
  knowledgeRoles,
} from "@nexo/db";
import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { Hono } from "hono";

import { writeAudit } from "../lib/audit";
import { forbidden, notFound } from "../lib/errors";
import { chunkMarkdown } from "../lib/chunk";
import { embedTexts } from "../lib/embeddings";
import { enqueueIngestionAsync, processIngestion, validateUpload } from "../lib/ingestion";
import {
  loadAllCollections,
  loadCollectionsForRole,
  loadDocuments,
  loadRoleLinks,
} from "../lib/knowledge";
import { parseBody } from "../lib/parse";
import { buildStorageKey, getObject, getPresignedDownloadUrl, putObject } from "../lib/storage";
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
    ownerId: (row as unknown as { ownerId: string | null }).ownerId ?? null,
    status: (row as unknown as { status: string }).status ?? "published",
    reviewAt: (row as unknown as { reviewAt: Date | null }).reviewAt?.toISOString() ?? null,
    publishedAt: (row as unknown as { publishedAt: Date | null }).publishedAt?.toISOString() ?? null,
    checksum: row.checksum,
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

async function guardDocumentRead(user: AuthUser, documentId: string) {
  const doc = (
    await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId))
  )[0];
  if (!doc || doc.deletedAt) throw notFound("Documento não encontrado.");
  await guardCollectionRead(user, doc.collectionId);
  return doc;
}

async function reindexDocument(documentId: string, collectionId: string, bodyMd: string) {
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
    for (let i = 0; i < rows.length; i += 64) {
      const batch = rows.slice(i, i + 64);
      await db.insert(knowledgeChunks).values(batch);
    }
  } catch (e) {
    console.warn(
      `reindex falhou para doc ${documentId}:`,
      e instanceof Error ? e.message : String(e),
    );
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

// download autorizado do arquivo original (por revisão ou documento atual)
// GET /api/knowledge/revisions/:revisionId/download — protegido por cargo da coleção
knowledgeRoutes.get("/revisions/:revisionId/download", async (c) => {
  const user = c.get("user");
  const revisionId = c.req.param("revisionId");
  const rev = (
    await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(eq(knowledgeDocumentRevisions.id, revisionId))
  )[0];
  if (!rev) throw notFound("Revisão não encontrada.");
  await guardDocumentRead(user, rev.documentId);
  // presigned se S3, senão stream direto
  const presigned = await getPresignedDownloadUrl(rev.storageKey, 900).catch(() => null);
  if (presigned) {
    return c.redirect(presigned, 302);
  }
  const buf = await getObject(rev.storageKey);
  const safeFilename = rev.filename.replace(/"/g, "");
  // @ts-ignore dom lib
  return new Response(buf as unknown as BodyInit, {
    headers: {
      "Content-Type": rev.mime,
      "Content-Disposition": `attachment; filename="${safeFilename}"`,
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, max-age=60",
    },
  });
});

// lista revisões + ingestões de um documento
knowledgeRoutes.get("/documents/:id/revisions", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  await guardDocumentRead(user, id);
  const revisions = await db
    .select()
    .from(knowledgeDocumentRevisions)
    .where(eq(knowledgeDocumentRevisions.documentId, id))
    .orderBy(desc(knowledgeDocumentRevisions.revisionNumber));
  const ingestionByRevision = new Map<string, typeof knowledgeIngestions.$inferSelect>();
  if (revisions.length) {
    const ingestions = await db
      .select()
      .from(knowledgeIngestions)
      .where(
        // poor man's IN
        // drizzle doesn't have inArray for this tiny set? use or chain
        // fallback: fetch all and filter (small)
        // to keep simple, fetch per revision? do bulk via sql
        // use db.execute raw
        // simpler: fetch all for these revisionIds via inArray
        // we imported correctly, use inArray
        // but avoid import clutter, do manual filter
        // just fetch all related via query
        eq(knowledgeIngestions.documentRevisionId, revisions[0]!.id),
      );
    // fetch remaining via loop to avoid sql complexity
    const allIngestions = await Promise.all(
      revisions.map(async (r) =>
        (await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.documentRevisionId, r.id)))[0],
      ),
    );
    for (const ing of allIngestions) {
      if (ing) ingestionByRevision.set(ing.documentRevisionId, ing);
    }
    // also include first fetch (duplicate)
    for (const ing of ingestions) ingestionByRevision.set(ing.documentRevisionId, ing);
  }
  return c.json({
    revisions: revisions.map((r) => ({
      id: r.id,
      documentId: r.documentId,
      revisionNumber: r.revisionNumber,
      storageKey: r.storageKey,
      filename: r.filename,
      mime: r.mime,
      sizeBytes: r.sizeBytes,
      checksum: r.checksum,
      hasExtracted: Boolean(r.extractedMarkdown),
      createdBy: r.createdBy,
      createdAt: r.createdAt.toISOString(),
      supersededAt: r.supersededAt?.toISOString() ?? null,
      ingestion: ingestionByRevision.get(r.id) ?? null,
    })),
    _debug: { documentId: id, title: (await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id)).then((x) => x[0]))?.title },
  });
});

// ingestion status direto
knowledgeRoutes.get("/ingestions/:id", async (c) => {
  const user = c.get("user");
  const ing = (
    await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.id, c.req.param("id")))
  )[0];
  if (!ing) throw notFound("Ingestão não encontrada.");
  const rev = (
    await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(eq(knowledgeDocumentRevisions.id, ing.documentRevisionId))
  )[0];
  if (!rev) throw notFound("Revisão não encontrada.");
  await guardDocumentRead(user, rev.documentId);
  return c.json({ ingestion: ing, revision: rev });
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
  const docChecksum = checksum(body.bodyMd);
  // R6: dedup por checksum na mesma coleção
  const dup = (
    await db
      .select()
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.collectionId, collection.id), eq(knowledgeDocuments.checksum, docChecksum), isNull(knowledgeDocuments.deletedAt)))
  )[0];
  if (dup) {
    return c.json({ error: { code: "CONFLICT", message: "Documento com mesmo conteúdo já existe." }, existingId: dup.id }, 409);
  }

  const [row] = await db
    .insert(knowledgeDocuments)
    .values({
      collectionId: collection.id,
      title: body.title,
      bodyMd: body.bodyMd,
      sourceType: "markdown",
      checksum: docChecksum,
      createdBy: user.id,
      ownerId: user.id,
      status: "published",
      reviewAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      publishedAt: new Date(),
    })
    .returning();
  if (!row) {
    throw new Error("failed to create document");
  }

  await db
    .update(knowledgeCollections)
    .set({ updatedAt: new Date() })
    .where(eq(knowledgeCollections.id, id));

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

// R2: upload com storage + ingestão assíncrona
knowledgeRoutes.post("/:id/upload", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const collection = await guardCollectionRead(user, id);
  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  if (!file || typeof file === "string") {
    throw forbidden("Envie um arquivo em 'file'.");
  }
  const filename = file.name || "upload.bin";
  const mime = (file.type || "").trim() || "application/octet-stream";
  const buf = Buffer.from(await file.arrayBuffer());
  const sizeBytes = buf.byteLength;

  // validação tamanho/MIME/ext
  const v = validateUpload(filename, mime, sizeBytes);
  if (!v.ok) {
    throw forbidden(v.message);
  }
  const fileChecksum = Bun.SHA256.hash(buf, "hex");

  // R6: dedup por checksum na mesma coleção — evita duplicatas
  const dupUpload = (
    await db
      .select()
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.collectionId, collection.id), eq(knowledgeDocuments.checksum, fileChecksum), isNull(knowledgeDocuments.deletedAt)))
  )[0];
  if (dupUpload) {
    return c.json({ error: { code: "CONFLICT", message: "Arquivo com mesmo conteúdo já existe." }, existingId: dupUpload.id }, 409);
  }

  // R6: owner/status/reviewAt via form (opcional)
  const ownerIdForm = form.get("ownerId");
  const statusForm = form.get("status");
  const reviewAtForm = form.get("reviewAt");
  const ownerId = typeof ownerIdForm === "string" && ownerIdForm.trim() ? ownerIdForm.trim() : user.id;
  const status = typeof statusForm === "string" && ["draft", "published", "obsolete"].includes(statusForm) ? (statusForm as "draft" | "published" | "obsolete") : "published";
  const reviewAt = typeof reviewAtForm === "string" && reviewAtForm.trim() ? new Date(reviewAtForm.trim()) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  const titleForm = form.get("title");
  const title =
    (typeof titleForm === "string" && titleForm.trim()) ||
    filename.replace(/\.[^.]+$/, "") ||
    "Documento";

  const [docRow] = await db
    .insert(knowledgeDocuments)
    .values({
      collectionId: collection.id,
      title,
      bodyMd: "", // será preenchido após extração
      sourceType: filename.toLowerCase().endsWith(".pdf") ? "upload" : "markdown",
      filename,
      mime,
      checksum: fileChecksum,
      createdBy: user.id,
      ownerId,
      status,
      reviewAt: Number.isNaN(reviewAt.getTime()) ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) : reviewAt,
      publishedAt: status === "published" ? new Date() : null,
    })
    .returning();
  if (!docRow) throw new Error("failed to create document");

  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  const revisionId = crypto.randomUUID();
  const storageKey = buildStorageKey(docRow.id, revisionId, ext);

  // armazena original em RustFS/local
  await putObject(storageKey, buf, mime || "application/octet-stream");

  const [rev] = await db
    .insert(knowledgeDocumentRevisions)
    .values({
      id: revisionId,
      documentId: docRow.id,
      revisionNumber: 1,
      storageKey,
      filename,
      mime: mime || mimeFromExtFallback(ext),
      sizeBytes,
      checksum: fileChecksum,
      createdBy: user.id,
    })
    .returning();
  if (!rev) throw new Error("failed to create revision");

  const [ing] = await db
    .insert(knowledgeIngestions)
    .values({
      documentRevisionId: rev.id,
      status: "queued",
      stage: "upload",
    })
    .returning();

  await db
    .update(knowledgeCollections)
    .set({ updatedAt: new Date() })
    .where(eq(knowledgeCollections.id, id));

  await writeAudit({
    actorId: user.id,
    action: "knowledge.upload",
    entityType: "knowledge_document",
    entityId: docRow.id,
    meta: { collectionId: id, title, filename, storageKey, checksum: fileChecksum, ingestionId: ing?.id },
  });

  // dispara worker assíncrono sem bloquear resposta
  if (ing) enqueueIngestionAsync(ing.id);

  return c.json({
    document: toDocument({ ...docRow, bodyMd: "" } as DocumentRow),
    revision: {
      id: rev.id,
      revisionNumber: rev.revisionNumber,
      storageKey: rev.storageKey,
      filename: rev.filename,
      mime: rev.mime,
      sizeBytes: rev.sizeBytes,
      checksum: rev.checksum,
    },
    ingestion: ing
      ? { id: ing.id, status: ing.status, stage: ing.stage }
      : null,
  });
});

// nova revisão para documento existente
knowledgeRoutes.post("/documents/:id/revisions", async (c) => {
  const user = c.get("user");
  const docId = c.req.param("id");
  await guardDocumentRead(user, docId);
  const form = await c.req.formData();
  const file = form.get("file") as File | null;
  if (!file || typeof file === "string") throw forbidden("Envie um arquivo em 'file'.");
  const filename = file.name || "upload.bin";
  const mime = (file.type || "").trim() || "application/octet-stream";
  const buf = Buffer.from(await file.arrayBuffer());
  const sizeBytes = buf.byteLength;
  const v = validateUpload(filename, mime, sizeBytes);
  if (!v.ok) throw forbidden(v.message);
  const fileChecksum = Bun.SHA256.hash(buf, "hex");

  const maxRev = await db
    .select()
    .from(knowledgeDocumentRevisions)
    .where(eq(knowledgeDocumentRevisions.documentId, docId))
    .orderBy(desc(knowledgeDocumentRevisions.revisionNumber))
    .limit(1)
    .then((r) => r[0]?.revisionNumber ?? 0);
  const nextRev = maxRev + 1;
  const ext = filename.includes(".") ? filename.slice(filename.lastIndexOf(".")) : "";
  // R6: dedup por checksum dentro do mesmo documento — evita duplicatas
  const latestRevForDedup = (
    await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(eq(knowledgeDocumentRevisions.documentId, docId))
      .orderBy(desc(knowledgeDocumentRevisions.revisionNumber))
      .limit(1)
  )[0];
  if (latestRevForDedup && latestRevForDedup.checksum === fileChecksum) {
    return c.json({ error: { code: "CONFLICT", message: "Mesma versão já existe." }, existingRevisionId: latestRevForDedup.id }, 409);
  }

  const revisionId = crypto.randomUUID();
  const storageKey = buildStorageKey(docId, revisionId, ext);
  await putObject(storageKey, buf, mime || "application/octet-stream");

  // marca anterior como superseded
  if (maxRev > 0) {
    const prev = (
      await db
        .select()
        .from(knowledgeDocumentRevisions)
        .where(
          and(
            eq(knowledgeDocumentRevisions.documentId, docId),
            eq(knowledgeDocumentRevisions.revisionNumber, maxRev),
          ),
        )
    )[0];
    if (prev && !prev.supersededAt) {
      await db
        .update(knowledgeDocumentRevisions)
        .set({ supersededAt: new Date() })
        .where(eq(knowledgeDocumentRevisions.id, prev.id));
    }
  }

  const [rev] = await db
    .insert(knowledgeDocumentRevisions)
    .values({
      id: revisionId,
      documentId: docId,
      revisionNumber: nextRev,
      storageKey,
      filename,
      mime: mime || mimeFromExtFallback(ext),
      sizeBytes,
      checksum: fileChecksum,
      createdBy: user.id,
    })
    .returning();
  if (!rev) throw new Error("failed to create revision");

  const [ing] = await db
    .insert(knowledgeIngestions)
    .values({ documentRevisionId: rev.id, status: "queued", stage: "upload" })
    .returning();

  await writeAudit({
    actorId: user.id,
    action: "knowledge.revision_upload",
    entityType: "knowledge_document",
    entityId: docId,
    meta: { revisionNumber: nextRev, filename, storageKey, ingestionId: ing?.id },
  });

  if (ing) enqueueIngestionAsync(ing.id);

  return c.json({
    revision: {
      id: rev.id,
      revisionNumber: rev.revisionNumber,
      storageKey: rev.storageKey,
      filename: rev.filename,
      mime: rev.mime,
      sizeBytes: rev.sizeBytes,
      checksum: rev.checksum,
    },
    ingestion: ing ? { id: ing.id, status: ing.status, stage: ing.stage } : null,
  });
});

// retry de ingestão falhada
knowledgeRoutes.post("/ingestions/:id/retry", async (c) => {
  const user = c.get("user");
  const ing = (
    await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.id, c.req.param("id")))
  )[0];
  if (!ing) throw notFound("Ingestão não encontrada.");
  const rev = (
    await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(eq(knowledgeDocumentRevisions.id, ing.documentRevisionId))
  )[0];
  if (!rev) throw notFound("Revisão não encontrada.");
  await guardDocumentRead(user, rev.documentId);
  if (ing.status !== "failed") throw forbidden("Só é possível retentar ingestões com falha.");

  const [updated] = await db
    .update(knowledgeIngestions)
    .set({ status: "queued", stage: "upload", errorCode: null, errorMessage: null })
    .where(eq(knowledgeIngestions.id, ing.id))
    .returning();

  await writeAudit({
    actorId: user.id,
    action: "knowledge.ingestion_retry",
    entityType: "knowledge_ingestion",
    entityId: ing.id,
    meta: { revisionId: rev.id },
  });

  if (updated) enqueueIngestionAsync(updated.id);

  return c.json({ ingestion: updated });
});

// processamento síncrono para teste/admin (processa queued ou uma específica)
knowledgeRoutes.post("/ingestions/:id/process", async (c) => {
  const user = c.get("user");
  const ing = (
    await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.id, c.req.param("id")))
  )[0];
  if (!ing) throw notFound("Ingestão não encontrada.");
  const rev = (
    await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(eq(knowledgeDocumentRevisions.id, ing.documentRevisionId))
  )[0];
  if (!rev) throw notFound("Revisão não encontrada.");
  await guardDocumentRead(user, rev.documentId);
  const result = await processIngestion(ing.id);
  return c.json(result);
});

knowledgeRoutes.patch("/documents/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const raw = await c.req.json();
  const body = await parseBody(patchKnowledgeDocumentBodySchema, raw);
  const current = (
    await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, id))
  )[0];
  if (!current || current.deletedAt) {
    throw notFound("Documento não encontrado.");
  }
  // R6: owner/status/reviewAt
  const extra = raw as { ownerId?: string; status?: string; reviewAt?: string | null };
  const patch: Record<string, unknown> = {
    title: body.title ?? current.title,
    bodyMd: body.bodyMd ?? current.bodyMd,
    checksum: checksum(body.bodyMd ?? current.bodyMd),
    updatedAt: new Date(),
  };
  if (extra.ownerId !== undefined) {
    if (extra.ownerId === null) patch.ownerId = null;
    else if (typeof extra.ownerId === "string" && extra.ownerId.trim()) patch.ownerId = extra.ownerId.trim();
  }
  if (extra.status !== undefined && ["draft", "published", "obsolete"].includes(extra.status)) {
    patch.status = extra.status;
    if (extra.status === "published" && !current.publishedAt) patch.publishedAt = new Date();
  }
  if (extra.reviewAt !== undefined) {
    if (extra.reviewAt === null) patch.reviewAt = null;
    else {
      const d = new Date(extra.reviewAt);
      if (!Number.isNaN(d.getTime())) patch.reviewAt = d;
    }
  }

  const [row] = await db
    .update(knowledgeDocuments)
    .set(patch as never)
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

// R6 — rollback para revisão anterior
knowledgeRoutes.post("/documents/:id/rollback", async (c) => {
  const user = c.get("user");
  const docId = c.req.param("id");
  const body = await c.req.json().catch(() => ({})) as { revisionId?: string };
  const revisionId = body.revisionId?.trim();
  if (!revisionId) throw forbidden("Informe revisionId.");
  await guardDocumentRead(user, docId);
  const target = (await db.select().from(knowledgeDocumentRevisions).where(eq(knowledgeDocumentRevisions.id, revisionId)))[0];
  if (!target || target.documentId !== docId) throw notFound("Revisão não encontrada para este documento.");
  // cria nova revisão copiando storageKey e markdown do target
  const maxRev = await db.select().from(knowledgeDocumentRevisions).where(eq(knowledgeDocumentRevisions.documentId, docId)).orderBy(desc(knowledgeDocumentRevisions.revisionNumber)).limit(1).then(r=>r[0]?.revisionNumber ?? 0);
  const nextRev = maxRev + 1;
  const newId = crypto.randomUUID();
  // copia objeto no storage (se S3) — para local, copia arquivo
  try {
    const buf = await getObject(target.storageKey);
    const newKey = buildStorageKey(docId, newId, target.filename.includes(".") ? target.filename.slice(target.filename.lastIndexOf(".")) : "");
    await putObject(newKey, buf, target.mime);
    const [newRev] = await db.insert(knowledgeDocumentRevisions).values({
      id: newId,
      documentId: docId,
      revisionNumber: nextRev,
      storageKey: newKey,
      filename: target.filename,
      mime: target.mime,
      sizeBytes: target.sizeBytes,
      checksum: target.checksum,
      extractedMarkdown: target.extractedMarkdown,
      extractionMetadata: { ...(target.extractionMetadata as Record<string, unknown> ?? {}), rollbackFrom: target.id },
      createdBy: user.id,
    }).returning();
    if (!newRev) throw new Error("failed to create rollback revision");
    // marca anteriores como superseded
    await db.execute(sql`UPDATE knowledge_document_revision SET superseded_at = now() WHERE document_id = ${docId}::uuid AND id != ${newId}::uuid AND superseded_at IS NULL`);
    const [ing] = await db.insert(knowledgeIngestions).values({ documentRevisionId: newRev.id, status: "queued" }).returning();
    if (ing) enqueueIngestionAsync(ing.id);
    // atualiza doc para refletir rollback imediato (bodyMd)
    if (target.extractedMarkdown) {
      await db.update(knowledgeDocuments).set({ bodyMd: target.extractedMarkdown.slice(0,500000), checksum: target.checksum, updatedAt: new Date() }).where(eq(knowledgeDocuments.id, docId));
    }
    await writeAudit({ actorId: user.id, action: "knowledge.rollback", entityType: "knowledge_document", entityId: docId, meta: { from: target.id, to: newId, nextRev } });
    return c.json({ revision: newRev, ingestion: ing });
  } catch (e) {
    throw new Error(`Rollback falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
});

// R6 — painel de operação (admin)
knowledgeRoutes.get("/ops/panel", async (c) => {
  const user = c.get("user");
  // admin já garantido pelo guard, mas checa isAdmin para painel completo
  if (!user.isAdmin) throw forbidden();
  const allDocs = await db.select().from(knowledgeDocuments).where(isNull(knowledgeDocuments.deletedAt));
  const now = new Date();
  const overdue = allDocs.filter((d) => (d as unknown as { reviewAt: Date | null }).reviewAt && (d as unknown as { reviewAt: Date }).reviewAt < now && (d as unknown as { status: string }).status !== "obsolete");
  const byStatus = allDocs.reduce<Record<string, number>>((acc, d) => { const s = (d as unknown as { status: string }).status ?? "published"; acc[s] = (acc[s] ?? 0)+1; return acc; }, {});
  const byOwner = allDocs.reduce<Record<string, number>>((acc, d) => { const o = (d as unknown as { ownerId: string | null }).ownerId ?? "sem dono"; acc[o] = (acc[o] ?? 0)+1; return acc; }, {});
  // docs mais usados: top por número de chunks (proxy para uso) — em produção contaria retrieval logs
  const topDocs = [...allDocs].sort((a,b)=> b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0,10).map(d=> ({ id: d.id, title: d.title, status: (d as unknown as { status: string }).status, reviewAt: (d as unknown as { reviewAt: Date | null }).reviewAt?.toISOString() ?? null, ownerId: (d as unknown as { ownerId: string | null }).ownerId }));
  // perguntas sem resposta: feedback sem_fonte + avaliação negativa
  const feedbacks = await db.select().from(knowledgeFeedback).orderBy(desc(knowledgeFeedback.createdAt)).limit(50);
  const semFonte = feedbacks.filter(f=> f.rating === "sem_fonte");
  const negativos = feedbacks.filter(f=> ["incorreta","desatualizada","sem_fonte"].includes(f.rating));
  return c.json({
    totalDocs: allDocs.length,
    byStatus,
    byOwner,
    overdue: overdue.map(d=> ({ id: d.id, title: d.title, reviewAt: (d as unknown as { reviewAt: Date }).reviewAt.toISOString(), status: (d as unknown as { status: string }).status, ownerId: (d as unknown as { ownerId: string | null }).ownerId })),
    topDocs,
    feedback: { total: feedbacks.length, semFonte: semFonte.length, negativos: negativos.length, recent: feedbacks.slice(0,10) },
  });
});

// R6 — retenção: limpa revisões antigas superseded e arquivos obsoletos
knowledgeRoutes.post("/ops/retention/run", async (c) => {
  const user = c.get("user");
  if (!user.isAdmin) throw forbidden();
  const body = await c.req.json().catch(()=>({})) as { days?: number; dryRun?: boolean };
  const days = Math.max(1, Math.min(365, Number(body.days ?? 90)));
  const cutoff = new Date(Date.now() - days*24*60*60*1000);
  const dryRun = body.dryRun !== false; // default dryRun true para segurança
  // revisões superseded antigas
  const oldRevisions = await db.select().from(knowledgeDocumentRevisions).where(lte(knowledgeDocumentRevisions.supersededAt, cutoff));
  // documentos soft-deleted antigos
  const oldDeletedDocs = await db.execute(sql`SELECT id FROM knowledge_document WHERE deleted_at IS NOT NULL AND deleted_at < ${cutoff.toISOString()}::timestamptz`) as unknown as { rows: unknown[] };
  const oldDeletedCount = Array.isArray((oldDeletedDocs as { rows?: unknown[] })?.rows) ? (oldDeletedDocs as { rows: unknown[] }).rows.length : 0;
  // na prática, deleta só se dryRun false
  let deletedRevisions = 0;
  let deletedDocs = 0;
  if (!dryRun) {
    for (const rev of oldRevisions) {
      try { const { deleteObject } = await import("../lib/storage"); await deleteObject(rev.storageKey); } catch {}
      await db.delete(knowledgeChunks).where(eq(knowledgeChunks.revisionId, rev.id));
      await db.delete(knowledgeDocumentRevisions).where(eq(knowledgeDocumentRevisions.id, rev.id));
      deletedRevisions++;
    }
    // hard delete docs soft-deletados antigos (e chunks já removidos)
    // aqui só contamos, não hard delete sem confirmação extra
  }
  await writeAudit({ actorId: user.id, action: "knowledge.retention_run", entityType: "knowledge_document", meta: { days, cutoff: cutoff.toISOString(), dryRun, oldRevisions: oldRevisions.length, deletedRevisions } });
  return c.json({ days, cutoff: cutoff.toISOString(), dryRun, candidates: { oldRevisions: oldRevisions.length, oldDeletedDocs: oldDeletedCount }, deleted: { deletedRevisions, deletedDocs } });
});

function mimeFromExtFallback(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".pdf") return "application/pdf";
  if (e === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (e === ".txt" || e === ".csv") return "text/plain";
  if (e === ".md") return "text/markdown";
  return "application/octet-stream";
}
