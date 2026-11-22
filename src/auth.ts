// Abdullah Olcan Askar, 2024502180
import type { MiddlewareHandler } from "hono";
import { jwtVerify, SignJWT } from "jose";
import bcrypt from "bcryptjs";
import type { Db } from "./db.ts";

export type Role = "user" | "admin";
export type Session = { userId: number; role: Role };

/** Values that middleware stores on the Hono context for the route handlers. */
export type Env = {
  Variables: { userId: number; role: Role; requestId: string; db: Db };
};

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

const secret = () => new TextEncoder().encode(Deno.env.get("JWT_SECRET") ?? "dev-secret");

export function signToken(
  userId: number,
  role: Role = "user",
  expiresIn: string | number = "1h",
  jwtSecret = secret(),
): Promise<string> {
  return new SignJWT({ role })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setExpirationTime(expiresIn)
    .sign(jwtSecret);
}

/** Returns null for a bad signature, a malformed token or an expired token. */
export async function verifyToken(
  token: string,
  jwtSecret = secret(),
): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret);
    const userId = Number(payload.sub);
    const role = payload.role;
    if (!Number.isInteger(userId) || userId < 1) return null;
    if (role !== "user" && role !== "admin") return null;
    return { userId, role };
  } catch {
    return null;
  }
}

export const requireAuth: MiddlewareHandler<Env> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  const session = await verifyToken(token);
  if (!session) return c.json({ error: "unauthorized" }, 401);
  c.set("userId", session.userId);
  c.set("role", session.role);
  await next();
};

export const requireRole =
  (...roles: Role[]): MiddlewareHandler<Env> => async (c, next) => {
    const role = c.get("role");
    if (!role) return c.json({ error: "unauthenticated" }, 401);
    if (!roles.includes(role)) return c.json({ error: "forbidden" }, 403);
    await next();
  };
