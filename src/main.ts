// Abdullah Olcan Askar, 2024502180
import { createApp } from "./app.ts";
import { type Config, loadConfig } from "./config.ts";
import { createDb, migrate } from "./db.ts";
import { createDbPool } from "./dbPool.ts";

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Configuration error: ${message}`);
  Deno.exit(1);
}

const db = createDb(config.databaseUrl);
await migrate(db);
const pool = await createDbPool(config.databaseUrl, 3);

const kv = await Deno.openKv();
Deno.serve(
  { port: config.port },
  createApp(db, kv, pool, config.uploadDir).fetch,
);
