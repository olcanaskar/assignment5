// Abdullah Olcan Askar, 2024502180
const base = (Deno.args[0] ?? "https://tasks-api-f30l.onrender.com")
  .replace(/\/+$/, "");
const password = "secret123";
const email = `smoke-${Date.now()}@example.com`;

type JsonObject = Record<string, unknown>;

async function request(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // Keep the raw text so a failing response is still visible.
  }
  return { status: response.status, body };
}

function requireValue(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function asObject(value: unknown): JsonObject {
  requireValue(
    typeof value === "object" && value !== null,
    "expected a JSON object",
  );
  return value as JsonObject;
}

const summary: JsonObject = { base };

try {
  const health = await request("/health");
  requireValue(health.status === 200, `health returned ${health.status}`);
  requireValue(asObject(health.body).ok === true, "health did not return ok");
  summary.health = health.body;

  const register = await request("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  requireValue(
    register.status === 201,
    `register returned ${register.status}`,
  );
  summary.register = { status: register.status, email };

  const login = await request("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  requireValue(login.status === 200, `login returned ${login.status}`);
  const token = asObject(login.body).token;
  requireValue(
    typeof token === "string" && token.length > 20,
    "login did not return a token",
  );
  summary.login = { status: login.status, token: "received" };

  const create = await request("/api/tasks", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ title: "Remote smoke test" }),
  });
  requireValue(create.status === 201, `create task returned ${create.status}`);
  const task = asObject(create.body);
  requireValue(typeof task.id === "number", "created task has no id");
  summary.create = { status: create.status, id: task.id };

  const list = await request("/api/tasks", {
    headers: { authorization: `Bearer ${token}` },
  });
  requireValue(list.status === 200, `list tasks returned ${list.status}`);
  const page = asObject(list.body);
  requireValue(Array.isArray(page.items), "list items is not an array");
  requireValue(
    typeof page.total === "number" && page.total >= 1,
    "list total is not positive",
  );
  summary.list = {
    status: list.status,
    total: page.total,
    items: page.items.length,
  };

  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  Deno.exit(1);
}
