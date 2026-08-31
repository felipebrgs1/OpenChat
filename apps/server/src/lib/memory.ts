import { db, userMemories, users } from "@nexo/db";
import { desc, eq } from "drizzle-orm";

// Heurística Hermes-style: detecta intenção de ensinar
const LEARN_TRIGGERS = [
  /aprenda que/i,
  /lembre[ -]?se que/i,
  /lembre que/i,
  /prefiro que/i,
  /sempre (responda|use|faça)/i,
  /meu nome é/i,
  /me chama de/i,
  /nunca (faça|use)/i,
  /daqui pra frente/i,
  /a partir de agora/i,
];

export function shouldAutoLearn(content: string) {
  return LEARN_TRIGGERS.some((re) => re.test(content));
}

export function extractMemorySnippet(userContent: string, _assistantContent?: string) {
  // keep first 500 chars, strip
  const raw = userContent.trim().slice(0, 500);
  // if user used trigger phrase, keep the sentence after it
  for (const re of LEARN_TRIGGERS) {
    const m = raw.match(re);
    if (m) {
      const idx = m.index ?? 0;
      // keep from trigger onward
      return raw.slice(idx).slice(0, 400);
    }
  }
  // fallback: if message is short and looks like a preference, keep it
  if (raw.length < 200 && /prefiro|gosto|quero|use/i.test(raw)) {
    return raw;
  }
  return null;
}

export async function getUserMemoryContext(userId: string) {
  const rows = await db
    .select()
    .from(userMemories)
    .where(eq(userMemories.userId, userId))
    .orderBy(desc(userMemories.createdAt))
    .limit(10);
  if (rows.length === 0) return null;
  // oldest first for prompt
  const ordered = [...rows].reverse();
  return ordered
    .map((r, i) => `${i + 1}. ${r.content}`)
    .join("\n")
    .slice(0, 2000);
}

export async function rebuildMemorySummary(userId: string) {
  const context = await getUserMemoryContext(userId);
  // summary is just joined memories for now; later we can call LLM to compact
  const summary = context ? `O usuário ensinou:\n${context}` : null;
  await db.update(users).set({ memorySummary: summary, updatedAt: new Date() }).where(eq(users.id, userId));
  return summary;
}

export async function addMemory(input: {
  userId: string;
  content: string;
  source?: string;
}) {
  const content = input.content.trim().slice(0, 1000);
  if (content.length < 3) throw new Error("Conteúdo muito curto");
  const [row] = await db
    .insert(userMemories)
    .values({
      userId: input.userId,
      content,
      source: input.source ?? "manual",
    })
    .returning();
  // rebuild summary async (fire and forget, but await here for consistency)
  await rebuildMemorySummary(input.userId);
  return row;
}

export async function maybeLearnFromTurn(input: {
  userId: string;
  userContent: string;
  assistantContent: string;
  autoLearn: boolean;
}) {
  if (!input.autoLearn) return null;
  if (!shouldAutoLearn(input.userContent)) return null;
  const snippet = extractMemorySnippet(input.userContent, input.assistantContent);
  if (!snippet) return null;
  // dedup: check last memory
  const last = (
    await db
      .select()
      .from(userMemories)
      .where(eq(userMemories.userId, input.userId))
      .orderBy(desc(userMemories.createdAt))
      .limit(1)
  )[0];
  if (last && last.content === snippet) return null;
  return addMemory({ userId: input.userId, content: snippet, source: "auto" });
}
