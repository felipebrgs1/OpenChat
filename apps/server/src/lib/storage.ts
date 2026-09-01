/**
 * R2 — Storage abstraction para RustFS (S3 compatível).
 * Dev: grava em disco local (data/storage) quando S3_* não está configurado.
 * Prod: usa S3 via AWS SDK v3; bucket `nexo-private` (ou S3_BUCKET).
 *
 * Chave: documents/{documentId}/{revisionId}/original.{ext}
 * Segurança: bucket privado, download só via API autorizada + URL pré-assinada curta.
 */

import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const LOCAL_DIR = process.env.STORAGE_DIR?.trim() || join(process.cwd(), "data", "storage");

function s3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT?.trim() &&
      process.env.S3_ACCESS_KEY?.trim() &&
      process.env.S3_SECRET_KEY?.trim() &&
      (process.env.S3_BUCKET?.trim() || "nexo-private"),
  );
}

function bucketName(): string {
  return process.env.S3_BUCKET?.trim() || "nexo-private";
}

function s3Endpoint(): string {
  return process.env.S3_ENDPOINT!.trim().replace(/\/$/, "");
}

export function buildStorageKey(documentId: string, revisionId: string, ext: string): string {
  const safeExt = ext.replace(/^\./, "").toLowerCase() || "bin";
  return `documents/${documentId}/${revisionId}/original.${safeExt}`;
}

export type StoragePutResult = {
  storageKey: string;
  sizeBytes: number;
};

let s3Client: unknown | null = null;

async function getS3Client(): Promise<unknown> {
  if (s3Client) return s3Client;
  const endpoint = s3Endpoint();
  const accessKeyId = process.env.S3_ACCESS_KEY!.trim();
  const secretAccessKey = process.env.S3_SECRET_KEY!.trim();
  const region = process.env.S3_REGION?.trim() || "us-east-1";
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";
  const mod = await import("@aws-sdk/client-s3").catch(() => null);
  if (!mod) throw new Error("@aws-sdk/client-s3 não instalado. Rode bun add @aws-sdk/client-s3");
  const { S3Client } = mod as { S3Client: new (opts: unknown) => unknown };
  s3Client = new S3Client({
    region,
    endpoint,
    forcePathStyle,
    credentials: { accessKeyId, secretAccessKey },
  } as never);
  return s3Client;
}

let bucketEnsured = false;
async function ensureBucket(): Promise<void> {
  if (bucketEnsured || !s3Configured()) return;
  const client = (await getS3Client()) as { send: (cmd: unknown) => Promise<unknown> };
  const mod = await import("@aws-sdk/client-s3");
  const bucket = bucketName();
  try {
    const head = new (mod as unknown as { HeadBucketCommand: new (o: unknown) => unknown }).HeadBucketCommand({ Bucket: bucket } as never);
    await client.send(head);
    bucketEnsured = true;
    return;
  } catch {}
  try {
    const create = new (mod as unknown as { CreateBucketCommand: new (o: unknown) => unknown }).CreateBucketCommand({ Bucket: bucket } as never);
    await client.send(create);
    bucketEnsured = true;
  } catch (e) {
    // bucket may already exist (race)
    bucketEnsured = true;
  }
}

export async function putObject(
  storageKey: string,
  data: Buffer | Uint8Array,
  contentType: string,
): Promise<StoragePutResult> {
  const sizeBytes = data.byteLength;
  if (s3Configured()) {
    await ensureBucket();
    const client = (await getS3Client()) as {
      send: (cmd: unknown) => Promise<unknown>;
    };
    const mod = await import("@aws-sdk/client-s3");
    const cmd = new (mod as unknown as { PutObjectCommand: new (o: unknown) => unknown }).PutObjectCommand({
      Bucket: bucketName(),
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
  if (s3Configured()) {
    const client = (await getS3Client()) as {
      send: (cmd: unknown) => Promise<unknown>;
    };
    const mod = await import("@aws-sdk/client-s3");
    const cmd = new (mod as unknown as { GetObjectCommand: new (o: unknown) => unknown }).GetObjectCommand({
      Bucket: bucketName(),
      Key: storageKey,
    } as never);
    const res = (await client.send(cmd)) as { Body?: { transformToByteArray?: () => Promise<Uint8Array> } & AsyncIterable<Uint8Array> };
    if (!res.Body) throw new Error("Objeto não encontrado no S3");
    if (typeof (res.Body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
      const arr = await (res.Body as { transformToByteArray: () => Promise<Uint8Array> }).transformToByteArray();
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
  if (s3Configured()) {
    const client = (await getS3Client()) as { send: (cmd: unknown) => Promise<unknown> };
    const mod = await import("@aws-sdk/client-s3");
    const cmd = new (mod as unknown as { DeleteObjectCommand: new (o: unknown) => unknown }).DeleteObjectCommand({
      Bucket: bucketName(),
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
  if (s3Configured()) {
    const client = (await getS3Client()) as { send: (cmd: unknown) => Promise<unknown> };
    const mod = await import("@aws-sdk/client-s3");
    const cmd = new (mod as unknown as { HeadObjectCommand: new (o: unknown) => unknown }).HeadObjectCommand({
      Bucket: bucketName(),
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
 * Se S3 não configurado, retorna null — caller deve fazer stream direto.
 */
export async function getPresignedDownloadUrl(
  storageKey: string,
  expiresInSec = 900,
): Promise<string | null> {
  if (!s3Configured()) return null;
  const mod = await import("@aws-sdk/client-s3").catch(() => null);
  // @ts-ignore optional dep
  const presigner: unknown = await import("@aws-sdk/s3-presigner" as string).catch(() => null);
  if (!mod || !presigner) return null;
  // @ts-ignore presigner optional
  const client = (await getS3Client()) as unknown as Parameters<any>[0];
  const cmd = new (mod as unknown as { GetObjectCommand: new (o: unknown) => unknown }).GetObjectCommand({
    Bucket: bucketName(),
    Key: storageKey,
  } as never);
  const getSigned = (presigner as Record<string, unknown> | null)?.["getSignedUrl"] as ((c: unknown, cmd: unknown, opts: unknown) => Promise<string>) | undefined;
  if (!getSigned) return null;
  const url = await getSigned(
    client as never,
    cmd as never,
    { expiresIn: expiresInSec },
  );
  return url;
}

export function storageDiagnostics() {
  return {
    configured: s3Configured(),
    endpoint: process.env.S3_ENDPOINT?.trim() || null,
    bucket: bucketName(),
    localDir: LOCAL_DIR,
  };
}
