import { Router, type IRouter } from "express";
import { db, appointmentsTable, usersTable, doctorsTable, specialtiesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { GetAppointmentsBySpecialtyQueryParams, GetAppointmentsOverTimeQueryParams } from "@workspace/api-zod";
import { requireRole } from "../lib/auth-middleware";

const router: IRouter = Router();

router.get("/analytics/summary", requireRole("admin", "staff"), async (req, res): Promise<void> => {
  const [totals] = await db.select({
    total: sql<number>`count(*)::int`,
    pending: sql<number>`count(*) filter (where status = 'pending')::int`,
    confirmed: sql<number>`count(*) filter (where status = 'confirmed')::int`,
    cancelled: sql<number>`count(*) filter (where status = 'cancelled')::int`,
    completed: sql<number>`count(*) filter (where status = 'completed')::int`,
  }).from(appointmentsTable);

  const [patientCount] = await db.select({ count: sql<number>`count(*)::int` }).from(usersTable).where(eq(usersTable.role, "patient"));
  const [doctorCount] = await db.select({ count: sql<number>`count(*)::int` }).from(doctorsTable);
  const [specialtyCount] = await db.select({ count: sql<number>`count(*)::int` }).from(specialtiesTable);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - today.getDay());

  const [todayCount] = await db.select({ count: sql<number>`count(*)::int` }).from(appointmentsTable).where(
    sql`${appointmentsTable.scheduledAt} >= ${today.toISOString()} AND ${appointmentsTable.scheduledAt} < ${tomorrow.toISOString()}`
  );
  const [weekCount] = await db.select({ count: sql<number>`count(*)::int` }).from(appointmentsTable).where(
    sql`${appointmentsTable.scheduledAt} >= ${weekStart.toISOString()}`
  );

  res.json({
    totalAppointments: totals.total ?? 0,
    pendingAppointments: totals.pending ?? 0,
    confirmedAppointments: totals.confirmed ?? 0,
    cancelledAppointments: totals.cancelled ?? 0,
    completedAppointments: totals.completed ?? 0,
    totalPatients: patientCount?.count ?? 0,
    totalDoctors: doctorCount?.count ?? 0,
    totalSpecialties: specialtyCount?.count ?? 0,
    todayAppointments: todayCount?.count ?? 0,
    thisWeekAppointments: weekCount?.count ?? 0,
  });
});

router.get("/analytics/appointments-by-specialty", requireRole("admin", "staff"), async (req, res): Promise<void> => {
  const stats = await db
    .select({
      specialtyId: specialtiesTable.id,
      specialtyName: specialtiesTable.name,
      color: specialtiesTable.color,
      count: sql<number>`count(${appointmentsTable.id})::int`,
    })
    .from(specialtiesTable)
    .leftJoin(appointmentsTable, eq(appointmentsTable.specialtyId, specialtiesTable.id))
    .groupBy(specialtiesTable.id, specialtiesTable.name, specialtiesTable.color)
    .orderBy(sql`count(${appointmentsTable.id}) desc`);

  res.json(stats);
});

router.get("/analytics/appointments-over-time", requireRole("admin", "staff"), async (req, res): Promise<void> => {
  const query = GetAppointmentsOverTimeQueryParams.safeParse(req.query);
  const period = query.success ? (query.data.period ?? "month") : "month";

  let truncUnit = "day";
  let limit = 30;
  if (period === "week") { truncUnit = "day"; limit = 7; }
  else if (period === "month") { truncUnit = "day"; limit = 30; }
  else if (period === "year") { truncUnit = "month"; limit = 12; }

  const data = await db.select({
    date: sql<string>`date_trunc('${sql.raw(truncUnit)}', ${appointmentsTable.scheduledAt})::date::text`,
    count: sql<number>`count(*)::int`,
    confirmed: sql<number>`count(*) filter (where status = 'confirmed')::int`,
    cancelled: sql<number>`count(*) filter (where status = 'cancelled')::int`,
    pending: sql<number>`count(*) filter (where status = 'pending')::int`,
  })
    .from(appointmentsTable)
    .where(sql`${appointmentsTable.scheduledAt} >= now() - interval '${sql.raw(String(limit))} ${sql.raw(truncUnit)}s'`)
    .groupBy(sql`date_trunc('${sql.raw(truncUnit)}', ${appointmentsTable.scheduledAt})::date`)
    .orderBy(sql`date_trunc('${sql.raw(truncUnit)}', ${appointmentsTable.scheduledAt})::date`);

  res.json(data);
});

export default router;
