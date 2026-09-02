/**
 * R2 — Ingestão assíncrona (queued → processing → ready|failed)
 * Stage: upload, validation, extraction, chunking, embedding, indexing
 *
 * Fila DURÁVEL na tabela knowledge_ingestion (Postgres), reivindicada com
 * FOR UPDATE SKIP LOCKED por um worker — ver bloco "Fila durável" abaixo.
 * Worker dedicado: `bun run worker` (src/worker.ts). Em dev a API roda um
 * worker embutido (INGEST_WORKER_EMBEDDED, default on fora de produção).
 * Extração: Docling (R3) + fallback local (pdf-parse/mammoth).
 */

import { eq, sql } from "drizzle-orm";
import {
  db,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocumentRevisions,
  knowledgeDocuments,
  knowledgeIngestions,
} from "@nexo/db";

import { chunkStructuredMarkdown } from "./chunk";
import { embedTexts } from "./embeddings";
import { extractWithDocling } from "./extraction";
import { getObject } from "./storage";

// limites R2/R3 — Docling expande para pptx, xlsx, html
// R2 aceitava só pdf/docx/txt/md; R3 aceita também pptx/xlsx/html
// (validação MIME é permissiva — extensão é a fonte de verdade)
export const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024); // 50 MB
export const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
]);
export const ALLOWED_EXTS = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".html",
  ".htm",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
]);

function extFromFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function _mimeFromExt(ext: string): string {
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx")
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".txt" || ext === ".csv") return "text/plain";
  if (ext === ".md" || ext === ".markdown") return "text/markdown";
  return "application/octet-stream";
}
void _mimeFromExt;

export function validateUpload(
  filename: string,
  mime: string,
  sizeBytes: number,
): { ok: true } | { ok: false; code: string; message: string } {
  const ext = extFromFilename(filename);
  if (!ALLOWED_EXTS.has(ext)) {
    return {
      ok: false,
      code: "UNSUPPORTED_TYPE",
      message: `Formato não suportado (${ext}). Use pdf, docx, txt ou md.`,
    };
  }
  if (
    mime &&
    !ALLOWED_MIMES.has(mime) &&
    !mime.startsWith("text/") &&
    mime !== "application/octet-stream"
  ) {
    // permite text/* genérico, mas bloqueia exóticos
    // ext já garante, então só alerta
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: "FILE_TOO_LARGE",
      message: `Arquivo muito grande (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Limite ${MAX_FILE_BYTES / 1024 / 1024} MB.`,
    };
  }
  if (sizeBytes === 0) {
    return { ok: false, code: "EMPTY_FILE", message: "Arquivo vazio." };
  }
  return { ok: true };
}

function sha256Hex(data: Buffer): string {
  return Bun.SHA256.hash(data, "hex");
}

// R3: extração delegada para extraction.ts (Docling + fallback local)
// mantida assinatura antiga para compat, mas usa extractWithDocling
async function extractText(
  buffer: Buffer,
  filename: string,
  mime: string,
): Promise<{ markdown: string; metadata: Record<string, unknown> }> {
  const res = await extractWithDocling(buffer, filename, mime);
  return { markdown: res.markdown, metadata: res.metadata };
}

// limites do worker de fila (durável)
const MAX_ATTEMPTS = Number(process.env.INGEST_MAX_ATTEMPTS ?? 5);
const STALE_MINUTES = Number(process.env.INGEST_STALE_MINUTES ?? 15);
const BATCH_SIZE = Number(process.env.INGEST_BATCH_SIZE ?? 2);
const POLL_MS = Number(process.env.INGEST_POLL_MS ?? 5000);

type ProcessResult = { status: "ready" | "failed"; errorCode?: string; errorMessage?: string };

// ---------------------------------------------------------------------------
// Fila durável (tabela knowledge_ingestion)
//
// O setTimeout em processo foi removido: job 'queued' vive no Postgres e é
// reivindicado atomicamente com FOR UPDATE SKIP LOCKED — múltiplas réplicas
// nunca processam o mesmo job. Jobs travados em 'processing' (crash/restart)
// são reenfileirados pelo worker após INGEST_STALE_MINUTES, com cap de
// tentativas (INGEST_MAX_ATTEMPTS) antes de falhar de vez.
// ---------------------------------------------------------------------------

function rowsOf(res: unknown): { id: string }[] {
  if (Array.isArray(res)) return res as { id: string }[];
  if (res && typeof res === "object" && "rows" in (res as Record<string, unknown>)) {
    return ((res as { rows: { id: string }[] }).rows ?? []) as { id: string }[];
  }
  return [];
}

/**
 * Reivindica atomicamente o próximo job 'queued' (SKIP LOCKED: seguro com
 * múltiplas réplicas do worker). Marca processing + attempts+1 na própria
 * transação do UPDATE.
 */
export async function claimNextIngestion(): Promise<string | null> {
  const res = await db.execute(sql`
    UPDATE knowledge_ingestion
    SET status = 'processing', stage = 'upload', attempts = attempts + 1,
        started_at = now(), error_code = NULL, error_message = NULL
    WHERE id = (
      SELECT id FROM knowledge_ingestion
      WHERE status = 'queued'
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `);
  return rowsOf(res)[0]?.id ?? null;
}

/**
 * Recupera jobs interrompidos (container reiniciou no meio do processing):
 *  - attempts >= maxAttempts → failed definitivo (ATTEMPTS_EXHAUSTED);
 *  - resto → de volta para 'queued' (REQUEUED_STALE).
 * Chamado pelo worker a cada tick.
 */
export async function requeueStaleIngestions(
  staleMinutes = STALE_MINUTES,
  maxAttempts = MAX_ATTEMPTS,
): Promise<{ requeued: number; failed: number }> {
  const exhausted = await db.execute(sql`
    UPDATE knowledge_ingestion
    SET status = 'failed', stage = 'upload', completed_at = now(),
        error_code = 'ATTEMPTS_EXHAUSTED',
        error_message = ${`Job interrompido e reenfileirado ${maxAttempts} vezes; desistindo.`}
    WHERE status = 'processing'
      AND attempts >= ${maxAttempts}
      AND (started_at IS NULL OR started_at < now() - make_interval(mins => ${staleMinutes}))
    RETURNING id
  `);
  const requeued = await db.execute(sql`
    UPDATE knowledge_ingestion
    SET status = 'queued', stage = 'upload', started_at = NULL,
        error_code = 'REQUEUED_STALE',
        error_message = 'Job travado em processing (crash/restart); reenfileirado pelo worker.'
    WHERE status = 'processing'
      AND attempts < ${maxAttempts}
      AND (started_at IS NULL OR started_at < now() - make_interval(mins => ${staleMinutes}))
    RETURNING id
  `);
  return { failed: rowsOf(exhausted).length, requeued: rowsOf(requeued).length };
}

/** Um tick do worker: reivindica e processa até batchSize jobs. */
export async function runIngestionWorkerOnce(batchSize = BATCH_SIZE): Promise<string[]> {
  const processed: string[] = [];
  for (let i = 0; i < batchSize; i += 1) {
    const id = await claimNextIngestion();
    if (!id) break;
    processed.push(id);
    // erros esperados já persistem status='failed' na row; catch é rede de
    // segurança para throws inesperados (job fica 'processing' e o próximo
    // tick reenfileira via requeueStaleIngestions)
    await processIngestion(id, { alreadyClaimed: true }).catch(() => {});
  }
  return processed;
}

/**
 * Worker embutido: habilitado por default fora de produção (dev não precisa
 * subir processo separado). Em produção rode o worker dedicado (bun run worker)
 * e deixe INGEST_WORKER_EMBEDDED=false.
 */
export function embeddedWorkerEnabled(): boolean {
  const flag = process.env.INGEST_WORKER_EMBEDDED?.trim();
  if (flag !== undefined && flag !== "") return flag === "true" || flag === "1";
  return process.env.NODE_ENV !== "production";
}

/** Loop do worker dedicado. Retorna função de stop (graceful). */
export function startIngestionWorker(opts?: {
  pollMs?: number;
  batchSize?: number;
  staleMinutes?: number;
  maxAttempts?: number;
}): () => void {
  const pollMs = opts?.pollMs ?? POLL_MS;
  const batchSize = opts?.batchSize ?? BATCH_SIZE;
  const staleMinutes = opts?.staleMinutes ?? STALE_MINUTES;
  const maxAttempts = opts?.maxAttempts ?? MAX_ATTEMPTS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function tick() {
    if (stopped) return;
    try {
      const stale = await requeueStaleIngestions(staleMinutes, maxAttempts);
      if (stale.requeued || stale.failed) {
        console.warn(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "warn",
            action: "ingest.requeue_stale",
            ...stale,
          }),
        );
      }
      const processed = await runIngestionWorkerOnce(batchSize);
      if (processed.length) {
        console.log(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "info",
            action: "ingest.worker.processed",
            ids: processed,
          }),
        );
      }
    } catch (e) {
      console.warn("ingestion worker tick falhou:", e instanceof Error ? e.message : String(e));
    }
    if (!stopped) timer = setTimeout(tick, pollMs);
  }

  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

export async function processIngestion(
  ingestionId: string,
  opts?: { alreadyClaimed?: boolean },
): Promise<ProcessResult> {
  const ingestion = (
    await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.id, ingestionId))
  )[0];
  if (!ingestion) throw new Error("Ingestão não encontrada");
  const revision = (
    await db
      .select()
      .from(knowledgeDocumentRevisions)
      .where(eq(knowledgeDocumentRevisions.id, ingestion.documentRevisionId))
  )[0];
  if (!revision) throw new Error("Revisão não encontrada");
  const document = (
    await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, revision.documentId))
  )[0];
  if (!document) throw new Error("Documento não encontrado");
  const collectionId = document.collectionId;

  // marca processing — exceto quando o worker já reivindicou o job
  // atomicamente (claimNextIngestion), que já incrementa attempts e zera erros
  if (!opts?.alreadyClaimed) {
    await db
      .update(knowledgeIngestions)
      .set({
        status: "processing",
        stage: "validation",
        attempts: (ingestion.attempts ?? 0) + 1,
        startedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      })
      .where(eq(knowledgeIngestions.id, ingestionId));
  }

  try {
    // --- validation ---
    const buf = await getObject(revision.storageKey);
    // checksum
    const actualChecksum = sha256Hex(buf);
    if (actualChecksum !== revision.checksum) {
      throw Object.assign(
        new Error(`Checksum divergente. Esperado ${revision.checksum.slice(0, 8)}…`),
        { code: "CHECKSUM_MISMATCH", stage: "validation" },
      );
    }
    const v = validateUpload(revision.filename, revision.mime, buf.byteLength);
    if (!v.ok) {
      throw Object.assign(new Error(v.message), { code: v.code, stage: "validation" });
    }
    await db
      .update(knowledgeIngestions)
      .set({ stage: "extraction" })
      .where(eq(knowledgeIngestions.id, ingestionId));

    // --- extraction ---
    let markdown: string;
    let metadata: Record<string, unknown>;
    try {
      const extracted = await extractText(buf, revision.filename, revision.mime);
      markdown = extracted.markdown;
      metadata = extracted.metadata;
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "EXTRACTION_FAILED";
      throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), {
        code,
        stage: "extraction",
      });
    }
    // guarda extracted
    await db
      .update(knowledgeDocumentRevisions)
      .set({ extractedMarkdown: markdown.slice(0, 500_000), extractionMetadata: metadata })
      .where(eq(knowledgeDocumentRevisions.id, revision.id));

    await db
      .update(knowledgeIngestions)
      .set({ stage: "chunking" })
      .where(eq(knowledgeIngestions.id, ingestionId));

    // --- chunking (R3: por estrutura, não mistura seções) ---
    const structured = chunkStructuredMarkdown(markdown);
    if (structured.length === 0) {
      throw Object.assign(new Error("Documento vazio após extração."), {
        code: "EMPTY_CHUNKS",
        stage: "chunking",
      });
    }
    // limpa chunks antigos apenas da revisão atual antes de reindexar (idempotência)
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.revisionId, revision.id));

    await db
      .update(knowledgeIngestions)
      .set({ stage: "embedding" })
      .where(eq(knowledgeIngestions.id, ingestionId));

    // --- embedding + indexing ---
    // Bloqueio 3 corrigido: falha de embedding NUNCA vira documento "pronto"
    // silenciosamente. A ingestão falha com EMBEDDING_FAILED (stage embedding)
    // e pode ser reprocessada pela rota de retry ou pelo worker.
    let embeddings: (number[] | null)[];
    try {
      const res = await embedTexts(structured.map((c) => c.content));
      embeddings = res.embeddings as (number[] | null)[];
    } catch (e) {
      throw Object.assign(
        new Error(`Embedding falhou: ${e instanceof Error ? e.message : String(e)}`),
        { code: "EMBEDDING_FAILED", stage: "embedding" },
      );
    }
    if (!Array.isArray(embeddings) || embeddings.length !== structured.length) {
      throw Object.assign(
        new Error(
          `Embeddings incompletos: ${embeddings?.length ?? 0} de ${structured.length} chunks.`,
        ),
        { code: "EMBEDDING_INCOMPLETE", stage: "embedding" },
      );
    }

    await db
      .update(knowledgeIngestions)
      .set({ stage: "indexing" })
      .where(eq(knowledgeIngestions.id, ingestionId));

    // atualiza documento bodyMd para compatibilidade com RAG atual (por revisão a partir de R3, mas mantém bodyMd latest)
    await db
      .update(knowledgeDocuments)
      .set({
        bodyMd: markdown.slice(0, 500_000),
        checksum: revision.checksum,
        mime: revision.mime,
        filename: revision.filename,
        updatedAt: new Date(),
      })
      .where(eq(knowledgeDocuments.id, document.id));

    // R3: garante que só a revisão mais recente fique ativa — remove chunks de revisões superseded do mesmo documento
    // deleta chunks de outras revisões deste documento (inclusive legacy sem revisionId)
    // faz antes do insert da nova para evitar apagar o que acabamos de inserir (usamos != )
    await db.execute(
      sql`DELETE FROM knowledge_chunk WHERE document_id = ${document.id}::uuid AND (revision_id IS NULL OR revision_id != ${revision.id}::uuid)`,
    );

    // insere chunks da revisão atual com metadados estruturados (page/heading/offsets)
    const rows = structured.map((c, i) => ({
      documentId: document.id,
      collectionId,
      revisionId: revision.id,
      chunkIndex: i,
      content: c.content,
      embedding: embeddings[i] ?? null,
      page: c.page,
      heading: c.heading,
      startOffset: c.startOffset,
      endOffset: c.endOffset,
      tokenCount: c.tokenCount,
    }));
    for (let i = 0; i < rows.length; i += 64) {
      const batch = rows.slice(i, i + 64);
      await db.insert(knowledgeChunks).values(batch as never);
    }

    await db
      .update(knowledgeIngestions)
      .set({
        status: "ready",
        stage: "indexing",
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      })
      .where(eq(knowledgeIngestions.id, ingestionId));

    // atualiza coleção
    await db
      .update(knowledgeCollections)
      .set({ updatedAt: new Date() })
      .where(eq(knowledgeCollections.id, collectionId));

    return { status: "ready" };
  } catch (e) {
    const error = e as { message?: string; code?: string; stage?: string };
    const stage = (error.stage as string) ?? "extraction";
    const code = error.code ?? "INGESTION_FAILED";
    const message = error.message ?? String(e);
    // stage enum mapping — fallback para extraction se desconhecido
    const stageEnum = [
      "upload",
      "validation",
      "extraction",
      "chunking",
      "embedding",
      "indexing",
    ].includes(stage)
      ? (stage as never)
      : ("extraction" as never);
    await db
      .update(knowledgeIngestions)
      .set({
        status: "failed",
        stage: stageEnum,
        errorCode: code,
        errorMessage: message.slice(0, 2000),
        completedAt: new Date(),
      })
      .where(eq(knowledgeIngestions.id, ingestionId));
    return { status: "failed", errorCode: code, errorMessage: message };
  }
}

// processa todos os queued (até limit) — usado por cron e após upload.
// Jobs são reivindicados com SKIP LOCKED (claimNextIngestion): seguro com
// múltiplas réplicas chamando concorrentemente.
export async function processQueuedIngestions(limit = 5): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const id = await claimNextIngestion();
    if (!id) break;
    ids.push(id);
    await processIngestion(id, { alreadyClaimed: true }).catch(() => {});
  }
  return ids;
}

/**
 * Nudge pós-upload: o job já está durável na tabela (status 'queued'). Aqui só
 * acordamos o worker embutido, se habilitado — em produção o worker dedicado
 * pega o job no próximo poll.
 */
export function enqueueIngestionAsync(_ingestionId: string): void {
  if (embeddedWorkerEnabled()) {
    void runIngestionWorkerOnce(1);
  }
}
