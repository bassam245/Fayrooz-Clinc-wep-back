import { Router, type IRouter } from "express";
import { db, auditLogTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { ListAuditLogQueryParams } from "@workspace/api-zod";
import { requireRole } from "../lib/auth-middleware";

const router: IRouter = Router();

router.get("/audit-log", requireRole("admin"), async (req, res): Promise<void> => {
  const query = ListAuditLogQueryParams.safeParse(req.query);
  const limit = query.success ? (query.data.limit ?? 50) : 50;
  const offset = query.success ? (query.data.offset ?? 0) : 0;

  const conditions: any[] = [];
  if (query.success && query.data.userId) {
    conditions.push(eq(auditLogTable.userId, query.data.userId));
  }
  if (query.success && query.data.action) {
    conditions.push(eq(auditLogTable.action, query.data.action));
  }

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLogTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const entries = await db
    .select()
    .from(auditLogTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${auditLogTable.createdAt} desc`)
    .limit(limit)
    .offset(offset);

  res.json({
    entries,
    total: countRow?.count ?? 0,
    limit,
    offset,
  });
});

export default router;
