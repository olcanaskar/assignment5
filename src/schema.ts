// Abdullah Olcan Askar, 2024502180
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Worked example: the users table.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["user", "admin"] }).notNull().default("user"),
  // A SQL default runs for every row. A JavaScript Date.now() here would run once.
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
});

// A task belongs to exactly one user. The enum option restricts the values in
// TypeScript; the CHECK constraints in the generated migration do the same in SQLite.
export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  status: text("status", { enum: ["todo", "in-progress", "done"] })
    .notNull()
    .default("todo"),
  priority: text("priority", { enum: ["low", "medium", "high"] })
    .notNull()
    .default("medium"),
  // SQL default: every row gets the time of its own insert, not the start-up time.
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
  // Reserved for a future reminder feature; the migration adds it without a rewrite.
  dueDate: integer("due_date"),
  // Generated file name for an image attachment; null when there is none.
  attachment: text("attachment"),
  // A soft delete sets this column; every normal query filters it out.
  deletedAt: integer("deleted_at"),
}, (table) => [
  check("tasks_status_check", sql`${table.status} in ('todo', 'in-progress', 'done')`),
  check("tasks_priority_check", sql`${table.priority} in ('low', 'medium', 'high')`),
  index("idx_tasks_user_status").on(table.userId, table.status),
]);
