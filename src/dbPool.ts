// Abdullah Olcan Askar, 2024502180
import { createDb, type Db } from "./db.ts";
import { Pool } from "./pool.ts";

/**
 * Open several libSQL clients on the same SQLite file. WAL lets readers run
 * while one writer works, and busy_timeout waits instead of failing on a lock.
 */
export async function createDbPool(
  url: string,
  size: number,
  authToken?: string,
): Promise<Pool<Db>> {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error("pool size must be a positive integer");
  }

  const items: Db[] = [];
  // Hosted libSQL (Turso) rejects PRAGMA journal_mode=WAL. Those settings only
  // make sense for a local SQLite file.
  const localFile = url.startsWith("file:");
  for (let index = 0; index < size; index++) {
    const db = createDb(url, { authToken });
    if (localFile) {
      await db.client.execute("PRAGMA journal_mode=WAL");
      await db.client.execute("PRAGMA busy_timeout=5000");
    }
    items.push(db);
  }
  return new Pool(items);
}
