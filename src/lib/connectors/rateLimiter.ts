/**
 * Per-host minimum-interval rate limiter. Requests to the same host are
 * serialized and spaced at least `minIntervalMs` apart; different hosts do
 * not block each other. Clock and sleep are injectable for tests.
 *
 * In-process only: one limiter per server process (PGlite local mode is
 * single-process). A multi-instance deployment needs a shared limiter —
 * documented in docs/LIMITATIONS.md.
 */

export interface RateLimiterDeps {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

const realDeps: RateLimiterDeps = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class HostRateLimiter {
  private lastStart = new Map<string, number>();
  private queue = new Map<string, Promise<void>>();

  constructor(
    private readonly intervals: Record<string, number>,
    private readonly defaultIntervalMs = 1000,
    private readonly deps: RateLimiterDeps = realDeps,
  ) {}

  intervalFor(host: string): number {
    return this.intervals[host] ?? this.defaultIntervalMs;
  }

  /** Resolves when a request to `host` may start; returns the wait applied (ms). */
  acquire(host: string): Promise<number> {
    const prev = this.queue.get(host) ?? Promise.resolve();
    let waited = 0;
    const next = prev.then(async () => {
      const last = this.lastStart.get(host);
      const now = this.deps.now();
      if (last !== undefined) {
        const wait = last + this.intervalFor(host) - now;
        if (wait > 0) {
          waited = wait;
          await this.deps.sleep(wait);
        }
      }
      this.lastStart.set(host, this.deps.now());
    });
    this.queue.set(host, next.catch(() => undefined));
    return next.then(() => waited);
  }
}
