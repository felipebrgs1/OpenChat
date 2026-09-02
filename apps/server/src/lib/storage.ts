/**
 * Storage abstraction para objetos originais de documentos.
 *
 * Drivers (resolvidos por env, ver resolveStorageDriver):
 *  - "local"  — disco (data/storage). Fallback quando nada é configurado.
 *  - "rustfs" — RustFS, o S3-compatível padrão do sistema (env S3_*).
 *  - "r2"     — Cloudflare R2, opcional (env R2_*).
 *
 * Seleção:
 *  - STORAGE_DRIVER=local|rustfs|s3|r2 força um driver (falha rápido se env
 *    incompleta).
 *  - Sem STORAGE_DRIVER (auto): S3_* completo → RustFS (padrão do sistema);
 *    senão R2_* completo → R2; senão disco local.
 *
 * Chave: documents/{documentId}/{revisionId}/original.{ext}
 * Segurança: bucket privado, download só via API autorizada + URL pré-assinada curta.
 */

import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const LOCAL_DIR = process.env.STORAGE_DIR?.trim() || join(process.cwd(), "data", "storage");

export function buildStorageKey(documentId: string, revisionId: string, ext: string): string {
  const safeExt = ext.replace(/^\./, "").toLowerCase() || "bin";
  return `documents/${documentId}/${revisionId}/original.${safeExt}`;
}

export type StoragePutResult = {
  storageKey: string;
  sizeBytes: number;
};

// ---------------------------------------------------------------------------
// Resolução de driver
// ---------------------------------------------------------------------------

export type S3DriverConfig = {
  driver: "rustfs" | "r2";
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

export type ResolvedDriver =
  | { driver: "local" }
  | { driver: "rustfs"; config: S3DriverConfig }
  | { driver: "r2"; config: S3DriverConfig };

function rustfsConfigFromEnv(env: Record<string, string | undefined>): S3DriverConfig | null {
  const endpoint = env.S3_ENDPOINT?.trim();
  const accessKeyId = env.S3_ACCESS_KEY?.trim();
  const secretAccessKey = env.S3_SECRET_KEY?.trim();
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return {
    driver: "rustfs",
    endpoint,
    region: env.S3_REGION?.trim() || "us-east-1",
    bucket: env.S3_BUCKET?.trim() || "nexo-private",
    accessKeyId,
    secretAccessKey,
    forcePathStyle: env.S3_FORCE_PATH_STYLE !== "false",
  };
}

function r2ConfigFromEnv(env: Record<string, string | undefined>): S3DriverConfig | null {
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  const bucket = env.R2_BUCKET?.trim();
  if (!accessKeyId || !secretAccessKey || !bucket) return null;
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const endpoint =
    env.R2_ENDPOINT?.trim() || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  if (!endpoint) return null;
  return {
    driver: "r2",
    endpoint,
    region: "auto", // R2 ignora região, mas o SDK exige valor
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle: true, // endpoint de conta exige path-style
  };
}

/**
 * Resolve o driver de storage a partir das variáveis de ambiente.
 * RustFS (S3_*) é o padrão do sistema; R2 é opcional e só assume em auto
 * quando RustFS não está configurado, ou via STORAGE_DRIVER=r2.
 * Com STORAGE_DRIVER explícito e env incompleta, falha rápido (evita
 * gravar silenciosamente no disco em produção).
 */
export function resolveStorageDriver(
  env: Record<string, string | undefined> = process.env,
): ResolvedDriver {
  const explicit = env.STORAGE_DRIVER?.trim().toLowerCase();
  const rustfs = rustfsConfigFromEnv(env);
  const r2 = r2ConfigFromEnv(env);

  if (explicit === "local") return { driver: "local" };
  if (explicit === "r2") {
    if (!r2) {
      throw new Error(
        "STORAGE_DRIVER=r2 requer R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY e (R2_ACCOUNT_ID | R2_ENDPOINT).",
      );
    }
    return { driver: "r2", config: r2 };
  }
  if (explicit === "rustfs" || explicit === "s3") {
    if (!rustfs) {
      throw new Error("STORAGE_DRIVER=rustfs requer S3_ENDPOINT, S3_ACCESS_KEY e S3_SECRET_KEY.");
    }
    return { driver: "rustfs", config: rustfs };
  }
  // auto: RustFS (padrão do sistema) → R2 (opcional) → disco local
  if (rustfs) return { driver: "rustfs", config: rustfs };
  if (r2) return { driver: "r2", config: r2 };
  return { driver: "local" };
}

// ---------------------------------------------------------------------------
// Cliente S3 (compartilhado por RustFS e R2 — mesma API)
// ---------------------------------------------------------------------------

const s3Clients = new Map<string, Promise<unknown>>();

async function getS3Client(config: S3DriverConfig): Promise<unknown> {
  const cached = s3Clients.get(config.endpoint);
  if (cached) return cached;
  const promise = (async () => {
    const mod = await import("@aws-sdk/client-s3").catch(() => null);
    if (!mod) {
      throw new Error("@aws-sdk/client-s3 não instalado. Rode bun add @aws-sdk/client-s3");
    }
    const { S3Client } = mod as { S3Client: new (opts: unknown) => unknown };
    return new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    } as never);
  })();
  s3Clients.set(config.endpoint, promise);
  return promise;
}

async function ensureBucket(config: S3DriverConfig): Promise<void> {
  if (config.driver === "r2") return; // R2: bucket é criado via dashboard/wrangler
  const client = (await getS3Client(config)) as { send: (cmd: unknown) => Promise<unknown> };
  const mod = await import("@aws-sdk/client-s3");
  const bucket = config.bucket;
  try {
    const head = new (
      mod as unknown as { HeadBucketCommand: new (o: unknown) => unknown }
    ).HeadBucketCommand({ Bucket: bucket } as never);
    await client.send(head);
    return;
  } catch {}
  try {
    const create = new (
      mod as unknown as { CreateBucketCommand: new (o: unknown) => unknown }
    ).CreateBucketCommand({ Bucket: bucket } as never);
    await client.send(create);
  } catch {
    // bucket may already exist (race)
  }
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

export async function putObject(
  storageKey: string,
  data: Buffer | Uint8Array,
  contentType: string,
): Promise<StoragePutResult> {
  const sizeBytes = data.byteLength;
  const d = resolveStorageDriver();
  if (d.driver !== "local") {
    await ensureBucket(d.config);
    const client = (await getS3Client(d.config)) as {
      send: (cmd: unknown) => Promise<unknown>;
    };
    const mod = await import("@aws-sdk/client-s3");
    const cmd = new (
      mod as unknown as { PutObjectCommand: new (o: unknown) => unknown }
    ).PutObjectCommand({
      Bucket: d.config.bucket,
      Key: storageKey,
      Body: data,
      ContentType: contentType,
    } as never);
    await client.send(cmd);
    return { storageKey, sizeBytes };
  }
  const filePath = join(LOCAL_DIR, storageKey);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
  return { storageKey, sizeBytes };
}

export async function getObject(storageKey: string): Promise<Buffer> {
  const d = resolveStorageDriver();
  if (d.driver !== "local") {
    const client = (await getS3Client(d.config)) as {
      send: (cmd: unknown) => Promise<unknown>;
    };
    const mod = await import("@aws-sdk/client-s3");
    const cmd = new (
      mod as unknown as { GetObjectCommand: new (o: unknown) => unknown }
    ).GetObjectCommand({
      Bucket: d.config.bucket,
      Key: storageKey,
    } as never);
    const res = (await client.send(cmd)) as {
      Body?: { transformToByteArray?: () => Promise<Uint8Array> } & AsyncIterable<Uint8Array>;
    };
    if (!res.Body) throw new Error("Objeto não encontrado no storage (RustFS/R2)");
    if (
      typeof (res.Body as { transformToByteArray?: unknown }).transformToByteArray === "function"
    ) {
      const arr = await (
        res.Body as { transformToByteArray: () => Promise<Uint8Array> }
      ).transformToByteArray();
      return Buffer.from(arr);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
  const filePath = join(LOCAL_DIR, storageKey);
  try {
    const buf = await readFile(filePath);
    return buf;
  } catch {
    throw new Error("Arquivo original não encontrado.");
  }
}

export async function deleteObject(storageKey: string): Promise<void> {
  const d = resolveStorageDriver();
  if (d.driver !== "local") {
    const client = (await getS3Client(d.config)) as { send: (cmd: unknown) => Promise<unknown> };
    const mod = await import("@aws-sdk/client-s3");
    const cmd = new (
      mod as unknown as { DeleteObjectCommand: new (o: unknown) => unknown }
    ).DeleteObjectCommand({
      Bucket: d.config.bucket,
      Key: storageKey,
    } as never);
    await client.send(cmd);
    return;
  }
  const filePath = join(LOCAL_DIR, storageKey);
  try {
    await unlink(filePath);
  } catch {}
}

export async function objectExists(storageKey: string): Promise<boolean> {
  const d = resolveStorageDriver();
  if (d.driver !== "local") {
    const client = (await getS3Client(d.config)) as { send: (cmd: unknown) => Promise<unknown> };
    const mod = await import("@aws-sdk/client-s3");
    const cmd = new (
      mod as unknown as { HeadObjectCommand: new (o: unknown) => unknown }
    ).HeadObjectCommand({
      Bucket: d.config.bucket,
      Key: storageKey,
    } as never);
    try {
      await client.send(cmd);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await stat(join(LOCAL_DIR, storageKey));
    return true;
  } catch {
    return false;
  }
}

/**
 * Gera URL pré-assinada curta (15 min default) para download autorizado.
 * Funciona com RustFS e com Cloudflare R2 (mesma API de presign).
 * Se driver é local, retorna null — caller deve fazer stream direto.
 */
export async function getPresignedDownloadUrl(
  storageKey: string,
  expiresInSec = 900,
): Promise<string | null> {
  const d = resolveStorageDriver();
  if (d.driver === "local") return null;
  const mod = await import("@aws-sdk/client-s3").catch(() => null);
  const presigner = await import("@aws-sdk/s3-request-presigner").catch(() => null);
  if (!mod || !presigner) {
    console.warn(
      "storage: presigner indisponível (@aws-sdk/s3-request-presigner), usando stream pela API",
    );
    return null;
  }
  const client = await getS3Client(d.config);
  const cmd = new (
    mod as unknown as { GetObjectCommand: new (o: unknown) => unknown }
  ).GetObjectCommand({
    Bucket: d.config.bucket,
    Key: storageKey,
  } as never);
  const getSigned = (presigner as Record<string, unknown>)?.["getSignedUrl"] as
    | ((c: unknown, cmd: unknown, opts: unknown) => Promise<string>)
    | undefined;
  if (!getSigned) return null;
  const url = await getSigned(client as never, cmd as never, { expiresIn: expiresInSec });
  return url;
}

export function storageDiagnostics() {
  const d = resolveStorageDriver();
  return {
    driver: d.driver,
    endpoint: d.driver !== "local" ? d.config.endpoint : null,
    bucket: d.driver !== "local" ? d.config.bucket : null,
    localDir: LOCAL_DIR,
  };
}
