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
  })
  .refine((value) => value.name !== undefined || value.onboardedAt !== undefined, {
    message: "Informe nome ou onboardedAt.",
  });
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
});
export type PatchAdminUserBody = z.infer<typeof patchAdminUserBodySchema>;

export const modelsResponseSchema = z.object({
  defaultModel: z.string(),
  fallbackModel: z.string(),
  allowedModels: z.array(z.string()),
});
export type ModelsResponse = z.infer<typeof modelsResponseSchema>;

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
  costUsd: z.string().nullable(),
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
export type SendMessageBody = z.infer<typeof sendMessageBodySchema>;
