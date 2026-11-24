// Abdullah Olcan Askar, 2024502180
import { join, relative } from "@std/path";

const root = Deno.cwd();
const header = "Abdullah Olcan Askar, 2024502180";
const liveUrl = "https://tasks-api-f30l.onrender.com";
const errors: string[] = [];

function check(ok: boolean, message: string) {
  if (ok) {
    console.log(`✓ ${message}`);
  } else {
    errors.push(message);
    console.error(`✗ ${message}`);
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = join(dir, entry.name);
    if (entry.isDirectory) yield* walk(path);
    else if (entry.isFile) yield path;
  }
}

const required = [
  "README.md",
  "deno.json",
  "src/main.ts",
  "src/app.ts",
  "src/auth.ts",
  "src/schema.ts",
  "src/db.ts",
  "tests/helpers.ts",
  "tests/tasks_test.ts",
  "drizzle",
  "Dockerfile",
  "render.yaml",
  "scripts/seed.ts",
  "scripts/smoke-remote.ts",
];

for (const path of required) {
  try {
    await Deno.stat(join(root, path));
    check(true, `exists: ${path}`);
  } catch {
    check(false, `missing: ${path}`);
  }
}

const readme = await Deno.readTextFile(join(root, "README.md"));
check(
  readme.includes(`# Tasks API: ${header}`),
  "README starts with the student name and number",
);
check(readme.includes("## My own log"), "README has 'My own log'");
check(readme.includes("## Repository"), "README has the repository section");
check(readme.includes(liveUrl), "README has the live URL");
check(readme.includes("## Bonus 19: Deploy"), "README claims Bonus 19");

const tsFiles: string[] = [join(root, "drizzle.config.ts")];
for (const dir of ["src", "tests", "scripts"]) {
  for await (const path of walk(join(root, dir))) {
    if (path.endsWith(".ts")) tsFiles.push(path);
  }
}

const missingHeaders: string[] = [];
for (const path of tsFiles) {
  const firstLine = (await Deno.readTextFile(path)).split(/\r?\n/, 1)[0];
  if (!firstLine.includes(header)) missingHeaders.push(relative(root, path));
}
check(
  missingHeaders.length === 0,
  `student header in ${tsFiles.length} TypeScript files` +
    (missingHeaders.length ? `; missing: ${missingHeaders.join(", ")}` : ""),
);

const gitignore = await Deno.readTextFile(join(root, ".gitignore"));
for (const pattern of [".env", "*.db", "node_modules", "uploads/"]) {
  check(gitignore.includes(pattern), `.gitignore contains ${pattern}`);
}

const denoConfig = JSON.parse(await Deno.readTextFile(join(root, "deno.json"))) as {
  tasks?: Record<string, string>;
};
for (
  const task of [
    "dev",
    "test",
    "check",
    "seed",
    "smoke:remote",
    "verify:submission",
    "db:generate",
    "db:migrate",
  ]
) {
  check(
    typeof denoConfig.tasks?.[task] === "string",
    `deno.json task exists: ${task}`,
  );
}

try {
  const git = await new Deno.Command("git", {
    args: ["ls-files"],
    cwd: root,
    stdout: "piped",
    stderr: "null",
  }).output();

  if (!git.success) {
    console.warn("! git ls-files failed; tracked-file check skipped");
  } else {
    const tracked = new TextDecoder()
      .decode(git.stdout)
      .split(/\r?\n/)
      .filter(Boolean);

    const badTracked = tracked.filter((path) =>
      path === ".env" ||
      path.endsWith(".db") ||
      path.endsWith(".db-journal") ||
      path.startsWith("uploads/") ||
      path.includes("node_modules/")
    );
    check(
      badTracked.length === 0,
      `no forbidden files tracked${
        badTracked.length ? `: ${badTracked.join(", ")}` : ""
      }`,
    );
  }
} catch {
  console.warn("! git is not available; tracked-file check skipped");
}

if (errors.length > 0) {
  console.error(`\n${errors.length} submission check(s) failed.`);
  Deno.exit(1);
}

console.log("\nAll submission checks passed.");
