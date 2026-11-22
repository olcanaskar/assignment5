// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";
import { createDbPool } from "../src/dbPool.ts";
import { Pool } from "../src/pool.ts";
import { createTask, registerAndLogin } from "./helpers.ts";

Deno.test("Bonus 6: 20 jobs on a pool of 3 never run more than 3 at once", async () => {
  const pool = new Pool([1, 2, 3]);
  let active = 0;
  let maximum = 0;

  const jobs = Array.from({ length: 20 }, () =>
    pool.use(async (item) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return item;
    }));

  const results = await Promise.all(jobs);
  assertEquals(results.length, 20);
  assertEquals(maximum, 3);
});

Deno.test("Bonus 6: task routes borrow and release pooled connections", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);
  const pool = await createDbPool(`file:${file}`, 3);
  const app = createApp(db, undefined, pool);

  const token = await registerAndLogin(app, "pool@example.com");
  const headers = { authorization: `Bearer ${token}` };
  const created = await createTask(app, token, { title: "Pooled" });
  assertEquals(created.status, 201);

  const responses = await Promise.all(
    Array.from({ length: 20 }, () => app.request("/api/tasks", { headers })),
  );
  assertEquals(responses.every((response) => response.status === 200), true);

  const list = await app.request("/api/tasks", { headers });
  const body = await list.json() as { total: number };
  assertEquals(body.total, 1);
});
