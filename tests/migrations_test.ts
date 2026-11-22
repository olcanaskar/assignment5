// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createDb, migrate } from "../src/db.ts";

Deno.test("Bonus 1/4: migrations create the new column and the index", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);

  const columns = await db.client.execute("PRAGMA table_info(tasks)");
  const columnNames = columns.rows.map((row) => String(row.name));
  assertEquals(columnNames.includes("deleted_at"), true);
  assertEquals(columnNames.includes("due_date"), true);

  const indexes = await db.client.execute("PRAGMA index_list(tasks)");
  const indexNames = indexes.rows.map((row) => String(row.name));
  assertEquals(indexNames.includes("idx_tasks_user_status"), true);
});
