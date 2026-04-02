import { Router, type IRouter } from "express";
import bcrypt from "bcryptjs";
import { db, usersTable } from "@workspace/db";
import { eq, ilike, and, SQL } from "drizzle-orm";
import { CreateUserBody, UpdateUserBody, GetUserParams, UpdateUserParams, DeleteUserParams, ListUsersQueryParams } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../lib/auth-middleware";
import { logAudit } from "../lib/audit";

const router: IRouter = Router();

router.get("/users", requireRole("admin"), async (req, res): Promise<void> => {
  const query = ListUsersQueryParams.safeParse(req.query);
  const conditions: SQL[] = [];
  if (query.success && query.data.role) {
    conditions.push(eq(usersTable.role, query.data.role));
  }
  if (query.success && query.data.search) {
    conditions.push(ilike(usersTable.name, `%${query.data.search}%`));
  }

  const users = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    role: usersTable.role,
    phone: usersTable.phone,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(conditions.length > 0 ? and(...conditions) : undefined);

  res.json(users);
});

router.post("/users", requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { password, ...rest } = parsed.data;
  const passwordHash = await bcrypt.hash(password, 10);

  const [user] = await db.insert(usersTable).values({ ...rest, passwordHash }).returning({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    role: usersTable.role,
    phone: usersTable.phone,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  });

  await logAudit(req, "CREATE_USER", "users", user.id, `Created user ${user.email}`);
  res.status(201).json(user);
});

router.get("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const [user] = await db.select({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    role: usersTable.role,
    phone: usersTable.phone,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  }).from(usersTable).where(eq(usersTable.id, id));

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.patch("/users/:id", requireAuth, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.update(usersTable).set(parsed.data).where(eq(usersTable.id, id)).returning({
    id: usersTable.id,
    email: usersTable.email,
    name: usersTable.name,
    role: usersTable.role,
    phone: usersTable.phone,
    avatarUrl: usersTable.avatarUrl,
    isActive: usersTable.isActive,
    createdAt: usersTable.createdAt,
  });

  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logAudit(req, "UPDATE_USER", "users", user.id);
  res.json(user);
});

router.delete("/users/:id", requireRole("admin"), async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [user] = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  await logAudit(req, "DELETE_USER", "users", id);
  res.json({ success: true, message: "User deleted" });
});

export default router;
