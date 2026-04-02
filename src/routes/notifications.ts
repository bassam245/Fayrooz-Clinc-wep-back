import { Router, type IRouter } from "express";
import { db, notificationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { ListNotificationsQueryParams } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth-middleware";

const router: IRouter = Router();

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const sessionUser = (req as any).session?.user;
  const query = ListNotificationsQueryParams.safeParse(req.query);

  const conditions: any[] = [eq(notificationsTable.userId, sessionUser.id)];
  if (query.success && query.data.unreadOnly) {
    conditions.push(eq(notificationsTable.isRead, false));
  }

  const notifications = await db
    .select()
    .from(notificationsTable)
    .where(and(...conditions))
    .orderBy(notificationsTable.createdAt);

  res.json(notifications.reverse());
});

router.post("/notifications/:id/read", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const sessionUser = (req as any).session?.user;

  const [notif] = await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(and(eq(notificationsTable.id, id), eq(notificationsTable.userId, sessionUser.id)))
    .returning();

  if (!notif) {
    res.status(404).json({ error: "Notification not found" });
    return;
  }
  res.json(notif);
});

router.post("/notifications/read-all", requireAuth, async (req, res): Promise<void> => {
  const sessionUser = (req as any).session?.user;

  await db
    .update(notificationsTable)
    .set({ isRead: true })
    .where(eq(notificationsTable.userId, sessionUser.id));

  res.json({ success: true, message: "All notifications marked as read" });
});

export default router;
