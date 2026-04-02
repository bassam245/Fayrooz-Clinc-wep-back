import { db, notificationsTable } from "@workspace/db";

export async function createNotification(
  userId: number,
  title: string,
  message: string,
  type: string,
  appointmentId?: number | null,
) {
  await db.insert(notificationsTable).values({
    userId,
    title,
    message,
    type,
    appointmentId: appointmentId ?? null,
    isRead: false,
  });
}
