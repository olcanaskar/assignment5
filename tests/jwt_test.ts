// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { type Env, requireAuth, signToken } from "../src/auth.ts";

const makeApp = () => {
  const app = new Hono<Env>();
  app.use("/api/*", requireAuth);
  app.get("/api/me", (c) => c.json({ userId: c.get("userId") }));
  return app;
};

Deno.test("Bonus 7: a tampered token is 401", async () => {
  const token = await signToken(1);
  const parts = token.split(".");
  const signature = parts[2];
  if (!signature) throw new Error("token has no signature");

  parts[2] = `${signature[0] === "a" ? "b" : "a"}${signature.slice(1)}`;
  const tampered = parts.join(".");

  const res = await makeApp().request("/api/me", {
    headers: { authorization: `Bearer ${tampered}` },
  });
  assertEquals(res.status, 401);
  assertEquals(await res.json(), { error: "unauthorized" });
});

Deno.test("Bonus 7: an expired token is 401", async () => {
  const token = await signToken(1, "user", "-1s");
  const res = await makeApp().request("/api/me", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 401);
});

Deno.test("Bonus 7: a token signed with another secret is 401", async () => {
  const otherSecret = new TextEncoder().encode("another-secret");
  const token = await signToken(1, "user", "1h", otherSecret);
  const res = await makeApp().request("/api/me", {
    headers: { authorization: `Bearer ${token}` },
  });
  assertEquals(res.status, 401);
});
