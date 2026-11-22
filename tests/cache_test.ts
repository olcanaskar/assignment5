// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";
import { tasks } from "../src/schema.ts";
import { createTask, registerAndLogin } from "./helpers.ts";

Deno.test("Bonus 16: GET /api/tasks/:id is cached and invalidated on change", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`, { logger: true });
  await migrate(db);
  const kv = await Deno.openKv(":memory:");
  const app = createApp(db, kv);

  const capture = async <T>(fn: () => T | Promise<T>) => {
    const lines: string[] = [];
    const original = console.log;
    try {
      console.log = (...args: unknown[]) => {
        lines.push(args.map((arg) => String(arg)).join(" "));
      };
      const result = await fn();
      return {
        result,
        queries: lines.filter((line) => line.startsWith("Query:")).length,
      };
    } finally {
      console.log = original;
    }
  };

  try {
    const token = await registerAndLogin(app, "cache@example.com");
    const headers = { authorization: `Bearer ${token}` };
    const created = await createTask(app, token, { title: "Cached task" });
    const { id } = await created.json() as { id: number };

    const miss = await capture(() => app.request(`/api/tasks/${id}`, { headers }));
    assertEquals(miss.result.status, 200);
    assertEquals(miss.queries, 1);

    const hit = await capture(() => app.request(`/api/tasks/${id}`, { headers }));
    assertEquals(hit.result.status, 200);
    assertEquals(hit.queries, 0);

    // Change the row behind the cache. The cached GET must still return the old title.
    await db.db
      .update(tasks)
      .set({ title: "Changed behind the cache" })
      .where(eq(tasks.id, id));
    const stale = await capture(() => app.request(`/api/tasks/${id}`, { headers }));
    assertEquals(stale.queries, 0);
    const staleBody = await stale.result.json() as { title: string };
    assertEquals(staleBody.title, "Cached task");

    // A normal API update invalidates the key, so the next GET reads the new row.
    const update = await app.request(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ title: "Updated through the API" }),
    });
    assertEquals(update.status, 200);

    const fresh = await capture(() => app.request(`/api/tasks/${id}`, { headers }));
    assertEquals(fresh.queries, 1);
    const freshBody = await fresh.result.json() as { title: string };
    assertEquals(freshBody.title, "Updated through the API");

    // The cache key includes the user id; another user cannot read this cache entry.
    const otherToken = await registerAndLogin(app, "cache-other@example.com");
    const other = await app.request(`/api/tasks/${id}`, {
      headers: { authorization: `Bearer ${otherToken}` },
    });
    assertEquals(other.status, 404);

    // DELETE removes the key, so the next GET is a real miss and then a 404.
    assertEquals(
      (await app.request(`/api/tasks/${id}`, { method: "DELETE", headers })).status,
      200,
    );
    const gone = await capture(() => app.request(`/api/tasks/${id}`, { headers }));
    assertEquals(gone.result.status, 404);
    assertEquals(gone.queries, 1);
  } finally {
    kv.close();
    db.client.close();
    await Deno.remove(file).catch(() => {});
  }
});
