// Abdullah Olcan Askar, 2024502180
import { assertEquals, assertThrows } from "@std/assert";
import { loadConfig } from "../src/config.ts";

Deno.test("Bonus 11: a bad configuration is refused", () => {
  assertThrows(() => loadConfig({ PORT: "not-a-port" }), Error);
});

Deno.test("Bonus 11: production refuses the default JWT secret", () => {
  assertThrows(() => loadConfig({ APP_ENV: "production" }), Error);
});

Deno.test("Bonus 11: port and APP_ENV boundaries are rejected", () => {
  assertThrows(() => loadConfig({ PORT: "0" }), Error);
  assertThrows(() => loadConfig({ PORT: "70000" }), Error);
  assertThrows(() => loadConfig({ APP_ENV: "staging" }), Error);
});

Deno.test("Bonus 11: defaults are applied when variables are absent", () => {
  const config = loadConfig({});

  assertEquals(config.port, 8000);
  assertEquals(config.databaseUrl, "file:./tasks.db");
  assertEquals(config.appEnv, "development");
  assertEquals(config.jwtSecret, "dev-secret");
  assertEquals(config.uploadDir, "./uploads");
});

Deno.test("Bonus 11: a valid configuration becomes one typed object", () => {
  const config = loadConfig({
    PORT: "9000",
    DATABASE_URL: "file:./test.db",
    APP_ENV: "test",
    JWT_SECRET: "test-secret",
  });

  assertEquals(config.port, 9000);
  assertEquals(config.databaseUrl, "file:./test.db");
  assertEquals(config.appEnv, "test");
  assertEquals(config.jwtSecret, "test-secret");
});
