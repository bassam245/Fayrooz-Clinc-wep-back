import { Router, type IRouter } from "express";
import { db, appointmentsTable, doctorsTable, usersTable, workingHoursTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { GetWeeklyScheduleQueryParams, UpdateWorkingHoursBody } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth-middleware";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/schedule/weekly", requireRole("staff", "admin"), async (req, res): Promise<void> => {
  const query = GetWeeklyScheduleQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "weekStart is required" });
    return;
  }

  const weekStart = new Date(query.data.weekStart);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const conditions: any[] = [
    sql`${appointmentsTable.scheduledAt} >= ${weekStart.toISOString()}`,
    sql`${appointmentsTable.scheduledAt} < ${weekEnd.toISOString()}`,
  ];

  if (query.data.doctorId) {
    conditions.push(eq(appointmentsTable.doctorId, query.data.doctorId));
  }

  const appointments = await db
    .select({
      id: appointmentsTable.id,
      scheduledAt: appointmentsTable.scheduledAt,
      endAt: appointmentsTable.endAt,
      status: appointmentsTable.status,
      patientName: usersTable.name,
      doctorId: appointmentsTable.doctorId,
      doctorName: sql<string>`(select u.name from users u join doctors d on d.user_id = u.id where d.id = appointments.doctor_id limit 1)`,
    })
    .from(appointmentsTable)
    .innerJoin(usersTable, eq(appointmentsTable.patientId, usersTable.id))
    .where(and(...conditions));

  const workingDays = await db.select().from(workingHoursTable).where(eq(workingHoursTable.isActive, true));

  const days: any[] = [];
  for (let i = 0; i < 7; i++) {
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + i);
    const dayOfWeek = dayDate.getDay();
    const dateStr = dayDate.toISOString().split("T")[0];

    const workingDay = workingDays.find((d) => d.dayOfWeek === dayOfWeek);
    const dayAppointments = appointments.filter((a) => {
      const d = new Date(a.scheduledAt);
      return d.toISOString().split("T")[0] === dateStr;
    });

    const slots: any[] = [];

    if (workingDay) {
      const [startH, startM] = workingDay.startTime.split(":").map(Number);
      const [endH, endM] = workingDay.endTime.split(":").map(Number);
      const slotDuration = 30;
      const dayStart = new Date(dayDate);
      dayStart.setHours(startH, startM, 0, 0);
      const dayEnd = new Date(dayDate);
      dayEnd.setHours(endH, endM, 0, 0);

      let current = new Date(dayStart);
      while (current < dayEnd) {
        const slotEnd = new Date(current.getTime() + slotDuration * 60 * 1000);
        const booked = dayAppointments.find((a) => {
          const aptStart = new Date(a.scheduledAt);
          const aptEnd = new Date(a.endAt);
          return current < aptEnd && slotEnd > aptStart;
        });

        if (booked) {
          const statusMap: Record<string, string> = {
            pending: "pending",
            confirmed: "booked",
            completed: "completed",
            cancelled: "cancelled",
          };
          slots.push({
            startTime: new Date(current),
            endTime: slotEnd,
            status: statusMap[booked.status] ?? "booked",
            appointmentId: booked.id,
            patientName: booked.patientName,
            doctorId: booked.doctorId,
            doctorName: booked.doctorName,
          });
        } else {
          const doctors = await db
            .select({ id: doctorsTable.id, name: sql<string>`(select u.name from users u where u.id = ${doctorsTable.userId} limit 1)` })
            .from(doctorsTable)
            .limit(1);

          slots.push({
            startTime: new Date(current),
            endTime: slotEnd,
            status: "free",
            appointmentId: null,
            patientName: null,
            doctorId: query.data.doctorId ?? (doctors[0]?.id ?? 0),
            doctorName: doctors[0]?.name ?? "Unknown",
          });
        }

        current = new Date(current.getTime() + slotDuration * 60 * 1000);
      }
    }

    days.push({ date: dateStr, slots });
  }

  res.json(days);
});

router.get("/schedule/working-hours", requireAuth, async (req, res): Promise<void> => {
  const hours = await db.select().from(workingHoursTable).orderBy(workingHoursTable.dayOfWeek);
  res.json(hours);
});

router.put("/schedule/working-hours", requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = UpdateWorkingHoursBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  for (const h of parsed.data.hours) {
    await db
      .update(workingHoursTable)
      .set({ startTime: h.startTime, endTime: h.endTime, isActive: h.isActive })
      .where(eq(workingHoursTable.dayOfWeek, h.dayOfWeek));
  }

  const hours = await db.select().from(workingHoursTable).orderBy(workingHoursTable.dayOfWeek);
  await logAudit(req, "UPDATE_WORKING_HOURS", "working_hours");
  res.json(hours);
});

export default router;
