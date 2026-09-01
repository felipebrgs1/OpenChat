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
  knowledgeIngestions,
  knowledgeRoles,
} from "@nexo/db";
import { and, desc, eq } from "drizzle-orm";
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

  // dedup por checksum dentro da mesma coleção (alerta mas permite)
  // cria documento + revisão
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

function mimeFromExtFallback(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".pdf") return "application/pdf";
  if (e === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (e === ".txt" || e === ".csv") return "text/plain";
  if (e === ".md") return "text/markdown";
  return "application/octet-stream";
}
