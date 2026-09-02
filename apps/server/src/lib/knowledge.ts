import { and, desc, eq, exists, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  knowledgeCollections,
  knowledgeDocumentRoles,
  knowledgeDocuments,
  knowledgeRoles,
} from "@nexo/db";

export const KNOWLEDGE_TOKEN_CAP = 4000;

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

/**
 * Collections acessíveis para um cargo: visibilidade "all" ou vinculadas
 * explicitamente em knowledge_role. Admin usa loadAllCollections.
 */
export async function loadCollectionsForRole(roleId: string) {
  return db
    .select()
    .from(knowledgeCollections)
    .where(
      and(
        isNull(knowledgeCollections.deletedAt),
        or(
          eq(knowledgeCollections.visibility, "all"),
          exists(
            db
              .select({ one: knowledgeRoles.collectionId })
              .from(knowledgeRoles)
              .where(
                and(
                  eq(knowledgeRoles.roleId, roleId),
                  eq(knowledgeRoles.collectionId, knowledgeCollections.id),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(desc(knowledgeCollections.updatedAt));
}

export async function loadAllCollections() {
  return db
    .select()
    .from(knowledgeCollections)
    .where(isNull(knowledgeCollections.deletedAt))
    .orderBy(desc(knowledgeCollections.updatedAt));
}

export async function loadRoleLinks(collectionIds: string[]) {
  if (collectionIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(knowledgeRoles)
    .where(inArray(knowledgeRoles.collectionId, collectionIds));
}

export async function loadDocuments(collectionIds: string[]) {
  if (collectionIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        inArray(knowledgeDocuments.collectionId, collectionIds),
        isNull(knowledgeDocuments.deletedAt),
      ),
    )
    .orderBy(desc(knowledgeDocuments.updatedAt));
}

/**
 * Docs legíveis no nível de documento para um cargo (sem usuário — drafts
 * ficam sempre de fora; o dono consulta o próprio doc pela API/RAG).
 * Mesma política de lib/acl.ts: coleção AND (doc 'all' OU cargo do doc).
 */
export async function loadDocumentsForRole(collectionIds: string[], roleId: string) {
  if (collectionIds.length === 0) {
    return [];
  }
  return db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        inArray(knowledgeDocuments.collectionId, collectionIds),
        isNull(knowledgeDocuments.deletedAt),
        eq(knowledgeDocuments.status, "published"),
        or(
          eq(knowledgeDocuments.visibility, "all"),
          exists(
            db
              .select({ one: knowledgeDocumentRoles.documentId })
              .from(knowledgeDocumentRoles)
              .where(
                and(
                  eq(knowledgeDocumentRoles.documentId, knowledgeDocuments.id),
                  eq(knowledgeDocumentRoles.roleId, roleId),
                ),
              ),
          ),
        ),
      ),
    )
    .orderBy(desc(knowledgeDocuments.updatedAt));
}

/**
 * Docs do cargo em ordem updated_at desc, docs inteiros até caber no cap
 * (NEXO.md §14 lote 4: cap 4k tokens, sem RAG).
 */
export async function buildKnowledgeBlock(roleId: string) {
  const collections = await loadCollectionsForRole(roleId);
  if (collections.length === 0) {
    return "";
  }
  // política única de documento: 'all' ou cargo vinculado; drafts não saem aqui
  const docs = await loadDocumentsForRole(
    collections.map((c) => c.id),
    roleId,
  );
  if (docs.length === 0) {
    return "";
  }

  const used: string[] = [];
  let tokens = 0;
  for (const doc of docs) {
    const part = `### ${doc.title}\n${doc.bodyMd}`;
    const cost = estimateTokens(part);
    if (used.length > 0 && tokens + cost > KNOWLEDGE_TOKEN_CAP) {
      break;
    }
    // o primeiro doc entra mesmo se estourar o cap sozinho
    used.push(part);
    tokens += cost;
  }
  if (used.length === 0) {
    return "";
  }

  return `[CONHECIMENTO]
${used.join("\n\n")}`;
}
