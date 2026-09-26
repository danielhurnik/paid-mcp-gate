/** In-memory token buckets, one per caller key. Enough for a single instance. */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedMs: number }>();
  private readonly clock: () => number;

  constructor(clock: () => number = Date.now) {
    this.clock = clock;
  }

  take(key: string, perMinute: number): { ok: boolean; retryAfterSeconds: number } {
    const now = this.clock();
    const perMs = perMinute / 60_000;
    const bucket = this.buckets.get(key) ?? { tokens: perMinute, updatedMs: now };
    bucket.tokens = Math.min(perMinute, bucket.tokens + (now - bucket.updatedMs) * perMs);
    bucket.updatedMs = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      this.sweep(now);
      return { ok: true, retryAfterSeconds: 0 };
    }
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / perMs / 1000)) };
  }

  private sweep(now: number): void {
    if (this.buckets.size < 10_000) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedMs > 10 * 60_000) this.buckets.delete(key);
    }
  }
}
