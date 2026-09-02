import app from "./app";
import { embeddedWorkerEnabled, startIngestionWorker } from "./lib/ingestion";

const port = Number(process.env.PORT ?? 3001);

export default {
  port,
  fetch: app.fetch,
};

// Worker embutido de ingestão (dev): fora de produção a própria API reivindica
// jobs 'queued' com SKIP LOCKED. Em produção use o worker dedicado
// (docker compose up worker / bun run worker) com INGEST_WORKER_EMBEDDED=false.
if (embeddedWorkerEnabled()) {
  const stopWorker = startIngestionWorker();
  process.on("SIGTERM", stopWorker);
  process.on("SIGINT", stopWorker);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "info",
      action: "ingest.embedded_worker.started",
    }),
  );
}
