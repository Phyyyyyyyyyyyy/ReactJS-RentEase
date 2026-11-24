/**
 * Limits how often something can happen, to stop password guessing and
 * mass sign-ups. Counts are kept in memory (they reset when the server restarts).
 *
 *   const limiter = new RateLimiter({ limit: 10, windowMs: 15 * 60_000 });
 *   if (limiter.retryAfter(key)) -> refuse;  limiter.hit(key) after a failure;  limiter.reset(key) after success.
 */
export class RateLimiter {
  constructor({ limit, windowMs }) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.hits = new Map(); // key -> timestamps (ms) of recent hits
  }

  recent(key, now = Date.now()) {
    const times = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    if (times.length) this.hits.set(key, times);
    else this.hits.delete(key);
    return times;
  }

  /** Seconds until `key` may try again, or 0 if it isn't blocked. */
  retryAfter(key) {
    const now = Date.now();
    const times = this.recent(key, now);
    if (times.length < this.limit) return 0;
    return Math.ceil((times[times.length - this.limit] + this.windowMs - now) / 1000);
  }

  hit(key) {
    const times = this.recent(key);
    times.push(Date.now());
    this.hits.set(key, times);
    if (this.hits.size > 10_000) this.prune();
  }

  reset(key) {
    this.hits.delete(key);
  }

  prune() {
    for (const key of this.hits.keys()) this.recent(key);
  }
}

export function minutes(seconds) {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return `${m} minute${m === 1 ? '' : 's'}`;
}
