import { Router, type IRouter } from "express";
import { db, appointmentsTable, doctorsTable, usersTable, specialtiesTable } from "@workspace/db";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import {
  CreateAppointmentBody,
  UpdateAppointmentBody,
  CancelAppointmentBody,
  ListAppointmentsQueryParams,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth-middleware";
import { logAudit } from "../lib/audit";
import { createNotification } from "../lib/notifications";

const router: IRouter = Router();

async function getAppointmentFull(id: number) {
  const [apt] = await db
    .select({
      id: appointmentsTable.id,
      patientId: appointmentsTable.patientId,
      patientName: usersTable.name,
      patientEmail: usersTable.email,
      doctorId: appointmentsTable.doctorId,
      doctorName: sql<string>`(select u.name from users u join doctors d on d.user_id = u.id where d.id = ${appointmentsTable.doctorId} limit 1)`,
      specialtyId: appointmentsTable.specialtyId,
      specialtyName: specialtiesTable.name,
      scheduledAt: appointmentsTable.scheduledAt,
      endAt: appointmentsTable.endAt,
      status: appointmentsTable.status,
      notes: appointmentsTable.notes,
      cancellationReason: appointmentsTable.cancellationReason,
      createdAt: appointmentsTable.createdAt,
      updatedAt: appointmentsTable.updatedAt,
    })
    .from(appointmentsTable)
    .innerJoin(usersTable, eq(appointmentsTable.patientId, usersTable.id))
    .innerJoin(specialtiesTable, eq(appointmentsTable.specialtyId, specialtiesTable.id))
    .where(eq(appointmentsTable.id, id));
  return apt;
}

router.get("/appointments", requireAuth, async (req, res): Promise<void> => {
  const sessionUser = (req as any).session?.user;
  const query = ListAppointmentsQueryParams.safeParse(req.query);

  const conditions: any[] = [];

  if (sessionUser.role === "patient") {
    conditions.push(eq(appointmentsTable.patientId, sessionUser.id));
  } else if (query.success && query.data.patientId) {
    conditions.push(eq(appointmentsTable.patientId, query.data.patientId));
  }

  if (query.success) {
    if (query.data.status) conditions.push(eq(appointmentsTable.status, query.data.status));
    if (query.data.doctorId) conditions.push(eq(appointmentsTable.doctorId, query.data.doctorId));
    if (query.data.dateFrom) conditions.push(gte(appointmentsTable.scheduledAt, new Date(query.data.dateFrom)));
    if (query.data.dateTo) conditions.push(lte(appointmentsTable.scheduledAt, new Date(query.data.dateTo)));
  }

  const appointments = await db
    .select({
      id: appointmentsTable.id,
      patientId: appointmentsTable.patientId,
      patientName: usersTable.name,
      patientEmail: usersTable.email,
      doctorId: appointmentsTable.doctorId,
      doctorName: sql<string>`(select u.name from users u join doctors d on d.user_id = u.id where d.id = appointments.doctor_id limit 1)`,
      specialtyId: appointmentsTable.specialtyId,
      specialtyName: specialtiesTable.name,
      scheduledAt: appointmentsTable.scheduledAt,
      endAt: appointmentsTable.endAt,
      status: appointmentsTable.status,
      notes: appointmentsTable.notes,
      cancellationReason: appointmentsTable.cancellationReason,
      createdAt: appointmentsTable.createdAt,
      updatedAt: appointmentsTable.updatedAt,
    })
    .from(appointmentsTable)
    .innerJoin(usersTable, eq(appointmentsTable.patientId, usersTable.id))
    .innerJoin(specialtiesTable, eq(appointmentsTable.specialtyId, specialtiesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(sql`${appointmentsTable.scheduledAt} desc`);

  res.json(appointments);
});

router.post("/appointments", requireAuth, async (req, res): Promise<void> => {
  const sessionUser = (req as any).session?.user;
  if (sessionUser.role !== "patient") {
    res.status(403).json({ error: "Only patients can book appointments" });
    return;
  }

  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { doctorId, scheduledAt, notes } = parsed.data;
  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
  if (!doctor) {
    res.status(404).json({ error: "Doctor not found" });
    return;
  }

  const startTime = new Date(scheduledAt);
  const endTime = new Date(startTime.getTime() + doctor.appointmentDuration * 60 * 1000);

  const conflicting = await db
    .select()
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.doctorId, doctorId),
        sql`${appointmentsTable.status} IN ('pending', 'confirmed')`,
        sql`tsrange(${appointmentsTable.scheduledAt}, ${appointmentsTable.endAt}) && tsrange(${startTime.toISOString()}, ${endTime.toISOString()})`
      )
    );

  if (conflicting.length > 0) {
    res.status(409).json({ error: "This time slot is not available" });
    return;
  }

  const [apt] = await db
    .insert(appointmentsTable)
    .values({
      patientId: sessionUser.id,
      doctorId,
      specialtyId: doctor.specialtyId,
      scheduledAt: startTime,
      endAt: endTime,
      status: "pending",
      notes: notes ?? null,
    })
    .returning();

  const full = await getAppointmentFull(apt.id);

  await createNotification(
    sessionUser.id,
    "Appointment Requested",
    `Your appointment with ${full?.doctorName} is pending confirmation.`,
    "appointment_pending",
    apt.id
  );

  await logAudit(req, "CREATE_APPOINTMENT", "appointments", apt.id);
  res.status(201).json(full);
});

router.get("/appointments/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const full = await getAppointmentFull(id);
  if (!full) {
    res.status(404).json({ error: "Appointment not found" });
    return;
  }
  res.json(full);
});

router.patch("/appointments/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const parsed = UpdateAppointmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Appointment not found" });
    return;
  }

  const updateData: any = {};
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.scheduledAt) {
    const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, existing.doctorId));
    const start = new Date(parsed.data.scheduledAt);
    updateData.scheduledAt = start;
    updateData.endAt = new Date(start.getTime() + (doctor?.appointmentDuration ?? 30) * 60 * 1000);
  }

  await db.update(appointmentsTable).set(updateData).where(eq(appointmentsTable.id, id));

  const full = await getAppointmentFull(id);
  await logAudit(req, "UPDATE_APPOINTMENT", "appointments", id);
  res.json(full);
});

router.post("/appointments/:id/confirm", requireRole("staff", "admin"), async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Appointment not found" });
    return;
  }

  await db.update(appointmentsTable).set({ status: "confirmed" }).where(eq(appointmentsTable.id, id));

  const full = await getAppointmentFull(id);

  await createNotification(
    existing.patientId,
    "Appointment Confirmed",
    `Your appointment with ${full?.doctorName} on ${new Date(existing.scheduledAt).toLocaleString()} has been confirmed.`,
    "appointment_confirmed",
    id
  );

  await logAudit(req, "CONFIRM_APPOINTMENT", "appointments", id);
  res.json(full);
});

router.post("/appointments/:id/cancel", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const parsed = CancelAppointmentBody.safeParse(req.body);

  const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Appointment not found" });
    return;
  }

  await db
    .update(appointmentsTable)
    .set({ status: "cancelled", cancellationReason: parsed.success ? (parsed.data.reason ?? null) : null })
    .where(eq(appointmentsTable.id, id));

  const full = await getAppointmentFull(id);

  await createNotification(
    existing.patientId,
    "Appointment Cancelled",
    `Your appointment has been cancelled.`,
    "appointment_cancelled",
    id
  );

  await logAudit(req, "CANCEL_APPOINTMENT", "appointments", id);
  res.json(full);
});

router.post("/appointments/:id/complete", requireRole("staff", "admin"), async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [existing] = await db.select().from(appointmentsTable).where(eq(appointmentsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Appointment not found" });
    return;
  }

  await db.update(appointmentsTable).set({ status: "completed" }).where(eq(appointmentsTable.id, id));

  const full = await getAppointmentFull(id);

  await createNotification(
    existing.patientId,
    "Appointment Completed",
    `Your appointment has been marked as completed.`,
    "appointment_completed",
    id
  );

  await logAudit(req, "COMPLETE_APPOINTMENT", "appointments", id);
  res.json(full);
});

export default router;
