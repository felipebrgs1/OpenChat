import { ApiError } from "./errors";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 30;
const hits = new Map<string, number[]>();

export function assertMessageRateLimit(userId: string) {
  const now = Date.now();
  const recent = (hits.get(userId) ?? []).filter((ts) => now - ts < WINDOW_MS);
  if (recent.length >= MAX_HITS) {
    throw new ApiError("VALIDATION", "Limite de 30 mensagens / 10 min.", 429);
  }
  recent.push(now);
  hits.set(userId, recent);
}
