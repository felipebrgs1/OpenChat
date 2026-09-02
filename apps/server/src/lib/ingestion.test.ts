import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";

import {
  db,
  knowledgeCollections,
  knowledgeDocuments,
  knowledgeDocumentRevisions,
  knowledgeIngestions,
} from "@nexo/db";

import { claimNextIngestion, embeddedWorkerEnabled, requeueStaleIngestions } from "./ingestion";

// Fila durável: claim atômico (SKIP LOCKED), reenfileiramento de stale e cap
// de tentativas. Requer Postgres (docker compose up postgres).

const slug = `teste-fila-${Date.now()}`;
const checksum = "x".repeat(64);

let collectionId = "";
let documentId = "";
let revisionId = "";

async function insertQueuedIngestion(attempts = 0) {
  const [ing] = await db
    .insert(knowledgeIngestions)
    .values({ documentRevisionId: revisionId, status: "queued", attempts })
    .returning();
  return ing!;
}

beforeAll(async () => {
  const [col] = await db
    .insert(knowledgeCollections)
    .values({ slug, name: "Base fila" })
    .returning();
  collectionId = col!.id;
  const [doc] = await db
    .insert(knowledgeDocuments)
    .values({ collectionId, title: "Doc fila", bodyMd: "conteúdo", checksum })
    .returning();
  documentId = doc!.id;
  const [rev] = await db
    .insert(knowledgeDocumentRevisions)
    .values({
      documentId,
      revisionNumber: 1,
      storageKey: "documents/x/r/original.txt",
      filename: "x.txt",
      mime: "text/plain",
      sizeBytes: 8,
      checksum,
    })
    .returning();
  revisionId = rev!.id;
});

afterAll(async () => {
  // cascata: ingestions/revisions/docs
  await db.delete(knowledgeCollections).where(eq(knowledgeCollections.id, collectionId));
});

describe("fila durável de ingestão", () => {
  it("claimNextIngestion reivindica atomicamente e marca processing com attempts+1", async () => {
    const ing = await insertQueuedIngestion(0);
    const claimed = await claimNextIngestion();
    expect(claimed).toBe(ing.id);

    const row = (
      await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.id, ing.id))
    )[0]!;
    expect(row.status).toBe("processing");
    expect(row.attempts).toBe(1);
    expect(row.startedAt).not.toBeNull();
  });

  it("job em processing não é reivindicado de novo (segurança multi-réplica)", async () => {
    // sem outros jobs queued, o segundo claim deve retornar null
    const second = await claimNextIngestion();
    expect(second).toBeNull();
  });

  it("requeueStaleIngestions reenfileira job travado (crash/restart)", async () => {
    const ing = await insertQueuedIngestion(1);
    await claimNextIngestion(); // vira processing
    // simula job travado: started_at no passado
    await db
      .update(knowledgeIngestions)
      .set({ startedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(knowledgeIngestions.id, ing.id));

    const res = await requeueStaleIngestions(30, 5); // stale > 30min
    expect(res.requeued).toBeGreaterThanOrEqual(1);

    const row = (
      await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.id, ing.id))
    )[0]!;
    expect(row.status).toBe("queued");
    expect(row.errorCode).toBe("REQUEUED_STALE");
    // pode ser reclamado novamente
    expect(await claimNextIngestion()).toBe(ing.id);
  });

  it("requeueStaleIngestions falha definitivo ao esgotar tentativas", async () => {
    const ing = await insertQueuedIngestion(5);
    await claimNextIngestion(); // attempts vira 6
    await db
      .update(knowledgeIngestions)
      .set({ startedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(knowledgeIngestions.id, ing.id));

    const res = await requeueStaleIngestions(30, 5);
    expect(res.failed).toBeGreaterThanOrEqual(1);

    const row = (
      await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.id, ing.id))
    )[0]!;
    expect(row.status).toBe("failed");
    expect(row.errorCode).toBe("ATTEMPTS_EXHAUSTED");
  });

  it("embeddedWorkerEnabled respeita flag explícita", () => {
    const prev = process.env.INGEST_WORKER_EMBEDDED;
    try {
      process.env.INGEST_WORKER_EMBEDDED = "false";
      expect(embeddedWorkerEnabled()).toBe(false);
      process.env.INGEST_WORKER_EMBEDDED = "true";
      expect(embeddedWorkerEnabled()).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.INGEST_WORKER_EMBEDDED;
      else process.env.INGEST_WORKER_EMBEDDED = prev;
    }
  });
});
