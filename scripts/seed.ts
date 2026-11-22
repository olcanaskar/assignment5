// Abdullah Olcan Askar, 2024502180
import { loadConfig } from "../src/config.ts";
import { createDb, migrate } from "../src/db.ts";
import { seedDemoData } from "../src/seed.ts";

const config = loadConfig();
if (config.appEnv === "production") {
  console.error("Refusing to seed a production database.");
  Deno.exit(1);
}

const db = createDb(config.databaseUrl);
await migrate(db);

const result = await seedDemoData(db);
console.log(JSON.stringify(result));
console.log("Demo users: demo1@example.com / secret123, demo2@example.com / secret123");
