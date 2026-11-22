// Abdullah Olcan Askar, 2024502180
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";
import { summaryGrouped, summaryNaive } from "../src/summary.ts";

const file = await Deno.makeTempFile({ suffix: ".db" });
const db = createDb(`file:${file}`, { logger: true });
await migrate(db);

const [user] = await db.db
  .insert(users)
  .values({ email: "summary-count@example.com", passwordHash: "not-a-real-hash" })
  .returning({ id: users.id });
if (!user) throw new Error("user insert failed");

const statuses = ["todo", "in-progress", "done"] as const;
await db.db.insert(tasks).values(
  Array.from({ length: 30 }, (_, index) => ({
    userId: user.id,
    title: `Task ${index}`,
    status: statuses[index % statuses.length],
  })),
);

const logs: string[] = [];
const original = console.log;
try {
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };

  await summaryNaive(db, user.id);
  const naiveLogs = logs.splice(0);

  await summaryGrouped(db, user.id);
  const groupedLogs = logs.splice(0);

  console.log = original;
  console.log(JSON.stringify(
    {
      naive: { queries: naiveLogs.length, log: naiveLogs },
      grouped: { queries: groupedLogs.length, log: groupedLogs },
    },
    null,
    2,
  ));
} finally {
  console.log = original;
  db.client.close();
  await Deno.remove(file).catch(() => {});
}
