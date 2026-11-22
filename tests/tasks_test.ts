// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import { createTask, freshApp, registerAndLogin } from "./helpers.ts";

Deno.test("R2: tasks table stores a task with the SQL defaults", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);

  const [user] = await db.db.insert(users).values({
    email: "table@example.com",
    passwordHash: "not-a-real-hash",
  }).returning();
  if (!user) throw new Error("user insert failed");

  const [task] = await db.db.insert(tasks).values({
    userId: user.id,
    title: "First task",
  }).returning();
  if (!task) throw new Error("task insert failed");

  assertEquals(task.userId, user.id);
  assertEquals(task.title, "First task");
  assertEquals(task.status, "todo");
  assertEquals(task.priority, "medium");
  assertEquals(typeof task.createdAt, "number");
  assertEquals(task.deletedAt, null);
});

Deno.test("R4: /api/tasks without a token is 401", async () => {
  const app = await freshApp();
  const res = await app.request("/api/tasks");
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "unauthorized" });
});

Deno.test("R4: create and list only the logged-in user's tasks", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "list@example.com");
  assertEquals((await createTask(app, token, { title: "First" })).status, 201);
  assertEquals((await createTask(app, token, { title: "Second" })).status, 201);

  const res = await app.request("/api/tasks", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 200);

  const body = await res.json() as {
    items: { title: string }[];
    page: number;
    limit: number;
    total: number;
  };
  assertEquals(body.items.length, 2);
  assertEquals(body.items.map((task) => task.title), ["Second", "First"]);
  assertEquals(body.page, 1);
  assertEquals(body.limit, 20);
  assertEquals(body.total, 2);
});

Deno.test("R4: a created task gets the owner and the defaults", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "create@example.com");

  const res = await createTask(app, token, { title: "Write tests" });
  assertEquals(res.status, 201);

  const task = await res.json() as {
    userId: number;
    title: string;
    status: string;
    priority: string;
    createdAt: number;
  };
  assertEquals(typeof task.userId, "number");
  assertEquals(task.title, "Write tests");
  assertEquals(task.status, "todo");
  assertEquals(task.priority, "medium");
  assertEquals(typeof task.createdAt, "number");
});

Deno.test("R5: an empty title is 400 with issues", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "bad-title@example.com");

  const res = await createTask(app, token, { title: "" });
  assertEquals(res.status, 400);

  const body = await res.json() as { error: string; issues: unknown[] };
  assertEquals(body.error, "validation failed");
  assertEquals(Array.isArray(body.issues), true);
  assertEquals(body.issues.length >= 1, true);
});

Deno.test("R5: an invalid status is 400", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "bad-status@example.com");

  const res = await createTask(app, token, { title: "Task", status: "urgent" });
  assertEquals(res.status, 400);

  const body = await res.json() as { error: string };
  assertEquals(body.error, "validation failed");
});

Deno.test("R4: another user's task is 404 for read, update and delete", async () => {
  const app = await freshApp();
  const owner = await registerAndLogin(app, "owner@example.com");
  const other = await registerAndLogin(app, "other@example.com");

  const created = await createTask(app, owner, { title: "Private" });
  assertEquals(created.status, 201);
  const { id } = await created.json() as { id: number };

  const ownRead = await app.request(`/api/tasks/${id}`, {
    headers: { authorization: `Bearer ${owner}` },
  });
  assertEquals(ownRead.status, 200);

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${other}`,
  };
  const read = await app.request(`/api/tasks/${id}`, { headers });
  assertEquals(read.status, 404);

  const update = await app.request(`/api/tasks/${id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ title: "Stolen", status: "done" }),
  });
  assertEquals(update.status, 404);

  const remove = await app.request(`/api/tasks/${id}`, {
    method: "DELETE",
    headers,
  });
  assertEquals(remove.status, 404);
});

Deno.test("R4: the owner can update and delete a task", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "crud@example.com");

  const created = await createTask(app, token, { title: "Draft", priority: "high" });
  assertEquals(created.status, 201);
  const { id } = await created.json() as { id: number };

  const updated = await app.request(`/api/tasks/${id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: "Finished", status: "done" }),
  });
  assertEquals(updated.status, 200);

  const updatedTask = await updated.json() as {
    title: string;
    status: string;
    priority: string;
  };
  assertEquals(updatedTask.title, "Finished");
  assertEquals(updatedTask.status, "done");
  // PUT replaces the whole task, so an omitted priority falls back to the default.
  assertEquals(updatedTask.priority, "medium");

  const removed = await app.request(`/api/tasks/${id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(removed.status, 200);
  assertEquals(await removed.json(), { ok: true });

  const gone = await app.request(`/api/tasks/${id}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(gone.status, 404);
});

Deno.test("R6: pagination returns the requested page and the total", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "pages@example.com");

  for (const title of ["One", "Two", "Three"]) {
    assertEquals((await createTask(app, token, { title })).status, 201);
  }

  const res = await app.request("/api/tasks?page=2&limit=2", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 200);

  const body = await res.json() as {
    items: { title: string }[];
    page: number;
    limit: number;
    total: number;
  };
  assertEquals(body.page, 2);
  assertEquals(body.limit, 2);
  assertEquals(body.total, 3);
  assertEquals(body.items.length, 1);
  assertEquals(body.items[0]?.title, "One");
});

Deno.test("R6: a bad page or limit is 400", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "bad-query@example.com");
  const headers = { authorization: `Bearer ${token}` };

  const badPage = await app.request("/api/tasks?page=abc", { headers });
  assertEquals(badPage.status, 400);
  const badPageBody = await badPage.json() as { error: string };
  assertEquals(badPageBody.error, "validation failed");

  const badLimit = await app.request("/api/tasks?limit=1000", { headers });
  assertEquals(badLimit.status, 400);
});

Deno.test("R6: the status filter returns only matching tasks", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "filter@example.com");

  await createTask(app, token, { title: "Still todo" });
  await createTask(app, token, { title: "Already done", status: "done" });

  const res = await app.request("/api/tasks?status=done", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 200);

  const body = await res.json() as { items: { title: string }[]; total: number };
  assertEquals(body.total, 1);
  assertEquals(body.items.length, 1);
  assertEquals(body.items[0]?.title, "Already done");
});

Deno.test("R5: an unknown route uses the same error shape", async () => {
  const app = await freshApp();
  const res = await app.request("/does-not-exist");
  assertEquals(res.status, 404);

  const body = await res.json() as { error: string; requestId: string };
  assertEquals(body.error, "not found");
  assertEquals(body.requestId, res.headers.get("x-request-id"));
});
