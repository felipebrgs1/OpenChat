import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, type Model } from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

const HARNESS_DIR = join(tmpdir(), "nexo-pi-harness");

export type NexoTurnUsage = {
  promptTokens?: number;
  completionTokens?: number;
  costUsd?: number;
  finishReason?: string;
};

export type PiHistoryTurn = {
  role: "user" | "assistant";
  content: string;
  model?: string | null;
  createdAt?: Date;
};

type StreamNexoTurnInput = {
  userId: string;
  model: string;
  fallbackModel?: string;
  baseUrl: string;
  systemPrompt: string;
  history: PiHistoryTurn[];
  content: string;
  signal?: AbortSignal;
  onDelta: (text: string) => Promise<void> | void;
  onToolStart?: (name: string) => Promise<void> | void;
};

let modelRuntimePromise: Promise<ModelRuntime> | undefined;

function harnessDir() {
  mkdirSync(HARNESS_DIR, { recursive: true });
  return HARNESS_DIR;
}

async function getModelRuntime() {
  if (!modelRuntimePromise) {
    modelRuntimePromise = ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
  }
  return modelRuntimePromise;
}

export function resolveOpenRouterModel(
  runtime: ModelRuntime,
  modelId: string,
  baseUrl: string,
): Model<"openai-completions"> {
  const catalog = runtime.getModel("openrouter", modelId);
  if (catalog) {
    return { ...catalog, id: modelId, baseUrl } as Model<"openai-completions">;
  }
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "openrouter",
    baseUrl,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
    compat: {
      supportsDeveloperRole: false,
      thinkingFormat: "openrouter",
    },
  };
}

export function toPiHistory(history: PiHistoryTurn[]) {
  const messages: Array<
    | { role: "user"; content: string; timestamp: number }
    | {
        role: "assistant";
        content: Array<{ type: "text"; text: string }>;
        api: "openai-completions";
        provider: "openrouter";
        model: string;
        usage: {
          input: number;
          output: number;
          cacheRead: number;
          cacheWrite: number;
          totalTokens: number;
          cost: {
            input: number;
            output: number;
            cacheRead: number;
            cacheWrite: number;
            total: number;
          };
        };
        stopReason: "stop";
        timestamp: number;
      }
  > = [];
  for (const row of history) {
    if (!row.content) {
      continue;
    }
    const timestamp = row.createdAt?.getTime() ?? Date.now();
    if (row.role === "user") {
      messages.push({ role: "user", content: row.content, timestamp });
      continue;
    }
    messages.push({
      role: "assistant",
      content: [{ type: "text", text: row.content }],
      api: "openai-completions",
      provider: "openrouter",
      model: row.model ?? "openrouter",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp,
    });
  }
  return messages;
}

export function usageFromPiMessages(
  messages: { role?: string; usage?: unknown; stopReason?: string }[],
) {
  const last = [...messages].reverse().find((row) => row.role === "assistant") as
    | {
        usage?: {
          input?: number;
          output?: number;
          cost?: { total?: number };
        };
        stopReason?: string;
        errorMessage?: string;
      }
    | undefined;
  if (!last) {
    return { usage: {} as NexoTurnUsage };
  }
  const usage: NexoTurnUsage = {
    promptTokens: last.usage?.input,
    completionTokens: last.usage?.output,
    costUsd: last.usage?.cost?.total,
    finishReason: last.stopReason,
  };
  return { usage, errorMessage: last.stopReason === "error" ? last.errorMessage : undefined };
}

export function publicLlmError(error: unknown) {
  const message = error instanceof Error ? error.message : "Falha no modelo.";
  if (/API key/i.test(message) || /OPENROUTER_API_KEY/i.test(message)) {
    return "OPENROUTER_API_KEY ausente.";
  }
  const first = message.split("\n")[0] ?? "Falha no modelo.";
  if (
    /pi-coding-agent|\b\/login\b|node_modules|sessionFile|toolCallId/i.test(first) ||
    first.includes(HARNESS_DIR)
  ) {
    return "Falha no modelo.";
  }
  return first.trim() || "Falha no modelo.";
}

function isTextDelta(event: AgentSessionEvent): event is AgentSessionEvent & {
  type: "message_update";
  assistantMessageEvent: { type: "text_delta"; delta: string };
} {
  return (
    event.type === "message_update" &&
    "assistantMessageEvent" in event &&
    event.assistantMessageEvent.type === "text_delta"
  );
}

export async function streamNexoTurn(input: StreamNexoTurnInput): Promise<NexoTurnUsage> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY ausente.");
  }

  const dir = harnessDir();
  const modelRuntime = await getModelRuntime();
  await modelRuntime.setRuntimeApiKey("openrouter", apiKey);
  const model = resolveOpenRouterModel(modelRuntime, input.model, input.baseUrl);
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: true },
    retry: { enabled: true, maxRetries: 2 },
  });
  const referer = process.env.OPENROUTER_HTTP_REFERER ?? "http://localhost:5173";
  const title = process.env.OPENROUTER_APP_TITLE ?? "Nexo";

  const loader = new DefaultResourceLoader({
    cwd: dir,
    agentDir: dir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => input.systemPrompt,
    appendSystemPromptOverride: () => [],
    extensionFactories: [
      {
        name: "nexo",
        factory: (pi) => {
          pi.on("before_agent_start", async () => ({ systemPrompt: input.systemPrompt }));
          pi.on("before_provider_headers", (event) => {
            event.headers["HTTP-Referer"] = referer;
            event.headers["X-Title"] = title;
          });
          pi.on("before_provider_request", (event) => {
            if (!event.payload || typeof event.payload !== "object") {
              return;
            }
            const payload = { ...(event.payload as Record<string, unknown>) };
            payload.user = input.userId;
            if (input.fallbackModel) {
              payload.models = [input.model, input.fallbackModel];
            }
            return payload;
          });
          pi.on("tool_call", async () => {
            // Lote 8: bloquear com { block: true, reason: "BUDGET_EXCEEDED" }.
          });
        },
      },
    ],
  });
  await loader.reload();

  const { session } = await createAgentSession({
    cwd: dir,
    agentDir: dir,
    model,
    thinkingLevel: "off",
    modelRuntime,
    noTools: "all",
    resourceLoader: loader,
    sessionManager: SessionManager.inMemory(dir),
    settingsManager,
  });

  session.agent.state.messages = toPiHistory(input.history) as typeof session.agent.state.messages;

  const abort = () => {
    void session.abort();
  };
  input.signal?.addEventListener("abort", abort, { once: true });

  const unsubscribe = session.subscribe((event) => {
    if (isTextDelta(event)) {
      void input.onDelta(event.assistantMessageEvent.delta);
    }
    if (event.type === "tool_execution_start") {
      void input.onToolStart?.(event.toolName);
    }
  });

  try {
    if (input.signal?.aborted) {
      throw new Error("Geração interrompida.");
    }
    await session.prompt(input.content, { expandPromptTemplates: false, source: "rpc" });
    const { usage, errorMessage } = usageFromPiMessages(session.messages);
    if (errorMessage) {
      throw new Error(errorMessage);
    }
    if (input.signal?.aborted) {
      throw new Error("Geração interrompida.");
    }
    return usage;
  } finally {
    input.signal?.removeEventListener("abort", abort);
    unsubscribe();
    session.dispose();
  }
}
