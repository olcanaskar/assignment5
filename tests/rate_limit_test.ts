// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createLoginLimiter } from "../src/rateLimit.ts";
import { freshApp, login, register } from "./helpers.ts";

Deno.test("Bonus 15: five failures then 429 even with the right password", async () => {
  const app = await freshApp();
  await register(app, "rate@example.com");

  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await login(app, "rate@example.com", "wrong-password");
    assertEquals(res.status, 401);
  }

  const blocked = await login(app, "rate@example.com");
  assertEquals(blocked.status, 429);

  const retryAfter = blocked.headers.get("retry-after");
  assertEquals(typeof retryAfter, "string");
  assertEquals(Number(retryAfter) > 0, true);
});

Deno.test("Bonus 15: a successful login clears the counter", async () => {
  const app = await freshApp();
  await register(app, "clear@example.com");

  for (let attempt = 0; attempt < 4; attempt++) {
    assertEquals((await login(app, "clear@example.com", "wrong-password")).status, 401);
  }
  assertEquals((await login(app, "clear@example.com")).status, 200);

  // If the counter had not been cleared, these four would make it eight and
  // the next correct login would be blocked.
  for (let attempt = 0; attempt < 4; attempt++) {
    assertEquals((await login(app, "clear@example.com", "wrong-password")).status, 401);
  }
  assertEquals((await login(app, "clear@example.com")).status, 200);
});

Deno.test("Bonus 15: the window expires after one minute", () => {
  let now = 0;
  const limiter = createLoginLimiter(() => now);

  for (let attempt = 0; attempt < 5; attempt++) {
    limiter.recordFailure("a@example.com");
  }
  assertEquals(limiter.retryAfter("a@example.com"), 60);

  now = 61_000;
  assertEquals(limiter.retryAfter("a@example.com"), null);
});
