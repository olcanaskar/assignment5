// Abdullah Olcan Askar, 2024502180
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Worked example: the users table.
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // A SQL default runs for every row. A JavaScript Date.now() here would run once.
  createdAt: integer("created_at").notNull().default(sql`(strftime('%s','now'))`),
});

// The sessions table is given: a login makes a row, a token finds it.
export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
});

// A task belongs to exactly one user. The enum option restricts the values in
// TypeScript; the CHECK constraints in migrate() do the same in SQLite.
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
  // A soft delete sets this column; every normal query filters it out.
  deletedAt: integer("deleted_at"),
});
