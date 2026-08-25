/**
 * Durable Object token-bucket rate limiter (closes audit finding H-SRV-11).
 *
 * The in-memory limiter in ratelimit.ts is per-isolate/per-PoP; an attacker
 * sharding requests across colos sidesteps it. Sensitive low-volume routes
 * (username claim, room create, handoff, feedback) additionally consult this
 * DO — one instance per route, so its memory IS the global bucket state.
 *
 * Free-plan friendly: SQLite-backed DO class with no persisted storage —
 * buckets live in instance memory. If the platform hibernates the instance,
 * buckets reset to full, which only ever errs on the permissive side.
 */

interface Bucket {
  tokens: number;
  last: number;
}

const MAX_BUCKETS = 5000;

export class RateLimiterDO {
  private buckets = new Map<string, Bucket>();

  async fetch(request: Request): Promise<Response> {
    interface CheckBody {
      key?: string;
      capacity?: number;
      refillPerMinute?: number;
    }
    let body: CheckBody | null = null;
    try {
      body = (await request.json()) as CheckBody;
    } catch {
      /* no body — treated as an allow */
    }
    const key = typeof body?.key === 'string' ? body.key : '';
    if (!key) return Response.json({ allow: true });
    const capacity = Number(body?.capacity) > 0 ? Number(body?.capacity) : 20;
    const refillPerMs = (Number(body?.refillPerMinute) > 0 ? Number(body?.refillPerMinute) : 10) / 60_000;

    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= MAX_BUCKETS) {
        const cutoff = now - 10 * 60_000;
        for (const [k, v] of this.buckets) if (v.last < cutoff) this.buckets.delete(k);
        if (this.buckets.size >= MAX_BUCKETS) this.buckets.clear();
      }
      b = { tokens: capacity, last: now };
      this.buckets.set(key, b);
    }
    b.tokens = Math.min(capacity, b.tokens + (now - b.last) * refillPerMs);
    b.last = now;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return Response.json({ allow: true });
    }
    const retryAfter = Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000));
    return Response.json({ allow: false, retryAfter });
  }
}
