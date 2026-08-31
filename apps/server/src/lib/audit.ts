import { auditLogs, db } from "@nexo/db";

export async function writeAudit(input: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  meta?: Record<string, unknown>;
}) {
  await db.insert(auditLogs).values({
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    meta: input.meta,
  });
}
