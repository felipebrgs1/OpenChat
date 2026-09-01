import {
  boolean,
  halfvec,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const userStatusEnum = pgEnum("user_status", ["invited", "active", "disabled"]);

export const roles = pgTable(
  "role",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    welcomeMd: text("welcome_md").notNull(),
    monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 12, scale: 4 }),
    isSystem: boolean("is_system").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("role_slug_unique").on(table.slug)],
);

export const roleStarterPrompts = pgTable("role_starter_prompt", {
  id: uuid("id").primaryKey().defaultRandom(),
  roleId: uuid("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  prompt: text("prompt").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const users = pgTable(
  "user",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    passwordHash: text("password_hash"),
    roleId: uuid("role_id").references(() => roles.id),
    isAdmin: boolean("is_admin").notNull().default(false),
    status: userStatusEnum("status").notNull().default("invited"),
    creditBalance: numeric("credit_balance", { precision: 12, scale: 4 })
      .notNull()
      .default("1000.0000"),
    monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 12, scale: 4 }),
    personalPrompt: text("personal_prompt"),
    memorySummary: text("memory_summary"),
    autoLearn: boolean("auto_learn").notNull().default(true),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("user_email_unique").on(table.email),
    index("user_role_id_idx").on(table.roleId),
  ],
);

export const refreshTokens = pgTable(
  "refresh_token",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("refresh_token_user_id_idx").on(table.userId)],
);

export const invites = pgTable(
  "invite",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id),
    invitedBy: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("invite_email_idx").on(table.email)],
);

export const organizationSettings = pgTable("organization_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  globalSystemPrompt: text("global_system_prompt").notNull(),
  defaultModel: text("default_model").notNull(),
  fallbackModel: text("fallback_model").notNull(),
  allowedModels: jsonb("allowed_models").$type<string[]>().notNull(),
  monthlyBudgetUsd: numeric("monthly_budget_usd", { precision: 12, scale: 4 }),
  openrouterBaseUrl: text("openrouter_base_url").notNull().default("https://openrouter.ai/api/v1"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system"]);

export const conversations = pgTable(
  "conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleIdSnapshot: uuid("role_id_snapshot").references(() => roles.id),
    title: text("title").notNull().default("Nova conversa"),
    model: text("model").notNull(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("conversation_user_updated_idx").on(table.userId, table.updatedAt)],
);

export const messages = pgTable(
  "message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    content: text("content").notNull().default(""),
    model: text("model"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    credits: numeric("credits", { precision: 12, scale: 4 }),
    tps: numeric("tps", { precision: 12, scale: 2 }),
    latencyMs: integer("latency_ms"),
    finishReason: text("finish_reason"),
    error: text("error"),
    sources: jsonb("sources").$type<unknown[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("message_conversation_created_idx").on(table.conversationId, table.createdAt)],
);

export const feedbackRatingEnum = pgEnum("feedback_rating", ["util", "incorreta", "desatualizada", "sem_fonte"]);

export const knowledgeFeedback = pgTable(
  "knowledge_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: feedbackRatingEnum("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_feedback_message_idx").on(table.messageId),
    index("knowledge_feedback_user_idx").on(table.userId),
    index("knowledge_feedback_rating_idx").on(table.rating),
  ],
);

export const usageEvents = pgTable(
  "usage_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    credits: numeric("credits", { precision: 12, scale: 4 }),
    tps: numeric("tps", { precision: 12, scale: 2 }),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("usage_event_user_created_idx").on(table.userId, table.createdAt)],
);

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    amount: numeric("amount", { precision: 12, scale: 4 }).notNull(),
    balanceAfter: numeric("balance_after", { precision: 12, scale: 4 }).notNull(),
    reason: text("reason").notNull(),
    model: text("model"),
    conversationId: uuid("conversation_id").references(() => conversations.id, {
      onDelete: "set null",
    }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    tps: numeric("tps", { precision: 12, scale: 2 }),
    latencyMs: integer("latency_ms"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("credit_ledger_user_created_idx").on(table.userId, table.createdAt)],
);

export const userMemories = pgTable(
  "user_memory",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    source: text("source").notNull().default("manual"), // manual | auto | feedback
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("user_memory_user_created_idx").on(table.userId, table.createdAt)],
);

export const knowledgeVisibilityEnum = pgEnum("knowledge_visibility", ["all", "by_role"]);

export const knowledgeCollections = pgTable(
  "knowledge_collection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    visibility: knowledgeVisibilityEnum("visibility").notNull().default("by_role"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [uniqueIndex("knowledge_collection_slug_unique").on(table.slug)],
);

export const knowledgeRoles = pgTable(
  "knowledge_role",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.roleId] }),
    index("knowledge_role_role_id_idx").on(table.roleId),
  ],
);

export const knowledgeDocumentRoles = pgTable(
  "knowledge_document_role",
  {
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.documentId, table.roleId] }),
    index("knowledge_document_role_role_id_idx").on(table.roleId),
  ],
);

export const documentStatusEnum = pgEnum("document_status", ["draft", "published", "obsolete"]);

export const knowledgeDocuments = pgTable(
  "knowledge_document",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    sourceType: text("source_type").notNull().default("markdown"),
    filename: text("filename"),
    mime: text("mime"),
    bodyMd: text("body_md").notNull(),
    checksum: text("checksum"),
    createdBy: uuid("created_by").references(() => users.id),
    ownerId: uuid("owner_id").references(() => users.id),
    status: documentStatusEnum("status").notNull().default("published"),
    visibility: knowledgeVisibilityEnum("visibility").notNull().default("by_role"),
    reviewAt: timestamp("review_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("knowledge_document_collection_idx").on(table.collectionId),
    index("knowledge_document_owner_idx").on(table.ownerId),
    index("knowledge_document_status_idx").on(table.status),
    index("knowledge_document_visibility_idx").on(table.visibility),
    index("knowledge_document_review_idx").on(table.reviewAt),
  ],
);

export const ingestionStatusEnum = pgEnum("ingestion_status", [
  "queued",
  "processing",
  "ready",
  "failed",
]);

export const ingestionStageEnum = pgEnum("ingestion_stage", [
  "upload",
  "validation",
  "extraction",
  "chunking",
  "embedding",
  "indexing",
]);

export const knowledgeDocumentRevisions = pgTable(
  "knowledge_document_revision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    checksum: text("checksum").notNull(),
    extractedMarkdown: text("extracted_markdown"),
    extractionMetadata: jsonb("extraction_metadata").$type<Record<string, unknown>>(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (table) => [
    index("knowledge_revision_document_idx").on(table.documentId),
    uniqueIndex("knowledge_revision_document_number_unique").on(
      table.documentId,
      table.revisionNumber,
    ),
  ],
);

export const knowledgeIngestions = pgTable(
  "knowledge_ingestion",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentRevisionId: uuid("document_revision_id")
      .notNull()
      .references(() => knowledgeDocumentRevisions.id, { onDelete: "cascade" }),
    status: ingestionStatusEnum("status").notNull().default("queued"),
    stage: ingestionStageEnum("stage").notNull().default("upload"),
    attempts: integer("attempts").notNull().default(0),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_ingestion_revision_idx").on(table.documentRevisionId),
    index("knowledge_ingestion_status_idx").on(table.status),
  ],
);

export const auditLogs = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const knowledgeChunks = pgTable(
  "knowledge_chunk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => knowledgeDocuments.id, { onDelete: "cascade" }),
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => knowledgeCollections.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id").references(() => knowledgeDocumentRevisions.id, {
      onDelete: "set null",
    }),
    chunkIndex: integer("chunk_index").notNull(),
    content: text("content").notNull(),
    embedding: halfvec("embedding", { dimensions: 2560 }),
    // R2/R3: evolução para busca híbrida e rastreabilidade
    page: integer("page"),
    heading: text("heading"),
    startOffset: integer("start_offset"),
    endOffset: integer("end_offset"),
    tokenCount: integer("token_count"),
    // R4: vetor textual para busca híbrida (gerado via trigger tsvector)
    // drizzle não tem tipo tsvector nativo, mapeamos como text para não quebrar, mas coluna real é tsvector
    searchVector: text("search_vector"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("knowledge_chunk_document_idx").on(table.documentId),
    index("knowledge_chunk_collection_idx").on(table.collectionId),
    index("knowledge_chunk_revision_idx").on(table.revisionId),
  ],
);

export const ragCaseCategoryEnum = pgEnum("rag_case_category", [
  "factual",
  "procedural",
  "negative",
  "access_denied",
]);

export const ragEvaluationCases = pgTable(
  "rag_evaluation_case",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    question: text("question").notNull(),
    category: ragCaseCategoryEnum("category").notNull(),
    // cargo que pode responder; null = todos, mas para teste de isolamento usamos slugs específicos
    allowedRoleSlug: text("allowed_role_slug"),
    // fonte esperada — coleção e documento que deve aparecer no top-k
    expectedCollectionSlug: text("expected_collection_slug"),
    expectedDocumentTitle: text("expected_document_title"),
    // critérios textuais que a resposta deve conter (keywords / regex simples)
    expectedKeywords: jsonb("expected_keywords").$type<string[]>(),
    expectedAnswerCriteria: text("expected_answer_criteria"),
    // tags livres para filtrar no runner (sigla, numero, etc)
    tags: jsonb("tags").$type<string[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("rag_case_category_idx").on(table.category)],
);

export const ragEvaluationRuns = pgTable("rag_evaluation_run", {
  id: uuid("id").primaryKey().defaultRandom(),
  pipelineVersion: text("pipeline_version").notNull(),
  gitCommit: text("git_commit"),
  params: jsonb("params").$type<Record<string, unknown>>(),
  // resumo agregado: { total, hitRate, negativeCorrectRate, accessDeniedCorrectRate, p50, p95, totalCostUsd }
  summary: jsonb("summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const ragEvaluationResults = pgTable(
  "rag_evaluation_result",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => ragEvaluationRuns.id, { onDelete: "cascade" }),
    caseId: uuid("case_id")
      .notNull()
      .references(() => ragEvaluationCases.id, { onDelete: "cascade" }),
    // métricas por caso
    hit: boolean("hit"),
    // null para negative/access_denied onde hit não se aplica da mesma forma
    retrievedChunkIds: jsonb("retrieved_chunk_ids").$type<string[]>(),
    retrievedTitles: jsonb("retrieved_titles").$type<string[]>(),
    latencyMs: integer("latency_ms"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    error: text("error"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("rag_result_run_idx").on(table.runId),
    index("rag_result_case_idx").on(table.caseId),
  ],
);
