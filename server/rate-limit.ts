/**
 * Fixed-window rate limiting in memory. Enough for one server instance; with several instances
 * each enforces its own limit (move this to Postgres or Redis if that matters).
 */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();

  /** Counts one attempt; false when `key` has used up `max` attempts in the current window. */
  take(key: string, max: number, windowMs: number, now = Date.now()): boolean {
    if (this.windows.size > 50_000) this.sweep(now, windowMs);
    const w = this.windows.get(key);
    if (!w || now - w.start >= windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count += 1;
    return w.count <= max;
  }

  private sweep(now: number, windowMs: number) {
    for (const [key, w] of this.windows) if (now - w.start >= windowMs) this.windows.delete(key);
  }
}
