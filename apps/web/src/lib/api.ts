import type { ErrorCode } from "@nexo/contracts";

import { clearSession, getSession, setSession } from "./session";

const baseUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export class ApiRequestError extends Error {
  constructor(
    readonly code: ErrorCode | "UNKNOWN",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

let refreshPromise: Promise<boolean> | null = null;

async function refreshTokens() {
  const session = getSession();
  if (!session?.refreshToken) {
    return false;
  }
  const response = await fetch(`${baseUrl}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  });
  if (!response.ok) {
    clearSession();
    return false;
  }
  setSession((await response.json()) as NonNullable<ReturnType<typeof getSession>>);
  return true;
}

export async function api<T>(
  path: string,
  init: RequestInit & { skipAuth?: boolean } = {},
): Promise<T> {
  const exec = async () => {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type") && init.body) {
      headers.set("Content-Type", "application/json");
    }
    const session = getSession();
    if (!init.skipAuth && session?.accessToken) {
      headers.set("Authorization", `Bearer ${session.accessToken}`);
    }
    return fetch(`${baseUrl}${path}`, { ...init, headers });
  };

  let response = await exec();
  if (response.status === 401 && !init.skipAuth) {
    if (!refreshPromise) {
      refreshPromise = refreshTokens().finally(() => {
        refreshPromise = null;
      });
    }
    const ok = await refreshPromise;
    if (ok) {
      response = await exec();
    }
  }

  const data = (await response.json().catch(() => null)) as
    | T
    | { error?: { code?: ErrorCode; message?: string } }
    | null;

  if (!response.ok) {
    const error = data && typeof data === "object" && "error" in data ? data.error : undefined;
    throw new ApiRequestError(
      error?.code ?? "UNKNOWN",
      error?.message ?? "Falha na requisição.",
      response.status,
    );
  }

  return data as T;
}
