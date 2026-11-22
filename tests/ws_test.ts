// Abdullah Olcan Askar, 2024502180
import { assertEquals } from "@std/assert";
import { createApp } from "../src/app.ts";
import { createDb, migrate } from "../src/db.ts";
import { freshApp } from "./helpers.ts";

Deno.test("Bonus 13: a bad WebSocket token is 401", async () => {
  const app = await freshApp();
  const res = await app.request("/ws?token=bad");
  assertEquals(res.status, 401);
  assertEquals(await res.text(), "Unauthorized");
});

Deno.test("Bonus 13: a created task is pushed to that user's socket", async () => {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);
  const app = createApp(db);
  const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);

  try {
    const base = `http://localhost:${server.addr.port}`;
    const credentials = { email: "ws@example.com", password: "secret123" };

    const registered = await fetch(`${base}/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    assertEquals(registered.status, 201);

    const loggedIn = await fetch(`${base}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(credentials),
    });
    const { token } = await loggedIn.json() as { token: string };

    const socket = new WebSocket(
      `ws://localhost:${server.addr.port}/ws?token=${token}`,
    );
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("WebSocket failed to open"));
    });

    const message = new Promise<{ type: string; task: { title: string } }>(
      (resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("WebSocket message timed out")),
          2_000,
        );
        socket.onmessage = (event) => {
          clearTimeout(timer);
          resolve(JSON.parse(String(event.data)));
        };
      },
    );

    const created = await fetch(`${base}/api/tasks`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ title: "Live task" }),
    });
    assertEquals(created.status, 201);

    const pushed = await message;
    assertEquals(pushed.type, "created");
    assertEquals(pushed.task.title, "Live task");
    socket.close();
  } finally {
    await server.shutdown();
    db.client.close();
    await Deno.remove(file).catch(() => {});
  }
});
