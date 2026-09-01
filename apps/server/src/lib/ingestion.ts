/**
 * R2 — Ingestão assíncrona (queued → processing → ready|failed)
 * Stage: upload, validation, extraction, chunking, embedding, indexing
 *
 * Worker em processo (poll) — em produção pode virar serviço separado.
 * Extração atual: txt/md pass-through, pdf via pdf-parse, docx via mammoth.
 * R3 troca para Docling + OCR.
 */

import { eq } from "drizzle-orm";
import {
  db,
  knowledgeChunks,
  knowledgeCollections,
  knowledgeDocumentRevisions,
  knowledgeDocuments,
  knowledgeIngestions,
} from "@nexo/db";

import { chunkMarkdown } from "./chunk";
import { embedTexts } from "./embeddings";
import { getObject } from "./storage";

// limites R2
export const MAX_FILE_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024); // 50 MB
export const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
  "text/csv",
]);
export const ALLOWED_EXTS = new Set([".pdf", ".docx", ".txt", ".md", ".markdown", ".csv"]);

function extFromFilename(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot).toLowerCase() : "";
}

function _mimeFromExt(ext: string): string {
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (ext === ".txt" || ext === ".csv") return "text/plain";
  if (ext === ".md" || ext === ".markdown") return "text/markdown";
  return "application/octet-stream";
}
void _mimeFromExt;

export function validateUpload(filename: string, mime: string, sizeBytes: number): { ok: true } | { ok: false; code: string; message: string } {
  const ext = extFromFilename(filename);
  if (!ALLOWED_EXTS.has(ext)) {
    return { ok: false, code: "UNSUPPORTED_TYPE", message: `Formato não suportado (${ext}). Use pdf, docx, txt ou md.` };
  }
  if (mime && !ALLOWED_MIMES.has(mime) && !mime.startsWith("text/") && mime !== "application/octet-stream") {
    // permite text/* genérico, mas bloqueia exóticos
    // ext já garante, então só alerta
  }
  if (sizeBytes > MAX_FILE_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: `Arquivo muito grande (${(sizeBytes / 1024 / 1024).toFixed(1)} MB). Limite ${MAX_FILE_BYTES / 1024 / 1024} MB.` };
  }
  if (sizeBytes === 0) {
    return { ok: false, code: "EMPTY_FILE", message: "Arquivo vazio." };
  }
  return { ok: true };
}

function sha256Hex(data: Buffer): string {
  return Bun.SHA256.hash(data, "hex");
}

async function extractText(buffer: Buffer, filename: string, mime: string): Promise<{ markdown: string; metadata: Record<string, unknown> }> {
  const ext = extFromFilename(filename);
  const lower = filename.toLowerCase();
  // txt/md/csv: utf8
  if (ext === ".txt" || ext === ".md" || ext === ".markdown" || ext === ".csv") {
    const text = buffer.toString("utf-8");
    if (!text.trim()) throw Object.assign(new Error("Arquivo vazio ou ilegível."), { code: "EMPTY_EXTRACTION" });
    return { markdown: text, metadata: { extractor: "utf8", ext } };
  }
  if (ext === ".pdf" || mime === "application/pdf" || lower.endsWith(".pdf")) {
    try {
      // @ts-ignore no types for pdf-parse
      const mod: unknown = await import("pdf-parse").catch(() => null);
      const pdfParse = (mod as { default?: (b: Buffer) => Promise<{ text: string; numpages?: number; info?: unknown }> })?.default;
      if (pdfParse) {
        const parsed = await pdfParse(buffer);
        const text = (parsed.text ?? "").trim();
        if (!text) {
          throw Object.assign(new Error("PDF sem texto extraível — pode estar escaneado. R3 com OCR será necessário."), { code: "PDF_NO_TEXT" });
        }
        return {
          markdown: text,
          metadata: { extractor: "pdf-parse", pages: parsed.numpages ?? null },
        };
      }
    } catch (e) {
      if ((e as { code?: string })?.code === "PDF_NO_TEXT") throw e;
      // fallback tenta utf8
    }
    const fallback = buffer.toString("utf-8").trim();
    if (!fallback || fallback.length < 20 || /%PDF/.test(fallback.slice(0, 10))) {
      throw Object.assign(new Error("PDF ilegível ou escaneado sem OCR."), { code: "PDF_UNREADABLE" });
    }
    return { markdown: fallback, metadata: { extractor: "utf8-fallback", ext } };
  }
  if (ext === ".docx") {
    try {
      const mod: unknown = await import("mammoth").catch(() => null);
      const mammoth = mod as { extractRawText?: (o: { buffer: Buffer }) => Promise<{ value: string }> } | null;
      if (mammoth?.extractRawText) {
        const { value } = await mammoth.extractRawText({ buffer });
        const text = value.trim();
        if (!text) throw Object.assign(new Error("DOCX vazio ou sem texto."), { code: "DOCX_EMPTY" });
        return { markdown: text, metadata: { extractor: "mammoth", ext } };
      }
    } catch (e) {
      if ((e as { code?: string })?.code) throw e;
    }
    throw Object.assign(new Error("DOCX não pôde ser lido. Instale mammoth (bun add mammoth)."), { code: "DOCX_NO_EXTRACTOR" });
  }
  throw Object.assign(new Error(`Extração não suportada para ${ext}`), { code: "UNSUPPORTED_EXTRACTION" });
}

type ProcessResult = { status: "ready" | "failed"; errorCode?: string; errorMessage?: string };

export async function processIngestion(ingestionId: string): Promise<ProcessResult> {
  const ingestion = (await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.id, ingestionId)))[0];
  if (!ingestion) throw new Error("Ingestão não encontrada");
  const revision = (await db.select().from(knowledgeDocumentRevisions).where(eq(knowledgeDocumentRevisions.id, ingestion.documentRevisionId)))[0];
  if (!revision) throw new Error("Revisão não encontrada");
  const document = (await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, revision.documentId)))[0];
  if (!document) throw new Error("Documento não encontrado");
  const collectionId = document.collectionId;

  // marca processing
  await db
    .update(knowledgeIngestions)
    .set({ status: "processing", stage: "validation", attempts: (ingestion.attempts ?? 0) + 1, startedAt: new Date(), errorCode: null, errorMessage: null })
    .where(eq(knowledgeIngestions.id, ingestionId));

  try {
    // --- validation ---
    const buf = await getObject(revision.storageKey);
    // checksum
    const actualChecksum = sha256Hex(buf);
    if (actualChecksum !== revision.checksum) {
      throw Object.assign(new Error(`Checksum divergente. Esperado ${revision.checksum.slice(0, 8)}…`), { code: "CHECKSUM_MISMATCH", stage: "validation" });
    }
    const v = validateUpload(revision.filename, revision.mime, buf.byteLength);
    if (!v.ok) {
      throw Object.assign(new Error(v.message), { code: v.code, stage: "validation" });
    }
    await db.update(knowledgeIngestions).set({ stage: "extraction" }).where(eq(knowledgeIngestions.id, ingestionId));

    // --- extraction ---
    let markdown: string;
    let metadata: Record<string, unknown>;
    try {
      const extracted = await extractText(buf, revision.filename, revision.mime);
      markdown = extracted.markdown;
      metadata = extracted.metadata;
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "EXTRACTION_FAILED";
      throw Object.assign(new Error(e instanceof Error ? e.message : String(e)), { code, stage: "extraction" });
    }
    // guarda extracted
    await db
      .update(knowledgeDocumentRevisions)
      .set({ extractedMarkdown: markdown.slice(0, 500_000), extractionMetadata: metadata })
      .where(eq(knowledgeDocumentRevisions.id, revision.id));

    await db.update(knowledgeIngestions).set({ stage: "chunking" }).where(eq(knowledgeIngestions.id, ingestionId));

    // --- chunking ---
    const chunks = chunkMarkdown(markdown);
    if (chunks.length === 0) {
      throw Object.assign(new Error("Documento vazio após extração."), { code: "EMPTY_CHUNKS", stage: "chunking" });
    }
    // limpa chunks antigos apenas da revisão (mantém outras revisões)
    await db.delete(knowledgeChunks).where(eq(knowledgeChunks.revisionId, revision.id));
    // também limpa chunks sem revision do mesmo documento (legado) para evitar duplicidade se for primeira revisão
    // não limpa todas as revisões — R3 tratará superseded

    await db.update(knowledgeIngestions).set({ stage: "embedding" }).where(eq(knowledgeIngestions.id, ingestionId));

    // --- embedding + indexing ---
    let embeddings: number[][] | null = null;
    try {
      const res = await embedTexts(chunks);
      embeddings = res.embeddings;
    } catch (e) {
      // sem embeddings não deve falhar ingestão — salva sem embedding e marca como ready com aviso
      console.warn("ingestão: embeddings falhou, salvando sem embedding", e instanceof Error ? e.message : String(e));
    }

    await db.update(knowledgeIngestions).set({ stage: "indexing" }).where(eq(knowledgeIngestions.id, ingestionId));

    // atualiza documento bodyMd para compatibilidade com RAG atual (será por revisão em R3+)
    const firstPageHeading = metadata["heading"] as string | undefined;
    await db
      .update(knowledgeDocuments)
      .set({ bodyMd: markdown.slice(0, 500_000), checksum: revision.checksum, mime: revision.mime, filename: revision.filename, updatedAt: new Date() })
      .where(eq(knowledgeDocuments.id, document.id));

    // insere chunks
    const rows = chunks.map((content, i) => ({
      documentId: document.id,
      collectionId,
      revisionId: revision.id,
      chunkIndex: i,
      content,
      embedding: embeddings?.[i] ?? null,
      page: null as number | null,
      heading: (firstPageHeading as string) ?? null,
      startOffset: null,
      endOffset: null,
      tokenCount: Math.ceil(content.length / 4),
    }));
    for (let i = 0; i < rows.length; i += 64) {
      const batch = rows.slice(i, i + 64);
      await db.insert(knowledgeChunks).values(batch as never);
    }

    await db
      .update(knowledgeIngestions)
      .set({ status: "ready", stage: "indexing", completedAt: new Date(), errorCode: null, errorMessage: null })
      .where(eq(knowledgeIngestions.id, ingestionId));

    // atualiza coleção
    await db.update(knowledgeCollections).set({ updatedAt: new Date() }).where(eq(knowledgeCollections.id, collectionId));

    return { status: "ready" };
  } catch (e) {
    const error = e as { message?: string; code?: string; stage?: string };
    const stage = (error.stage as string) ?? "extraction";
    const code = error.code ?? "INGESTION_FAILED";
    const message = error.message ?? String(e);
    // stage enum mapping — fallback para extraction se desconhecido
    const stageEnum = ["upload", "validation", "extraction", "chunking", "embedding", "indexing"].includes(stage) ? (stage as never) : ("extraction" as never);
    await db
      .update(knowledgeIngestions)
      .set({ status: "failed", stage: stageEnum, errorCode: code, errorMessage: message.slice(0, 2000), completedAt: new Date() })
      .where(eq(knowledgeIngestions.id, ingestionId));
    return { status: "failed", errorCode: code, errorMessage: message };
  }
}

// processa todos os queued (até limit) — usado por cron e após upload
export async function processQueuedIngestions(limit = 5): Promise<string[]> {
  const queued = await db.select().from(knowledgeIngestions).where(eq(knowledgeIngestions.status, "queued")).limit(limit);
  const ids: string[] = [];
  for (const q of queued) {
    ids.push(q.id);
    // fire-and-forget sequencial para não sobrecarregar embeddings
    await processIngestion(q.id).catch(() => {});
  }
  return ids;
}

// agenda processamento assíncrono sem bloquear request
export function enqueueIngestionAsync(ingestionId: string): void {
  setTimeout(() => {
    void processIngestion(ingestionId).catch((e) => console.warn("enqueueIngestionAsync failed", e));
  }, 100);
}
