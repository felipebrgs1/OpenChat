/**
 * Worker dedicado de ingestão (fila durável no Postgres).
 *
 * Produção: rode quantas réplicas precisar — a reivindicação de jobs usa
 * FOR UPDATE SKIP LOCKED, então réplicas nunca processam o mesmo job.
 *   docker compose up worker   |   bun run worker   |   bun src/worker.ts
 *
 * A cada tick:
 *  1. reenfileira jobs travados em 'processing' (crash/restart), com cap de
 *     tentativas antes de marcar failed definitivo;
 *  2. reivindica e processa até INGEST_BATCH_SIZE jobs 'queued'.
 *
 * Env: INGEST_POLL_MS (5000), INGEST_BATCH_SIZE (2), INGEST_STALE_MINUTES (15),
 * INGEST_MAX_ATTEMPTS (5), DATABASE_URL, S3_* / R2_*, DOCLING_WORKER_URL, OCR_ENABLED.
 */

import { startIngestionWorker } from "./lib/ingestion";

function log(action: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", action, ...extra }));
}

const stop = startIngestionWorker();
log("ingest.worker.started", {
  pollMs: process.env.INGEST_POLL_MS ?? 5000,
  batchSize: process.env.INGEST_BATCH_SIZE ?? 2,
  staleMinutes: process.env.INGEST_STALE_MINUTES ?? 15,
  maxAttempts: process.env.INGEST_MAX_ATTEMPTS ?? 5,
});

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("ingest.worker.stopping", { signal });
  stop();
  // jobs 'processing' no momento do shutdown são recuperados pelo próximo
  // worker via requeueStaleIngestions — não há perda de job
  setTimeout(() => process.exit(0), 500);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
