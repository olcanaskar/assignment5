// Abdullah Olcan Askar, 2024502180
import { z } from "zod";

const ConfigSchema = z.object({
  port: z.coerce.number().int().min(1).max(65535).default(8000),
  databaseUrl: z.string().min(1).default("file:./tasks.db"),
  databaseAuthToken: z.string().min(1).optional(),
  jwtSecret: z.string().min(1).default("dev-secret"),
  appEnv: z.enum(["development", "test", "production"]).default("development"),
  uploadDir: z.string().min(1).default("./uploads"),
  kvPath: z.string().min(1).optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Read the environment once, validate it, and return one typed object.
 * The caller decides what to do with the error; main.ts stops with a clear message.
 */
export function loadConfig(
  env: Record<string, string | undefined> = Deno.env.toObject(),
): Config {
  const parsed = ConfigSchema.safeParse({
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    databaseAuthToken: env.TURSO_AUTH_TOKEN,
    jwtSecret: env.JWT_SECRET,
    appEnv: env.APP_ENV,
    uploadDir: env.UPLOAD_DIR,
    kvPath: env.KV_PATH,
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`invalid configuration: ${details}`);
  }

  if (parsed.data.appEnv === "production" && parsed.data.jwtSecret === "dev-secret") {
    throw new Error("JWT_SECRET must not be the default value in production");
  }

  return parsed.data;
}
