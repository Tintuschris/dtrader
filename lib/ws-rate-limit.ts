/**
 * Tiny in-memory sliding-window rate limiter, used by the diag endpoint so a
 * misbehaving client (or a leaked token) cannot flood the drop log.
 */

export type RateLimiter = {
  allow(key: string, now?: number): boolean;
  reset(): void;
};

export function createRateLimiter(opts: { windowMs: number; max: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(key: string, now: number = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < opts.windowMs);
      if (recent.length >= opts.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.set(key, recent);
      return true;
    },
    reset(): void {
      hits.clear();
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Singleton used by the diag route (also gives tests a reset hook).  */
/* ------------------------------------------------------------------ */
let diagLimiter: RateLimiter | null = null;

/** Lazily-created shared limiter for /api/diag (env read at first use). */
export function getDiagRateLimiter(): RateLimiter {
  if (!diagLimiter) {
    diagLimiter = createRateLimiter({
      windowMs: 60_000,
      max: Number(process.env.WS_DIAG_MAX_PER_MIN ?? 30),
    });
  }
  return diagLimiter;
}

/** Test hook — clear the in-memory rate-limit window. */
export function resetDiagRateLimiter(): void {
  diagLimiter?.reset();
}
