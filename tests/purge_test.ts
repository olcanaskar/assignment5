// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createDb, migrate } from "../src/db.ts";
import { purgeOldDone } from "../src/purge.ts";
import { tasks, users } from "../src/schema.ts";

Deno.test("Bonus 14: purge removes only old completed tasks and is idempotent", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);

  const [user] = await db.db
    .insert(users)
    .values({ email: "purge@example.com", passwordHash: "not-a-real-hash" })
    .returning({ id: users.id });
  if (!user) throw new Error("user insert failed");

  const now = Math.floor(Date.now() / 1000);
  const old = now - 40 * 24 * 60 * 60;
  const recent = now - 1 * 24 * 60 * 60;

  await db.db.insert(tasks).values([
    {
      userId: user.id,
      title: "old done",
      status: "done",
      completedAt: old,
    },
    {
      userId: user.id,
      title: "recent done",
      status: "done",
      completedAt: recent,
    },
    {
      userId: user.id,
      title: "old todo",
      status: "todo",
      completedAt: old,
    },
    {
      userId: user.id,
      title: "old done without date",
      status: "done",
      completedAt: null,
    },
  ]);

  assertEquals(await purgeOldDone(db, 30), 1);

  const rows = await db.db.select({ title: tasks.title }).from(tasks);
  const titles = rows.map((row) => row.title);
  assertEquals(titles.includes("old done"), false);
  assertEquals(titles.includes("recent done"), true);
  assertEquals(titles.includes("old todo"), true);
  assertEquals(titles.includes("old done without date"), true);

  assertEquals(await purgeOldDone(db, 30), 0);
});
