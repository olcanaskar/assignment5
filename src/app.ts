// Abdullah Olcan Askar, 2024502180
import { Hono } from "hono";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "./db.ts";
import {
  checkPassword,
  createSession,
  type Env,
  hashPassword,
  requireAuth,
} from "./auth.ts";
import { createLoginLimiter } from "./rateLimit.ts";
import { tasks, users } from "./schema.ts";
import { summaryGrouped } from "./summary.ts";

const Credentials = z.object({
  email: z.email(),
  password: z.string().min(8),
});

const TaskBody = z.object({
  title: z.string().trim().min(1).max(100),
  status: z.enum(["todo", "in-progress", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

const TaskQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["todo", "in-progress", "done"]).optional(),
});

/** A visible task belongs to the user and has not been soft-deleted. */
const ownVisible = (id: number, userId: number) =>
  and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt));

/** Only restore may look at a deleted task, and it still has to belong to the user. */
const ownDeleted = (id: number, userId: number) =>
  and(eq(tasks.id, id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt));

/** Build the whole application around a database, so tests can give it their own. */
export function createApp(db: Db) {
  const app = new Hono<Env>();
  const loginLimiter = createLoginLimiter();

  // One JSON log line per request, with an id that clients can quote in a bug report.
  app.use("*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    const start = performance.now();

    try {
      await next();
    } finally {
      console.log(JSON.stringify({
        requestId,
        method: c.req.method,
        path: c.req.path,
        status: c.res?.status ?? 500,
        ms: Math.round(performance.now() - start),
      }));
    }
  });

  // Worked example: a health check.
  app.get("/health", (c) => c.json({ ok: true }));

  // Render and other platforms use these two names for liveness and readiness.
  app.get("/healthz", (c) => c.json({ ok: true }));

  app.get("/readyz", async (c) => {
    try {
      await db.client.execute("SELECT 1");
      return c.json({ ready: true });
    } catch {
      return c.json({ ready: false }, 503);
    }
  });

  app.post("/auth/register", async (c) => {
    const parsed = Credentials.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const { email, password } = parsed.data;
    const [existing] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing) return c.json({ error: "email already taken" }, 409);

    const passwordHash = await hashPassword(password);
    const user = await db.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({ email, passwordHash })
        .returning({ id: users.id, email: users.email });
      if (!created) throw new Error("could not create user");

      await tx.insert(tasks).values({
        userId: created.id,
        title: "Welcome! Add your first task.",
      });
      return created;
    });

    return c.json(user, 201);
  });

  app.post("/auth/login", async (c) => {
    const parsed = Credentials.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const { email, password } = parsed.data;
    const limitKey = email.toLowerCase();

    const retryAfter = loginLimiter.retryAfter(limitKey);
    if (retryAfter !== null) {
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "too many login attempts" }, 429);
    }

    const [user] = await db.db.select().from(users).where(eq(users.email, email));
    const valid = user ? await checkPassword(password, user.passwordHash) : false;
    if (!user || !valid) {
      loginLimiter.recordFailure(limitKey);
      return c.json({ error: "invalid email or password" }, 401);
    }

    loginLimiter.clear(limitKey);
    return c.json({ token: await createSession(db, user.id) });
  });

  // Everything below /api needs a valid session token.
  app.use("/api/*", requireAuth(db));

  app.get("/api/tasks", async (c) => {
    const parsed = TaskQuery.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const { page, limit, status } = parsed.data;
    const userId = c.get("userId");
    const visible = and(eq(tasks.userId, userId), isNull(tasks.deletedAt));
    const where = status ? and(visible, eq(tasks.status, status)) : visible;

    const items = await db.db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(limit)
      .offset((page - 1) * limit);

    const [row] = await db.db
      .select({ total: count() })
      .from(tasks)
      .where(where);

    return c.json({ items, page, limit, total: row?.total ?? 0 });
  });

  app.get("/api/me/summary", async (c) => {
    return c.json(await summaryGrouped(db, c.get("userId")));
  });

  app.post("/api/tasks", async (c) => {
    const parsed = TaskBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const [task] = await db.db
      .insert(tasks)
      .values({ userId: c.get("userId"), ...parsed.data })
      .returning();
    if (!task) return c.json({ error: "could not create task" }, 500);

    return c.json(task, 201);
  });

  app.get("/api/tasks/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const [task] = await db.db
      .select()
      .from(tasks)
      .where(ownVisible(id, c.get("userId")));
    return task ? c.json(task) : c.json({ error: "not found" }, 404);
  });

  app.put("/api/tasks/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const parsed = TaskBody.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      return c.json({ error: "validation failed", issues: parsed.error.issues }, 400);
    }

    const [task] = await db.db
      .update(tasks)
      .set(parsed.data)
      .where(ownVisible(id, c.get("userId")))
      .returning();
    return task ? c.json(task) : c.json({ error: "not found" }, 404);
  });

  app.delete("/api/tasks/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const [deleted] = await db.db
      .update(tasks)
      .set({ deletedAt: sql`(strftime('%s','now'))` })
      .where(ownVisible(id, c.get("userId")))
      .returning({ id: tasks.id });
    return deleted ? c.json({ ok: true }) : c.json({ error: "not found" }, 404);
  });

  app.post("/api/tasks/:id/restore", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const [task] = await db.db
      .update(tasks)
      .set({ deletedAt: null })
      .where(ownDeleted(id, c.get("userId")))
      .returning();
    return task ? c.json(task) : c.json({ error: "not found" }, 404);
  });

  app.notFound((c) => c.json({ error: "not found", requestId: c.get("requestId") }, 404));

  app.onError((err, c) => {
    console.error(err); // details go to the log, not to the client
    return c.json({ error: "internal error", requestId: c.get("requestId") }, 500);
  });

  return app;
}
