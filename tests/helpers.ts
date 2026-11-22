// Abdullah Olcan Askar, 2024502180
import type { Hono } from "hono";
import { createApp } from "../src/app.ts";
import type { Env } from "../src/auth.ts";
import { createDb, migrate } from "../src/db.ts";

type App = Hono<Env>;

/**
 * Every test gets a fresh, empty database in its own temporary file.
 * (An in-memory database loses its tables after a transaction with libSQL,
 * so a temporary file is the safe choice.)
 */
export async function freshApp(): Promise<App> {
  const file = await Deno.makeTempFile({ suffix: ".db" });
  const db = createDb(`file:${file}`);
  await migrate(db);
  return createApp(db);
}

const postJson = (body: unknown) => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export function register(app: App, email: string, password = "secret123") {
  return app.request("/auth/register", postJson({ email, password }));
}

export function login(app: App, email: string, password = "secret123") {
  return app.request("/auth/login", postJson({ email, password }));
}

/** Register a user and return a valid session token for the task tests. */
export async function registerAndLogin(
  app: App,
  email: string,
  password = "secret123",
): Promise<string> {
  const registered = await register(app, email, password);
  if (registered.status !== 201) {
    throw new Error(`register failed: ${registered.status} ${await registered.text()}`);
  }

  const loggedIn = await login(app, email, password);
  if (loggedIn.status !== 200) {
    throw new Error(`login failed: ${loggedIn.status} ${await loggedIn.text()}`);
  }

  const body = await loggedIn.json() as { token: string };
  return body.token;
}

export function createTask(
  app: App,
  token: string,
  body: Record<string, unknown> = { title: "Task" },
) {
  return app.request("/api/tasks", {
    ...postJson(body),
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
  });
}
