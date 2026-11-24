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

Deno.test("Bonus 10: request logs do not contain passwords or tokens", async () => {
  const app = await freshApp();
  const logs: string[] = [];
  const original = console.log;

  try {
    console.log = (...args: unknown[]) => {
      logs.push(args.map((arg) => String(arg)).join(" "));
    };

    const credentials = {
      email: "log-redaction@example.com",
      password: "secret123",
    };
    await app.request("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const login = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const { token } = await login.json() as { token: string };
    await app.request("/api/tasks", {
      headers: { authorization: `Bearer ${token}` },
    });
  } finally {
    console.log = original;
  }

  const text = logs.join("\n");
  assertEquals(text.includes("secret123"), false);
  assertEquals(text.toLowerCase().includes("bearer"), false);
  assertEquals(text.includes("password"), false);
  assertEquals(text.includes("token"), false);
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
