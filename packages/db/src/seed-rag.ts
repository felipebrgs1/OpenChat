import { db } from "./index";
import { ragEvaluationCases } from "./schema";
import { RAG_CASE_SEEDS } from "./rag-cases";

export async function seedRagCases() {
  let inserted = 0;
  for (const seed of RAG_CASE_SEEDS) {
    const exists = await db
      .select()
      .from(ragEvaluationCases)
      .then((rows) => rows.find((r) => r.question === seed.question));
    if (exists) continue;
    await db.insert(ragEvaluationCases).values({
      question: seed.question,
      category: seed.category,
      allowedRoleSlug: seed.allowedRoleSlug,
      expectedCollectionSlug: seed.expectedCollectionSlug,
      expectedDocumentTitle: seed.expectedDocumentTitle,
      expectedKeywords: seed.expectedKeywords,
      expectedAnswerCriteria: seed.expectedAnswerCriteria,
      tags: seed.tags,
    });
    inserted += 1;
  }
  console.log(`seedRagCases: ${inserted} novos, total ${RAG_CASE_SEEDS.length} seeds`);
  return inserted;
}

if (import.meta.main) {
  await seedRagCases();
  process.exit(0);
}
