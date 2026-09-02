/**
 * Política ÚNICA de autorização da base de conhecimento (coleção + documento).
 *
 * Reutilizada por: listagem, detalhe, download de revisão, ingestão e retrieval
 * RAG (via ragPermissionSql). Nunca combine permissões de coleção e documento
 * com OR — a regra de documento restringe, não amplia.
 *
 * Regras (default deny):
 *  1. Admin: acesso total.
 *  2. Documento/coleção com deletedAt: negado para todos.
 *  3. Dono do documento: acesso garantido ao próprio documento (leitura e gestão).
 *  4. Demais usuários precisam de AMBOS:
 *     a. acesso à coleção  → visibility 'all' OU cargo vinculado (knowledge_role)
 *     b. acesso ao doc     → visibility 'all' OU cargo vinculado (knowledge_document_role)
 *  5. status 'draft': somente admin e dono — rascunho nunca vaza por cargo.
 *  6. 'obsolete': segue as regras de leitura normais (excluído do RAG pelo
 *     filtro de status='published' na query).
 *  7. Usuário sem cargo (e não-admin, não-dono): negado.
 *
 * No retrieval (ragPermissionSql) a semântica é idêntica, exceto:
 *  - drafts nunca são recuperáveis via RAG (nem pelo dono);
 *  - o dono recupera apenas documentos publicados (rascunho entra pela API).
 */

import { eq, sql, type SQL } from "drizzle-orm";
import {
  db,
  knowledgeCollections,
  knowledgeDocumentRoles,
  knowledgeDocuments,
  knowledgeRoles,
} from "@nexo/db";

import { notFound } from "./errors";
import type { AuthUser } from "../middleware/auth";

export type CollectionRow = typeof knowledgeCollections.$inferSelect;
export type DocumentRow = typeof knowledgeDocuments.$inferSelect;

// ---------------------------------------------------------------------------
// Regras puras (sem I/O) — testáveis unitariamente
// ---------------------------------------------------------------------------

/** Regra de nível de coleção: visibility 'all' ou cargo vinculado. */
export function collectionReadable(
  user: Pick<AuthUser, "isAdmin" | "roleId">,
  collection: Pick<CollectionRow, "deletedAt" | "visibility">,
  collectionRoleIds: string[],
): boolean {
  if (user.isAdmin) return true;
  if (collection.deletedAt) return false;
  if (collection.visibility === "all") return true;
  return !!user.roleId && collectionRoleIds.includes(user.roleId);
}

/** Regra de nível de documento — assume que a coleção já foi autorizada. */
export function documentLevelReadable(
  user: Pick<AuthUser, "id" | "isAdmin" | "roleId">,
  doc: Pick<DocumentRow, "ownerId" | "status" | "visibility">,
  documentRoleIds: string[],
): boolean {
  if (user.isAdmin) return true;
  if (doc.ownerId === user.id) return true;
  // rascunho nunca vaza por cargo — só admin e dono
  if (doc.status === "draft") return false;
  if (doc.visibility === "all") return true;
  return !!user.roleId && documentRoleIds.includes(user.roleId);
}

/** Política completa: admin OU dono OU (coleção E documento). */
export function documentReadable(
  user: Pick<AuthUser, "id" | "isAdmin" | "roleId">,
  doc: Pick<DocumentRow, "deletedAt" | "ownerId" | "status" | "visibility">,
  collection: Pick<CollectionRow, "deletedAt" | "visibility">,
  collectionRoleIds: string[],
  documentRoleIds: string[],
): boolean {
  if (user.isAdmin) return true;
  if (doc.deletedAt || collection.deletedAt) return false;
  if (doc.ownerId === user.id) return true;
  if (doc.status === "draft") return false;
  return (
    collectionReadable(user, collection, collectionRoleIds) &&
    documentLevelReadable(user, doc, documentRoleIds)
  );
}

// ---------------------------------------------------------------------------
// Acesso a dados com a política aplicada
// ---------------------------------------------------------------------------

export async function loadCollectionRoleIds(collectionId: string): Promise<string[]> {
  const links = await db
    .select()
    .from(knowledgeRoles)
    .where(eq(knowledgeRoles.collectionId, collectionId));
  return links.map((l) => l.roleId);
}

export async function loadDocumentRoleIds(documentId: string): Promise<string[]> {
  const links = await db
    .select()
    .from(knowledgeDocumentRoles)
    .where(eq(knowledgeDocumentRoles.documentId, documentId));
  return links.map((l) => l.roleId);
}

export async function loadCollectionById(collectionId: string): Promise<CollectionRow | null> {
  return (
    (
      await db.select().from(knowledgeCollections).where(eq(knowledgeCollections.id, collectionId))
    )[0] ?? null
  );
}

export async function loadDocumentById(documentId: string): Promise<DocumentRow | null> {
  return (
    (await db.select().from(knowledgeDocuments).where(eq(knowledgeDocuments.id, documentId)))[0] ??
    null
  );
}

/**
 * Carrega documento + coleção e aplica a política completa de leitura.
 * 404 (não 403) para não permitir enumeração de documentos restritos.
 */
export async function loadDocumentForRead(
  user: AuthUser,
  documentId: string,
): Promise<{ doc: DocumentRow; collection: CollectionRow }> {
  const doc = await loadDocumentById(documentId);
  if (!doc || doc.deletedAt) throw notFound("Documento não encontrado.");
  const collection = await loadCollectionById(doc.collectionId);
  if (!collection || collection.deletedAt) throw notFound("Documento não encontrado.");
  const [collectionRoleIds, documentRoleIds] = await Promise.all([
    user.isAdmin ? Promise.resolve([]) : loadCollectionRoleIds(collection.id),
    user.isAdmin ? Promise.resolve([]) : loadDocumentRoleIds(doc.id),
  ]);
  if (!documentReadable(user, doc, collection, collectionRoleIds, documentRoleIds)) {
    throw notFound("Documento não encontrado.");
  }
  return { doc, collection };
}

/** Filtra em lote os documentos legíveis para o usuário (listagem). */
export async function filterReadableDocuments(
  user: AuthUser,
  docs: DocumentRow[],
  collections: CollectionRow[],
): Promise<DocumentRow[]> {
  if (docs.length === 0) return [];
  if (user.isAdmin) return docs.filter((d) => !d.deletedAt);

  const colIds = [...new Set(docs.map((d) => d.collectionId))];
  const docIds = docs.map((d) => d.id);
  const [colRoleLinks, docRoleLinks] = await Promise.all([
    db
      .select()
      .from(knowledgeRoles)
      .where(
        sql`${knowledgeRoles.collectionId} IN (${sql.join(
          colIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      ),
    db
      .select()
      .from(knowledgeDocumentRoles)
      .where(
        sql`${knowledgeDocumentRoles.documentId} IN (${sql.join(
          docIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      ),
  ]);
  const colRoles = new Map<string, string[]>();
  for (const l of colRoleLinks) {
    const arr = colRoles.get(l.collectionId) ?? [];
    arr.push(l.roleId);
    colRoles.set(l.collectionId, arr);
  }
  const docRoles = new Map<string, string[]>();
  for (const l of docRoleLinks) {
    const arr = docRoles.get(l.documentId) ?? [];
    arr.push(l.roleId);
    docRoles.set(l.documentId, arr);
  }
  const colById = new Map(collections.map((c) => [c.id, c]));

  return docs.filter((doc) => {
    const col = colById.get(doc.collectionId);
    if (!col) return false;
    return documentReadable(user, doc, col, colRoles.get(col.id) ?? [], docRoles.get(doc.id) ?? []);
  });
}

// ---------------------------------------------------------------------------
// Fragmento SQL para o retrieval RAG (mesma política, mesma semântica)
// ---------------------------------------------------------------------------

/**
 * WHERE de permissão do RAG. Requer aliases: kd (knowledge_document),
 * kcol (knowledge_collection). Combina coleção E documento com AND —
 * a restrição por documento nunca é contornada pelo acesso à coleção.
 * O filtro kd.status = 'published' fica no JOIN (drafts/obsolete nunca
 * saem via RAG, nem para dono).
 */
export function ragPermissionSql(opts: {
  isAdmin: boolean;
  roleId: string | null;
  userId: string | null;
}): SQL {
  if (opts.isAdmin) return sql`TRUE`;
  if (!opts.roleId) return sql`FALSE`;
  const ownerCheck = opts.userId ? sql`kd.owner_id = ${opts.userId}::uuid` : sql`FALSE`;
  // Coleção: 'all' ou cargo vinculado.
  const collectionOk = sql`(
    kcol.visibility = 'all'
    OR EXISTS (SELECT 1 FROM knowledge_role kr WHERE kr.collection_id = kcol.id AND kr.role_id = ${opts.roleId}::uuid)
  )`;
  // Documento: 'all' ou cargo vinculado (AND com a coleção — não OR).
  const documentOk = sql`(
    kd.visibility = 'all'
    OR EXISTS (SELECT 1 FROM knowledge_document_role kdr WHERE kdr.document_id = kd.id AND kdr.role_id = ${opts.roleId}::uuid)
  )`;
  return sql`(${ownerCheck} OR (${collectionOk} AND ${documentOk}))`;
}
