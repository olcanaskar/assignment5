// Abdullah Olcan Askar, 2024502180
import { and, eq, isNotNull, lt } from "drizzle-orm";
import type { Db } from "./db.ts";
import { tasks } from "./schema.ts";

/**
 * Hard-delete tasks that were completed more than `days` days ago.
 * Tasks without completedAt are left alone, which keeps old rows safe.
 */
export async function purgeOldDone(db: Db, days: number): Promise<number> {
  if (!Number.isInteger(days) || days < 1) {
    throw new Error("days must be a positive integer");
  }

  const cutoff = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
  const removed = await db.db
    .delete(tasks)
    .where(
      and(
        eq(tasks.status, "done"),
        isNotNull(tasks.completedAt),
        lt(tasks.completedAt, cutoff),
      ),
    )
    .returning({ id: tasks.id });

  return removed.length;
}
