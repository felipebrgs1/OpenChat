import { describe, expect, it } from "bun:test";

import { resolveStorageDriver } from "./storage";

const RUSTFS_ENV = {
  S3_ENDPOINT: "http://localhost:9000",
  S3_ACCESS_KEY: "nexo",
  S3_SECRET_KEY: "nexo12345",
  S3_BUCKET: "nexo-private",
};

const R2_ENV = {
  R2_ACCOUNT_ID: "abc123",
  R2_BUCKET: "nexo-private",
  R2_ACCESS_KEY_ID: "r2-key",
  R2_SECRET_ACCESS_KEY: "r2-secret",
};

describe("storage — resolveStorageDriver", () => {
  it("sem env → disco local", () => {
    expect(resolveStorageDriver({})).toEqual({ driver: "local" });
  });

  it("auto: S3_* completo → RustFS (padrão do sistema)", () => {
    const d = resolveStorageDriver(RUSTFS_ENV);
    expect(d.driver).toBe("rustfs");
    if (d.driver === "rustfs") {
      expect(d.config.endpoint).toBe("http://localhost:9000");
      expect(d.config.bucket).toBe("nexo-private");
      expect(d.config.forcePathStyle).toBe(true);
    }
  });

  it("auto: sem S3_*, R2_* completo → R2 com endpoint derivado do account id", () => {
    const d = resolveStorageDriver(R2_ENV);
    expect(d.driver).toBe("r2");
    if (d.driver === "r2") {
      expect(d.config.endpoint).toBe("https://abc123.r2.cloudflarestorage.com");
      expect(d.config.region).toBe("auto");
      expect(d.config.forcePathStyle).toBe(true);
    }
  });

  it("auto: RustFS tem precedência quando ambos configurados", () => {
    expect(resolveStorageDriver({ ...RUSTFS_ENV, ...R2_ENV }).driver).toBe("rustfs");
  });

  it("STORAGE_DRIVER=r2 força R2 mesmo com RustFS configurado", () => {
    const d = resolveStorageDriver({ ...RUSTFS_ENV, ...R2_ENV, STORAGE_DRIVER: "r2" });
    expect(d.driver).toBe("r2");
  });

  it("R2_ENDPOINT sobrepõe o endpoint derivado do account id", () => {
    const d = resolveStorageDriver({
      ...R2_ENV,
      R2_ENDPOINT: "https://custom.example.com",
    });
    expect(d.driver).toBe("r2");
    if (d.driver === "r2") expect(d.config.endpoint).toBe("https://custom.example.com");
  });

  it("STORAGE_DRIVER=local vence tudo (disco, mesmo com S3_*/R2_*)", () => {
    const d = resolveStorageDriver({
      ...RUSTFS_ENV,
      ...R2_ENV,
      STORAGE_DRIVER: "local",
    });
    expect(d).toEqual({ driver: "local" });
  });

  it("STORAGE_DRIVER=r2 sem env completa falha rápido", () => {
    expect(() => resolveStorageDriver({ STORAGE_DRIVER: "r2" })).toThrow(/R2_BUCKET/);
  });

  it("STORAGE_DRIVER=rustfs (alias s3) sem S3_* falha rápido", () => {
    expect(() => resolveStorageDriver({ STORAGE_DRIVER: "s3" })).toThrow(/S3_ENDPOINT/);
    expect(resolveStorageDriver({ ...RUSTFS_ENV, STORAGE_DRIVER: "rustfs" }).driver).toBe("rustfs");
  });
});
