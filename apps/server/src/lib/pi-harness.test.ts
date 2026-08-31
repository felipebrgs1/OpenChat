import { describe, expect, it } from "bun:test";

import { publicLlmError, toPiHistory, usageFromPiMessages } from "./pi-harness";

describe("lote 3 — pi harness", () => {
  it("restaura histórico user/assistant sem tools", () => {
    const messages = toPiHistory([
      { role: "user", content: "Como calculamos multa?" },
      { role: "assistant", content: "Use a tabela oficial.", model: "google/gemini-2.5-flash" },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "user", content: "Como calculamos multa?" });
    expect(messages[1]).toMatchObject({
      role: "assistant",
      stopReason: "stop",
    });
    expect(JSON.stringify(messages)).not.toContain("toolCallId");
    expect(JSON.stringify(messages)).not.toContain("sessionFile");
  });

  it("lê usage da última mensagem assistant", () => {
    const { usage, errorMessage } = usageFromPiMessages([
      { role: "user" },
      {
        role: "assistant",
        stopReason: "stop",
        usage: { input: 12, output: 8, cost: { total: 0.0012 } },
      },
    ]);
    expect(errorMessage).toBeUndefined();
    expect(usage).toEqual({
      promptTokens: 12,
      completionTokens: 8,
      costUsd: 0.0012,
      finishReason: "stop",
    });
  });

  it("não vaza pi nem paths no erro público", () => {
    expect(publicLlmError(new Error("OPENROUTER_API_KEY ausente."))).toBe(
      "OPENROUTER_API_KEY ausente.",
    );
    expect(publicLlmError(new Error("No API key found for openrouter.\nUse /login"))).toBe(
      "OPENROUTER_API_KEY ausente.",
    );
    expect(
      publicLlmError(
        new Error(
          "See: /home/felipeb/chatgpt/node_modules/.bun/@earendil-works+pi-coding-agent@0.84.4/node_modules",
        ),
      ),
    ).toBe("Falha no modelo.");
    expect(publicLlmError(new Error("OpenRouter HTTP 502"))).toBe("OpenRouter HTTP 502");
  });
});
