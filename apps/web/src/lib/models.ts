const LABELS: Record<string, string> = {
  "google/gemini-2.5-flash": "Gemini 2.5 Flash",
  "anthropic/claude-sonnet-4.5": "Claude Sonnet 4.5",
  "openai/gpt-4.1-mini": "GPT-4.1 mini",
};

export function modelLabel(id: string) {
  if (!id) {
    return "Modelo";
  }
  return LABELS[id] ?? id.split("/").pop() ?? id;
}
