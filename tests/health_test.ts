// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";
import { freshApp } from "./helpers.ts";

Deno.test("GET /health answers 200 and { ok: true }", async () => {
  const app = await freshApp();
  const res = await app.request("/health");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("Bonus 11: /healthz answers 200 while the process is up", async () => {
  const app = await freshApp();
  const res = await app.request("/healthz");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
});

Deno.test("Bonus 11: /readyz answers 200 when the database answers", async () => {
  const app = await freshApp();
  const res = await app.request("/readyz");
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ready: true });
});

Deno.test("Bonus 11: /readyz answers 503 when the database fails", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);
  db.client.execute = () => Promise.reject(new Error("database down"));

  const app = createApp(db);
  const res = await app.request("/readyz");
  assertEquals(res.status, 503);
  assertEquals(await res.json(), { ready: false });
});
