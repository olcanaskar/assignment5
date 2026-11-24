// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";
import { createTask, freshApp, login, register, registerAndLogin } from "./helpers.ts";

Deno.test("Bonus 2: register creates a welcome task in one transaction", async () => {
  const app = await freshApp();
  assertEquals((await register(app, "welcome@example.com")).status, 201);

  const loggedIn = await login(app, "welcome@example.com");
  const { token } = await loggedIn.json() as { token: string };

  const res = await app.request("/api/tasks", {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json() as {
    items: { title: string; status: string }[];
    total: number;
  };

  assertEquals(body.total, 1);
  assertEquals(body.items.length, 1);
  assertEquals(body.items[0]?.title, "Welcome! Add your first task.");
  assertEquals(body.items[0]?.status, "todo");
});

Deno.test("Bonus 2: delete hides a task from list and lookup", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "soft-delete@example.com");
  const headers = { authorization: `Bearer ${token}` };

  const created = await createTask(app, token, { title: "Temporary" });
  const { id } = await created.json() as { id: number };

  const removed = await app.request(`/api/tasks/${id}`, {
    method: "DELETE",
    headers,
  });
  assertEquals(removed.status, 200);
  assertEquals(await removed.json(), { ok: true });

  const list = await app.request("/api/tasks", { headers });
  const page = await list.json() as { items: unknown[]; total: number };
  assertEquals(page.items.length, 0);
  assertEquals(page.total, 0);

  const get = await app.request(`/api/tasks/${id}`, { headers });
  assertEquals(get.status, 404);

  const update = await app.request(`/api/tasks/${id}`, {
    method: "PUT",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ title: "Still deleted" }),
  });
  assertEquals(update.status, 404);
});

Deno.test("Bonus 2: restore brings a deleted task back", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "restore@example.com");
  const headers = { authorization: `Bearer ${token}` };

  const created = await createTask(app, token, { title: "Bring me back" });
  const { id } = await created.json() as { id: number };

  assertEquals(
    (await app.request(`/api/tasks/${id}`, { method: "DELETE", headers })).status,
    200,
  );

  const restored = await app.request(`/api/tasks/${id}/restore`, {
    method: "POST",
    headers,
  });
  assertEquals(restored.status, 200);

  const task = await restored.json() as { title: string; deletedAt: number | null };
  assertEquals(task.title, "Bring me back");
  assertEquals(task.deletedAt, null);

  const get = await app.request(`/api/tasks/${id}`, { headers });
  assertEquals(get.status, 200);
});

Deno.test("Bonus 2: another user cannot restore your deleted task", async () => {
  const app = await freshApp();
  const owner = await registerAndLogin(app, "restore-owner@example.com");
  const other = await registerAndLogin(app, "restore-other@example.com");

  const created = await createTask(app, owner, { title: "Owner only" });
  const { id } = await created.json() as { id: number };
  assertEquals(
    (await app.request(`/api/tasks/${id}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${owner}` },
    })).status,
    200,
  );

  const foreign = await app.request(`/api/tasks/${id}/restore`, {
    method: "POST",
    headers: { authorization: `Bearer ${other}` },
  });
  assertEquals(foreign.status, 404);

  const own = await app.request(`/api/tasks/${id}/restore`, {
    method: "POST",
    headers: { authorization: `Bearer ${owner}` },
  });
  assertEquals(own.status, 200);
});

Deno.test("Bonus 2: restoring a task that is not deleted is 404", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "restore-visible@example.com");
  const created = await createTask(app, token, { title: "Visible" });
  const { id } = await created.json() as { id: number };

  const res = await app.request(`/api/tasks/${id}/restore`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 404);
});

Deno.test("Bonus 2: a failed welcome task rolls back the user insert", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);

  await db.client.execute(`
    CREATE TRIGGER fail_welcome_task
    BEFORE INSERT ON tasks
    BEGIN
      SELECT RAISE(ABORT, 'welcome task failed');
    END
  `);

  const app = createApp(db);
  const res = await register(app, "rollback@example.com");
  assertEquals(res.status, 500);

  const userCount = await db.client.execute("SELECT COUNT(*) AS n FROM users");
  assertEquals(Number(userCount.rows[0]?.n), 0);
  const taskCount = await db.client.execute("SELECT COUNT(*) AS n FROM tasks");
  assertEquals(Number(taskCount.rows[0]?.n), 0);
});
