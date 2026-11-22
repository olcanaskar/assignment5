// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { freshApp } from "./helpers.ts";

Deno.test("Bonus 10: every response carries an x-request-id header", async () => {
  const app = await freshApp();
  const res = await app.request("/health");
  const requestId = res.headers.get("x-request-id");

  assertEquals(typeof requestId, "string");
  assertEquals(requestId !== null && requestId.length > 0, true);
});

Deno.test("Bonus 10: a 404 body repeats the request id", async () => {
  const app = await freshApp();
  const res = await app.request("/does-not-exist");
  assertEquals(res.status, 404);

  const body = await res.json() as { error: string; requestId: string };
  assertEquals(body.error, "not found");
  assertEquals(body.requestId, res.headers.get("x-request-id"));
});

Deno.test("Bonus 10: a 500 body repeats the request id", async () => {
  const app = await freshApp();
  app.get("/boom", () => {
    throw new Error("boom");
  });

  const res = await app.request("/boom");
  assertEquals(res.status, 500);

  const body = await res.json() as { error: string; requestId: string };
  assertEquals(body.error, "internal error");
  assertEquals(body.requestId, res.headers.get("x-request-id"));
});
