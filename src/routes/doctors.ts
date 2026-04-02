import { Router, type IRouter } from "express";
import { db, doctorsTable, usersTable, specialtiesTable, appointmentsTable, workingHoursTable } from "@workspace/db";
import { eq, and, ilike, sql } from "drizzle-orm";
import { CreateDoctorBody, UpdateDoctorBody, ListDoctorsQueryParams, GetDoctorAvailableSlotsQueryParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth-middleware";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/doctors", requireAuth, async (req, res): Promise<void> => {
  const query = ListDoctorsQueryParams.safeParse(req.query);
  const baseQuery = db
    .select({
      id: doctorsTable.id,
      userId: doctorsTable.userId,
      name: usersTable.name,
      email: usersTable.email,
      specialtyId: doctorsTable.specialtyId,
      specialtyName: specialtiesTable.name,
      bio: doctorsTable.bio,
      avatarUrl: usersTable.avatarUrl,
      experience: doctorsTable.experience,
      rating: sql<number>`null`,
      appointmentDuration: doctorsTable.appointmentDuration,
    })
    .from(doctorsTable)
    .innerJoin(usersTable, eq(doctorsTable.userId, usersTable.id))
    .innerJoin(specialtiesTable, eq(doctorsTable.specialtyId, specialtiesTable.id));

  let doctors;
  if (query.success && query.data.specialtyId) {
    doctors = await baseQuery.where(eq(doctorsTable.specialtyId, query.data.specialtyId));
  } else {
    doctors = await baseQuery;
  }

  res.json(doctors);
});

router.post("/doctors", requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = CreateDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [doctor] = await db.insert(doctorsTable).values(parsed.data).returning();
  const [full] = await db
    .select({
      id: doctorsTable.id,
      userId: doctorsTable.userId,
      name: usersTable.name,
      email: usersTable.email,
      specialtyId: doctorsTable.specialtyId,
      specialtyName: specialtiesTable.name,
      bio: doctorsTable.bio,
      avatarUrl: usersTable.avatarUrl,
      experience: doctorsTable.experience,
      rating: sql<number>`null`,
      appointmentDuration: doctorsTable.appointmentDuration,
    })
    .from(doctorsTable)
    .innerJoin(usersTable, eq(doctorsTable.userId, usersTable.id))
    .innerJoin(specialtiesTable, eq(doctorsTable.specialtyId, specialtiesTable.id))
    .where(eq(doctorsTable.id, doctor.id));

  await logAudit(req, "CREATE_DOCTOR", "doctors", doctor.id);
  res.status(201).json(full);
});

router.get("/doctors/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [doctor] = await db
    .select({
      id: doctorsTable.id,
      userId: doctorsTable.userId,
      name: usersTable.name,
      email: usersTable.email,
      specialtyId: doctorsTable.specialtyId,
      specialtyName: specialtiesTable.name,
      bio: doctorsTable.bio,
      avatarUrl: usersTable.avatarUrl,
      experience: doctorsTable.experience,
      rating: sql<number>`null`,
      appointmentDuration: doctorsTable.appointmentDuration,
    })
    .from(doctorsTable)
    .innerJoin(usersTable, eq(doctorsTable.userId, usersTable.id))
    .innerJoin(specialtiesTable, eq(doctorsTable.specialtyId, specialtiesTable.id))
    .where(eq(doctorsTable.id, id));

  if (!doctor) {
    res.status(404).json({ error: "Doctor not found" });
    return;
  }
  res.json(doctor);
});

router.patch("/doctors/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const parsed = UpdateDoctorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  await db.update(doctorsTable).set(parsed.data).where(eq(doctorsTable.id, id));

  const [doctor] = await db
    .select({
      id: doctorsTable.id,
      userId: doctorsTable.userId,
      name: usersTable.name,
      email: usersTable.email,
      specialtyId: doctorsTable.specialtyId,
      specialtyName: specialtiesTable.name,
      bio: doctorsTable.bio,
      avatarUrl: usersTable.avatarUrl,
      experience: doctorsTable.experience,
      rating: sql<number>`null`,
      appointmentDuration: doctorsTable.appointmentDuration,
    })
    .from(doctorsTable)
    .innerJoin(usersTable, eq(doctorsTable.userId, usersTable.id))
    .innerJoin(specialtiesTable, eq(doctorsTable.specialtyId, specialtiesTable.id))
    .where(eq(doctorsTable.id, id));

  if (!doctor) {
    res.status(404).json({ error: "Doctor not found" });
    return;
  }

  await logAudit(req, "UPDATE_DOCTOR", "doctors", id);
  res.json(doctor);
});

router.get("/doctors/:id/available-slots", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const doctorId = parseInt(rawId, 10);
  const queryParsed = GetDoctorAvailableSlotsQueryParams.safeParse(req.query);
  if (!queryParsed.success) {
    res.status(400).json({ error: "Missing required date parameter" });
    return;
  }
  const { date } = queryParsed.data;

  const [doctor] = await db.select().from(doctorsTable).where(eq(doctorsTable.id, doctorId));
  if (!doctor) {
    res.status(404).json({ error: "Doctor not found" });
    return;
  }

  const targetDate = new Date(date);
  const dayOfWeek = targetDate.getDay();

  const [workingDay] = await db.select().from(workingHoursTable).where(
    and(eq(workingHoursTable.dayOfWeek, dayOfWeek), eq(workingHoursTable.isActive, true))
  );

  if (!workingDay) {
    res.json([]);
    return;
  }

  const [startHour, startMin] = workingDay.startTime.split(":").map(Number);
  const [endHour, endMin] = workingDay.endTime.split(":").map(Number);
  const slotDuration = doctor.appointmentDuration;

  const dayStart = new Date(targetDate);
  dayStart.setHours(startHour, startMin, 0, 0);
  const dayEnd = new Date(targetDate);
  dayEnd.setHours(endHour, endMin, 0, 0);

  const bookedAppointments = await db
    .select({ scheduledAt: appointmentsTable.scheduledAt, endAt: appointmentsTable.endAt })
    .from(appointmentsTable)
    .where(
      and(
        eq(appointmentsTable.doctorId, doctorId),
        sql`date(${appointmentsTable.scheduledAt}) = date(${targetDate.toISOString()})`,
        sql`${appointmentsTable.status} IN ('pending', 'confirmed')`
      )
    );

  const slots = [];
  let current = new Date(dayStart);

  while (current < dayEnd) {
    const slotEnd = new Date(current.getTime() + slotDuration * 60 * 1000);
    if (slotEnd > dayEnd) break;

    const isBooked = bookedAppointments.some((apt) => {
      const aptStart = new Date(apt.scheduledAt);
      const aptEnd = new Date(apt.endAt);
      return current < aptEnd && slotEnd > aptStart;
    });

    slots.push({
      startTime: new Date(current),
      endTime: slotEnd,
      available: !isBooked && new Date(current) > new Date(),
    });

    current = new Date(current.getTime() + slotDuration * 60 * 1000);
  }

  res.json(slots);
});

export default router;
