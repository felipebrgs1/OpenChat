import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
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
    creditBalance: numeric("credit_balance", { precision: 12, scale: 4 }).notNull().default("1000.0000"),
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("message_conversation_created_idx").on(table.conversationId, table.createdAt)],
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

export const auditLogs = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").references(() => users.id),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
