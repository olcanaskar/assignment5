// Abdullah Olcan Askar, 2024502180
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema.ts";

export type Db = ReturnType<typeof createDb>;

/** Open a database. Tests pass "file::memory:" or a temporary file. */
export function createDb(url: string) {
  const client = createClient({ url });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** Create the tables if they do not exist yet. Keep this in sync with schema.ts. */
export async function migrate({ client }: Db) {
  await client.batch([
    `CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       email TEXT NOT NULL UNIQUE,
       password_hash TEXT NOT NULL,
       created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
     )`,
    `CREATE TABLE IF NOT EXISTS sessions (
       token TEXT PRIMARY KEY,
       user_id INTEGER NOT NULL REFERENCES users(id),
       expires_at INTEGER NOT NULL
     )`,
    `CREATE TABLE IF NOT EXISTS tasks (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id INTEGER NOT NULL REFERENCES users(id),
       title TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'todo'
         CHECK (status IN ('todo', 'in-progress', 'done')),
       priority TEXT NOT NULL DEFAULT 'medium'
         CHECK (priority IN ('low', 'medium', 'high')),
       created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
     )`,
  ]);
}
