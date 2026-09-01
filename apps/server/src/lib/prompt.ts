import type { messages, roles } from "@nexo/db";

const SAFETY_RULES = `- Não inventar regra financeira, jurídica ou de cobrança.
- Se a informação não estiver no contexto, dizer que não sabe e sugerir quem perguntar.
- Não pedir nem repetir CPF, senha, token, chave de API.
- Responder em pt-BR, direto, operacional.`;

type MessageRow = typeof messages.$inferSelect;
type RoleRow = typeof roles.$inferSelect;

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

export function assemblePrompt(input: {
  globalSystemPrompt: string;
  role: RoleRow;
  history: MessageRow[];
  knowledgeBlock?: string;
  user?: { personalPrompt?: string | null; memorySummary?: string | null };
}) {
  const userBlock = (() => {
    const parts: string[] = [];
    if (input.user?.memorySummary?.trim()) {
      parts.push(`[MEMÓRIA DO USUÁRIO - APRENDIZADO]\n${input.user.memorySummary.trim()}`);
    }
    if (input.user?.personalPrompt?.trim()) {
      parts.push(`[PROMPT DO USUÁRIO]\n${input.user.personalPrompt.trim()}`);
    }
    return parts.length ? parts.join("\n\n") + "\n\n" : "";
  })();

  const knowledgeSuffix = input.knowledgeBlock ? `\n\n${input.knowledgeBlock}` : "";

  const system = `[GLOBAL SYSTEM]
${input.globalSystemPrompt}

[CARGO]
${input.role.systemPrompt}

${userBlock}[REGRAS DE SEGURANÇA]
${SAFETY_RULES}${knowledgeSuffix}`;

  const historyBudget = 8000;
  const usable = input.history.filter(
    (row) => (row.role === "user" || row.role === "assistant") && row.content && !row.error,
  );
  const kept: MessageRow[] = [];
  let used = 0;
  for (let i = usable.length - 1; i >= 0; i -= 1) {
    const row = usable[i];
    if (!row) {
      continue;
    }
    const tokens = estimateTokens(row.content);
    if (used + tokens > historyBudget) {
      break;
    }
    kept.unshift(row);
    used += tokens;
  }

  return {
    system,
    messages: kept.map((row) => ({
      role: row.role as "user" | "assistant",
      content: row.content,
    })),
  };
}
