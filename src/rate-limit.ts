export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number | undefined;
}

interface RateEntry {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  readonly #entries = new Map<string, RateEntry>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("O limite deve ser um inteiro positivo.");
    if (!Number.isFinite(windowMs) || windowMs < 1) throw new Error("A janela deve ser positiva.");
  }

  consume(key: string, now = Date.now()): RateLimitDecision {
    if (this.#entries.size > 10_000) this.#prune(now);
    let entry = this.#entries.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + this.windowMs };
      this.#entries.set(key, entry);
    }
    entry.count += 1;
    const allowed = entry.count <= this.limit;
    return {
      allowed,
      limit: this.limit,
      remaining: Math.max(this.limit - entry.count, 0),
      resetAt: entry.resetAt,
      retryAfterSeconds: allowed ? undefined : Math.max(Math.ceil((entry.resetAt - now) / 1000), 1),
    };
  }

  #prune(now: number): void {
    for (const [key, entry] of this.#entries) {
      if (entry.resetAt <= now) this.#entries.delete(key);
    }
  }
}
