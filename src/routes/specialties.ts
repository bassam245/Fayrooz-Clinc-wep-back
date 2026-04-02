import { Router, type IRouter } from "express";
import { db, specialtiesTable, doctorsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { CreateSpecialtyBody, UpdateSpecialtyParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth-middleware";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/specialties", requireAuth, async (req, res): Promise<void> => {
  const specialties = await db.select({
    id: specialtiesTable.id,
    name: specialtiesTable.name,
    description: specialtiesTable.description,
    icon: specialtiesTable.icon,
    color: specialtiesTable.color,
    doctorCount: sql<number>`(select count(*) from doctors where doctors.specialty_id = specialties.id)::int`,
  }).from(specialtiesTable);

  res.json(specialties);
});

router.post("/specialties", requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = CreateSpecialtyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [specialty] = await db.insert(specialtiesTable).values(parsed.data).returning();
  await logAudit(req, "CREATE_SPECIALTY", "specialties", specialty.id, specialty.name);
  res.status(201).json({ ...specialty, doctorCount: 0 });
});

router.patch("/specialties/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const parsed = CreateSpecialtyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [specialty] = await db.update(specialtiesTable).set(parsed.data).where(eq(specialtiesTable.id, id)).returning();
  if (!specialty) {
    res.status(404).json({ error: "Specialty not found" });
    return;
  }

  const [countRow] = await db.select({ count: sql<number>`count(*)::int` }).from(doctorsTable).where(eq(doctorsTable.specialtyId, id));

  await logAudit(req, "UPDATE_SPECIALTY", "specialties", id);
  res.json({ ...specialty, doctorCount: countRow?.count ?? 0 });
});

router.delete("/specialties/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [specialty] = await db.delete(specialtiesTable).where(eq(specialtiesTable.id, id)).returning();
  if (!specialty) {
    res.status(404).json({ error: "Specialty not found" });
    return;
  }

  await logAudit(req, "DELETE_SPECIALTY", "specialties", id);
  res.json({ success: true, message: "Specialty deleted" });
});

export default router;
