// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { freshApp } from "./helpers.ts";

Deno.test("Bonus 8: /openapi.json lists the routes and the Bearer scheme", async () => {
  const app = await freshApp();
  const res = await app.request("/openapi.json");
  assertEquals(res.status, 200);

  const doc = await res.json() as {
    paths: Record<string, unknown>;
    components: { securitySchemes: Record<string, unknown> };
  };

  for (
    const path of [
      "/health",
      "/healthz",
      "/readyz",
      "/auth/register",
      "/auth/login",
      "/api/tasks",
      "/api/tasks/{id}",
      "/api/tasks/{id}/restore",
      "/api/tasks/{id}/attachment",
      "/api/me/summary",
      "/api/admin/users",
    ]
  ) {
    assertEquals(path in doc.paths, true);
  }

  assertEquals(doc.components.securitySchemes.Bearer !== undefined, true);
});

Deno.test("Bonus 8: /docs serves a Swagger UI page", async () => {
  const app = await freshApp();
  const res = await app.request("/docs");
  assertEquals(res.status, 200);

  const html = await res.text();
  assertEquals(html.includes("swagger-ui"), true);
  assertEquals(html.includes("/openapi.json"), true);
});
