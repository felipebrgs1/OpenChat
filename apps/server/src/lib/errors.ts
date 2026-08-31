import type { ErrorCode } from "@nexo/contracts";

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function unauthorized(message = "Não autenticado.") {
  return new ApiError("UNAUTHORIZED", message, 401);
}

export function forbidden(message = "Sem permissão.") {
  return new ApiError("FORBIDDEN", message, 403);
}

export function roleRequired(message = "Usuário sem cargo.") {
  return new ApiError("ROLE_REQUIRED", message, 403);
}

export function notFound(message = "Não encontrado.") {
  return new ApiError("NOT_FOUND", message, 404);
}

export function conflict(message = "Conflito.") {
  return new ApiError("CONFLICT", message, 409);
}

export function validation(message: string) {
  return new ApiError("VALIDATION", message, 400);
}

export function llmUpstream(message = "Falha no modelo.") {
  return new ApiError("LLM_UPSTREAM", message, 502);
}
