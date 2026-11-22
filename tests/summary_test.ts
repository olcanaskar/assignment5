// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import { summaryGrouped, summaryNaive } from "../src/summary.ts";
import { createTask, freshApp, registerAndLogin } from "./helpers.ts";

Deno.test("Bonus 3: the summary route counts the visible tasks per status", async () => {
  const app = await freshApp();
  const token = await registerAndLogin(app, "summary@example.com");
  const headers = { authorization: `Bearer ${token}` };

  await createTask(app, token, { title: "Todo one" });
  await createTask(app, token, { title: "Todo two" });
  await createTask(app, token, { title: "In progress", status: "in-progress" });
  await createTask(app, token, { title: "Done", status: "done" });

  const res = await app.request("/api/me/summary", { headers });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    todo: 2,
    "in-progress": 1,
    done: 1,
    total: 4,
  });

  const list = await app.request("/api/tasks", { headers });
  const page = await list.json() as { items: { id: number; title: string }[] };
  const doneTask = page.items.find((task) => task.title === "Done");
  if (!doneTask) throw new Error("no task to delete");

  assertEquals(
    (await app.request(`/api/tasks/${doneTask.id}`, { method: "DELETE", headers }))
      .status,
    200,
  );

  const afterDelete = await app.request("/api/me/summary", { headers });
  assertEquals(await afterDelete.json(), {
    todo: 2,
    "in-progress": 1,
    done: 0,
    total: 3,
  });
});

Deno.test("Bonus 3: the naive and grouped versions return the same numbers", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);

  const [user] = await db.db
    .insert(users)
    .values({ email: "summary-direct@example.com", passwordHash: "not-a-real-hash" })
    .returning({ id: users.id });
  if (!user) throw new Error("user insert failed");

  const statuses = ["todo", "in-progress", "done"] as const;
  await db.db.insert(tasks).values(
    Array.from({ length: 30 }, (_, index) => ({
      userId: user.id,
      title: `Task ${index}`,
      status: statuses[index % statuses.length],
      deletedAt: index === 0 ? 1 : null,
    })),
  );

  assertEquals(await summaryNaive(db, user.id), await summaryGrouped(db, user.id));
});
