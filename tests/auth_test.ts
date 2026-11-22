// STUDENT NAME, STUDENT NUMBER
// TODO R7: register works (201), a duplicate email is 409, a wrong password is 401,
// a bad body is 400, login returns a token.
import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { createSession, type Env, requireAuth } from "../src/auth.ts";
import { createDb, migrate } from "../src/db.ts";
import { users } from "../src/schema.ts";

Deno.test("R3: requireAuth rejects a missing token and accepts a valid one", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);

  const [user] = await db.db.insert(users).values({
    email: "middleware@example.com",
    passwordHash: "not-a-real-hash",
  }).returning();
  if (!user) throw new Error("user insert failed");

  const app = new Hono<Env>();
  app.use("/api/*", requireAuth(db));
  app.get("/api/me", (c) => c.json({ userId: c.get("userId") }));

  const denied = await app.request("/api/me");
  assertEquals(denied.status, 401);
  assertEquals(await denied.json(), { error: "unauthorized" });

  const token = await createSession(db, user.id);
  const allowed = await app.request("/api/me", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(allowed.status, 200);
  assertEquals(await allowed.json(), { userId: user.id });
});
