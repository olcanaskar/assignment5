// Abdullah Olcan Askar, 2024502180
import { eq } from "drizzle-orm";
import { hashPassword } from "./auth.ts";
import type { Db } from "./db.ts";
import { tasks, users } from "./schema.ts";

const DEMO_USERS = [
  { email: "demo1@example.com", password: "secret123" },
  { email: "demo2@example.com", password: "secret123" },
] as const;

const TITLES = [
  "Plan the week",
  "Read the Deno docs",
  "Write the report",
  "Review a pull request",
  "Fix the login form",
  "Prepare the demo",
  "Update the README",
  "Run the test suite",
  "Clean up the database",
  "Ship the release",
] as const;

const STATUSES = ["todo", "in-progress", "done"] as const;
const PRIORITIES = ["low", "medium", "high"] as const;

export type SeedResult = {
  users: number;
  tasks: number;
  skippedUsers: number;
};

/**
 * Create two demo users and ten tasks each. On a second run the users already
 * exist and already have tasks, so nothing is duplicated.
 */
export async function seedDemoData(db: Db): Promise<SeedResult> {
  let createdUsers = 0;
  let createdTasks = 0;
  let skippedUsers = 0;

  for (const [userIndex, demo] of DEMO_USERS.entries()) {
    const passwordHash = await hashPassword(demo.password);
    const [created] = await db.db
      .insert(users)
      .values({ email: demo.email, passwordHash })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (created) createdUsers++;

    let userId = created?.id;
    if (userId === undefined) {
      const [existing] = await db.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, demo.email));
      userId = existing?.id;
    }
    if (userId === undefined) {
      throw new Error(`could not find or create ${demo.email}`);
    }

    const [existingTask] = await db.db
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.userId, userId))
      .limit(1);
    if (existingTask) {
      skippedUsers++;
      continue;
    }

    const values = TITLES.map((title, taskIndex) => ({
      userId,
      title,
      status: STATUSES[(taskIndex + userIndex) % STATUSES.length],
      priority: PRIORITIES[(taskIndex + userIndex) % PRIORITIES.length],
    }));
    await db.db.insert(tasks).values(values);
    createdTasks += values.length;
  }

  return { users: createdUsers, tasks: createdTasks, skippedUsers };
}
