import {
  API_BASES,
  COOLDOWN_MS,
  MAX_CONSECUTIVE_FAILURES,
  type ApiBase,
} from '@/constants/endpoints';

export interface EndpointHealth {
  id: string;
  /** Lifetime totals this session (shown on the Cache page). */
  successes: number;
  failures: number;
  consecutiveFailures: number;
  /** EWMA of answer time, and of its absolute deviation (for the p75). */
  latencyEmaMs: number;
  latencyDevMs: number;
  /** Recency-weighted success / failure weights (decay 0.9 per outcome). */
  okWeight: number;
  failWeight: number;
  cooldownUntil: number;
  /** Set by 429 / 503: no new requests go here before this time. */
  limitedUntil: number;
  inFlight: number;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
}

/** 10.1 — at most this many requests in flight per endpoint. */
export const MAX_IN_FLIGHT = 6;
/** Bounds for the hedge delay (an endpoint's p75 answer time). */
export const HEDGE_MIN_MS = 350;
export const HEDGE_MAX_MS = 900;
/** A rate limit with no usable Retry-After cools the endpoint this long. */
export const RATE_LIMIT_DEFAULT_MS = 30_000;
const RATE_LIMIT_MAX_MS = 10 * 60_000;
const DECAY = 0.9;
/** What a failed attempt costs before the call moves on (an error page, a
 *  stall, a timeout): at least this, or the endpoint's own latency. */
const FAILURE_COST_MS = 2000;

function fresh(id: string): EndpointHealth {
  return {
    id,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    latencyEmaMs: 600,
    latencyDevMs: 200,
    okWeight: 0,
    failWeight: 0,
    cooldownUntil: 0,
    limitedUntil: 0,
    inFlight: 0,
    lastSuccessAt: null,
    lastFailureAt: null,
  };
}

/**
 * `Retry-After` as milliseconds: delta-seconds or an HTTP date. Null when the
 * header is missing or unreadable.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

type Waiter = { resolve: () => void; interactive: boolean };

/**
 * In-memory per-session health registry (10.1 allotment).
 *
 * Ranking is by EXPECTED TIME TO SUCCESS: the latency EWMA plus the
 * failure odds (a recency-weighted, Laplace-smoothed success rate) times
 * what a failure costs, stretched by recent consecutive failures. A fast
 * endpoint that fails half the time ranks behind a slower one that always
 * answers.
 *
 * An endpoint that fails MAX_CONSECUTIVE_FAILURES times in a row, or answers
 * 429/503, cools down (honouring Retry-After) and is skipped until the
 * cooldown expires — unless every endpoint is cooling, in which case all are
 * tried anyway (graceful last resort). Each endpoint also has a small
 * concurrency cap; callers queue for a slot only when every endpoint is full.
 */
class HealthRegistry {
  private map = new Map<string, EndpointHealth>();
  private waiters = new Map<string, Waiter[]>();
  /** Swappable for tests (weighted spreading). */
  random: () => number = Math.random;

  private get(id: string): EndpointHealth {
    let h = this.map.get(id);
    if (!h) {
      h = fresh(id);
      this.map.set(id, h);
    }
    return h;
  }

  private observeLatency(h: EndpointHealth, ms: number): void {
    h.latencyDevMs = h.latencyDevMs * 0.75 + Math.abs(ms - h.latencyEmaMs) * 0.25;
    h.latencyEmaMs = h.latencyEmaMs * 0.7 + ms * 0.3;
  }

  recordSuccess(id: string, latencyMs: number): void {
    const h = this.get(id);
    h.successes += 1;
    h.okWeight = h.okWeight * DECAY + 1;
    h.failWeight *= DECAY;
    h.consecutiveFailures = 0;
    h.cooldownUntil = 0;
    h.limitedUntil = 0;
    this.observeLatency(h, latencyMs);
    h.lastSuccessAt = Date.now();
  }

  recordFailure(id: string): void {
    const h = this.get(id);
    h.failures += 1;
    h.failWeight = h.failWeight * DECAY + 1;
    h.okWeight *= DECAY;
    h.consecutiveFailures += 1;
    h.lastFailureAt = Date.now();
    if (h.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      h.cooldownUntil = Math.max(h.cooldownUntil, Date.now() + COOLDOWN_MS);
    }
  }

  /** 429 / 503: the endpoint asked us to back off. Cool it for Retry-After
   *  (bounded), default 30 s, and count it as a failure for the rate. */
  recordRateLimited(id: string, retryAfterMs: number | null): void {
    const h = this.get(id);
    this.recordFailure(id);
    const wait = Math.min(Math.max(retryAfterMs ?? RATE_LIMIT_DEFAULT_MS, 1000), RATE_LIMIT_MAX_MS);
    h.limitedUntil = Math.max(h.limitedUntil, Date.now() + wait);
    h.cooldownUntil = Math.max(h.cooldownUntil, h.limitedUntil);
  }

  /** A hedged loser we aborted after `elapsedMs` without an answer: no
   *  failure, but it was at least that slow — let the EWMA know. */
  recordSlow(id: string, elapsedMs: number): void {
    const h = this.get(id);
    if (elapsedMs > h.latencyEmaMs) this.observeLatency(h, elapsedMs);
  }

  /** Recency-weighted success rate, Laplace-smoothed (a fresh endpoint = 0.5). */
  successRate(id: string): number {
    const h = this.get(id);
    return (h.okWeight + 1) / (h.okWeight + h.failWeight + 2);
  }

  /** Expected milliseconds until a call started here yields a usable
   *  answer: its latency, plus the odds of failing times what a failure
   *  costs, stretched while it is on a failure streak. */
  expectedMs(id: string): number {
    const h = this.get(id);
    const p = Math.max(this.successRate(id), 0.05);
    const failCost = Math.max(h.latencyEmaMs, FAILURE_COST_MS);
    return (h.latencyEmaMs + ((1 - p) / p) * failCost) * (1 + h.consecutiveFailures * 0.5);
  }

  /** Higher is better (kept for callers that compare endpoints). */
  score(id: string): number {
    return 1000 / this.expectedMs(id);
  }

  /** The endpoint's p75 answer time, bounded — how long an interactive call
   *  waits on it before hedging to the next endpoint. */
  hedgeDelayMs(id: string): number {
    const h = this.get(id);
    const p75 = h.latencyEmaMs + 0.675 * h.latencyDevMs;
    return Math.round(Math.min(Math.max(p75, HEDGE_MIN_MS), HEDGE_MAX_MS));
  }

  isCoolingDown(id: string): boolean {
    return this.get(id).cooldownUntil > Date.now();
  }

  /** Asked us to back off (429 / 503 + Retry-After): allot elsewhere. */
  isRateLimited(id: string): boolean {
    return this.get(id).limitedUntil > Date.now();
  }

  hasSlot(id: string): boolean {
    return this.get(id).inFlight < MAX_IN_FLIGHT;
  }

  /** Bases ordered best-first; full ones next, cooled-down ones last. */
  ranked(bases: ApiBase[] = API_BASES): ApiBase[] {
    const tier = (b: ApiBase) => (this.isCoolingDown(b.id) ? 2 : this.hasSlot(b.id) ? 0 : 1);
    return [...bases].sort(
      (a, b) => tier(a) - tier(b) || this.expectedMs(a.id) - this.expectedMs(b.id),
    );
  }

  /**
   * Background allotment: the first endpoint is drawn at random, weighted by
   * health (1 / expected time) among the ready ones, so prefetch traffic is
   * spread instead of always queueing on the top endpoint. The rest follow
   * in rank order as fallbacks.
   */
  spread(bases: ApiBase[] = API_BASES): ApiBase[] {
    const order = this.ranked(bases);
    const ready = order.filter((b) => !this.isCoolingDown(b.id) && this.hasSlot(b.id));
    if (ready.length < 2) return order;
    const weights = ready.map((b) => 1 / this.expectedMs(b.id));
    let r = this.random() * weights.reduce((s, w) => s + w, 0);
    let pick = ready[ready.length - 1];
    for (let i = 0; i < ready.length; i += 1) {
      r -= weights[i];
      if (r < 0) {
        pick = ready[i];
        break;
      }
    }
    return [pick, ...order.filter((b) => b !== pick)];
  }

  /** Take a slot on `id`, waiting (interactive callers first) while the
   *  endpoint is full. Resolves false when `signal` aborts first. */
  acquire(id: string, interactive: boolean, signal?: AbortSignal): Promise<boolean> {
    const h = this.get(id);
    if (h.inFlight < MAX_IN_FLIGHT) {
      h.inFlight += 1;
      return Promise.resolve(true);
    }
    if (signal?.aborted) return Promise.resolve(false);
    return new Promise((done) => {
      const queue = this.waiters.get(id) ?? [];
      this.waiters.set(id, queue);
      const waiter: Waiter = {
        interactive,
        resolve: () => {
          signal?.removeEventListener('abort', onAbort);
          h.inFlight += 1;
          done(true);
        },
      };
      const onAbort = () => {
        const i = queue.indexOf(waiter);
        if (i >= 0) queue.splice(i, 1);
        done(false);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      // Interactive waiters jump the background ones.
      const at = interactive ? queue.findIndex((w) => !w.interactive) : -1;
      if (at >= 0) queue.splice(at, 0, waiter);
      else queue.push(waiter);
    });
  }

  release(id: string): void {
    const h = this.get(id);
    h.inFlight = Math.max(0, h.inFlight - 1);
    const next = this.waiters.get(id)?.shift();
    if (next) next.resolve();
  }

  snapshot(): EndpointHealth[] {
    return API_BASES.map((b) => ({ ...this.get(b.id) }));
  }

  /** Test hook. */
  reset(): void {
    this.map.clear();
    this.waiters.clear();
    this.random = Math.random;
  }
}

export const healthRegistry = new HealthRegistry();
