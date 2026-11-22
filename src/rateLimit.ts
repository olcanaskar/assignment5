// Abdullah Olcan Askar, 2024502180
export type LoginLimiter = {
  /** Seconds to wait, or null when this email may try again. */
  retryAfter(email: string): number | null;
  recordFailure(email: string): void;
  clear(email: string): void;
};

/**
 * A small in-memory limiter. It is created per app, so tests and separate
 * processes never share counters.
 */
export function createLoginLimiter(
  now: () => number = Date.now,
  windowMs = 60_000,
  maxFailures = 5,
): LoginLimiter {
  const failures = new Map<string, { count: number; resetAt: number }>();

  return {
    retryAfter(email) {
      const current = now();
      const entry = failures.get(email);
      if (!entry || entry.resetAt <= current || entry.count < maxFailures) {
        return null;
      }
      return Math.max(1, Math.ceil((entry.resetAt - current) / 1000));
    },

    recordFailure(email) {
      const current = now();
      const entry = failures.get(email);
      if (!entry || entry.resetAt <= current) {
        failures.set(email, { count: 1, resetAt: current + windowMs });
        return;
      }
      entry.count++;
    },

    clear(email) {
      failures.delete(email);
    },
  };
}
