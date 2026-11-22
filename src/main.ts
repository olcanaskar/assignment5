// Abdullah Olcan Askar, 2024502180
import { createApp } from "./app.ts";
import { type Config, loadConfig } from "./config.ts";
import { createDb, migrate } from "./db.ts";

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

const kv = await Deno.openKv();
Deno.serve({ port: config.port }, createApp(db, kv).fetch);
