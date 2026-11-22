// Abdullah Olcan Askar, 2024502180
import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "./db.ts";
import { tasks } from "./schema.ts";

export type StatusCounts = {
  todo: number;
  "in-progress": number;
  done: number;
  total: number;
};

const STATUSES = ["todo", "in-progress", "done"] as const;

const visible = (userId: number) =>
  and(eq(tasks.userId, userId), isNull(tasks.deletedAt));

/**
 * The naive version: one query to load the rows, then one count query per
 * status. The query count grows with the number of groups.
 */
export async function summaryNaive(db: Db, userId: number): Promise<StatusCounts> {
  const all = await db.db
    .select({ id: tasks.id })
    .from(tasks)
    .where(visible(userId));
  const result: StatusCounts = {
    todo: 0,
    "in-progress": 0,
    done: 0,
    total: all.length,
  };

  for (const status of STATUSES) {
    const [row] = await db.db
      .select({ n: count() })
      .from(tasks)
      .where(and(visible(userId), eq(tasks.status, status)));
    result[status] = row?.n ?? 0;
  }

  return result;
}

/** The good version: one GROUP BY query, independent of the row count. */
export async function summaryGrouped(db: Db, userId: number): Promise<StatusCounts> {
  const rows = await db.db
    .select({ status: tasks.status, n: count() })
    .from(tasks)
    .where(visible(userId))
    .groupBy(tasks.status);

  const result: StatusCounts = {
    todo: 0,
    "in-progress": 0,
    done: 0,
    total: 0,
  };

  for (const row of rows) {
    result[row.status] = row.n;
    result.total += row.n;
  }

  return result;
}
