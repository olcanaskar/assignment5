# Tasks API: Abdullah Olcan Askar, 2024502180

MIS 233 Web Based Application Programming, Assignment 5.

A small Tasks API built with Deno 2, Hono, Drizzle ORM and SQLite. A user registers, logs
in, and can then create, list, update and delete only their own tasks. Every request body
and query string is checked with Zod, every failure has the same JSON shape, and the test
suite runs without starting a server.

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

The API listens on <http://localhost:8000>. In a second terminal:

```sh
deno task test
deno task check
deno fmt --check
deno lint
```

The given `dev` task starts `src/main.ts` with the defaults `file:./tasks.db` and
port 8000. The `.env` file is not loaded automatically by that task; it is only read when
you pass `--env-file=.env`. The project runs without a `.env`, which is useful for a fresh
hand-in.

If you change a table, delete the old `tasks.db` file first: `CREATE TABLE IF NOT EXISTS`
does not alter an existing table.

### Optional UI

`ui/` is the given React page. Start the API first, then in a second terminal:

```sh
deno task ui:install   # once
deno task ui:dev       # UI on http://localhost:5173
```

Vite forwards `/auth` and `/api` to port 8000.

## Tests

`deno task test` runs 20 tests. They cover:

- **Auth:** register 201, duplicate email 409, bad body 400, login 200 with a token, wrong
  password and unknown email both 401 with the same message, missing and unknown
  token 401.
- **Tasks:** table defaults, no token 401, create and list, owner and default fields,
  empty title 400, invalid status 400, another user's task 404 for read/update/delete,
  owner update and delete, pagination, bad query 400, status filter, unknown route 404.
- **Health:** `GET /health` returns `{ "ok": true }`.

Each test gets its own temporary SQLite file from `freshApp()`, so tests do not share
data. `app.request(...)` calls the Hono app directly; no server or port is needed.

## Design

### Tables

| Table      | Columns                                                      | Notes                                                                                                                  |
| ---------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `users`    | `id`, `email`, `password_hash`, `created_at`                 | `email` is unique; the password is stored only as a bcrypt hash.                                                       |
| `sessions` | `token`, `user_id`, `expires_at`                             | `token` is a random UUID; a session lasts one hour.                                                                    |
| `tasks`    | `id`, `user_id`, `title`, `status`, `priority`, `created_at` | `user_id` references `users.id`; `status` is `todo`, `in-progress` or `done`; `priority` is `low`, `medium` or `high`. |

`tasks.status` and `tasks.priority` are restricted twice: with the Drizzle
`{ enum: [...] }` option for TypeScript, and with SQL `CHECK` constraints in `migrate()`
for SQLite. The two definitions in `src/schema.ts` and `src/db.ts` describe the same
table.

`created_at` uses the SQL default `(strftime('%s','now'))`. A JavaScript `Date.now()` in
the schema would run once at start-up and give every row the same timestamp.

### Routes

| Method and path         | Token? | Success                             | Main failures                             |
| ----------------------- | ------ | ----------------------------------- | ----------------------------------------- |
| `GET /health`           | no     | 200 `{ "ok": true }`                | -                                         |
| `POST /auth/register`   | no     | 201 `{ id, email }`                 | 400 bad body, 409 email taken             |
| `POST /auth/login`      | no     | 200 `{ token }`                     | 400 bad body, 401 wrong email or password |
| `GET /api/tasks`        | yes    | 200 `{ items, page, limit, total }` | 400 bad query, 401                        |
| `POST /api/tasks`       | yes    | 201 task                            | 400, 401                                  |
| `GET /api/tasks/:id`    | yes    | 200 task                            | 401, 404                                  |
| `PUT /api/tasks/:id`    | yes    | 200 updated task                    | 400, 401, 404                             |
| `DELETE /api/tasks/:id` | yes    | 200 `{ "ok": true }`                | 401, 404                                  |

### Why these decisions

- **Another user's task is 404, not 403.** A 403 would tell the caller that the task
  exists. With 404 the API behaves as if the row is not there, which leaks nothing.
- **Wrong email and wrong password use the same 401 message.** The client learns that the
  credentials are wrong, but not whether the email is registered.
- **The password hash never leaves the database.** Register returns only `{ id, email }`,
  and login returns only `{ token }`.
- **Sessions are rows in SQLite.** The token is a random UUID stored in `sessions` with an
  expiry. Deleting the row would log the user out immediately; a JWT would be a bonus.
- **Zod validates the boundary.** `safeParse` produces the 400 body with `issues`; a bad
  token, an unknown route and a server error use `{ "error": "..." }`. `app.onError` logs
  the real error and returns only `internal error`.
- **Pagination is deterministic.** The list uses `ORDER BY created_at DESC, id DESC`.
  `created_at` has second precision, so the id is the tiebreaker for tasks created in the
  same second. The count query uses the same owner and status filter as the page query.
- **PUT replaces the whole task.** The same `TaskBody` schema is used for POST and PUT, so
  an omitted `status` or `priority` falls back to its default. The given UI was changed to
  send the current priority when it advances a task.
- **Every task query includes the owner.** The helper `own(id, userId)` combines
  `eq(tasks.id, id)` and `eq(tasks.userId, userId)`; Drizzle passes the values as SQL
  parameters, so user input is never joined into a SQL string.

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
# {"token":"68e20042-..."}   (the token is shortened here)
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

### List tasks (empty)

```sh
curl -s $BASE/api/tasks -H "authorization: Bearer $TOKEN"
# {"items":[],"page":1,"limit":20,"total":0}
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
# {"id":1,"userId":1,"title":"Write the README","status":"todo","priority":"high","createdAt":1795343577}
```

```sh
curl -s -X POST $BASE/api/tasks \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"title":"Run the test suite"}'
# {"id":2,"userId":1,"title":"Run the test suite","status":"todo","priority":"medium","createdAt":1795343577}
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
# {"items":[{"id":2,"userId":1,"title":"Run the test suite","status":"todo","priority":"medium","createdAt":1795343577},{"id":1,"userId":1,"title":"Write the README","status":"todo","priority":"high","createdAt":1795343577}],"page":1,"limit":20,"total":2}
```

### Get one task

```sh
curl -s $BASE/api/tasks/1 -H "authorization: Bearer $TOKEN"
# {"id":1,"userId":1,"title":"Write the README","status":"todo","priority":"high","createdAt":1795343577}
```

A task that belongs to another user answers 404. After registering `bob@example.com` and
using Bob's token:

```sh
curl -s $BASE/api/tasks/1 -H "authorization: Bearer $BOB_TOKEN"
# {"error":"not found"}
```

### Update a task

`PUT` replaces the task, so it sends the current `priority` as well:

```sh
curl -s -X PUT $BASE/api/tasks/1 \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $TOKEN" \
  -d '{"title":"Write the README","status":"done","priority":"high"}'
# {"id":1,"userId":1,"title":"Write the README","status":"done","priority":"high","createdAt":1795343577}
```

### Pagination and filtering

```sh
curl -s "$BASE/api/tasks?page=1&limit=1&status=done" \
  -H "authorization: Bearer $TOKEN"
# {"items":[{"id":1,"userId":1,"title":"Write the README","status":"done","priority":"high","createdAt":1795343577}],"page":1,"limit":1,"total":1}
```

A bad limit is a 400, not a crash:

```sh
curl -s "$BASE/api/tasks?limit=1000" -H "authorization: Bearer $TOKEN"
# {"error":"validation failed","issues":[{"origin":"number","code":"too_big","maximum":100,"inclusive":true,"path":["limit"],"message":"Too big: expected number to be <=100"}]}
```

### Delete a task

```sh
curl -s -X DELETE $BASE/api/tasks/2 -H "authorization: Bearer $TOKEN"
# {"ok":true}
```

### Unknown route

```sh
curl -s $BASE/nope
# {"error":"not found"}
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

### 6. `deno task check` only checks the top level

The task is `deno check src/*.ts tests/*.ts`. If I had put a route file in
`src/routes/tasks.ts`, it would not have been type-checked. I kept the source files flat
in `src/` and `tests/` so the given task covers every file. If the project grows, the
check task should be extended.

## Bonuses claimed

None yet. Each bonus I add will start with the exact line `Bonus N: Title` from the
handout and will include the proof asked for in that bonus.
