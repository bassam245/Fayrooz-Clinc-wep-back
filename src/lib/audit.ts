import { db, auditLogTable } from "@workspace/db";
import { Request } from "express";

export async function logAudit(
  req: Request,
  action: string,
  entity: string,
  entityId?: number | null,
  details?: string | null,
) {
  const user = (req as any).session?.user;
  await db.insert(auditLogTable).values({
    userId: user?.id ?? null,
    userName: user?.name ?? null,
    userRole: user?.role ?? null,
    action,
    entity,
    entityId: entityId ?? null,
    details: details ?? null,
    ipAddress: req.ip ?? null,
  });
}
