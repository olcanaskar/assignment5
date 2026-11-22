// STUDENT NAME, STUDENT NUMBER
import type { MiddlewareHandler } from "hono";
import bcrypt from "bcryptjs";
import type { Db } from "./db.ts";

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

const SESSION_SECONDS = 60 * 60; // a session lives for one hour

/** Log a user in: store a random token for them and return it. */
export async function createSession(db: Db, userId: number): Promise<string> {
  const token = crypto.randomUUID();
  await db.client.execute({
    sql:
      "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, strftime('%s','now') + ?)",
    args: [token, userId, SESSION_SECONDS],
  });
  return token;
}

/** Return the user id that owns a valid, unexpired token, or null. */
export async function userIdFromToken(db: Db, token: string): Promise<number | null> {
  const res = await db.client.execute({
    sql:
      "SELECT user_id FROM sessions WHERE token = ? AND expires_at > strftime('%s','now')",
    args: [token],
  });
  const id = res.rows[0]?.user_id;
  return id === undefined ? null : Number(id);
}

/** Routes behind requireAuth can read the logged-in user id with c.get("userId"). */
export type Env = { Variables: { userId: number } };

/**
 * Read the bearer token, find its session, and either stop with 401 or store
 * the user id in the context for the route handler.
 */
export const requireAuth = (db: Db): MiddlewareHandler<Env> => async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const id = await userIdFromToken(db, token);
  if (id === null) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", id);
  await next();
};
