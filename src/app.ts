// Abdullah Olcan Askar, 2024502180
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { and, count, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { join } from "@std/path";
import type { Db } from "./db.ts";
import {
  checkPassword,
  type Env,
  hashPassword,
  requireAuth,
  requireRole,
  signToken,
  verifyToken,
} from "./auth.ts";
import { createLoginLimiter } from "./rateLimit.ts";
import type { Pool } from "./pool.ts";
import { tasks, users } from "./schema.ts";
import { summaryGrouped } from "./summary.ts";

const Credentials = z.object({
  email: z.email(),
  password: z.string().min(8),
}).openapi("Credentials");

const TaskBody = z.object({
  title: z.string().trim().min(1).max(100),
  status: z.enum(["todo", "in-progress", "done"]).default("todo"),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
}).openapi("TaskBody");

const TaskQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["todo", "in-progress", "done"]).optional(),
}).openapi("TaskQuery");

const IdParams = z.object({ id: z.string() }).openapi("IdParams");

const HealthSchema = z.object({ ok: z.boolean() }).openapi("Health");
const ReadySchema = z.object({ ready: z.boolean() }).openapi("Ready");
const UserSchema = z.object({ id: z.number(), email: z.string() }).openapi("User");
const TokenSchema = z.object({ token: z.string() }).openapi("Token");
const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");
const TaskSchema = z.object({
  id: z.number(),
  userId: z.number(),
  title: z.string(),
  status: z.enum(["todo", "in-progress", "done"]),
  priority: z.enum(["low", "medium", "high"]),
  createdAt: z.number(),
  dueDate: z.number().nullable(),
  attachment: z.string().nullable(),
  completedAt: z.number().nullable(),
  deletedAt: z.number().nullable(),
}).openapi("Task");
const TaskPageSchema = z.object({
  items: z.array(TaskSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
}).openapi("TaskPage");
const SummarySchema = z.object({
  todo: z.number(),
  "in-progress": z.number(),
  done: z.number(),
  total: z.number(),
}).openapi("Summary");
const AdminUserSchema = z.object({
  id: z.number(),
  email: z.string(),
  role: z.enum(["user", "admin"]),
  createdAt: z.number(),
}).openapi("AdminUser");
const AdminUsersSchema = z.object({ items: z.array(AdminUserSchema) }).openapi(
  "AdminUsers",
);
const ErrorSchema = z.object({ error: z.string() }).openapi("Error");
const ValidationErrorSchema = z.object({
  error: z.string(),
  issues: z.array(z.object({
    path: z.array(z.union([z.string(), z.number()])),
    message: z.string(),
  })),
}).openapi("ValidationError");

const errorResponse = (description: string) => ({
  content: { "application/json": { schema: ErrorSchema } },
  description,
});
const validationResponse = (description: string) => ({
  content: { "application/json": { schema: ValidationErrorSchema } },
  description,
});
const taskResponse = (description: string) => ({
  content: { "application/json": { schema: TaskSchema } },
  description,
});
const taskPageResponse = (description: string) => ({
  content: { "application/json": { schema: TaskPageSchema } },
  description,
});

const security = [{ Bearer: [] }];

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: {
    200: {
      content: { "application/json": { schema: HealthSchema } },
      description: "Process is up",
    },
  },
});

const healthzRoute = createRoute({
  method: "get",
  path: "/healthz",
  responses: {
    200: {
      content: { "application/json": { schema: HealthSchema } },
      description: "Process is up",
    },
  },
});

const readyzRoute = createRoute({
  method: "get",
  path: "/readyz",
  responses: {
    200: {
      content: { "application/json": { schema: ReadySchema } },
      description: "Database answered",
    },
    503: {
      content: { "application/json": { schema: ReadySchema } },
      description: "Database is unavailable",
    },
  },
});

const registerRoute = createRoute({
  method: "post",
  path: "/auth/register",
  request: {
    body: {
      content: { "application/json": { schema: Credentials } },
      required: true,
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: UserSchema } },
      description: "User created",
    },
    400: validationResponse("Invalid body"),
    409: errorResponse("Email already taken"),
    500: errorResponse("Internal error"),
  },
});

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  request: {
    body: {
      content: { "application/json": { schema: Credentials } },
      required: true,
    },
  },
  responses: {
    200: {
      content: { "application/json": { schema: TokenSchema } },
      description: "Login succeeded",
    },
    400: validationResponse("Invalid body"),
    401: errorResponse("Wrong email or password"),
    429: errorResponse("Too many login attempts"),
  },
});

const listRoute = createRoute({
  method: "get",
  path: "/api/tasks",
  security,
  request: { query: TaskQuery },
  responses: {
    200: taskPageResponse("One page of the user's tasks"),
    400: validationResponse("Invalid query"),
    401: errorResponse("Missing or invalid token"),
  },
});

const summaryRoute = createRoute({
  method: "get",
  path: "/api/me/summary",
  security,
  responses: {
    200: {
      content: { "application/json": { schema: SummarySchema } },
      description: "Visible task counts per status",
    },
    401: errorResponse("Missing or invalid token"),
  },
});

const adminUsersRoute = createRoute({
  method: "get",
  path: "/api/admin/users",
  security,
  responses: {
    200: {
      content: { "application/json": { schema: AdminUsersSchema } },
      description: "Users without password hashes",
    },
    401: errorResponse("Missing or invalid token"),
    403: errorResponse("Admin role required"),
  },
});

const createRouteDef = createRoute({
  method: "post",
  path: "/api/tasks",
  security,
  request: {
    body: {
      content: { "application/json": { schema: TaskBody } },
      required: true,
    },
  },
  responses: {
    201: taskResponse("Task created"),
    400: validationResponse("Invalid body"),
    401: errorResponse("Missing or invalid token"),
    500: errorResponse("Internal error"),
  },
});

const getRoute = createRoute({
  method: "get",
  path: "/api/tasks/{id}",
  security,
  request: { params: IdParams },
  responses: {
    200: taskResponse("The task"),
    401: errorResponse("Missing or invalid token"),
    404: errorResponse("Task not found"),
  },
});

const updateRoute = createRoute({
  method: "put",
  path: "/api/tasks/{id}",
  security,
  request: {
    params: IdParams,
    body: {
      content: { "application/json": { schema: TaskBody } },
      required: true,
    },
  },
  responses: {
    200: taskResponse("Updated task"),
    400: validationResponse("Invalid body"),
    401: errorResponse("Missing or invalid token"),
    404: errorResponse("Task not found"),
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/api/tasks/{id}",
  security,
  request: { params: IdParams },
  responses: {
    200: {
      content: { "application/json": { schema: OkSchema } },
      description: "Task soft-deleted",
    },
    401: errorResponse("Missing or invalid token"),
    404: errorResponse("Task not found"),
  },
});

const restoreRoute = createRoute({
  method: "post",
  path: "/api/tasks/{id}/restore",
  security,
  request: { params: IdParams },
  responses: {
    200: taskResponse("Restored task"),
    401: errorResponse("Missing or invalid token"),
    404: errorResponse("Deleted task not found"),
  },
});

type Task = typeof tasks.$inferSelect;

const taskKey = (userId: number, id: number) => ["task", userId, id];

const SWAGGER_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Tasks API docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>SwaggerUIBundle({ url: "/openapi.json", dom_id: "#swagger-ui" });</script>
</body>
</html>`;

function isDuplicateEmailError(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (/unique constraint failed: users\.email/i.test(current.message)) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

/** A visible task belongs to the user and has not been soft-deleted. */
const ownVisible = (id: number, userId: number) =>
  and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAt));

/** Only restore may look at a deleted task, and it still has to belong to the user. */
const ownDeleted = (id: number, userId: number) =>
  and(eq(tasks.id, id), eq(tasks.userId, userId), isNotNull(tasks.deletedAt));

/**
 * Build the whole application around a database, so tests can give it their own.
 * Passing a Deno.Kv instance enables the 60-second task cache (Bonus 16).
 * Passing a pool makes every /api request borrow and return a connection (Bonus 6).
 */
export function createApp(
  db: Db,
  kv?: Deno.Kv,
  pool?: Pool<Db>,
  uploadDir = "./uploads",
) {
  const app = new OpenAPIHono<Env>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json({ error: "validation failed", issues: result.error.issues }, 400);
      }
    },
  });
  const loginLimiter = createLoginLimiter();
  const clients = new Map<number, Set<WebSocket>>();

  const broadcast = (userId: number, message: unknown) => {
    const sockets = clients.get(userId);
    if (!sockets) return;

    const data = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    }
  };

  const loadTask = async (conn: Db, id: number, userId: number) => {
    const [task] = await conn.db
      .select()
      .from(tasks)
      .where(ownVisible(id, userId));
    return task;
  };

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

  app.openapi(healthRoute, (c) => c.json({ ok: true }, 200));

  app.openapi(healthzRoute, (c) => c.json({ ok: true }, 200));

  app.openapi(readyzRoute, async (c) => {
    try {
      await db.client.execute("SELECT 1");
      return c.json({ ready: true }, 200);
    } catch {
      return c.json({ ready: false }, 503);
    }
  });

  app.openapi(registerRoute, async (c) => {
    const { email, password } = c.req.valid("json");
    const [existing] = await db.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    if (existing) return c.json({ error: "email already taken" }, 409);

    const passwordHash = await hashPassword(password);
    try {
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
    } catch (error) {
      // Two simultaneous registrations can pass the SELECT check together.
      // The unique index still protects us; translate that constraint error.
      if (isDuplicateEmailError(error)) {
        return c.json({ error: "email already taken" }, 409);
      }
      throw error;
    }
  });

  app.openapi(loginRoute, async (c) => {
    const { email, password } = c.req.valid("json");
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
    return c.json({ token: await signToken(user.id, user.role) }, 200);
  });

  app.get("/ws", async (c) => {
    const session = await verifyToken(c.req.query("token") ?? "");
    if (!session) return c.text("Unauthorized", 401);

    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);
    socket.onopen = () => {
      const sockets = clients.get(session.userId) ?? new Set<WebSocket>();
      sockets.add(socket);
      clients.set(session.userId, sockets);
    };
    socket.onclose = () => {
      const sockets = clients.get(session.userId);
      sockets?.delete(socket);
      if (sockets?.size === 0) clients.delete(session.userId);
    };
    return response;
  });

  // Every /api request borrows one pooled connection and returns it afterwards.
  app.use("/api/*", async (c, next) => {
    if (!pool) {
      c.set("db", db);
      await next();
      return;
    }

    const conn = await pool.acquire();
    c.set("db", conn);
    try {
      await next();
    } finally {
      pool.release(conn);
    }
  });

  // Everything below /api needs a valid JWT.
  app.use("/api/*", requireAuth);

  app.openapi(listRoute, async (c) => {
    const { page, limit, status } = c.req.valid("query");
    const conn = c.get("db");
    const userId = c.get("userId");
    const visible = and(eq(tasks.userId, userId), isNull(tasks.deletedAt));
    const where = status ? and(visible, eq(tasks.status, status)) : visible;

    const items = await conn.db
      .select()
      .from(tasks)
      .where(where)
      .orderBy(desc(tasks.createdAt), desc(tasks.id))
      .limit(limit)
      .offset((page - 1) * limit);

    const [row] = await conn.db
      .select({ total: count() })
      .from(tasks)
      .where(where);

    return c.json({ items, page, limit, total: row?.total ?? 0 }, 200);
  });

  app.openapi(summaryRoute, async (c) => {
    return c.json(await summaryGrouped(c.get("db"), c.get("userId")), 200);
  });

  app.post("/api/tasks/:id/attachment", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const conn = c.get("db");
    const userId = c.get("userId");
    const [taskRow] = await conn.db
      .select({ id: tasks.id, attachment: tasks.attachment })
      .from(tasks)
      .where(ownVisible(id, userId));
    if (!taskRow) return c.json({ error: "not found" }, 404);

    const body: Record<string, string | File> = await c.req
      .parseBody()
      .catch(() => ({}));
    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "file required" }, 400);
    }
    if (file.size > 1_000_000) {
      return c.json({ error: "too large" }, 413);
    }
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      return c.json({ error: "type not allowed" }, 415);
    }

    await Deno.mkdir(uploadDir, { recursive: true });
    const extension = file.type === "image/png" ? ".png" : ".jpg";
    const filename = `${crypto.randomUUID()}${extension}`;
    await Deno.writeFile(
      join(uploadDir, filename),
      new Uint8Array(await file.arrayBuffer()),
    );

    const [updated] = await conn.db
      .update(tasks)
      .set({ attachment: filename })
      .where(ownVisible(id, userId))
      .returning();
    if (kv) await kv.delete(taskKey(userId, id));

    if (taskRow.attachment) {
      await Deno.remove(join(uploadDir, taskRow.attachment)).catch(() => {});
    }

    return c.json(updated, 200);
  });

  app.get("/api/tasks/:id/attachment", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const conn = c.get("db");
    const userId = c.get("userId");
    const [taskRow] = await conn.db
      .select({ attachment: tasks.attachment })
      .from(tasks)
      .where(ownVisible(id, userId));
    if (!taskRow?.attachment) {
      return c.json({ error: "not found" }, 404);
    }

    const bytes = await Deno.readFile(join(uploadDir, taskRow.attachment))
      .catch(() => null);
    if (!bytes) return c.json({ error: "not found" }, 404);

    const contentType = taskRow.attachment.endsWith(".png") ? "image/png" : "image/jpeg";
    return c.body(bytes, 200, {
      "content-type": contentType,
      "content-disposition": `inline; filename="${taskRow.attachment}"`,
    });
  });

  app.use("/api/admin/users", requireRole("admin"));
  app.openapi(adminUsersRoute, async (c) => {
    const conn = c.get("db");
    const items = await conn.db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
      })
      .from(users);
    return c.json({ items }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const body = c.req.valid("json");
    const conn = c.get("db");
    const [task] = await conn.db
      .insert(tasks)
      .values({
        userId: c.get("userId"),
        ...body,
        completedAt: body.status === "done" ? sql`(strftime('%s','now'))` : null,
      })
      .returning();
    if (!task) return c.json({ error: "could not create task" }, 500);

    broadcast(c.get("userId"), { type: "created", task });
    return c.json(task, 201);
  });

  app.openapi(getRoute, async (c) => {
    const id = Number(c.req.valid("param").id);
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const conn = c.get("db");
    const userId = c.get("userId");
    if (kv) {
      const key = taskKey(userId, id);
      const hit = await kv.get<Task>(key);
      if (hit.value !== null) return c.json(hit.value, 200);

      const task = await loadTask(conn, id, userId);
      if (!task) return c.json({ error: "not found" }, 404);
      await kv.set(key, task, { expireIn: 60_000 });
      return c.json(task, 200);
    }

    const task = await loadTask(conn, id, userId);
    return task ? c.json(task, 200) : c.json({ error: "not found" }, 404);
  });

  app.openapi(updateRoute, async (c) => {
    const id = Number(c.req.valid("param").id);
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const body = c.req.valid("json");
    const conn = c.get("db");
    const userId = c.get("userId");
    const [task] = await conn.db
      .update(tasks)
      .set({
        ...body,
        completedAt: body.status === "done" ? sql`(strftime('%s','now'))` : null,
      })
      .where(ownVisible(id, userId))
      .returning();
    if (kv) await kv.delete(taskKey(userId, id));
    if (task) broadcast(userId, { type: "updated", task });
    return task ? c.json(task, 200) : c.json({ error: "not found" }, 404);
  });

  app.openapi(deleteRoute, async (c) => {
    const id = Number(c.req.valid("param").id);
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const conn = c.get("db");
    const userId = c.get("userId");
    const [deleted] = await conn.db
      .update(tasks)
      .set({ deletedAt: sql`(strftime('%s','now'))` })
      .where(ownVisible(id, userId))
      .returning({ id: tasks.id });
    if (kv) await kv.delete(taskKey(userId, id));
    if (deleted) broadcast(userId, { type: "deleted", task: { id } });
    return deleted ? c.json({ ok: true }, 200) : c.json({ error: "not found" }, 404);
  });

  app.openapi(restoreRoute, async (c) => {
    const id = Number(c.req.valid("param").id);
    if (!Number.isInteger(id) || id < 1) {
      return c.json({ error: "not found" }, 404);
    }

    const conn = c.get("db");
    const userId = c.get("userId");
    const [task] = await conn.db
      .update(tasks)
      .set({ deletedAt: null })
      .where(ownDeleted(id, userId))
      .returning();
    if (kv) await kv.delete(taskKey(userId, id));
    if (task) broadcast(userId, { type: "restored", task });
    return task ? c.json(task, 200) : c.json({ error: "not found" }, 404);
  });

  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/ws",
    request: { query: z.object({ token: z.string() }) },
    responses: {
      101: { description: "WebSocket upgrade" },
      401: errorResponse("Missing or invalid token"),
    },
  });

  const AttachmentBodySchema = z.object({
    file: z.string().openapi({ type: "string", format: "binary" }),
  }).openapi("AttachmentBody");

  app.openAPIRegistry.registerPath({
    method: "post",
    path: "/api/tasks/{id}/attachment",
    security,
    request: {
      params: IdParams,
      body: {
        content: { "multipart/form-data": { schema: AttachmentBodySchema } },
      },
    },
    responses: {
      200: taskResponse("Attachment saved"),
      400: validationResponse("File missing"),
      401: errorResponse("Missing or invalid token"),
      404: errorResponse("Task not found"),
      413: errorResponse("File too large"),
      415: errorResponse("Unsupported file type"),
    },
  });

  app.openAPIRegistry.registerPath({
    method: "get",
    path: "/api/tasks/{id}/attachment",
    security,
    request: { params: IdParams },
    responses: {
      200: {
        description: "Image bytes",
        content: {
          "image/png": {
            schema: z.string().openapi({ type: "string", format: "binary" }),
          },
          "image/jpeg": {
            schema: z.string().openapi({ type: "string", format: "binary" }),
          },
        },
      },
      401: errorResponse("Missing or invalid token"),
      404: errorResponse("Task or attachment not found"),
    },
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "Bearer", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  app.doc("/openapi.json", {
    openapi: "3.0.0",
    info: {
      title: "Tasks API",
      version: "1.0.0",
      description: "Tasks API for the MIS 233 assignment.",
    },
  });

  app.get("/docs", (c) => c.html(SWAGGER_HTML));

  app.notFound((c) => c.json({ error: "not found", requestId: c.get("requestId") }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return c.json(
        { error: err.message, requestId: c.get("requestId") },
        err.status,
      );
    }

    console.error(err); // details go to the log, not to the client
    return c.json({ error: "internal error", requestId: c.get("requestId") }, 500);
  });

  return app;
}
