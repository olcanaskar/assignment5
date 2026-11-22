// Abdullah Olcan Askar, 2024502180
import { createDb, migrate } from "../src/db.ts";
import { tasks, users } from "../src/schema.ts";

const file = await Deno.makeTempFile({ suffix: ".db" });
const db = createDb(`file:${file}`);
await migrate(db);

const insertedUsers = await db.db
  .insert(users)
  .values(
    Array.from({ length: 20 }, (_, index) => ({
      email: `bench${index}@example.com`,
      passwordHash: "not-a-real-hash",
    })),
  )
  .returning({ id: users.id });
if (insertedUsers.length !== 20) throw new Error("user seed failed");

const statuses = ["todo", "in-progress", "done"] as const;
const priorities = ["low", "medium", "high"] as const;
let seededTasks = 0;

for (const user of insertedUsers) {
  const values = Array.from({ length: 1000 }, (_, index) => ({
    userId: user.id,
    title: `Benchmark task ${index}`,
    status: statuses[index % statuses.length],
    priority: priorities[index % priorities.length],
  }));

  for (let offset = 0; offset < values.length; offset += 200) {
    await db.db.insert(tasks).values(values.slice(offset, offset + 200));
  }
  seededTasks += values.length;
}

const userId = insertedUsers[1]?.id;
if (userId === undefined) throw new Error("benchmark user missing");

const query = {
  sql: "SELECT * FROM tasks WHERE user_id = ? AND status = ?",
  args: [userId, "done"],
};

const plan = async () => {
  const result = await db.client.execute({
    sql: "EXPLAIN QUERY PLAN SELECT * FROM tasks WHERE user_id = ? AND status = ?",
    args: [userId, "done"],
  });
  return result.rows.map((row) => String(row.detail));
};

const timeQuery = async (iterations = 30) => {
  for (let warmup = 0; warmup < 5; warmup++) {
    await db.client.execute(query);
  }
  const start = performance.now();
  for (let index = 0; index < iterations; index++) {
    await db.client.execute(query);
  }
  return (performance.now() - start) / iterations;
};

await db.client.execute("DROP INDEX IF EXISTS idx_tasks_user_status");
const beforePlan = await plan();
const beforeMs = await timeQuery();

await db.client.execute(
  "CREATE INDEX idx_tasks_user_status ON tasks(user_id, status)",
);
const afterPlan = await plan();
const afterMs = await timeQuery();

console.log(JSON.stringify(
  {
    seededUsers: insertedUsers.length,
    seededTasks,
    before: {
      plan: beforePlan,
      averageMs: Number(beforeMs.toFixed(2)),
    },
    after: {
      plan: afterPlan,
      averageMs: Number(afterMs.toFixed(2)),
    },
  },
  null,
  2,
));

db.client.close();
await Deno.remove(file).catch(() => {});
