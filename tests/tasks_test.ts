// Abdullah Olcan Askar, 2024502180
// TODO R7: no token is 401, create and list work, a user cannot read or change
// another user's task, an invalid status is 400, pagination returns the right page.
import { assertEquals } from "@std/assert";
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";

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
});
