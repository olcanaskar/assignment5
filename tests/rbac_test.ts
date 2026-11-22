// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { hashPassword } from "../src/auth.ts";
import { createDb, migrate } from "../src/db.ts";
import { users } from "../src/schema.ts";
import { login, registerAndLogin } from "./helpers.ts";

Deno.test("Bonus 9: the admin route answers 401, 403 and 200 by role", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);

  const adminEmail = "admin@example.com";
  const [admin] = await db.db
    .insert(users)
    .values({
      email: adminEmail,
      passwordHash: await hashPassword("secret123"),
      role: "admin",
    })
    .returning({ id: users.id });
  if (!admin) throw new Error("admin insert failed");

  const app = createApp(db);
  const normalToken = await registerAndLogin(app, "normal@example.com");

  const noToken = await app.request("/api/admin/users");
  assertEquals(noToken.status, 401);

  const forbidden = await app.request("/api/admin/users", {
    headers: { authorization: `Bearer ${normalToken}` },
  });
  assertEquals(forbidden.status, 403);
  assertEquals(await forbidden.json(), { error: "forbidden" });

  const adminLogin = await login(app, adminEmail);
  const { token: adminToken } = await adminLogin.json() as { token: string };
  const allowed = await app.request("/api/admin/users", {
    headers: { authorization: `Bearer ${adminToken}` },
  });
  assertEquals(allowed.status, 200);

  const body = await allowed.json() as {
    items: { email: string; role: string; passwordHash?: string }[];
  };
  const adminRow = body.items.find((row) => row.email === adminEmail);
  assertEquals(adminRow?.role, "admin");
  assertEquals(body.items.every((row) => !("passwordHash" in row)), true);
});
