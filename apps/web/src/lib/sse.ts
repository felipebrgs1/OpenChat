import type { ErrorCode } from "@nexo/contracts";

import { ApiRequestError } from "./api";
import { getSession } from "./session";

const baseUrl = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export type StreamMeta = { messageId: string; userMessageId?: string; model: string };
export type StreamDone = {
  messageId: string;
  promptTokens: number;
  completionTokens: number;
  credits?: string | null;
  tps?: number | null;
  latencyMs?: number | null;
  balanceAfter?: string | null;
};

export async function streamChat(input: {
  conversationId: string;
  content: string;
  model?: string;
  starterId?: string | null;
  signal?: AbortSignal;
  onMeta: (meta: StreamMeta) => void;
  onDelta: (text: string) => void;
  onDone: (done: StreamDone) => void;
  onError: (code: ErrorCode | "UNKNOWN", message: string) => void;
}) {
  const headers = new Headers({ "Content-Type": "application/json" });
  const session = getSession();
  if (session?.accessToken) {
    headers.set("Authorization", `Bearer ${session.accessToken}`);
  }

  const response = await fetch(`${baseUrl}/api/conversations/${input.conversationId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: input.content,
      model: input.model,
      starterId: input.starterId ?? null,
    }),
    signal: input.signal,
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    const data = (await response.json().catch(() => null)) as {
      error?: { code?: ErrorCode; message?: string };
    } | null;
    throw new ApiRequestError(
      data?.error?.code ?? "UNKNOWN",
      data?.error?.message ?? "Falha ao enviar mensagem.",
      response.status,
    );
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new ApiRequestError("LLM_UPSTREAM", "Stream indisponível.", 502);
  }

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      dispatchSse(part, input);
    }
  }
  if (buffer.trim()) {
    dispatchSse(buffer, input);
  }
}

function dispatchSse(
  part: string,
  input: {
    onMeta: (meta: StreamMeta) => void;
    onDelta: (text: string) => void;
    onDone: (done: StreamDone & Record<string, unknown>) => void;
    onError: (code: ErrorCode | "UNKNOWN", message: string) => void;
  },
) {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of part.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  const raw = dataLines.join("");
  if (!raw) {
    return;
  }
  const data = JSON.parse(raw) as Record<string, unknown>;
  if (event === "meta") {
    input.onMeta(data as StreamMeta);
  } else if (event === "delta") {
    input.onDelta(String(data.text ?? ""));
  } else if (event === "done") {
    input.onDone(data as StreamDone);
  } else if (event === "error") {
    input.onError(
      (data.code as ErrorCode | undefined) ?? "LLM_UPSTREAM",
      String(data.message ?? "Falha no modelo."),
    );
  }
}
