import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const errorCodeSchema = z.enum([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "ROLE_REQUIRED",
  "VALIDATION",
  "NOT_FOUND",
  "BUDGET_EXCEEDED",
  "LLM_UPSTREAM",
  "CONFLICT",
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: errorCodeSchema,
    message: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const userStatusSchema = z.enum(["invited", "active", "disabled"]);
export type UserStatus = z.infer<typeof userStatusSchema>;

export const publicUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  email: z.string().email(),
  isAdmin: z.boolean(),
  roleId: z.string().uuid().nullable(),
  status: userStatusSchema,
  onboardedAt: z.string().nullable(),
  image: z.string().nullable(),
  creditBalance: z.string(),
  monthlyBudgetUsd: z.string().nullable(),
  personalPrompt: z.string().nullable(),
  memorySummary: z.string().nullable(),
  autoLearn: z.boolean(),
});
export type PublicUser = z.infer<typeof publicUserSchema>;

export const starterSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  prompt: z.string(),
  sortOrder: z.number().int(),
});
export type Starter = z.infer<typeof starterSchema>;

export const roleSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  isSystem: z.boolean(),
});
export type RoleSummary = z.infer<typeof roleSummarySchema>;

export const roleDetailSchema = roleSummarySchema.extend({
  systemPrompt: z.string(),
  welcomeMd: z.string(),
  monthlyBudgetUsd: z.string().nullable(),
  starters: z.array(starterSchema),
});
export type RoleDetail = z.infer<typeof roleDetailSchema>;

export const tokenResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresIn: z.number().int(),
  user: publicUserSchema,
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginBody = z.infer<typeof loginBodySchema>;

export const refreshBodySchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshBody = z.infer<typeof refreshBodySchema>;

export const logoutBodySchema = z.object({
  refreshToken: z.string().min(1).optional(),
});
export type LogoutBody = z.infer<typeof logoutBodySchema>;

export const acceptInviteBodySchema = z.object({
  name: z.string().min(1),
  password: z.string().min(8),
});
export type AcceptInviteBody = z.infer<typeof acceptInviteBodySchema>;

export const createInviteBodySchema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid().optional(),
});
export type CreateInviteBody = z.infer<typeof createInviteBodySchema>;

export const inviteSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  roleId: z.string().uuid(),
  roleName: z.string(),
  expiresAt: z.string(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const createInviteResponseSchema = inviteSchema.extend({
  token: z.string(),
  acceptPath: z.string(),
});
export type CreateInviteResponse = z.infer<typeof createInviteResponseSchema>;

export const meResponseSchema = z.object({
  user: publicUserSchema,
  role: roleDetailSchema.nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const patchMeBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    onboardedAt: z.string().nullable().optional(),
    personalPrompt: z.string().max(2000).nullable().optional(),
    autoLearn: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.onboardedAt !== undefined ||
      value.personalPrompt !== undefined ||
      value.autoLearn !== undefined,
    {
      message: "Informe ao menos um campo.",
    },
  );
export type PatchMeBody = z.infer<typeof patchMeBodySchema>;

export const createRoleBodySchema = z.object({
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  welcomeMd: z.string().min(1),
});
export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;

export const patchRoleBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  systemPrompt: z.string().min(1).optional(),
  welcomeMd: z.string().min(1).optional(),
  monthlyBudgetUsd: z.number().nullable().optional(),
});
export type PatchRoleBody = z.infer<typeof patchRoleBodySchema>;

export const putStartersBodySchema = z.object({
  starters: z.array(
    z.object({
      title: z.string().min(1),
      prompt: z.string().min(1),
      sortOrder: z.number().int().optional(),
    }),
  ),
});
export type PutStartersBody = z.infer<typeof putStartersBodySchema>;

export const adminUserSchema = publicUserSchema.extend({
  role: roleSummarySchema.nullable(),
});
export type AdminUser = z.infer<typeof adminUserSchema>;

export const patchAdminUserBodySchema = z.object({
  roleId: z.string().uuid().nullable().optional(),
  status: z.enum(["active", "disabled"]).optional(),
  isAdmin: z.boolean().optional(),
  monthlyBudgetUsd: z.number().nullable().optional(),
});
export type PatchAdminUserBody = z.infer<typeof patchAdminUserBodySchema>;

export const modelOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export type ModelOption = z.infer<typeof modelOptionSchema>;

export const modelsResponseSchema = z.object({
  defaultModel: z.string(),
  fallbackModel: z.string(),
  allowedModels: z.array(z.string()),
  models: z.array(modelOptionSchema),
});
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;

export const patchAdminSettingsBodySchema = z.object({
  defaultModel: z.string().min(1).optional(),
  fallbackModel: z.string().min(1).optional(),
  allowedModels: z.array(z.string().min(1)).min(1).optional(),
  globalSystemPrompt: z.string().min(1).optional(),
  monthlyBudgetUsd: z.number().nullable().optional(),
});
export type PatchAdminSettingsBody = z.infer<typeof patchAdminSettingsBodySchema>;

export const adminSettingsSchema = z.object({
  name: z.string(),
  defaultModel: z.string(),
  fallbackModel: z.string(),
  allowedModels: z.array(z.string()),
  globalSystemPrompt: z.string(),
  monthlyBudgetUsd: z.string().nullable(),
  catalog: z.array(modelOptionSchema),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const adminUsageBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  messages: z.number().int(),
  promptTokens: z.number().int(),
  completionTokens: z.number().int(),
  costUsd: z.string(),
  credits: z.string(),
});
export type AdminUsageBucket = z.infer<typeof adminUsageBucketSchema>;

export const adminUsageResponseSchema = z.object({
  since: z.string(),
  until: z.string(),
  total: adminUsageBucketSchema,
  byUser: z.array(adminUsageBucketSchema),
  byRole: z.array(
    adminUsageBucketSchema.extend({
      budgetUsd: z.string().nullable(),
    }),
  ),
  byModel: z.array(adminUsageBucketSchema),
  byDay: z.array(adminUsageBucketSchema),
});
export type AdminUsageResponse = z.infer<typeof adminUsageResponseSchema>;

export const conversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  model: z.string(),
  roleIdSnapshot: z.string().uuid().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const createConversationBodySchema = z.object({
  model: z.string().min(1).optional(),
});
export type CreateConversationBody = z.infer<typeof createConversationBodySchema>;

export const patchConversationBodySchema = z
  .object({
    title: z.string().min(1).optional(),
    archived: z.boolean().optional(),
  })
  .refine((value) => value.title !== undefined || value.archived !== undefined, {
    message: "Informe title ou archived.",
  });
export type PatchConversationBody = z.infer<typeof patchConversationBodySchema>;

export const messageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
  model: z.string().nullable(),
  promptTokens: z.number().int().nullable(),
  completionTokens: z.number().int().nullable(),
  credits: z.string().nullable(),
  tps: z.number().nullable(),
  latencyMs: z.number().int().nullable(),
  finishReason: z.string().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type ChatMessage = z.infer<typeof messageSchema>;

export const sendMessageBodySchema = z.object({
  content: z.string().min(1),
  model: z.string().min(1).optional(),
  starterId: z.string().uuid().nullable().optional(),
});

export const CREDITS_PER_USD = 1000;

export const creditBalanceSchema = z.object({
  balance: z.string(),
});
export type CreditBalance = z.infer<typeof creditBalanceSchema>;

export const creditLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  amount: z.string(),
  balanceAfter: z.string(),
  reason: z.string(),
  model: z.string().nullable(),
  conversationId: z.string().uuid().nullable(),
  messageId: z.string().uuid().nullable(),
  promptTokens: z.number().int().nullable(),
  completionTokens: z.number().int().nullable(),
  tps: z.number().nullable(),
  latencyMs: z.number().int().nullable(),
  createdAt: z.string(),
});
export type CreditLedgerEntry = z.infer<typeof creditLedgerEntrySchema>;

export const adjustCreditsBodySchema = z.object({
  amount: z.number(),
  reason: z.string().min(1).optional(),
});
export type AdjustCreditsBody = z.infer<typeof adjustCreditsBodySchema>;

export const userMemorySchema = z.object({
  id: z.string().uuid(),
  content: z.string(),
  source: z.string(),
  createdAt: z.string(),
});
export type UserMemory = z.infer<typeof userMemorySchema>;

export const createMemoryBodySchema = z.object({
  content: z.string().min(3).max(1000),
  source: z.enum(["manual", "feedback"]).optional(),
});
export type CreateMemoryBody = z.infer<typeof createMemoryBodySchema>;

export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;

export const knowledgeVisibilitySchema = z.enum(["all", "by_role"]);
export type KnowledgeVisibility = z.infer<typeof knowledgeVisibilitySchema>;

export const knowledgeCollectionSummarySchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  visibility: knowledgeVisibilitySchema,
  documentCount: z.number().int(),
  roleIds: z.array(z.string().uuid()),
  updatedAt: z.string(),
});
export type KnowledgeCollectionSummary = z.infer<typeof knowledgeCollectionSummarySchema>;

export const knowledgeDocumentSchema = z.object({
  id: z.string().uuid(),
  collectionId: z.string().uuid(),
  title: z.string(),
  sourceType: z.string(),
  filename: z.string().nullable(),
  mime: z.string().nullable(),
  bodyMd: z.string(),
  updatedAt: z.string(),
});
export type KnowledgeDocument = z.infer<typeof knowledgeDocumentSchema>;

export const knowledgeCollectionDetailSchema = knowledgeCollectionSummarySchema.extend({
  documents: z.array(knowledgeDocumentSchema),
});
export type KnowledgeCollectionDetail = z.infer<typeof knowledgeCollectionDetailSchema>;

export const createKnowledgeCollectionBodySchema = z.object({
  slug: z
    .string()
    .min(2)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  description: z.string().optional(),
  visibility: knowledgeVisibilitySchema.optional(),
  roleIds: z.array(z.string().uuid()).optional(),
});
export type CreateKnowledgeCollectionBody = z.infer<typeof createKnowledgeCollectionBodySchema>;

export const patchKnowledgeCollectionBodySchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    visibility: knowledgeVisibilitySchema.optional(),
    roleIds: z.array(z.string().uuid()).optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.description !== undefined ||
      value.visibility !== undefined ||
      value.roleIds !== undefined,
    { message: "Informe ao menos um campo." },
  );
export type PatchKnowledgeCollectionBody = z.infer<typeof patchKnowledgeCollectionBodySchema>;

export const createKnowledgeDocumentBodySchema = z.object({
  title: z.string().min(1),
  bodyMd: z.string().min(1),
});
export type CreateKnowledgeDocumentBody = z.infer<typeof createKnowledgeDocumentBodySchema>;

export const patchKnowledgeDocumentBodySchema = z
  .object({
    title: z.string().min(1).optional(),
    bodyMd: z.string().min(1).optional(),
  })
  .refine((value) => value.title !== undefined || value.bodyMd !== undefined, {
    message: "Informe title ou bodyMd.",
  });
export type PatchKnowledgeDocumentBody = z.infer<typeof patchKnowledgeDocumentBodySchema>;
