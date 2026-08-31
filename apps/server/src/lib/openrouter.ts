export type ChatTurn = { role: "system" | "user" | "assistant"; content: string };

export type OpenRouterUsage = {
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  finishReason?: string;
};

type StreamHandlers = {
  onDelta: (text: string) => Promise<void> | void;
  signal?: AbortSignal;
};

export async function streamOpenRouter(input: {
  baseUrl: string;
  apiKey: string;
  referer?: string;
  title?: string;
  userId: string;
  model: string;
  fallbackModel?: string;
  messages: ChatTurn[];
  onDelta: StreamHandlers["onDelta"];
  signal?: AbortSignal;
}): Promise<OpenRouterUsage> {
  const models = input.fallbackModel ? [input.model, input.fallbackModel] : [input.model];
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": input.referer ?? "http://localhost:5173",
      "X-Title": input.title ?? "Nexo",
    },
    body: JSON.stringify({
      model: input.model,
      models,
      user: input.userId,
      stream: true,
      stream_options: { include_usage: true },
      messages: input.messages,
    }),
    signal: input.signal,
  });

  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(detail || `OpenRouter HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const usage: OpenRouterUsage = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      await applySseChunk(part, usage, input.onDelta);
    }
  }
  if (buffer.trim()) {
    await applySseChunk(buffer, usage, input.onDelta);
  }
  return usage;
}

async function applySseChunk(
  part: string,
  usage: OpenRouterUsage,
  onDelta: StreamHandlers["onDelta"],
) {
  for (const line of part.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    let json: {
      choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    };
    try {
      json = JSON.parse(data) as typeof json;
    } catch {
      continue;
    }
    const delta = json.choices?.[0]?.delta?.content;
    if (delta) {
      await onDelta(delta);
    }
    const finish = json.choices?.[0]?.finish_reason;
    if (finish) {
      usage.finishReason = finish;
    }
    if (json.usage) {
      usage.promptTokens = json.usage.prompt_tokens;
      usage.completionTokens = json.usage.completion_tokens;
      usage.costUsd = json.usage.cost;
    }
  }
}
