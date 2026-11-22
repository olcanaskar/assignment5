// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { count } from "drizzle-orm";
import { createDb, migrate } from "../src/db.ts";
import { seedDemoData } from "../src/seed.ts";
import { tasks, users } from "../src/schema.ts";

Deno.test("Bonus 5: seed creates demo data and is safe to run twice", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);

  const first = await seedDemoData(db);
  assertEquals(first.users, 2);
  assertEquals(first.tasks, 20);
  assertEquals(first.skippedUsers, 0);

  const [userCount] = await db.db.select({ n: count() }).from(users);
  const [taskCount] = await db.db.select({ n: count() }).from(tasks);
  assertEquals(userCount?.n, 2);
  assertEquals(taskCount?.n, 20);

  const second = await seedDemoData(db);
  assertEquals(second.users, 0);
  assertEquals(second.tasks, 0);
  assertEquals(second.skippedUsers, 2);

  const [taskCountAgain] = await db.db.select({ n: count() }).from(tasks);
  assertEquals(taskCountAgain?.n, 20);
});
