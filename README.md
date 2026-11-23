# Tasks API: Abdullah Olcan Askar, 2024502180

MIS 233 Web Based Application Programming, Assignment 5.

A small Tasks API built with Deno 2, Hono, Drizzle ORM and SQLite. A user registers, logs
in, and can then create, list, update and delete only their own tasks. Every request body
and query string is checked with Zod, every failure has the same JSON shape, and the test
suite runs without starting a server.

## Repository

The project is kept in a private Git repository:
<https://github.com/olcanaskar/assignment5>

It will be made public before submission. To check a clean copy:

```sh
git clone https://github.com/olcanaskar/assignment5.git
cd assignment5
deno task test
```

## Run it

### Windows PowerShell

```powershell
Copy-Item .env.example .env
deno task dev
```

### macOS, Linux or Git Bash

```sh
cp .env.example .env
deno task dev
```

The API listens on <http://localhost:8000>. The OpenAPI document is at
<http://localhost:8000/openapi.json> and Swagger UI is at <http://localhost:8000/docs>. In
a second terminal:

```sh
deno task test
deno task check
deno fmt --check
deno lint
```

To fill a fresh database with demo data, run `deno task seed`. The demo users are
`demo1@example.com` and `demo2@example.com`, both with password `secret123`;
`demo2@example.com` is the admin.

To smoke-test the live deployment (health, register, login, create, list):

```sh
deno task smoke:remote https://tasks-api-f30l.onrender.com
```

The given `dev` task starts `src/main.ts` with the defaults `file:./tasks.db` and
port 8000. The `.env` file is not loaded automatically by that task; it is only read when
you pass `--env-file=.env`. The project runs without a `.env`, which is useful for a fresh
hand-in.

If you have an old `tasks.db` created before the migration switch, delete it once. The app
now applies the files in `drizzle/` at startup and records them in `__drizzle_migrations`.

For a schema change: edit `src/schema.ts`, run `deno task db:generate`, read the new file
in `drizzle/`, then run `deno task db:migrate` (or just start the app, which applies
pending migrations).

### Optional UI

`ui/` is the given React page. Start the API first, then in a second terminal:

```sh
deno task ui:install   # once
deno task ui:dev       # UI on http://localhost:5173
```

Vite forwards `/auth` and `/api` to port 8000.

## Tests

`deno task test` runs 64 tests. They cover:

- **Auth (9):** register 201, duplicate email 409, concurrent duplicate 201/409, bad body
  400, malformed JSON 400, login 200 with a token, wrong password and unknown email both
  401 with the same message, missing and unknown token 401.
- **Tasks (17):** table defaults, no token 401, create and list, owner and default fields,
  empty title 400, invalid status 400, another user's task 404 for read/update/delete,
  owner update and delete, completedAt transitions, pagination, limit/page/status/id
  boundaries, bad query 400, status filter, unknown route 404.
- **Health and config (7):** `/health`, `/healthz`, a healthy `/readyz`, a failing
  `/readyz` with 503, bad configuration, the production default secret, and a valid config
  object.
- **Logging (3):** `x-request-id` on every response, the same id in a 404 body, and the
  same id in a 500 body.
- **Rate limit (3):** five failures then 429, clearing on success, and the one-minute
  window expiring.
- **Soft delete (5):** the welcome task, a deleted task disappearing from list and lookup,
  restore, restoring a visible task 404, and a rolled-back registration.
- **Seed (1):** two users and twenty tasks on the first run, nothing duplicated on the
  second.
- **Summary (2):** the status totals on the route, and the naive and grouped versions
  returning the same numbers.
- **Migrations and index (1):** `deleted_at`, `due_date`, `role` and
  `idx_tasks_user_status` exist after the migrations run, and the old `sessions` table is
  gone.
- **JWT (3):** a tampered token, an expired token and a token signed with another secret
  all return 401.
- **RBAC (1):** the admin route returns 401 without a token, 403 for a normal user and 200
  for an admin.
- **Cache (1):** the first GET reads the database, the second is a cache hit, an API
  update invalidates the key, another user cannot hit the key, and DELETE removes it.
- **Pool (2):** 20 jobs on a pool of 3 never run more than 3 at once, and 20 concurrent
  task requests borrow and release pooled connections correctly.
- **OpenAPI (2):** `/openapi.json` lists the routes and the Bearer scheme, and `/docs`
  serves the Swagger UI page.
- **Upload (2):** a PNG upload and download, owner-only access, and the 400/413/415 file
  validation failures.
- **WebSocket (4):** a bad token gets 401; a real WebSocket receives created, updated and
  deleted messages; another user's socket receives nothing.
- **Purge (1):** only old done tasks with a completion date are removed, and a second run
  removes nothing.

Each test gets its own temporary SQLite file from `freshApp()`, so tests do not share
data. `app.request(...)` calls the Hono app directly; no server or port is needed.

## Design

### Tables

| Table   | Columns                                                                                                              | Notes                                                                                                                                                                                                                                                                                           |
| ------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `users` | `id`, `email`, `password_hash`, `role`, `created_at`                                                                 | `email` is unique; the password is stored only as a bcrypt hash; `role` is `user` or `admin`.                                                                                                                                                                                                   |
| `tasks` | `id`, `user_id`, `title`, `status`, `priority`, `created_at`, `due_date`, `attachment`, `completed_at`, `deleted_at` | `user_id` references `users.id`; `status` is `todo`, `in-progress` or `done`; `priority` is `low`, `medium` or `high`; `due_date` is reserved for a future reminder feature; `attachment` is a generated file name; `completed_at` is set while done; `deleted_at` is null until a soft delete. |

`tasks.status` and `tasks.priority` are restricted twice: with the Drizzle
`{ enum: [...] }` option for TypeScript, and with SQL `CHECK` constraints in the generated
migration for SQLite. The Drizzle schema and the migration files describe the same table.

`created_at` uses the SQL default `(strftime('%s','now'))`. A JavaScript `Date.now()` in
the schema would run once at start-up and give every row the same timestamp.

### Routes

| Method and path                  | Token? | Success                                  | Main failures                             |
| -------------------------------- | ------ | ---------------------------------------- | ----------------------------------------- |
| `GET /health`                    | no     | 200 `{ "ok": true }`                     | -                                         |
| `POST /auth/register`            | no     | 201 `{ id, email }`                      | 400 bad body, 409 email taken             |
| `POST /auth/login`               | no     | 200 `{ token }`                          | 400 bad body, 401 wrong email or password |
| `GET /api/tasks`                 | yes    | 200 `{ items, page, limit, total }`      | 400 bad query, 401                        |
| `GET /api/me/summary`            | yes    | 200 `{ todo, in-progress, done, total }` | 401                                       |
| `GET /api/admin/users`           | admin  | 200 `{ items }`                          | 401, 403                                  |
| `POST /api/tasks`                | yes    | 201 task                                 | 400, 401                                  |
| `GET /api/tasks/:id`             | yes    | 200 task                                 | 401, 404                                  |
| `PUT /api/tasks/:id`             | yes    | 200 updated task                         | 400, 401, 404                             |
| `DELETE /api/tasks/:id`          | yes    | 200 `{ "ok": true }`, soft delete        | 401, 404                                  |
| `POST /api/tasks/:id/restore`    | yes    | 200 restored task                        | 401, 404                                  |
| `POST /api/tasks/:id/attachment` | yes    | 200 task with attachment                 | 400, 401, 404, 413, 415                   |
| `GET /api/tasks/:id/attachment`  | yes    | 200 image bytes                          | 401, 404                                  |
| `GET /ws?token=...`              | query  | 101 WebSocket upgrade                    | 401                                       |

### Why these decisions

- **Another user's task is 404, not 403.** A 403 would tell the caller that the task
  exists. With 404 the API behaves as if the row is not there, which leaks nothing.
- **Wrong email and wrong password use the same 401 message.** The client learns that the
  credentials are wrong, but not whether the email is registered.
- **The password hash never leaves the database.** Register returns only `{ id, email }`,
  and login returns only `{ token }`.
- **JWTs replaced the sessions table.** Login signs a one-hour JWT with `sub` and `role`;
  `requireAuth` verifies it without a database lookup. The tradeoff is that a token cannot
  be revoked before it expires, unlike deleting a session row.
- **Roles are in the token.** `GET /api/admin/users` uses `requireRole("admin")`; a normal
  user gets 403, no token gets 401. The seed makes `demo2@example.com` the admin.
- **The task cache is per user.** GET one task uses a Deno KV key `["task", userId, id]`
  with a 60-second TTL; update, delete and restore delete the key.
- **The API documents itself.** The app is an `OpenAPIHono`; every route is described with
  `createRoute` and the same Zod schemas used for validation. `/openapi.json` serves the
  document and `/docs` serves Swagger UI with a Bearer Authorize button.
- **Uploads use generated names.** Attachments are limited to 1 MB and PNG/JPEG, written
  under `uploads/` with a UUID name, and served only to the task owner.
- **Live updates are per user.** `/ws?token=...` verifies the JWT before the upgrade and
  keeps `Map<number, Set<WebSocket>>`. Create, update, delete and restore send
  `{ type, task }` only to that user's sockets.
- **Old done tasks are purged.** `purgeOldDone(db, 30)` hard-deletes done tasks whose
  `completed_at` is older than 30 days; `Deno.cron` runs it daily at 03:00 and logs the
  count. The job is idempotent.
- **Zod validates the boundary.** `safeParse` produces the 400 body with `issues`; a bad
  token, an unknown route and a server error use `{ "error": "..." }`. `app.onError` logs
  the real error and returns only `internal error`.
- **Pagination is deterministic.** The list uses `ORDER BY created_at DESC, id DESC`.
  `created_at` has second precision, so the id is the tiebreaker for tasks created in the
  same second. The count query uses the same owner and status filter as the page query.
- **PUT replaces the whole task.** The same `TaskBody` schema is used for POST and PUT, so
  an omitted `status` or `priority` falls back to its default. The given UI was changed to
  send the current priority when it advances a task.
- **Delete is a soft delete.** `DELETE /api/tasks/:id` sets `deleted_at`; every normal
  lookup adds `isNull(tasks.deletedAt)`. `POST /api/tasks/:id/restore` clears the column.
  A deleted task is invisible to list, get and update until it is restored.
- **Registration is one transaction.** The user insert and the welcome task insert run in
  `db.transaction(...)`. If the welcome task fails, the user insert is rolled back, so a
  half-created account cannot exist.
- **Every task query includes the owner.** The helpers `ownVisible(id, userId)` and
  `ownDeleted(id, userId)` combine the id, the owner and the matching `deleted_at` state;
  Drizzle passes the values as SQL parameters, so user input is never joined into a SQL
  string.
- **Seed data is idempotent.** `deno task seed` inserts two demo users and ten tasks each;
  on a second run it finds the users and their tasks and adds nothing.
- **The summary uses one query.** The route calls `summaryGrouped`, which is one
  `GROUP BY status` query. `summaryNaive` is kept for the comparison: it loads the rows
  and then runs one count query per status, four queries in total.
- **The list index matches the list query.** `idx_tasks_user_status` covers
  `(user_id, status)`, the two columns used by the filtered list and the summary. The
  benchmark in `scripts/explain.ts` shows the plan change.

## API with curl

Start the API with `deno task dev` and use a fresh `tasks.db` for the cleanest output. The
examples below use Git Bash, macOS or Linux. In PowerShell,
`curl.exe --data-binary "@file"` is easier because PowerShell changes the quotes in inline
JSON.

```sh
BASE=http://localhost:8000
```

### Health

```sh
curl -s $BASE/health
# {"ok":true}
```

### Register

```sh
curl -s -X POST $BASE/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"secret123"}'
# {"id":1,"email":"ada@example.com"}
```

A second registration with the same email:

```sh
curl -s -X POST $BASE/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"secret123"}'
# {"error":"email already taken"}
```

### Login

```sh
curl -s -X POST $BASE/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"secret123"}'
# {"token":"eyJhbGciOiJIUzI1NiJ9..."}   (the JWT is shortened here)
```

Copy the token from the response and put it in a variable:

```sh
TOKEN='paste-the-token-from-the-login-response'
```

A wrong password gives the same message as an unknown email:

```sh
curl -s -X POST $BASE/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"wrong-password"}'
# {"error":"invalid email or password"}

curl -s -X POST $BASE/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"nobody@example.com","password":"secret123"}'
# {"error":"invalid email or password"}
```

### List tasks after registration

Registration creates a welcome task in the same transaction (Bonus 2), so the first list
already has one item:

```sh
curl -s $BASE/api/tasks -H "authorization: Bearer $TOKEN"
# {"items":[{"id":1,"userId":1,"title":"Welcome! Add your first task.","status":"todo","priority":"medium","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}],"page":1,"limit":20,"total":1}
```

Without a token:

```sh
curl -s $BASE/api/tasks
# {"error":"unauthorized"}
```

### Create a task

```sh
curl -s -X POST $BASE/api/tasks \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"title":"Write the README","priority":"high"}'
# {"id":2,"userId":1,"title":"Write the README","status":"todo","priority":"high","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}
```

```sh
curl -s -X POST $BASE/api/tasks \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"title":"Run the test suite"}'
# {"id":3,"userId":1,"title":"Run the test suite","status":"todo","priority":"medium","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}
```

An empty title is a 400:

```sh
curl -s -X POST $BASE/api/tasks \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"title":""}'
# {"error":"validation failed","issues":[{"origin":"string","code":"too_small","minimum":1,"inclusive":true,"path":["title"],"message":"Too small: expected string to have >=1 characters"}]}
```

An invalid status is also a 400:

```sh
curl -s -X POST $BASE/api/tasks \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"title":"Task","status":"urgent"}'
# {"error":"validation failed","issues":[{"code":"invalid_value","values":["todo","in-progress","done"],"path":["status"],"message":"Invalid option: expected one of \"todo\"|\"in-progress\"|\"done\""}]}
```

### List tasks

```sh
curl -s $BASE/api/tasks -H "authorization: Bearer $TOKEN"
# {"items":[{"id":3,"userId":1,"title":"Run the test suite","status":"todo","priority":"medium","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null},{"id":2,"userId":1,"title":"Write the README","status":"todo","priority":"high","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null},{"id":1,"userId":1,"title":"Welcome! Add your first task.","status":"todo","priority":"medium","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}],"page":1,"limit":20,"total":3}
```

### Summary per status (Bonus 3)

```sh
curl -s $BASE/api/me/summary -H "authorization: Bearer $TOKEN"
# {"todo":2,"in-progress":0,"done":1,"total":3}
```

### Admin users (Bonus 9)

After `deno task seed`, `demo2@example.com` is the admin. The normal demo user gets 403:

```sh
curl -s $BASE/api/admin/users -H "authorization: Bearer $DEMO1_TOKEN"
# {"error":"forbidden"}
```

The admin gets the list without password hashes:

```sh
curl -s $BASE/api/admin/users -H "authorization: Bearer $DEMO2_TOKEN"
# {"items":[{"id":1,"email":"demo1@example.com","role":"user","createdAt":1795356928},{"id":2,"email":"demo2@example.com","role":"admin","createdAt":1795356928}]}
```

### Get one task

```sh
curl -s $BASE/api/tasks/2 -H "authorization: Bearer $TOKEN"
# {"id":2,"userId":1,"title":"Write the README","status":"todo","priority":"high","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}
```

A task that belongs to another user answers 404. After registering `bob@example.com` and
using Bob's token:

```sh
curl -s $BASE/api/tasks/2 -H "authorization: Bearer $BOB_TOKEN"
# {"error":"not found"}
```

### Update a task

`PUT` replaces the task, so it sends the current `priority` as well:

```sh
curl -s -X PUT $BASE/api/tasks/2 \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"title":"Write the README","status":"done","priority":"high"}'
# {"id":2,"userId":1,"title":"Write the README","status":"done","priority":"high","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}
```

### Pagination and filtering

```sh
curl -s "$BASE/api/tasks?page=1&limit=1&status=done" \
  -H "authorization: Bearer $TOKEN"
# {"items":[{"id":2,"userId":1,"title":"Write the README","status":"done","priority":"high","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}],"page":1,"limit":1,"total":1}
```

A bad limit is a 400, not a crash:

```sh
curl -s "$BASE/api/tasks?limit=1000" -H "authorization: Bearer $TOKEN"
# {"error":"validation failed","issues":[{"origin":"number","code":"too_big","maximum":100,"inclusive":true,"path":["limit"],"message":"Too big: expected number to be <=100"}]}
```

### Soft delete and restore (Bonus 2)

`DELETE` sets `deleted_at` instead of removing the row, so the task disappears from every
normal query but can be restored:

```sh
curl -s -X DELETE $BASE/api/tasks/3 -H "authorization: Bearer $TOKEN"
# {"ok":true}
```

```sh
curl -s $BASE/api/tasks/3 -H "authorization: Bearer $TOKEN"
# {"error":"not found"}
```

The list now has the other two tasks:

```sh
curl -s $BASE/api/tasks -H "authorization: Bearer $TOKEN"
# {"items":[{"id":2,"userId":1,"title":"Write the README","status":"done","priority":"high","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null},{"id":1,"userId":1,"title":"Welcome! Add your first task.","status":"todo","priority":"medium","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}],"page":1,"limit":20,"total":2}
```

```sh
curl -s -X POST $BASE/api/tasks/3/restore -H "authorization: Bearer $TOKEN"
# {"id":3,"userId":1,"title":"Run the test suite","status":"todo","priority":"medium","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}
```

Restoring a task that is not deleted is a 404:

```sh
curl -s -X POST $BASE/api/tasks/3/restore -H "authorization: Bearer $TOKEN"
# {"error":"not found"}
```

### Unknown route

```sh
curl -s $BASE/nope
# {"error":"not found","requestId":"e3a8a73c-832f-4dbb-866a-a5cba7149235"}
```

## My own log

### 1. The starter failed `deno lint` on Deno 2.9.7

The starter was tested with Deno 2.6.3. On Deno 2.9.7, `deno task test`, `deno task check`
and `deno fmt --check` passed, but `deno lint` failed with six errors:

```text
error[jsx-button-has-type]: `button` elements must have a `type` attribute
   --> C:\Projects\assignment5\ui\src\App.tsx:126:14
```

The root `deno lint` also scans `ui/`, which is not graded. I added `type="button"` to the
six buttons in `ui/src/App.tsx`; `deno lint` is clean now.

### 2. PowerShell turned my JSON body into invalid JSON

I first tested the API with `curl.exe` from PowerShell and passed the JSON body as a
variable:

```powershell
curl.exe -s -X POST http://localhost:8000/auth/register `
  -H "content-type: application/json" -d $body
```

The server answered:

```json
{
  "error": "validation failed",
  "issues": [
    {
      "expected": "string",
      "code": "invalid_type",
      "path": ["email"],
      "message": "Invalid input: expected string, received undefined"
    },
    {
      "expected": "string",
      "code": "invalid_type",
      "path": ["password"],
      "message": "Invalid input: expected string, received undefined"
    }
  ]
}
```

The body was valid in PowerShell, but the native argument quoting removed the double
quotes before curl sent it. `c.req.json()` failed, my `.catch(() => ({}))` turned the
failure into an empty object, and Zod reported the missing fields. I used
`Invoke-RestMethod` for the smoke test and `curl.exe --data-binary "@file.json"` for the
curl outputs above.

### 3. PUT reset a high priority to medium

I created a task with `"priority":"high"` and then sent a PUT with only `title` and
`status`. The response came back with `"priority":"medium"`. The reason is that `PUT` uses
the same `TaskBody` schema as `POST`, whose defaults are `todo` and `medium`, and `PUT`
replaces the whole task. I kept the full-replacement behaviour because that is what `PUT`
means in the handout, and changed the given UI's advance action to send the current
priority too. A partial update would need a separate PATCH schema with optional fields.

### 4. Two tasks created in the same second had the same `createdAt`

I created two tasks quickly and both had `"createdAt":1795343577`. The SQL default uses
seconds, so ordering by `created_at` alone was not deterministic. I changed the list query
to `ORDER BY created_at DESC, id DESC`; the id is the tiebreaker, so page 1 and page 2
cannot show the same item or skip an item.

### 5. `deno task dev` did not read `.env`

I changed `PORT` in `.env` and ran a small script with and without the flag:

```text
without flag: undefined
with flag: 8123
```

The given `dev` task is `deno run -A --watch src/main.ts`, with no `--env-file`. The
server still works because `src/main.ts` has defaults (`file:./tasks.db`, port 8000). I
left the task unchanged so the project runs from a fresh zip without a `.env`; the README
explains how to pass `--env-file=.env` when the file is wanted.

### 6. `deno task check` only checked the top level

The task checked only `src/*.ts` and `tests/*.ts`. When I added `scripts/seed.ts`, it
would not have been type-checked, so I extended the task to
`deno check src/*.ts tests/*.ts scripts/*.ts`. A new subfolder such as `src/routes/` would
still be missed; I kept the source files flat.

### 7. The welcome task broke my task-count tests

After Bonus 2, every registration created one extra task, so tests that expected two tasks
saw three. I changed `registerAndLogin()` in `tests/helpers.ts` to soft-delete the welcome
task before returning the token, and added `tests/bonus2_test.ts` to check the welcome
task and the rollback explicitly. The helper now also exercises DELETE on every setup.

### 8. Drizzle Kit did not generate the CHECK constraints from `{ enum }`

My first generated migration had no SQL `CHECK` on `status` or `priority`; the
`{ enum: [...] }` option only restricts TypeScript. I added `check()` definitions to
`src/schema.ts`, deleted the `drizzle/` folder and regenerated `0000`. The new SQL
contains:

```sql
CONSTRAINT "tasks_status_check" CHECK("tasks"."status" in ('todo', 'in-progress', 'done')),
CONSTRAINT "tasks_priority_check" CHECK("tasks"."priority" in ('low', 'medium', 'high'))
```

### 9. `Deno.openKv` was undefined until I passed `--unstable-kv`

The first time I checked the KV API I got:

```text
$ deno eval "console.log(typeof Deno.openKv)"
undefined
$ deno eval --unstable-kv "console.log(typeof Deno.openKv)"
function
```

I added `--unstable-kv` to the `dev`, `start`, `start:prod`, `start:test`, `test` and
`check` tasks. Without the flag the server would not start with the cache code.

### 10. OpenAPIHono rejected my union responses

When I converted `app.ts`, TypeScript rejected
`app.openapi(route, requireRole("admin"), handler)` because the middleware was read as the
handler, and it rejected `c.json(task)` because the response status became a union. I
moved `requireRole` to `app.use("/api/admin/users", requireRole("admin"))` and passed
explicit statuses (`c.json(task, 200)`, `c.json({ ok: true }, 200)`). After that
`deno check` passed.

### 11. `c.req.parseBody()` needed a concrete record type

The upload handler did `const body = await c.req.parseBody().catch(() => ({}))` and
TypeScript rejected `body["file"]`:

```text
Element implicitly has an 'any' type because expression of type '"file"' can't be used to index type '{ [x: string]: string | File; } | {}'.
```

I changed it to `const body: Record<string, string | File> = ...`. The empty fallback is
still a valid record, and the `file instanceof File` check handles the rest.

### 12. The WebSocket test needed a real server

`app.request()` can test that a bad token gets 401, but it cannot upgrade a real socket. I
started `Deno.serve({ port: 0 }, app.fetch)` inside the test, read `server.addr.port`,
connected with `new WebSocket(...)`, created a task through `fetch`, and received:

```json
{"type":"created","task":{"id":2,"title":"Live task",...}}
```

The test closes the socket and calls `server.shutdown()` in `finally`.

### 13. Docker was not installed on my machine

`docker --version` failed with `CommandNotFoundException`. Instead of claiming an untested
image, I put the build and run in the GitHub Actions `docker` job; it built the image, ran
the container with a volume, restarted it, and got the expected 409 for the duplicate
email. The real log and image size are in Bonus 17.

### 14. `deno deploy` needs a token in this non-interactive shell

`deno deploy whoami` downloaded its CLI and then stopped with:

```text
This command requires interactive input, but stdin is not a terminal.
Set the DENO_DEPLOY_TOKEN environment variable or use --token.
```

I prepared the Turso/libSQL token support and documented both providers. Deno Deploy
itself still stopped at the missing token error above; I used Render instead (see Bonus
19).

### 15. Turso rejected `PRAGMA journal_mode=WAL`

The first Render deploy exited with status 1:

```text
LibsqlError: SQL_PARSE_ERROR: SQL not allowed statement: PRAGMA journal_mode=WAL
    at async createDbPool (file:///app/src/dbPool.ts:21:5)
```

WAL and `busy_timeout` are local SQLite settings; hosted libSQL manages concurrency itself
and rejects the pragma. I changed `createDbPool` to run both pragmas only when the URL
starts with `file:`. The local pool tests still pass, and the remote pool no longer sends
the statement.

### 16. Render deployment succeeded after the Turso fix

After the fix, Render rebuilt the Docker image. `/health` returned `{"ok":true}`, and I
tested register, login, task creation and listing against
`https://tasks-api-f30l.onrender.com`. `/openapi.json` and `/docs` also returned 200. The
database lives in Turso; Render’s `/tmp` cache and uploads are ephemeral on the free plan.

### 17. Malformed JSON was a 500

I sent `{not-json` to `/auth/register` and expected 400. The zod-openapi validator threw
an `HTTPException` with status 400, but my `app.onError` caught every error as a 500:

```json
{ "error": "internal error", "requestId": "..." }
```

I added an `HTTPException` branch that returns its real status and message, and a test
that checks the 400 plus the request id. The normal 500 path still hides internal details.

## Bonus 1: Migrations with Drizzle Kit

`src/db.ts` no longer contains hand-written `CREATE TABLE` SQL. `migrate()` calls the
Drizzle migrator with the `drizzle/` folder:

```ts
await runMigrations(db, { migrationsFolder: "./drizzle" });
```

`drizzle.config.ts` points at `src/schema.ts` and writes to `drizzle/`. The folder
contains:

- `0000_sharp_maverick.sql` — users, sessions and tasks, including the SQL CHECK
  constraints.
- `0001_lyrical_tana_nile.sql` — `ALTER TABLE tasks ADD due_date integer;`
- `0002_strange_la_nuit.sql` — `CREATE INDEX idx_tasks_user_status ...;` (Bonus 4).
- `0003_oval_thunderbolt.sql` — `DROP TABLE sessions;` (Bonus 7).
- `0004_breezy_moonstone.sql` — `ALTER TABLE users ADD role ... NOT NULL;` (Bonus 9).

For the second change I added `dueDate` as a nullable integer to `src/schema.ts`, ran
`deno task db:generate`, read the generated `ALTER TABLE`, and only then ran
`deno task db:migrate`. `tests/migrations_test.ts` checks that the new columns, the role
column, the index and the removed sessions table are as expected after a fresh migration.

## Bonus 2: Soft delete, restore and a transaction

- `tasks` has a nullable `deleted_at` column.
- `DELETE /api/tasks/:id` sets it to the current SQL time; list, get and update add
  `isNull(tasks.deletedAt)`.
- `POST /api/tasks/:id/restore` clears it and answers 404 when the task is visible or
  belongs to another user.
- Registration runs the user insert and the welcome task insert in one
  `db.transaction(async (tx) => ...)`.
- The rollback test creates a trigger that aborts the welcome insert; after the 500, both
  `users` and `tasks` are empty.

Real output:

```sh
curl -s -X DELETE $BASE/api/tasks/3 -H "authorization: Bearer $TOKEN"
# {"ok":true}
curl -s $BASE/api/tasks/3 -H "authorization: Bearer $TOKEN"
# {"error":"not found"}
curl -s -X POST $BASE/api/tasks/3/restore -H "authorization: Bearer $TOKEN"
# {"id":3,"userId":1,"title":"Run the test suite","status":"todo","priority":"medium","createdAt":1795356216,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}
```

`tests/bonus2_test.ts` covers the welcome task, delete hiding, restore, restore-visible
404 and the rolled-back registration.

## Bonus 3: Joins and the N+1 problem

`GET /api/me/summary` returns `{ todo, in-progress, done, total }`.

The naive version `summaryNaive()` loads the task ids and then runs one count query per
status: **4 queries**. The grouped version `summaryGrouped()` runs one `GROUP BY status`
query: **1 query**. `deno task db:summary-count` prints the actual queries:

```text
naive: 4 queries
Query: select "id" from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null) -- params: [1]
Query: select count(*) from "tasks" where (("tasks"."user_id" = ? and "tasks"."deleted_at" is null) and "tasks"."status" = ?) -- params: [1, "todo"]
Query: select count(*) from "tasks" where (("tasks"."user_id" = ? and "tasks"."deleted_at" is null) and "tasks"."status" = ?) -- params: [1, "in-progress"]
Query: select count(*) from "tasks" where (("tasks"."user_id" = ? and "tasks"."deleted_at" is null) and "tasks"."status" = ?) -- params: [1, "done"]

grouped: 1 query
Query: select "status", count(*) from "tasks" where ("tasks"."user_id" = ? and "tasks"."deleted_at" is null) group by "tasks"."status" -- params: [1]
```

The naive query count grows with the number of groups (and would grow per user or tag if
the summary were extended); the grouped query stays one query regardless of the number of
rows. The route uses the grouped version. `tests/summary_test.ts` checks that both
versions return the same numbers, that the route counts only visible tasks, and that a
soft delete changes the total.

## Bonus 4: Indexes and EXPLAIN

`idx_tasks_user_status` is declared in `src/schema.ts` and created by
`drizzle/0002_strange_la_nuit.sql`.

`deno task db:explain` fills a temporary database with 20 users and 20,000 tasks, drops
the index, runs `EXPLAIN QUERY PLAN` and times the query, then creates the index and
repeats. Real output:

```json
{
  "seededUsers": 20,
  "seededTasks": 20000,
  "before": {
    "plan": ["SCAN tasks"],
    "averageMs": 5.35
  },
  "after": {
    "plan": ["SEARCH tasks USING INDEX idx_tasks_user_status (user_id=? AND status=?)"],
    "averageMs": 3.69
  }
}
```

The plan changes from a full table scan to an index search, and the average of 30 runs
drops from 5.35 ms to 3.69 ms. The index costs extra storage and makes inserts and updates
slightly slower, so it is worth it here because the list and summary both filter on
`(user_id, status)`. `tests/migrations_test.ts` also checks that the index exists after
the migrations run.

## Bonus 5: Seed data

`scripts/seed.ts` opens the configured database, migrates it, and calls `seedDemoData()`
in `src/seed.ts`. It creates two users and ten tasks each. Users are inserted with
`onConflictDoNothing()`, and a user who already has any task is skipped, so a second run
changes nothing.

Real output:

```text
$ deno task seed
{"users":2,"tasks":20,"skippedUsers":0}
Demo users: demo1@example.com / secret123, demo2@example.com / secret123

$ deno task seed
{"users":0,"tasks":0,"skippedUsers":2}
Demo users: demo1@example.com / secret123, demo2@example.com / secret123
```

With `.env.production` it refuses before touching the database:

```text
$ deno run -A --env-file=.env.production scripts/seed.ts
Refusing to seed a production database.
exit: 1
```

The demo login `demo1@example.com` / `secret123` returns ten tasks; `demo2@example.com` is
the admin. `tests/seed_test.ts` checks the counts, the admin role and the second run.

## Bonus 6: A connection pool (Postgres or SQLite)

I chose **option B, the SQLite pool**, which counts as two bonuses.

`src/pool.ts` contains the generic `Pool<T>`: `acquire()` returns an idle item or waits in
a FIFO queue, `release()` hands the item directly to the next waiter, and `use()` always
releases in a `finally`.

`src/dbPool.ts` opens three libSQL clients on the same SQLite file and runs
`PRAGMA journal_mode=WAL` and `PRAGMA busy_timeout=5000` on each. `main.ts` builds the
pool and passes it to `createApp`. A middleware on `/api/*` borrows one connection, stores
it on the context, and releases it in `finally`; the task routes read it with
`c.get("db")`.

The pool size is **3**: enough to show queueing without opening many SQLite handles. When
all three are busy, `acquire()` waits; `release()` wakes the next waiter. Real proof is in
`tests/pool_test.ts`: 20 jobs on a pool of 3 never run more than 3 at once, all 20 finish,
and 20 concurrent task requests return 200.

SQLite gains less from a pool than Postgres because it still has one writer; WAL lets
readers continue while a writer works, and `busy_timeout` waits instead of failing
immediately. Postgres could run writes in parallel, so a pool matters more there.

## Bonus 7: JWT instead of sessions

`src/auth.ts` uses `jose`. Login signs a one-hour HS256 token with `sub` and `role`;
`requireAuth` verifies it and sets `userId` and `role` without a database lookup. The old
`sessions` table is removed by `drizzle/0003_oval_thunderbolt.sql`.

Real login output (shortened):

```json
{ "token": "eyJhbGciOiJIUzI1NiJ9..." }
```

The secret comes from `JWT_SECRET`; `src/config.ts` refuses the default `dev-secret` in
production. `tests/jwt_test.ts` covers a tampered token, an expired token and a token
signed with another secret; all three return 401.

Sessions vs JWT: a session row can be deleted to revoke access immediately, but every
request needs a database lookup. A JWT needs no lookup and works across several servers,
but it cannot be revoked before it expires. The one-hour lifetime is the compromise.

## Bonus 8: OpenAPI and a docs page

The app is an `OpenAPIHono`. Every route has a `createRoute` definition with its method,
path, request schema, response schemas and security, and the handlers are registered with
`app.openapi(...)`. The same `Credentials`, `TaskBody` and `TaskQuery` Zod schemas used
for validation also appear in the document.

`GET /openapi.json` serves the OpenAPI document with the **Bearer** security scheme, so
Swagger UI has an Authorize button. `GET /docs` serves a Swagger UI page that loads
`/openapi.json`. The document includes the 400, 401, 403, 404 and 500 responses as well as
the success responses.

A `defaultHook` keeps the project's error shape for automatic validation failures:
`{ "error": "validation failed", "issues": [...] }`. `tests/openapi_test.ts` checks that
the document lists the routes (`/health`, `/auth/register`, `/auth/login`, `/api/tasks`,
`/api/tasks/{id}`, `/api/tasks/{id}/restore`, `/api/me/summary`, `/api/admin/users`) and
that `/docs` serves the Swagger UI HTML.

## Bonus 9: Roles (RBAC)

`users.role` is `user` or `admin` (added by `drizzle/0004_breezy_moonstone.sql`). The role
is put in the JWT at login, and `requireAuth` stores it in the context. `requireRole(...)`
returns 401 when no role is present and 403 when the role is not allowed.

`GET /api/admin/users` is admin-only and selects `id`, `email`, `role` and `createdAt`;
`password_hash` is never selected. The seed makes `demo2@example.com` the admin and
`demo1@example.com` a normal user.

Real output:

```text
demo1 (role user):  403 {"error":"forbidden"}
demo2 (role admin): 200 {"items":[{"id":1,"email":"demo1@example.com","role":"user","createdAt":1795356928},{"id":2,"email":"demo2@example.com","role":"admin","createdAt":1795356928}]}
no token:           401 {"error":"unauthorized"}
```

`tests/rbac_test.ts` covers all three outcomes. 401 means "not authenticated"; 403 means
"authenticated but not allowed".

## Bonus 10: Logging and request ids

Every request passes through one middleware in `src/app.ts`. It creates a UUID, sets the
`x-request-id` response header, measures the request with `performance.now()`, and prints
one JSON line after the route finishes:

```json
{"requestId":"804b7420-7512-4b07-8703-2181eeaf231f","method":"GET","path":"/healthz","status":200,"ms":1}
{"requestId":"51668991-f33d-47ff-8247-d8fad48e3307","method":"POST","path":"/auth/login","status":401,"ms":77}
{"requestId":"90004dac-46a0-4f13-8767-ede12f23ecac","method":"POST","path":"/auth/login","status":429,"ms":0}
{"requestId":"e3a8a73c-832f-4dbb-866a-a5cba7149235","method":"GET","path":"/nope","status":404,"ms":0}
```

The line contains only the method, path, status, duration and id; it never includes the
request body or the Authorization header. After a real run I checked the captured log:

```powershell
Get-Content $out | Select-String -Pattern 'secret123|password|Bearer|token'
# no match
```

The 404 and 500 bodies repeat the same id:

```sh
curl -s -i $BASE/nope
# x-request-id: e3a8a73c-832f-4dbb-866a-a5cba7149235
# {"error":"not found","requestId":"e3a8a73c-832f-4dbb-866a-a5cba7149235"}
```

`tests/logging_test.ts` checks the header, the 404 body and the 500 body.

## Bonus 11: Health, readiness and configuration

- `GET /healthz` answers 200 `{ "ok": true }`.
- `GET /readyz` runs `SELECT 1`; it answers 200 `{ "ready": true }` or 503
  `{ "ready": false }`.
- `src/config.ts` reads `PORT`, `DATABASE_URL`, `JWT_SECRET` and `APP_ENV` once, validates
  them with Zod, and returns one `Config` object.
- `src/main.ts` catches a bad configuration, prints the reason and exits with status 1.
- In production the default `dev-secret` is refused.
- `deno.json` has `start:prod` and `start:test` tasks for `.env.production` and
  `.env.test`.

Real run with `.env.production`:

```text
$ deno task start:prod
$ curl -s localhost:8000/healthz
{"ok":true}
$ curl -s localhost:8000/readyz
{"ready":true}
```

A bad configuration stops the process:

```text
$ deno run -A --env-file=bad.env src/main.ts
Configuration error: invalid configuration: port: Invalid input: expected number, received NaN
exit: 1
```

`tests/config_test.ts` covers a bad port and the production default secret;
`tests/health_test.ts` covers healthz, a healthy readyz and a failing readyz (503).
`start:test` was also run on port 8001, where `/healthz` and `/readyz` answered 200.

## Bonus 12: File upload

`tasks.attachment` is a nullable generated filename
(`drizzle/0005_omniscient_wild_child.sql`). `POST /api/tasks/:id/attachment` reads the
multipart form, checks that `file` is a `File` (400), at most 1 MB (413), and
`image/png`/`image/jpeg` (415), then writes it under `uploads/` with a UUID name. It never
uses the browser's file name. Replacing an attachment removes the old file.

`GET /api/tasks/:id/attachment` checks the owner and streams the bytes with the right
`content-type`; another user or a task without an attachment gets 404. `uploads/` is in
`.gitignore`. Both attachment routes are also registered in the OpenAPI document.

`tests/upload_test.ts` covers a successful PNG upload/download, another user's 404, a
missing attachment 404, and the 400/413/415 validation failures.

## Bonus 13: WebSocket live updates

`GET /ws?token=...` checks the JWT before calling `Deno.upgradeWebSocket`; a bad token
gets 401, and a browser can connect because the token travels in the query string (a
browser cannot set an Authorization header on a WebSocket).

The app keeps `Map<number, Set<WebSocket>>`. `onopen` adds the socket to the user's set
and `onclose` removes it. After create, update, delete and restore, only that user's
sockets receive a JSON message:

```json
{"type":"created","task":{"id":2,"title":"Live task",...}}
```

`tests/ws_test.ts` starts a real server on port 0, connects with a WebSocket, creates a
task over HTTP and receives the message. The bad-token test checks the 401 before any
upgrade. For a manual check, log in, then run:

```sh
deno run -A scripts/ws-client.ts "$TOKEN"
```

and create, update or delete a task from another terminal. The client prints each
`{ "type", "task" }` message; two browser tabs connected with the same token both receive
it, while another user's tab receives nothing.

## Bonus 14: A background job with Deno.cron

`tasks.completed_at` (added by `drizzle/0006_wise_lila_cheney.sql`) is set when a task
becomes `done` and cleared when it leaves `done`. `purgeOldDone(db, 30)` hard-deletes done
tasks whose completion time is older than 30 days; tasks without `completed_at` are left
alone.

`src/main.ts` registers the job:

```ts
Deno.cron("purge old done tasks", "0 3 * * *", async () => {
  const removed = await purgeOldDone(db, 30);
  console.log(JSON.stringify({ job: "purge", removed }));
});
```

`--unstable-cron` is in the `dev`, `start`, `start:prod`, `start:test` and `check` tasks.
For a quick real check I used a temporary `* * * * *` schedule and got:

```text
cron registered
{"job":"purge","removed":1}
```

`tests/purge_test.ts` inserts an old done task, a recent done task, an old todo task and a
done task without a date. Only the old done task is removed, and a second run removes
nothing, so the job is idempotent.

## Bonus 15: Rate limit on login

`src/rateLimit.ts` keeps a `Map` from email to `{ count, resetAt }`. The login route
checks the bucket before it checks the password. Five failed logins in one minute block
the sixth attempt for the rest of the window, even when the password is correct.

Real run:

```text
attempts 1-5: 401 {"error":"invalid email or password"}
attempt 6:    429
HTTP/1.1 429 Too Many Requests
retry-after: 60
{"error":"too many login attempts"}
```

A successful login clears the bucket, and an expired window starts again from zero.
`tests/rate_limit_test.ts` covers the five failures and 429, the clearing on success, and
the one-minute expiry with a fake clock.

This limiter is in memory: it does not protect a multi-process deployment, it resets on
restart, and an attacker can still try many different email addresses because every email
has its own bucket. A shared store such as Deno KV or Redis would be the next step.

## Bonus 16: A cache with Deno KV

`src/main.ts` opens one `Deno.Kv` and passes it to `createApp`. GET one task checks the
key `["task", userId, id]`; on a miss it loads the row from SQLite and stores it with
`expireIn: 60_000`. PUT, DELETE and restore delete the key, and the user id is part of the
key so one user can never read another user's cached task.

`tests/cache_test.ts` counts Drizzle `Query:` lines:

- first GET: **1 query**
- second GET: **0 queries** (cache hit)
- after a direct database change: **0 queries**, so the cached row is served
- after an API PUT: **1 query**, because the key was invalidated
- after DELETE: **404**, not the stale cached row
- another user: **404**, because the key includes the user id

The cache entry expires after 60 seconds. `--unstable-kv` is required and is already in
the `dev`, `start`, `test` and related tasks.

## Bonus 17: Docker

The `Dockerfile` uses `denoland/deno:2.6.3`, copies `deno.json`/`deno.lock`, `src`,
`drizzle` and `scripts`, and caches dependencies before copying the source, so a code
change does not download them again. It creates `/data/uploads`, runs as the non-root
`deno` user, and keeps `tasks.db`, `uploads/` and `kv.sqlite` on the `/data` volume:

```sh
docker build -t tasks-api .
docker volume create tasksdata
docker run -d --rm -p 8000:8000 -v tasksdata:/data tasks-api
```

The permission flags are: `--allow-net` for HTTP and WebSocket, `--allow-env` for the
configuration, `--allow-read`/`--allow-write` for the database, migrations, uploads and
KV, `--allow-ffi` for the native libSQL client, `--allow-sys` for system information, and
`--unstable-kv`/`--unstable-cron` for the cache and cron APIs.

Docker is not installed on the Windows machine, so the `docker` job in GitHub Actions
performed the real build/run. The log shows:

```text
Register a user: {"id":1,"email":"docker@example.com"}
After stop/start: {"ok":true}duplicate status: 409
tasks-api:latest 426MB
```

The full job is
[this Docker job](https://github.com/olcanaskar/assignment5/actions/runs/45034319297/job/137244553342).
The image is 426 MB; a multi-stage build or `deno compile` with a slimmer base would make
it smaller, while the dependency layer already avoids re-downloading packages.

## Bonus 18: Continuous integration

`.github/workflows/ci.yml` runs on every push and pull request:

- **test:** checkout, Deno 2 setup, `deno fmt --check`, `deno lint`, `deno task check`,
  `deno task test`.
- **docker:** build the image, run it with the `tasksdata` volume, wait for `/health`,
  register a user, restart the container, verify the duplicate email is still 409, and
  print the image size.

Green run:
[45034825913](https://github.com/olcanaskar/assignment5/actions/runs/45034825913)

Red run: [45034842476](https://github.com/olcanaskar/assignment5/actions/runs/45034842476)
— branch `ci-red-demo`, with an intentional `assertEquals(1, 2)` test.

The branch was reverted in
[45034933558](https://github.com/olcanaskar/assignment5/actions/runs/45034933558), so the
fix is visible as a green run; the temporary branch was then deleted and `main` stayed
green.

## Bonus 19: Deploy

Deno Deploy is not accepting new accounts, so I deployed the same Docker image on
**Render** with a free **Turso** libSQL database.

**Public URL: <https://tasks-api-f30l.onrender.com>**

- `/health` returns `{"ok":true}`.
- Register, login, create task and list tasks were tested against the live service.
- `/openapi.json` (12 paths) and `/docs` both return 200.
- `render.yaml` uses the Docker runtime, Frankfurt, the free plan, `APP_ENV=production`, a
  generated `JWT_SECRET`, and secrets for `DATABASE_URL` and `TURSO_AUTH_TOKEN`.
- Turso is the persistent database. On Render’s free plan, `/tmp/kv.sqlite` and
  `/tmp/uploads` are ephemeral; the database is the important persistent part.
- `Deno.cron` runs while the free instance is awake; the free plan can sleep, so the daily
  purge is not guaranteed there.

### Live curl

```sh
BASE=https://tasks-api-f30l.onrender.com

curl -s $BASE/health
# {"ok":true}

curl -s -X POST $BASE/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"render181516@example.com","password":"secret123"}'
# {"id":1,"email":"render181516@example.com"}

curl -s -X POST $BASE/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"render181516@example.com","password":"secret123"}'
# {"token":"eyJhbGciOiJIUzI1NiJ9..."}   (shortened)

TOKEN='paste-the-token'

curl -s -X POST $BASE/api/tasks \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"title":"Render smoke test"}'
# {"id":2,"userId":1,"title":"Render smoke test","status":"todo","priority":"medium","createdAt":1795360517,"dueDate":null,"attachment":null,"completedAt":null,"deletedAt":null}

curl -s $BASE/api/tasks -H "authorization: Bearer $TOKEN"
# {"items":[{"id":2,...,"title":"Render smoke test",...},{"id":1,...,"title":"Welcome! Add your first task.",...}],"page":1,"limit":20,"total":2}
```

`/openapi.json` and `/docs` both answered 200 on the live service.

To redeploy: push to `main` (Blueprint autoDeploy), or open Render → Deploys → **Deploy
latest commit**. The live service uses the Docker image and applies the Drizzle migrations
at startup.

**Fly.io alternative:** use the same image with a 1 GB volume at `/data`,
`DATABASE_URL=file:/data/tasks.db`, `KV_PATH=/data/kv.sqlite`, `UPLOAD_DIR=/data/uploads`,
and `JWT_SECRET` set with `fly secrets`. This keeps SQLite, uploads and KV on one volume,
but Fly requires a credit card.

## Bonuses claimed

- **Bonus 1: Migrations with Drizzle Kit**
- **Bonus 2: Soft delete, restore and a transaction**
- **Bonus 3: Joins and the N+1 problem**
- **Bonus 4: Indexes and EXPLAIN**
- **Bonus 5: Seed data**
- **Bonus 6: A connection pool (Postgres or SQLite)**
- **Bonus 7: JWT instead of sessions**
- **Bonus 8: OpenAPI and a docs page**
- **Bonus 9: Roles (RBAC)**
- **Bonus 10: Logging and request ids**
- **Bonus 11: Health, readiness and configuration**
- **Bonus 12: File upload**
- **Bonus 13: WebSocket live updates**
- **Bonus 14: A background job with Deno.cron**
- **Bonus 15: Rate limit on login**
- **Bonus 16: A cache with Deno KV**
- **Bonus 17: Docker**
- **Bonus 18: Continuous integration**
- **Bonus 19: Deploy**

Each section above includes the proof asked for in the handout.
