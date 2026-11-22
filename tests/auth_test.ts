// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { type Env, requireAuth, signToken } from "../src/auth.ts";
import { freshApp, login, register } from "./helpers.ts";

Deno.test("R3/Bonus 7: requireAuth rejects a missing token and accepts a valid one", async () => {
  const app = new Hono<Env>();
  app.use("/api/*", requireAuth);
  app.get("/api/me", (c) => c.json({ userId: c.get("userId"), role: c.get("role") }));

  const denied = await app.request("/api/me");
  assertEquals(denied.status, 401);
  assertEquals(await denied.json(), { error: "unauthorized" });

  const token = await signToken(42, "admin");
  const allowed = await app.request("/api/me", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(allowed.status, 200);
  assertEquals(await allowed.json(), { userId: 42, role: "admin" });
});

Deno.test("R3: register creates a user without returning the password hash", async () => {
  const app = await freshApp();
  const res = await register(app, "new@example.com");
  assertEquals(res.status, 201);

  const body = await res.json() as Record<string, unknown>;
  assertEquals(body.email, "new@example.com");
  assertEquals(typeof body.id, "number");
  assertEquals("passwordHash" in body, false);
  assertEquals("password_hash" in body, false);
});

Deno.test("R3: a duplicate email is 409", async () => {
  const app = await freshApp();
  assertEquals((await register(app, "duplicate@example.com")).status, 201);

  const res = await register(app, "duplicate@example.com");
  assertEquals(res.status, 409);
  const body = await res.json() as { error: string };
  assertEquals(typeof body.error, "string");
});

Deno.test("R3: a bad register body is 400 with issues", async () => {
  const app = await freshApp();
  const res = await app.request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password: "short" }),
  });
  assertEquals(res.status, 400);

  const body = await res.json() as { error: string; issues: unknown[] };
  assertEquals(body.error, "validation failed");
  assertEquals(Array.isArray(body.issues), true);
  assertEquals(body.issues.length >= 1, true);
});

Deno.test("R3: login returns a token", async () => {
  const app = await freshApp();
  await register(app, "login@example.com");

  const res = await login(app, "login@example.com");
  assertEquals(res.status, 200);
  const body = await res.json() as { token: string };
  assertEquals(typeof body.token, "string");
  assertEquals(body.token.length > 0, true);
});

Deno.test("R3: a wrong password and an unknown email give the same 401", async () => {
  const app = await freshApp();
  await register(app, "same-message@example.com");

  const wrongPassword = await login(app, "same-message@example.com", "wrong-password");
  const unknownEmail = await login(app, "nobody@example.com");

  assertEquals(wrongPassword.status, 401);
  assertEquals(unknownEmail.status, 401);
  assertEquals(await wrongPassword.json(), await unknownEmail.json());
});

Deno.test("R3: an unknown bearer token is 401", async () => {
  const app = await freshApp();
  const res = await app.request("/api/tasks", {
    headers: { authorization: "Bearer not-a-real-token" },
  });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "unauthorized" });
});
